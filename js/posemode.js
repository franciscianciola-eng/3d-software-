// 🎭 Pose mode — the animation creator for rigged models.
// Click a joint dot, rotate it with the gizmo (E), move the Hips with W,
// scrub the timeline and press 🔑 to record poses. The recorded poses become
// the "✎ Keyframed motion" clip: playable, loopable, exported in the GLB.
import * as THREE from 'three';
import { app } from './app.js';
import { toast } from './utils.js';
import { isRigged, setSkeletonVisible, rigEditActive, cancelJointEdit } from './autorig.js';
import { canonicalFor } from './bonemap.js';
import { addKeyAtCurrentTime, stop as timelineStop } from './timeline.js';

const state = {
  active: false,
  item: null,
  bones: [],
  markers: [],
  group: null,
  ticker: null,
  offSel: null,
  offRemoved: null,
  prevSkel: false,
  savedMode: null,
  savedSpace: null,
};

export function poseActive(item) {
  return state.active && (!item || state.item === item);
}

function isHipsBone(bone) {
  return canonicalFor(bone.name) === 'hips' || !(bone.parent && bone.parent.isBone);
}

/** Snapshot every bone's local rotation (+ root-bone positions) for keyframing. */
export function capturePoseData(item) {
  const pose = {}, bonePos = {};
  item.traverse(o => {
    if (!o.isBone) return;
    if (!(o.name in pose)) pose[o.name] = o.quaternion.toArray();
    if (isHipsBone(o) && !(o.name in bonePos)) bonePos[o.name] = o.position.toArray();
  });
  return { pose, bonePos };
}

export function enterPoseMode(item) {
  if (!item || !isRigged(item)) {
    toast('Pose mode needs a rigged model — Auto-Rig it first (sidebar → Rigging).', 'warn', 5200);
    return;
  }
  if (rigEditActive()) cancelJointEdit();
  if (state.active) exitPoseMode();
  timelineStop();

  state.active = true;
  state.item = item;
  state.prevSkel = !!item.userData._skelHelper;
  setSkeletonVisible(item, true);

  state.bones = [];
  item.traverse(o => { if (o.isBone && !o.name.endsWith('_End')) state.bones.push(o); });

  const box = new THREE.Box3().setFromObject(item);
  const H = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).y, 0.05);
  const r = THREE.MathUtils.clamp(0.016 * H, 0.006, 0.15);
  const geo = new THREE.SphereGeometry(r, 10, 8);
  const group = new THREE.Group();
  group.name = '__poseMarkers';
  state.group = group;
  state.markers = [];
  for (const bone of state.bones) {
    const hips = isHipsBone(bone);
    const mat = new THREE.MeshBasicMaterial({
      color: hips ? 0xffcf5a : 0x6ea1ff,
      depthTest: false, transparent: true, opacity: 0.9,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 999;
    m.userData.bone = bone;
    group.add(m);
    state.markers.push(m);
  }
  app.scene.add(group);

  state.ticker = () => {
    state.item.updateMatrixWorld(true);
    for (const m of state.markers) {
      m.position.setFromMatrixPosition(m.userData.bone.matrixWorld);
      const attached = app.tc.object === m.userData.bone;
      m.material.opacity = attached ? 1 : 0.9;
      const s = attached ? 1.5 : 1;
      m.scale.setScalar(s);
    }
  };
  app.tickers.push(state.ticker);

  state.savedMode = app.tc.mode;
  state.savedSpace = app.tc.space;
  app.tc.detach();
  app.tc.setMode('rotate');
  app.tc.setSpace('local');

  app.pickOverride = raycaster => {
    const hits = raycaster.intersectObjects(state.markers, false);
    if (hits.length) attachBone(hits[0].object.userData.bone);
    else if (app.tc.object?.isBone) app.tc.detach();
    return true; // clicks never change selection while posing
  };

  state.offSel = app.events.on('selection-changed', o => { if (o !== state.item) exitPoseMode(); });
  state.offRemoved = app.events.on('item-removed', it => { if (it === state.item) exitPoseMode(); });

  document.getElementById('pose-toolbar').classList.remove('hidden');
  app.events.emit('pose-changed', true);
  toast('🎭 <b>Pose mode</b> — click a dot, rotate it (<b>E</b>), move the yellow Hips dot with <b>W</b>. Scrub the timeline, press <b>🔑 Key pose</b>, move time, pose again… then <b>Space</b> to watch it.', '', 8200);
}

function attachBone(bone) {
  app.tc.attach(bone);
  if (!isHipsBone(bone) && app.tc.mode === 'translate') app.tc.setMode('rotate');
}

export function exitPoseMode() {
  if (!state.active) return;
  state.offSel?.(); state.offRemoved?.();
  const ti = app.tickers.indexOf(state.ticker);
  if (ti !== -1) app.tickers.splice(ti, 1);
  app.scene.remove(state.group);
  app.pickOverride = null;
  if (app.tc.object?.isBone) app.tc.detach();
  app.tc.setMode(state.savedMode || 'translate');
  app.tc.setSpace(state.savedSpace || 'world');
  const item = state.item;
  if (!state.prevSkel) setSkeletonVisible(item, false);
  document.getElementById('pose-toolbar').classList.add('hidden');
  state.active = false; state.item = null; state.bones = []; state.markers = []; state.group = null;
  state.ticker = null; state.offSel = null; state.offRemoved = null;
  if (app.selected === item && item) app.tc.attach(item);
  app.events.emit('pose-changed', false);
}

/** Keyboard while posing. Returns true when the key was handled. */
export function handlePoseKey(k) {
  if (!state.active) return false;
  if (k === 'escape') { exitPoseMode(); return true; }
  if (k === 'e') { app.tc.setMode('rotate'); return true; }
  if (k === 'w') {
    if (app.tc.object?.isBone && isHipsBone(app.tc.object)) app.tc.setMode('translate');
    else toast('Only the yellow <b>Hips</b> dot can be moved — everything else rotates (<b>E</b>).', '', 3200);
    return true;
  }
  if (k === 'r') return true; // no scaling bones
  return false;
}

function resetPose() {
  if (!state.active) return;
  const done = new Set();
  state.item.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton && !done.has(o.skeleton)) {
      done.add(o.skeleton);
      o.skeleton.pose();
    }
  });
  app.events.emit('transform-changed', state.item);
  toast('↩ Back to rest pose (unkeyed changes only — your 🔑 keys are safe)', '', 3000);
}

export function initPoseToolbar() {
  document.getElementById('pose-reset').addEventListener('click', resetPose);
  document.getElementById('pose-key').addEventListener('click', () => addKeyAtCurrentTime());
  document.getElementById('pose-done').addEventListener('click', exitPoseMode);
}
