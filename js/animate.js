// 🎬 Motion library: imported BVH/FBX/GLB clips, one-click retargeting onto
// any rigged model, skeleton preview, and a manual bone-mapping dialog for
// exotic rigs.
import * as THREE from 'three';
import { app } from './app.js';
import { el, toast, fmt } from './utils.js';
import { retargetClip } from './retarget.js';
import { guessBoneMap, collectBones, CORE_SLOTS } from './bonemap.js';
import { play, setTime } from './timeline.js';

let inPlace = false;
const preview = { entry: null, group: null, mixer: null, action: null, ticker: null };

const $ = id => document.getElementById(id);

function boneCount(root) {
  return collectBones(root).length;
}

function rebuild() {
  const host = $('mocap-list');
  const count = $('mocap-count');
  host.innerHTML = '';
  count.textContent = app.mocap.length ? `(${app.mocap.length})` : '';

  if (!app.mocap.length) {
    host.appendChild(el('div', 'dim small pad',
      'Import a <b>BVH</b> mocap file or any animated FBX/GLB — clips land here, ready to apply to any rigged model.'));
    return;
  }

  const opts = el('div', 'row small', '');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = inPlace;
  cb.addEventListener('change', () => { inPlace = cb.checked; });
  const lab = el('label', 'small dim', ' Apply “in place” (ignore walking drift)');
  lab.prepend(cb);
  opts.appendChild(lab);
  host.appendChild(opts);

  for (const entry of app.mocap) {
    const card = el('div', 'mocap-item');
    card.appendChild(el('div', 'mname', `🎬 ${entry.name}`));
    card.appendChild(el('div', 'mmeta',
      `${fmt(entry.duration, 1)}s · ${boneCount(entry.sourceRoot)} bones`));
    const row = el('div', 'btnrow');

    const bApply = el('button', 'tb accent', '▶ Apply to selected');
    bApply.title = 'Retarget this motion onto the selected rigged model';
    bApply.addEventListener('click', () => applyEntry(entry));
    row.appendChild(bApply);

    const inScene = !!entry.sourceRoot.parent;
    if (!inScene) {
      const bPrev = el('button', 'tb', preview.entry === entry ? '⏹ Stop preview' : '👁 Preview');
      bPrev.addEventListener('click', () => togglePreview(entry));
      row.appendChild(bPrev);
    }

    const bMap = el('button', 'tb', '⚙ Bone map…');
    bMap.title = 'Review / fix the automatic bone matching';
    bMap.addEventListener('click', () => openMapDialog(entry));
    row.appendChild(bMap);

    const bDel = el('button', 'tb', '✕');
    bDel.title = 'Remove from library';
    bDel.addEventListener('click', () => {
      if (preview.entry === entry) stopPreview();
      app.removeMocap(entry);
    });
    row.appendChild(bDel);

    card.appendChild(row);
    host.appendChild(card);
  }
}

/* ---------------- apply ---------------- */
function applyEntry(entry, pairs) {
  const item = app.selected;
  if (!item) {
    toast('Select a model first (click it), then Apply.', 'warn');
    return;
  }
  let bones = 0;
  item.traverse(o => { if (o.isBone) bones++; });
  if (!bones) {
    toast(`<b>${item.name}</b> has no skeleton yet — open <b>Rigging</b> in the sidebar and Auto-Rig it first (takes ~20 seconds).`, 'warn', 6500);
    return;
  }
  try {
    const { clip, mappedCount, missing } = retargetClip(entry, item, { pairs, inPlace });
    const idx = app.addClipToItem(item, entry.name, clip);
    item.userData.activeClipSel = String(idx);
    app.events.emit('clips-changed', item);
    setTime(0);
    play();
    let msg = `🎉 <b>${entry.name}</b> → <b>${item.name}</b> (${mappedCount} bones matched)`;
    if (missing.length) msg += `<br><span class="small dim">No match for: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''} — use ⚙ Bone map to fix.</span>`;
    toast(msg, 'good', 6000);
  } catch (e) {
    app.error(`Retarget failed: ${e.message}`, e);
    if (/hips|pelvis|matching/i.test(String(e.message))) openMapDialog(entry);
  }
}

/* ---------------- preview ---------------- */
function stopPreview() {
  if (!preview.group) { preview.entry = null; rebuild(); return; }
  const i = app.tickers.indexOf(preview.ticker);
  if (i !== -1) app.tickers.splice(i, 1);
  preview.mixer.stopAllAction();
  preview.mixer.uncacheRoot(preview.entry.sourceRoot);
  app.scene.remove(preview.group);
  // detach sourceRoot back out of the preview group so it stays reusable
  const root = preview.entry.sourceRoot;
  preview.group.remove(root);
  if (root.userData._restPose) {
    root.traverse(o => {
      const t = root.userData._restPose.get(o.uuid);
      if (t) { o.position.fromArray(t.p); o.quaternion.fromArray(t.q); o.scale.fromArray(t.s); }
    });
  }
  preview.entry = null; preview.group = null; preview.mixer = null; preview.action = null; preview.ticker = null;
  rebuild();
}

function togglePreview(entry) {
  if (preview.entry === entry) { stopPreview(); return; }
  stopPreview();

  const root = entry.sourceRoot;
  const group = new THREE.Group();
  group.name = '__mocapPreview';
  group.add(root);

  // scale the naked skeleton to human size for display
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const h = box.isEmpty() ? 1 : Math.max(box.getSize(new THREE.Vector3()).y, 1e-3);
  const s = 1.8 / h;
  if (s < 0.5 || s > 2) group.scale.setScalar(s);

  const helper = new THREE.SkeletonHelper(root);
  helper.material.depthTest = false;
  group.add(helper);

  app.scene.add(group);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(entry.clip);
  action.play();
  const ticker = dt => mixer.update(dt);
  app.tickers.push(ticker);

  Object.assign(preview, { entry, group, mixer, action, ticker });
  toast(`👁 Previewing <b>${entry.name}</b> as a stick figure — press the button again to stop.`, '', 4200);
  rebuild();
}

/* ---------------- manual bone map dialog ---------------- */
function openMapDialog(entry) {
  const item = app.selected;
  if (!item) { toast('Select the target model first.', 'warn'); return; }
  const targetBones = collectBones(item);
  if (!targetBones.length) {
    toast(`<b>${item.name}</b> has no bones — Auto-Rig it first (sidebar → Rigging).`, 'warn', 5500);
    return;
  }
  const sourceBones = collectBones(entry.sourceRoot);
  const guess = guessBoneMap(entry.sourceRoot, item);
  const bySlot = new Map(guess.pairs.map(p => [p.key, p]));

  const rootEl = $('modal-root');
  rootEl.classList.remove('hidden');
  rootEl.innerHTML = '';
  const modal = el('div', 'modal');
  modal.appendChild(el('div', 'modal-head', `⚙ Bone map — ${entry.name} → ${item.name}`));
  const body = el('div', 'modal-body');
  body.appendChild(el('div', 'small dim',
    'Each body part needs a bone from the motion (source) and from your model (target). Auto-matched rows are filled in — fix any that look wrong. Extra bones (fingers, twist bones) are matched automatically when names allow.'));
  body.appendChild(el('div', '', '<br>'));

  const grid = el('div', 'map-grid');
  grid.append(el('div', 'hdr', 'Body part'), el('div', 'hdr', 'Motion bone'), el('div', 'hdr', 'Model bone'));

  const rows = [];
  const mkSelect = (bones, chosen) => {
    const s = document.createElement('select');
    s.add(new Option('—', ''));
    for (const b of bones) s.add(new Option(b.name, b.name));
    s.value = chosen?.name || '';
    return s;
  };
  for (const slot of CORE_SLOTS) {
    const pair = bySlot.get(slot.key);
    const name = el('div', 'cname' + (pair ? '' : ' unmapped'), (pair ? '✓ ' : '· ') + slot.label);
    const sSel = mkSelect(sourceBones, pair?.source);
    const tSel = mkSelect(targetBones, pair?.target);
    grid.append(name, sSel, tSel);
    rows.push({ slot, sSel, tSel, name });
    const upd = () => name.className = 'cname' + (sSel.value && tSel.value ? '' : ' unmapped');
    sSel.addEventListener('change', upd);
    tSel.addEventListener('change', upd);
  }
  body.appendChild(grid);
  modal.appendChild(body);

  const foot = el('div', 'modal-foot');
  const bCancel = el('button', 'tb', 'Cancel');
  bCancel.addEventListener('click', close);
  const bApply = el('button', 'tb accent', '▶ Apply with this map');
  bApply.addEventListener('click', () => {
    const srcByName = new Map(sourceBones.map(b => [b.name, b]));
    const tgtByName = new Map(targetBones.map(b => [b.name, b]));
    const pairs = [];
    for (const r of rows) {
      const s = srcByName.get(r.sSel.value);
      const t = tgtByName.get(r.tSel.value);
      if (s && t) pairs.push({ key: r.slot.key, source: s, target: t });
    }
    // keep auto-matched extras (fingers etc.) that the dialog doesn't list
    for (const p of guess.pairs) {
      if (!CORE_SLOTS.some(sl => sl.key === p.key) && !pairs.some(x => x.key === p.key)) pairs.push(p);
    }
    close();
    applyEntry(entry, pairs);
  });
  foot.append(bCancel, bApply);
  modal.appendChild(foot);
  rootEl.appendChild(modal);

  function close() {
    rootEl.classList.add('hidden');
    rootEl.innerHTML = '';
  }
  rootEl.addEventListener('pointerdown', e => { if (e.target === rootEl) close(); }, { once: true });
}

export function initAnimatePanel() {
  app.events.on('mocap-changed', rebuild);
  app.events.on('item-removed', item => {
    // drop library entries whose source skeleton lived inside the removed item
    const dead = app.mocap.filter(e => {
      let p = e.sourceRoot;
      while (p) { if (p === item) return true; p = p.parent; }
      return false;
    });
    for (const d of dead) {
      if (preview.entry === d) stopPreview();
    }
  });
  rebuild();
}
