// Motion retargeting: bake a mocap clip from ANY source skeleton onto ANY
// rigged model. Works by transferring per-bone world-rotation deltas
// (relative to each skeleton's rest pose), so bone lengths, hierarchies and
// rest offsets can differ between the two rigs. Hips also receive scaled
// root motion.
import * as THREE from 'three';
import { guessBoneMap } from './bonemap.js';

const FPS = 30;

/** Snapshot every bone's local transform so we can restore later. */
function snapshotPose(root) {
  const map = new Map();
  root.traverse(o => {
    if (o.isBone || o === root) {
      map.set(o.uuid, {
        p: o.position.toArray(),
        q: o.quaternion.toArray(),
        s: o.scale.toArray(),
      });
    }
  });
  return map;
}

function applyPose(root, map) {
  root.traverse(o => {
    const t = map.get(o.uuid);
    if (t) {
      o.position.fromArray(t.p);
      o.quaternion.fromArray(t.q);
      o.scale.fromArray(t.s);
    }
  });
}

/** Put every skeleton found under root into its bind pose (if it has one). */
function toBindPose(root) {
  const done = new Set();
  root.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton && !done.has(o.skeleton)) {
      done.add(o.skeleton);
      o.skeleton.pose();
    }
  });
  return done.size > 0;
}

/**
 * Capture the rest pose of a mocap source root (call once after import).
 * Uses the skeleton bind pose when available, else the current pose.
 */
export function captureRestPose(root) {
  toBindPose(root);
  root.updateMatrixWorld(true);
  root.userData._restPose = snapshotPose(root);
}

/**
 * Bake `entry.clip` (playing on entry.sourceRoot) onto the bones of
 * `targetItem`. Returns a new AnimationClip whose tracks target the item's
 * bone names, playable with a mixer rooted at the item.
 *
 * opts: { pairs (from guessBoneMap, optional), inPlace, fps }
 */
export function retargetClip(entry, targetItem, opts = {}) {
  const source = entry.sourceRoot;
  const fps = opts.fps || FPS;

  const map = opts.pairs ? { pairs: opts.pairs, missing: [] } : guessBoneMap(source, targetItem);
  const pairs = map.pairs.filter(p => p.source && p.target);
  const hipsPair = pairs.find(p => p.key === 'hips');
  if (!pairs.length) throw new Error('No matching bones between the mocap and this model.');
  if (!hipsPair) throw new Error('Could not find a Hips/Pelvis bone on both skeletons.');

  // ---------- target rest data (in item space) ----------
  const savedTargetPose = snapshotPose(targetItem);
  toBindPose(targetItem);
  targetItem.updateMatrixWorld(true);
  const itemInv = new THREE.Matrix4().copy(targetItem.matrixWorld).invert();

  const targetBones = [];
  targetItem.traverse(o => { if (o.isBone) targetBones.push(o); }); // DFS = parents first
  if (!targetBones.length) throw new Error('This model has no skeleton. Rig it first (Auto-Rig).');

  const rest = new Map(); // bone -> data
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
  for (const b of targetBones) {
    const m = tmpM.copy(itemInv).multiply(b.matrixWorld);
    const q = new THREE.Quaternion();
    m.decompose(tmpP.clone(), q, tmpS.clone());
    rest.set(b, {
      itemQuat: q,                       // rest orientation in item space
      itemPos: new THREE.Vector3().setFromMatrixPosition(m),
      localQuat: b.quaternion.clone(),   // rest local rotation
      parentIsBone: !!(b.parent && b.parent.isBone),
      parentItemQuat: null,              // filled for non-bone parents
    });
  }
  for (const b of targetBones) {
    const r = rest.get(b);
    if (!r.parentIsBone) {
      const pm = new THREE.Matrix4().copy(itemInv).multiply(b.parent.matrixWorld);
      const q = new THREE.Quaternion();
      pm.decompose(new THREE.Vector3(), q, new THREE.Vector3());
      r.parentItemQuat = q;
    }
  }
  const hipsT = hipsPair.target;
  const hipsParentRestInv = new THREE.Matrix4().copy(itemInv)
    .multiply(hipsT.parent.matrixWorld).invert();
  const hipsRestItemPos = rest.get(hipsT).itemPos.clone();

  // ---------- source rest data (in source-root space) ----------
  const savedSourcePose = snapshotPose(source);
  if (source.userData._restPose) applyPose(source, source.userData._restPose);
  else toBindPose(source);
  source.updateMatrixWorld(true);
  const srcRootInv = new THREE.Matrix4().copy(source.matrixWorld).invert();

  const srcRestQuatInv = new Map();
  for (const p of pairs) {
    const m = new THREE.Matrix4().copy(srcRootInv).multiply(p.source.matrixWorld);
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    srcRestQuatInv.set(p.source, q.invert());
  }

  // ---------- sample ----------
  const duration = Math.max(entry.clip.duration, 1 / fps);
  const nFrames = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(nFrames);

  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(entry.clip);
  action.play();

  const pairByTarget = new Map(pairs.map(p => [p.target, p]));
  const quatValues = new Map(pairs.map(p => [p.target, new Float32Array(nFrames * 4)]));
  const hipPosValues = new Float32Array(nFrames * 3);
  let srcHipStart = null;
  let hipRatio = 1;

  const worldQ = new Map();   // target bone -> item-space quat at current sample
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qd = new THREE.Quaternion();
  const prevQ = new Map();

  for (let f = 0; f < nFrames; f++) {
    const t = Math.min((f / fps), duration);
    times[f] = t;
    action.time = t;
    mixer.update(0);
    source.updateMatrixWorld(true);

    // source world (root-relative) rotation deltas
    const deltas = new Map();
    for (const p of pairs) {
      tmpM.copy(srcRootInv).multiply(p.source.matrixWorld);
      tmpM.decompose(tmpP, q1, tmpS);
      qd.copy(q1).multiply(srcRestQuatInv.get(p.source));
      deltas.set(p.source, qd.clone());
    }

    // source hips position (root-relative)
    tmpM.copy(srcRootInv).multiply(hipsPair.source.matrixWorld);
    const srcHipPos = new THREE.Vector3().setFromMatrixPosition(tmpM);
    if (f === 0) {
      srcHipStart = srcHipPos.clone();
      const srcHipY = Math.abs(srcHipStart.y);
      hipRatio = srcHipY > 1e-4 ? Math.abs(hipsRestItemPos.y) / srcHipY : 1;
      if (!isFinite(hipRatio) || hipRatio < 1e-4) hipRatio = 1;
    }

    // walk target hierarchy parents-first, composing item-space rotations
    worldQ.clear();
    for (const b of targetBones) {
      const r = rest.get(b);
      const parentQ = r.parentIsBone ? worldQ.get(b.parent) : r.parentItemQuat;
      const pair = pairByTarget.get(b);
      let itemQuat;
      if (pair) {
        itemQuat = q2.copy(deltas.get(pair.source)).multiply(r.itemQuat).clone();
        // local = parent⁻¹ * item
        const local = q1.copy(parentQ).invert().multiply(itemQuat);
        const arr = quatValues.get(b);
        // keep quaternion hemisphere continuity to avoid interpolation flips
        const pq = prevQ.get(b);
        if (pq && (pq.x * local.x + pq.y * local.y + pq.z * local.z + pq.w * local.w) < 0) {
          local.set(-local.x, -local.y, -local.z, -local.w);
        }
        prevQ.set(b, (pq || new THREE.Quaternion()).copy(local));
        arr[f * 4] = local.x; arr[f * 4 + 1] = local.y; arr[f * 4 + 2] = local.z; arr[f * 4 + 3] = local.w;
      } else {
        itemQuat = q2.copy(parentQ).multiply(r.localQuat).clone();
      }
      worldQ.set(b, itemQuat);
    }

    // hips position: rest + scaled root motion, expressed in hips-parent space
    const delta = new THREE.Vector3().subVectors(srcHipPos, srcHipStart).multiplyScalar(hipRatio);
    if (opts.inPlace) { delta.x = 0; delta.z = 0; }
    const desired = new THREE.Vector3().copy(hipsRestItemPos).add(delta);
    desired.applyMatrix4(hipsParentRestInv);
    hipPosValues[f * 3] = desired.x; hipPosValues[f * 3 + 1] = desired.y; hipPosValues[f * 3 + 2] = desired.z;
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(source);
  applyPose(source, savedSourcePose);
  source.updateMatrixWorld(true);
  applyPose(targetItem, savedTargetPose);
  targetItem.updateMatrixWorld(true);

  // ---------- build clip ----------
  const tracks = [];
  for (const p of pairs) {
    tracks.push(new THREE.QuaternionKeyframeTrack(`${p.target.name}.quaternion`, times, quatValues.get(p.target)));
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hipsT.name}.position`, times, hipPosValues));

  const clip = new THREE.AnimationClip(entry.name, duration, tracks);
  return { clip, mappedCount: pairs.length, missing: map.missing };
}
