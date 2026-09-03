// Joining models: ⇧click several items → Join merges them into ONE object
// (world positions preserved, fully undoable). If exactly one of them is
// rigged, the joined object keeps that rig and its animations.
// bakeItem() goes further: welds all meshes of an object into a single mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { app } from './app.js';
import { toast } from './utils.js';
import { isRigged, setSkeletonVisible } from './autorig.js';

export function joinItems(list, opts = {}) {
  const items = [...new Set(list)].filter(i => app.items.includes(i));
  if (items.length < 2) {
    toast('Select 2+ models first: click one, then <b>⇧click</b> the others (in the viewport or the Scene list), then Join.', 'warn', 5200);
    return null;
  }
  const primary = items[0];
  const riggedOnes = items.filter(isRigged);
  const keepRig = riggedOnes.length === 1;

  const rec = items.map(it => ({
    it,
    pos: it.position.clone(),
    quat: it.quaternion.clone(),
    scl: it.scale.clone(),
    idx: app.items.indexOf(it),
    ud: it.userData,
  }));

  const group = new THREE.Group();
  group.position.copy(primary.position); // pivot where the first model stood

  const doJoin = () => {
    app.select(null);
    for (const { it } of rec) {
      setSkeletonVisible(it, false);
      app.events.emit('item-removed', it); // releases mixers, gizmo, previews
    }
    app.contentGroup.add(group);
    app.contentGroup.updateMatrixWorld(true);
    for (const { it } of rec) {
      it.updateMatrixWorld(true);
      group.attach(it); // keeps its world transform
      it.userData.isItem = false;
    }
    for (const { it } of rec) {
      const i = app.items.indexOf(it);
      if (i !== -1) app.items.splice(i, 1);
    }
    group.userData = {
      isItem: true,
      clips: keepRig ? app.getClips(riggedOnes[0]).slice() : [],
      keys: [],
      rigged: keepRig,
    };
    if (!group.name) group.name = app.uniqueName(opts.name || `${primary.name} +${items.length - 1}`);
    if (!app.items.includes(group)) app.items.push(group);
    app.events.emit('items-changed');
    app.select(group);
  };

  const undoJoin = () => {
    app.select(null);
    app.contentGroup.remove(group);
    const gi = app.items.indexOf(group);
    if (gi !== -1) app.items.splice(gi, 1);
    const ordered = [...rec].sort((a, b) => a.idx - b.idx);
    for (const r of ordered) {
      app.contentGroup.add(r.it);
      r.it.position.copy(r.pos);
      r.it.quaternion.copy(r.quat);
      r.it.scale.copy(r.scl);
      r.it.userData = r.ud;
      r.it.userData.isItem = true;
      app.items.splice(Math.min(r.idx, app.items.length), 0, r.it);
    }
    app.events.emit('items-changed');
    app.select(primary);
  };

  doJoin();
  app.undo.push({ label: `Join ${items.length} models`, undo: undoJoin, redo: doJoin });

  let note = `🧲 Joined ${items.length} models → <b>${group.name}</b>`;
  if (keepRig) note += ' <span class="small dim">(rig & animations kept)</span>';
  else if (riggedOnes.length > 1) note += '<br><span class="small dim">Heads-up: several rigged parts — only bones with unique names will animate cleanly.</span>';
  toast(note, 'good', 5200);
  return group;
}

/** Weld every mesh of an item into ONE mesh (great for export/3D-printing). */
export function bakeItem(item) {
  if (!item) return;
  if (isRigged(item)) {
    toast('This model is rigged — baking would freeze it. Duplicate it first if you want a static welded copy.', 'warn', 5600);
    return;
  }
  const meshes = [];
  item.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) meshes.push(o); });
  if (meshes.length < 2) {
    toast('Nothing to weld — this object is already a single mesh.', 'warn');
    return;
  }
  if (meshes.some(m => Array.isArray(m.material))) {
    toast('One part uses multiple materials per mesh — that can’t be welded yet. Join as a group instead.', 'warn', 5600);
    return;
  }

  item.updateMatrixWorld(true);
  const itemInv = new THREE.Matrix4().copy(item.matrixWorld).invert();
  let geos = meshes.map(m => {
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().copy(itemInv).multiply(m.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    return g;
  });
  // keep only attributes every part has, and align indexing
  const common = Object.keys(geos[0].attributes)
    .filter(name => geos.every(g => g.attributes[name]));
  const dropUV = !common.includes('uv');
  geos = geos.map(g => {
    for (const name of Object.keys(g.attributes)) {
      if (!common.includes(name)) g.deleteAttribute(name);
    }
    return g.index && geos.some(x => !x.index) ? g.toNonIndexed() : g;
  });
  if (geos.some(g => !g.index)) geos = geos.map(g => (g.index ? g.toNonIndexed() : g));

  const merged = mergeGeometries(geos, true);
  if (!merged) {
    toast('These meshes are too different to weld into one.', 'bad');
    return;
  }
  const mats = meshes.map(m => {
    const c = m.material.clone();
    if (dropUV && 'map' in c) c.map = null;
    return c;
  });
  const mesh = new THREE.Mesh(merged, mats.length > 1 ? mats : mats[0]);
  mesh.name = item.name;
  mesh.castShadow = mesh.receiveShadow = true;

  const prevChildren = [...item.children];
  const apply = () => {
    for (const c of prevChildren) item.remove(c);
    item.add(mesh);
    app.events.emit('items-changed');
    if (app.selected === item) { app.select(null); app.select(item); }
  };
  const revert = () => {
    item.remove(mesh);
    for (const c of prevChildren) item.add(c);
    app.events.emit('items-changed');
    if (app.selected === item) { app.select(null); app.select(item); }
  };
  apply();
  app.undo.push({ label: `Weld ${item.name}`, undo: revert, redo: apply });
  const tris = (merged.index ? merged.index.count : merged.attributes.position.count) / 3;
  toast(`⧈ Welded <b>${item.name}</b> into one mesh (${meshes.length} parts, ${Math.round(tris).toLocaleString()} tris)`, 'good', 4600);
}
