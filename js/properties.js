// Right sidebar: transform numbers (drag the axis letters to slide values),
// real-world size editing, materials, rigging and object actions.
import * as THREE from 'three';
import { app } from './app.js';
import { el, fmt, bindNumberDrag, toast } from './utils.js';
import { isRigged, startJointEdit, setSkeletonVisible, rigEditActive } from './autorig.js';
import { enterPoseMode, poseActive } from './posemode.js';
import { joinItems, bakeItem } from './join.js';
import { focusSelection } from './viewport.js';
import { loadTextureFromFile } from './importers.js';

const refs = {};        // stable UI references
let matRefs = [];       // materials of current selection
let matBefore = null;   // snapshot for material undo

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/* ============ small builders ============ */
function section(title) {
  const s = el('div', 'sec');
  if (title) s.appendChild(el('div', 'sec-title', title));
  return s;
}

function triplet(host, label, axes, cfg) {
  const row = el('div', 'row');
  const rl = el('label', 'rl noslide', label);
  row.appendChild(rl);
  const trip = el('div', 'triplet');
  const cells = [];
  for (const ax of axes) {
    const cell = el('div', 'cell');
    const tag = el('span', `ax ${ax}`, ax.toUpperCase());
    tag.style.cursor = 'ew-resize';
    tag.title = 'Drag to slide · Shift = ×10 · Alt = fine';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    cell.append(tag, input);
    trip.appendChild(cell);
    const binding = bindNumberDrag(input, tag, {
      step: cfg.step,
      digits: cfg.digits ?? 3,
      min: cfg.min,
      onInput: v => cfg.set(ax, v),
      onCommit: (b, a) => cfg.commit(ax, b, a),
    });
    cells.push({ ax, input, binding });
  }
  row.appendChild(trip);
  host.appendChild(row);
  return {
    update() {
      for (const c of cells) c.binding.set(cfg.get(c.ax));
    },
  };
}

/* ============ transform setters ============ */
const sel = () => app.selected;

function setPos(ax, v) { const o = sel(); if (o) { o.position[ax] = v; bump(o); } }
function setRot(ax, v) { const o = sel(); if (o) { o.rotation[ax] = v * D2R; bump(o); } }

function setScaleAxis(ax, v) {
  const o = sel(); if (!o) return;
  if (refs.lockScale.classList.contains('on')) {
    const cur = o.scale[ax];
    if (Math.abs(cur) > 1e-9) {
      const r = v / cur;
      o.scale.set(o.scale.x * r, o.scale.y * r, o.scale.z * r);
      o.scale[ax] = v; // exact on the edited axis
    } else {
      o.scale.set(v, v, v);
    }
  } else {
    o.scale[ax] = v;
  }
  bump(o);
}

function worldSize(o) {
  const box = new THREE.Box3().setFromObject(o);
  return box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
}

function setSizeAxis(ax, v) {
  const o = sel(); if (!o) return;
  const size = worldSize(o);
  const cur = size[ax];
  if (cur < 1e-9 || v < 1e-9) return;
  const r = v / cur;
  if (refs.lockScale.classList.contains('on')) o.scale.multiplyScalar(r);
  else o.scale[ax] *= r;
  bump(o);
}

function bump(o) {
  o.updateMatrixWorld(true);
  app.events.emit('transform-changed', o);
}

function fieldCommit(setter, label) {
  return (ax, before, after) => {
    const o = sel(); if (!o) return;
    app.undo.push({
      label,
      undo: () => { setter(ax, before); },
      redo: () => { setter(ax, after); },
    });
  };
}

/* ============ build static structure ============ */
export function initProperties() {
  const host = document.getElementById('sel-props');

  // ---- object section ----
  const so = section('Object');
  const nameRow = el('div', 'row');
  refs.name = document.createElement('input');
  refs.name.type = 'text';
  refs.name.className = 'grow';
  refs.name.title = 'Object name';
  nameRow.appendChild(refs.name);
  so.appendChild(nameRow);
  refs.name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') refs.name.blur(); });
  refs.name.addEventListener('blur', () => {
    const o = sel(); if (!o) return;
    const raw = refs.name.value.trim();
    if (!raw || raw === o.name) { refs.name.value = o?.name || ''; return; }
    const before = o.name;
    o.name = '';
    o.name = app.uniqueName(raw);
    const after = o.name;
    app.undo.push({
      label: 'Rename',
      undo: () => { o.name = before; app.events.emit('items-changed'); refreshAll(); },
      redo: () => { o.name = after; app.events.emit('items-changed'); refreshAll(); },
    });
    app.events.emit('items-changed');
    refreshAll();
  });

  refs.pos = triplet(so, 'Position', ['x', 'y', 'z'], {
    step: 0.02, get: ax => sel()?.position[ax] ?? 0, set: setPos, commit: fieldCommit(setPos, 'Move'),
  });
  refs.rot = triplet(so, 'Rotation°', ['x', 'y', 'z'], {
    step: 1, digits: 1, get: ax => (sel()?.rotation[ax] ?? 0) * R2D, set: setRot, commit: fieldCommit(setRot, 'Rotate'),
  });

  const scaleRow = el('div', 'row');
  const srl = el('label', 'rl noslide', 'Scale');
  refs.lockScale = el('button', 'linkbtn on', '🔗');
  refs.lockScale.title = 'Uniform scaling: keep proportions when resizing';
  refs.lockScale.addEventListener('click', () => refs.lockScale.classList.toggle('on'));
  srl.appendChild(refs.lockScale);
  scaleRow.appendChild(srl);
  const strip = el('div', 'triplet');
  scaleRow.appendChild(strip);
  so.appendChild(scaleRow);
  refs.scale = tripletInto(strip, ['x', 'y', 'z'], {
    step: 0.01, get: ax => sel()?.scale[ax] ?? 1, set: setScaleAxis, commit: fieldCommit(setScaleAxis, 'Scale'),
  });

  refs.size = triplet(so, 'Size', ['x', 'y', 'z'], {
    step: 0.02, min: 0.001,
    get: ax => sel() ? worldSize(sel())[ax] : 0,
    set: setSizeAxis, commit: fieldCommit(setSizeAxis, 'Resize'),
  });
  so.appendChild(el('div', 'small dim', 'Tip: drag the X/Y/Z letters to slide values. “Size” is the real bounding size — type a number to make it exactly that big.'));
  host.appendChild(so);

  // ---- material section ----
  refs.matSec = section('Material');
  refs.matBody = el('div');
  refs.matSec.appendChild(refs.matBody);
  host.appendChild(refs.matSec);

  // ---- rigging section ----
  refs.rigSec = section('Rigging & Mocap');
  refs.rigBody = el('div');
  refs.rigSec.appendChild(refs.rigBody);
  host.appendChild(refs.rigSec);

  // ---- actions ----
  const sa = section('Actions');
  const br = el('div', 'btnrow');
  const bFocus = el('button', 'tb', '⌖ Focus (F)');
  bFocus.addEventListener('click', () => focusSelection());
  const bDup = el('button', 'tb', '⧉ Duplicate (Ctrl+D)');
  bDup.addEventListener('click', () => app.ops?.duplicateSelected());
  const bDel = el('button', 'tb', '🗑 Delete');
  bDel.addEventListener('click', () => app.ops?.deleteSelected());
  const bJoin = el('button', 'tb', '🧲 Join models');
  bJoin.title = 'Merge the selected models into one object — ⇧click to select several first (Ctrl+J)';
  bJoin.addEventListener('click', () => joinItems(app.selectedItems()));
  const bBake = el('button', 'tb', '⧈ Weld into one mesh');
  bBake.title = 'Fuse every part of this object into a single mesh (for export / 3D printing)';
  bBake.addEventListener('click', () => { if (sel()) bakeItem(sel()); });
  br.append(bFocus, bDup, bJoin, bBake, bDel);
  sa.appendChild(br);
  host.appendChild(sa);

  // texture input
  document.getElementById('tex-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !matRefs.length) return;
    try {
      const tex = await loadTextureFromFile(f);
      for (const m of matRefs) if ('map' in m) { m.map = tex; m.needsUpdate = true; }
      toast(`🖼 Texture applied to ${sel()?.name}`, 'good');
      rebuildMaterial();
    } catch (err) {
      app.error('Could not load that image.', err);
    }
  });

  app.events.on('selection-changed', refreshAll);
  app.events.on('transform-changed', o => { if (o === sel()) refreshNumbers(); });
  app.events.on('rig-edit-changed', () => rebuildRig());
  app.events.on('pose-changed', () => rebuildRig());
  refreshAll();
}

// like triplet() but into an existing .triplet container (for the scale row)
function tripletInto(trip, axes, cfg) {
  const cells = [];
  for (const ax of axes) {
    const cell = el('div', 'cell');
    const tag = el('span', `ax ${ax}`, ax.toUpperCase());
    tag.style.cursor = 'ew-resize';
    tag.title = 'Drag to slide · Shift = ×10 · Alt = fine';
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    cell.append(tag, input);
    trip.appendChild(cell);
    const binding = bindNumberDrag(input, tag, {
      step: cfg.step, digits: cfg.digits ?? 3, min: cfg.min,
      onInput: v => cfg.set(ax, v),
      onCommit: (b, a) => cfg.commit(ax, b, a),
    });
    cells.push({ ax, binding });
  }
  return { update() { for (const c of cells) c.binding.set(cfg.get(c.ax)); } };
}

/* ============ refresh ============ */
function refreshAll() {
  const o = sel();
  document.getElementById('no-selection').classList.toggle('hidden', !!o);
  document.getElementById('sel-props').classList.toggle('hidden', !o);
  if (!o) return;
  refs.name.value = o.name;
  refreshNumbers();
  collectMaterials();
  rebuildMaterial();
  rebuildRig();
}

function refreshNumbers() {
  if (!sel()) return;
  refs.pos.update();
  refs.rot.update();
  refs.scale.update();
  refs.size.update();
}

/* ============ materials ============ */
function collectMaterials() {
  matRefs = [];
  const o = sel();
  if (!o) return;
  const seen = new Set();
  o.traverse(node => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const m of mats) if (m && !seen.has(m)) { seen.add(m); matRefs.push(m); }
  });
  matBefore = snapshotMats();
}

function snapshotMats() {
  return matRefs.map(m => ({
    color: m.color ? m.color.getHex() : null,
    roughness: m.roughness, metalness: m.metalness,
    opacity: m.opacity, transparent: m.transparent,
    wireframe: m.wireframe, map: m.map || null,
  }));
}

function applyMatSnapshot(snap) {
  matRefs.forEach((m, i) => {
    const s = snap[i]; if (!s) return;
    if (m.color && s.color !== null) m.color.setHex(s.color);
    if (s.roughness !== undefined && 'roughness' in m) m.roughness = s.roughness;
    if (s.metalness !== undefined && 'metalness' in m) m.metalness = s.metalness;
    m.opacity = s.opacity; m.transparent = s.transparent;
    if ('wireframe' in m) m.wireframe = s.wireframe;
    if ('map' in m) m.map = s.map;
    m.needsUpdate = true;
  });
}

function pushMatUndo(label) {
  const before = matBefore;
  const after = snapshotMats();
  const mats = matRefs;
  app.undo.push({
    label,
    undo: () => { const keep = matRefs; matRefs = mats; applyMatSnapshot(before); matRefs = keep; },
    redo: () => { const keep = matRefs; matRefs = mats; applyMatSnapshot(after); matRefs = keep; },
  });
  matBefore = after;
}

function rebuildMaterial() {
  const body = refs.matBody;
  body.innerHTML = '';
  if (!matRefs.length) {
    body.appendChild(el('div', 'small dim', 'No editable materials on this object.'));
    return;
  }
  const ref = matRefs.find(m => m.color) || matRefs[0];
  const many = matRefs.length > 1;
  if (many) body.appendChild(el('div', 'small dim', `${matRefs.length} materials — edits apply to all.`));

  // color
  if (ref.color) {
    const row = el('div', 'row');
    row.appendChild(el('label', 'rl noslide', 'Color'));
    const c = document.createElement('input');
    c.type = 'color';
    c.value = `#${ref.color.getHexString()}`;
    c.addEventListener('input', () => {
      for (const m of matRefs) m.color?.set(c.value);
    });
    c.addEventListener('change', () => pushMatUndo('Color'));
    row.appendChild(c);
    const hex = el('span', 'small dim mono', '');
    hex.textContent = c.value;
    c.addEventListener('input', () => hex.textContent = c.value);
    row.appendChild(hex);
    body.appendChild(row);
  }

  const slider = (label, get, set, min = 0, max = 1, step = 0.01) => {
    const row = el('div', 'row');
    row.appendChild(el('label', 'rl noslide', label));
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step;
    r.value = get();
    r.addEventListener('input', () => set(parseFloat(r.value)));
    r.addEventListener('change', () => pushMatUndo(label));
    row.appendChild(r);
    body.appendChild(row);
  };

  if ('roughness' in ref) slider('Rough', () => ref.roughness ?? 0.7, v => { for (const m of matRefs) if ('roughness' in m) m.roughness = v; });
  if ('metalness' in ref) slider('Metal', () => ref.metalness ?? 0, v => { for (const m of matRefs) if ('metalness' in m) m.metalness = v; });
  slider('Opacity', () => ref.opacity ?? 1, v => {
    for (const m of matRefs) { m.opacity = v; m.transparent = v < 0.999; m.needsUpdate = true; }
  });

  const wrow = el('div', 'row');
  wrow.appendChild(el('label', 'rl noslide', 'Wire'));
  const w = document.createElement('input');
  w.type = 'checkbox';
  w.checked = !!ref.wireframe;
  w.addEventListener('change', () => {
    for (const m of matRefs) if ('wireframe' in m) m.wireframe = w.checked;
    pushMatUndo('Wireframe');
  });
  wrow.appendChild(w);
  body.appendChild(wrow);

  const trow = el('div', 'btnrow');
  const bTex = el('button', 'tb', ref.map ? '🖼 Replace texture…' : '🖼 Add texture…');
  bTex.addEventListener('click', () => document.getElementById('tex-input').click());
  trow.appendChild(bTex);
  if (ref.map) {
    const bClr = el('button', 'tb', '✕ Remove texture');
    bClr.addEventListener('click', () => {
      for (const m of matRefs) if ('map' in m) { m.map = null; m.needsUpdate = true; }
      pushMatUndo('Remove texture');
      rebuildMaterial();
    });
    trow.appendChild(bClr);
  }
  body.appendChild(trow);
}

/* ============ rigging ============ */
function rebuildRig() {
  const body = refs.rigBody;
  body.innerHTML = '';
  const o = sel();
  if (!o) return;

  if (rigEditActive()) {
    body.appendChild(el('div', 'small dim', '🦴 Fitting joints… use the bar at the top of the viewport to Bind or Cancel.'));
    return;
  }
  if (poseActive(o)) {
    body.appendChild(el('div', 'small dim', '🎭 Posing… rotate joints, press 🔑 to record poses, then Done in the bar at the top of the viewport.'));
    return;
  }

  if (isRigged(o)) {
    let bones = 0;
    o.traverse(n => { if (n.isBone) bones++; });
    const row = el('div', 'row');
    row.appendChild(el('span', 'chip good', `🦴 Rigged · ${bones} bones`));
    body.appendChild(row);

    const arow = el('div', 'btnrow');
    const bPose = el('button', 'tb accent', '🎭 Animate (pose keyframes)…');
    bPose.title = 'Rotate joints and record poses on the timeline — your own animation clip';
    bPose.addEventListener('click', () => enterPoseMode(o));
    arow.appendChild(bPose);
    body.appendChild(arow);

    const srow = el('div', 'row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'cb-skel';
    cb.checked = !!o.userData._skelHelper;
    cb.addEventListener('change', () => setSkeletonVisible(o, cb.checked));
    const lab = el('label', 'small', ' Show skeleton');
    lab.prepend(cb);
    srow.appendChild(lab);
    body.appendChild(srow);
    body.appendChild(el('div', 'small dim', 'Apply any clip from the 🎬 Motion library below — bones are matched automatically.'));
  } else {
    const br = el('div', 'btnrow');
    const b = el('button', 'tb accent', '🦴 Auto-Rig (humanoid)…');
    b.title = 'Adds a skeleton you can drag into place, then binds the mesh to it';
    b.addEventListener('click', () => startJointEdit(o));
    br.appendChild(b);
    body.appendChild(br);
    body.appendChild(el('div', 'small dim', 'Give this model a skeleton so mocap and character animations can drive it. Best on humanoids standing in a T-pose.'));
  }
}
