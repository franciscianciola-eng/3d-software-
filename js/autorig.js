// One-click humanoid auto-rigging:
//  1) a standard skeleton is fitted to the model's bounding box,
//  2) the user may drag joint dots to fine-tune placement (mirrored L/R),
//  3) "Bind skin" converts meshes to SkinnedMesh with automatic
//     distance-based vertex weights (4 influences, sharp falloff).
// Bone names follow the common Mixamo-style convention, so retargeting
// mocap onto an auto-rigged model works out of the box.
import * as THREE from 'three';
import { app } from './app.js';
import { toast } from './utils.js';

// name, parent, position builder (H=height, S=half arm span, g=ground y, c=center)
function templateJoints(box) {
  const size = box.getSize(new THREE.Vector3());
  const H = Math.max(size.y, 0.01);
  const S = Math.max(size.x / 2, 0.05 * H);
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const g = box.min.y;
  const f = (box.max.z - cz) >= (cz - box.min.z) ? 1 : -1; // facing direction
  const legX = Math.min(0.055 * H, 0.35 * S);
  const armY = g + 0.815 * H;

  const J = (name, parent, x, y, z) => ({ name, parent, pos: new THREE.Vector3(x, y, z) });
  const sides = [['Left', 1], ['Right', -1]];
  const joints = [
    J('Hips', null, cx, g + 0.52 * H, cz),
    J('Spine', 'Hips', cx, g + 0.585 * H, cz),
    J('Spine1', 'Spine', cx, g + 0.67 * H, cz),
    J('Spine2', 'Spine1', cx, g + 0.755 * H, cz),
    J('Neck', 'Spine2', cx, g + 0.855 * H, cz),
    J('Head', 'Neck', cx, g + 0.9 * H, cz),
    J('HeadTop_End', 'Head', cx, g + 0.995 * H, cz),
  ];
  for (const [side, s] of sides) {
    joints.push(
      J(`${side}Shoulder`, 'Spine2', cx + s * 0.045 * H, g + 0.83 * H, cz),
      J(`${side}Arm`, `${side}Shoulder`, cx + s * Math.min(0.10 * H, 0.30 * S), armY, cz),
      J(`${side}ForeArm`, `${side}Arm`, cx + s * Math.min(0.22 * H, 0.60 * S), armY, cz),
      J(`${side}Hand`, `${side}ForeArm`, cx + s * Math.min(0.32 * H, 0.86 * S), armY, cz),
      J(`${side}Hand_End`, `${side}Hand`, cx + s * Math.min(0.37 * H, 0.99 * S), armY, cz),
      J(`${side}UpLeg`, 'Hips', cx + s * legX, g + 0.50 * H, cz),
      J(`${side}Leg`, `${side}UpLeg`, cx + s * legX, g + 0.27 * H, cz),
      J(`${side}Foot`, `${side}Leg`, cx + s * legX, g + 0.05 * H, cz),
      J(`${side}ToeBase`, `${side}Foot`, cx + s * legX, g + 0.02 * H, cz + f * 0.09 * H),
      J(`${side}Toe_End`, `${side}ToeBase`, cx + s * legX, g + 0.02 * H, cz + f * 0.145 * H),
    );
  }
  return joints;
}

export function isRigged(item) {
  let rigged = false;
  item.traverse(o => { if (o.isSkinnedMesh) rigged = true; });
  return rigged;
}

/* ============================================================
   Interactive joint editing
   ============================================================ */
const edit = {
  active: false,
  item: null,
  markers: [],       // Mesh spheres, userData.jointName / .parentName
  markerGroup: null,
  lines: null,
  centerX: 0,
  savedGizmo: null,
};

export function startJointEdit(item) {
  if (edit.active) cancelJointEdit();
  const box = new THREE.Box3().setFromObject(item);
  if (box.isEmpty()) { toast('⚠️ This object has no geometry to rig.', 'warn'); return; }
  edit.active = true;
  edit.item = item;
  edit.centerX = (box.min.x + box.max.x) / 2;

  const H = box.getSize(new THREE.Vector3()).y || 1;
  const r = THREE.MathUtils.clamp(0.02 * H, 0.008, 0.2);
  const group = new THREE.Group();
  group.name = '__rigMarkers';
  edit.markerGroup = group;
  edit.markers = [];

  const geo = new THREE.SphereGeometry(r, 12, 10);
  for (const j of templateJoints(box)) {
    const isEnd = j.name.endsWith('_End');
    const mat = new THREE.MeshBasicMaterial({
      color: isEnd ? 0x8b93a7 : (j.name.startsWith('Left') ? 0x5aa0ff : j.name.startsWith('Right') ? 0xff6a7a : 0xffcf5a),
      depthTest: false, transparent: true, opacity: 0.95,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(j.pos);
    m.renderOrder = 999;
    m.userData.jointName = j.name;
    m.userData.parentName = j.parent;
    group.add(m);
    edit.markers.push(m);
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edit.markers.length * 6), 3));
  edit.lines = new THREE.LineSegments(lineGeo,
    new THREE.LineBasicMaterial({ color: 0x9fc0ff, depthTest: false, transparent: true, opacity: 0.8 }));
  edit.lines.renderOrder = 998;
  group.add(edit.lines);
  updateLines();

  app.scene.add(group);
  app.tc.detach();
  edit.savedGizmo = app.tc.mode;
  app.tc.setMode('translate');

  // picking priority for markers
  app.pickOverride = raycaster => {
    const hits = raycaster.intersectObjects(edit.markers, false);
    if (hits.length) { app.tc.attach(hits[0].object); return true; }
    // clicking empty space in rig mode keeps the mode; just detach from marker
    if (app.tc.object && app.tc.object.userData.jointName) app.tc.detach();
    return true;
  };
  edit.offMoved = app.events.on('transform-changed', onMarkerMoved);

  document.getElementById('rig-toolbar').classList.remove('hidden');
  toast('🦴 Skeleton placed — drag the dots to match the body, then <b>Bind skin</b>. Works best on a standing character (T-pose).', '', 6600);
  app.events.emit('rig-edit-changed', true);
}

function onMarkerMoved(obj) {
  if (!edit.active || !obj || !obj.userData?.jointName) return;
  const mirror = document.getElementById('rig-mirror')?.checked;
  const name = obj.userData.jointName;
  if (mirror) {
    const other = name.startsWith('Left') ? 'Right' + name.slice(4)
      : name.startsWith('Right') ? 'Left' + name.slice(5) : null;
    if (other) {
      const m2 = edit.markers.find(m => m.userData.jointName === other);
      if (m2) {
        m2.position.set(2 * edit.centerX - obj.position.x, obj.position.y, obj.position.z);
      }
    }
  }
  updateLines();
}

function updateLines() {
  if (!edit.lines) return;
  const byName = new Map(edit.markers.map(m => [m.userData.jointName, m]));
  const attr = edit.lines.geometry.attributes.position;
  let i = 0;
  for (const m of edit.markers) {
    const p = byName.get(m.userData.parentName);
    if (!p) continue;
    attr.setXYZ(i++, p.position.x, p.position.y, p.position.z);
    attr.setXYZ(i++, m.position.x, m.position.y, m.position.z);
  }
  edit.lines.geometry.setDrawRange(0, i);
  attr.needsUpdate = true;
}

export function cancelJointEdit(silent) {
  if (!edit.active) return;
  edit.offMoved?.();
  edit.offMoved = null;
  app.pickOverride = null;
  app.scene.remove(edit.markerGroup);
  document.getElementById('rig-toolbar').classList.add('hidden');
  if (app.tc.object?.userData?.jointName) app.tc.detach();
  if (edit.savedGizmo) app.tc.setMode(edit.savedGizmo);
  const item = edit.item;
  edit.active = false; edit.item = null; edit.markers = []; edit.markerGroup = null; edit.lines = null;
  if (app.selected === item && item) app.tc.attach(item);
  if (!silent) app.events.emit('rig-edit-changed', false);
}

export function bindFromMarkers() {
  if (!edit.active) return;
  const item = edit.item;
  const joints = edit.markers.map(m => ({
    name: m.userData.jointName,
    parent: m.userData.parentName,
    world: m.position.clone(),
  }));
  cancelJointEdit(true);
  try {
    bindSkeleton(item, joints);
    app.select(null); app.select(item);
    toast(`✅ <b>${item.name}</b> is rigged! Grab a mocap clip from the Motion library — or import a BVH — and press Apply.`, 'good', 7000);
  } catch (e) {
    app.error(`Rigging failed: ${e.message}`, e);
  }
  app.events.emit('rig-edit-changed', false);
}

/** Fully automatic rig (template pose, no joint editing) — used by the mannequin. */
export function rigItemAuto(item) {
  const box = new THREE.Box3().setFromObject(item);
  const joints = templateJoints(box).map(j => ({ name: j.name, parent: j.parent, world: j.pos }));
  bindSkeleton(item, joints);
}

/* ============================================================
   Skeleton construction + automatic skinning
   ============================================================ */
function bindSkeleton(item, joints) {
  item.updateMatrixWorld(true);
  const itemInv = new THREE.Matrix4().copy(item.matrixWorld).invert();
  const local = new Map(); // joint name -> item-local position
  for (const j of joints) local.set(j.name, j.world.clone().applyMatrix4(itemInv));

  // build bones (identity rotations; positions are offsets from parent)
  const bones = new Map();
  const boneList = [];
  for (const j of joints) {
    const b = new THREE.Bone();
    b.name = j.name;
    const p = local.get(j.name);
    const pp = j.parent ? local.get(j.parent) : null;
    b.position.copy(pp ? p.clone().sub(pp) : p);
    bones.set(j.name, b);
    boneList.push(b);
  }
  for (const j of joints) {
    if (j.parent) bones.get(j.parent).add(bones.get(j.name));
  }
  const rootBone = boneList[0];

  // weight-candidate segments: every joint with children contributes segments
  const children = new Map();
  for (const j of joints) {
    if (!j.parent) continue;
    if (!children.has(j.parent)) children.set(j.parent, []);
    children.get(j.parent).push(j.name);
  }
  const candidates = []; // {index (into boneList), segs: [[a,b],...]}
  joints.forEach((j, idx) => {
    const kids = children.get(j.name);
    if (!kids || j.name.endsWith('_End')) return;
    candidates.push({
      index: idx,
      segs: kids.map(k => [local.get(j.name), local.get(k)]),
    });
  });

  // collect meshes to skin
  const meshes = [];
  item.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) throw new Error('no meshes found on this object');

  // if the item root is itself a mesh, its geometry gets baked into the
  // skinned copy — blank the original so it doesn't render twice
  const selfGeo = item.isMesh ? item.geometry : null;
  const prevChildren = [...item.children];

  const armature = new THREE.Group();
  armature.name = 'Armature';
  armature.add(rootBone);

  const skinnedMeshes = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const rel = new THREE.Matrix4().copy(itemInv).multiply(mesh.matrixWorld);
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(rel);
    const pos = geo.attributes.position;
    const count = pos.count;
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const scores = new Array(candidates.length);

    for (let i = 0; i < count; i++) {
      v.fromBufferAttribute(pos, i);
      for (let c = 0; c < candidates.length; c++) {
        let dMin = Infinity;
        for (const [a, b] of candidates[c].segs) {
          const d = distPointSegment(v, a, b);
          if (d < dMin) dMin = d;
        }
        scores[c] = { c, w: 1 / (Math.pow(dMin, 4) + 1e-8) };
      }
      scores.sort((a, b) => b.w - a.w);
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += scores[k]?.w || 0;
      for (let k = 0; k < 4; k++) {
        const s = scores[k];
        skinIndex[i * 4 + k] = s ? candidates[s.c].index : 0;
        skinWeight[i * 4 + k] = s ? s.w / sum : 0;
      }
    }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

    const sm = new THREE.SkinnedMesh(geo, mesh.material);
    sm.name = mesh.name || 'SkinnedMesh';
    sm.castShadow = true;
    sm.receiveShadow = true;
    skinnedMeshes.push(sm);
  }

  // swap children
  for (const c of prevChildren) item.remove(c);
  if (selfGeo) item.geometry = new THREE.BufferGeometry();
  item.add(armature);
  for (const sm of skinnedMeshes) item.add(sm);
  item.updateMatrixWorld(true);

  const skeleton = new THREE.Skeleton(boneList);
  for (const sm of skinnedMeshes) sm.bind(skeleton, sm.matrixWorld);

  item.userData.rigged = true;

  if (app.undo) {
    const newChildren = [...item.children];
    app.undo.push({
      label: `Rig ${item.name}`,
      undo: () => {
        for (const c of newChildren) item.remove(c);
        for (const c of prevChildren) item.add(c);
        if (selfGeo) item.geometry = selfGeo;
        item.userData.rigged = false;
        setSkeletonVisible(item, false);
        app.events.emit('clips-changed', item);
        if (app.selected === item) { app.select(null); app.select(item); }
      },
      redo: () => {
        for (const c of prevChildren) item.remove(c);
        for (const c of newChildren) item.add(c);
        if (selfGeo) item.geometry = new THREE.BufferGeometry();
        item.userData.rigged = true;
        app.events.emit('clips-changed', item);
        if (app.selected === item) { app.select(null); app.select(item); }
      },
    });
  }
  return skeleton;
}

const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();
function distPointSegment(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-12 ? THREE.MathUtils.clamp(_ap.dot(_ab) / len2, 0, 1) : 0;
  _c.copy(a).addScaledVector(_ab, t);
  return _c.distanceTo(p);
}

/* ============================================================
   Skeleton visualisation
   ============================================================ */
export function setSkeletonVisible(item, on) {
  if (on && !item.userData._skelHelper) {
    let src = null;
    item.traverse(o => { if (!src && o.isSkinnedMesh) src = o; });
    if (!src) return;
    const helper = new THREE.SkeletonHelper(item);
    helper.material.depthTest = false;
    app.scene.add(helper);
    item.userData._skelHelper = helper;
  } else if (!on && item.userData._skelHelper) {
    app.scene.remove(item.userData._skelHelper);
    item.userData._skelHelper.dispose?.();
    item.userData._skelHelper = null;
  }
}

export function initRigToolbar() {
  document.getElementById('rig-bind').addEventListener('click', bindFromMarkers);
  document.getElementById('rig-cancel').addEventListener('click', () => cancelJointEdit());
  app.events.on('item-removed', item => {
    if (edit.active && edit.item === item) cancelJointEdit();
    setSkeletonVisible(item, false);
  });
}

export function rigEditActive() { return edit.active; }
