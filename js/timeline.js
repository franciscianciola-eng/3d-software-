// Global timeline: plays every object's chosen clip in sync, scrubbing,
// looping, speed — plus keyframe authoring on object transforms (🔑).
import * as THREE from 'three';
import { app } from './app.js';
import { toast, fmt } from './utils.js';

const state = {
  time: 0,
  playing: false,
  loop: true,
  speed: 1,
  duration: 5,
};

const playstates = new Map(); // item -> {mixer, action, clip, baseline, sel}

const $ = id => document.getElementById(id);

/* ---------------- clip selection per item ---------------- */
function activeSel(item) {
  let sel = item.userData.activeClipSel;
  if (sel === undefined) {
    sel = app.getClips(item).length ? '0' : '-1';
    item.userData.activeClipSel = sel;
  }
  return sel;
}

function activeClip(item) {
  const sel = activeSel(item);
  if (sel === 'k') return buildKeyframeClip(item);
  const idx = parseInt(sel, 10);
  const rec = app.getClips(item)[idx];
  return rec ? rec.clip : null;
}

function isArmed(item) {
  const sel = activeSel(item);
  if (sel === 'k') return (item.userData.keys || []).length >= 2;
  return !!app.getClips(item)[parseInt(sel, 10)];
}

function armedItems() {
  return app.items.filter(isArmed);
}

/* ---------------- playback engine ---------------- */
function snapshotSubtree(item) {
  const map = new Map();
  item.traverse(o => map.set(o, {
    p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(),
  }));
  return map;
}

function restoreSubtree(map) {
  for (const [o, t] of map) {
    o.position.copy(t.p); o.quaternion.copy(t.q); o.scale.copy(t.s);
  }
}

function ensurePlaystate(item) {
  const sel = activeSel(item);
  let ps = playstates.get(item);
  if (ps && ps.sel === sel && !ps.dirty) return ps;
  if (ps) releaseItem(item, true);
  const clip = activeClip(item);
  if (!clip) return null;
  const baseline = snapshotSubtree(item);
  const mixer = new THREE.AnimationMixer(item);
  const action = mixer.clipAction(clip);
  action.play();
  ps = { mixer, action, clip, baseline, sel, dirty: false };
  playstates.set(item, ps);
  return ps;
}

function releaseItem(item, restore) {
  const ps = playstates.get(item);
  if (!ps) return;
  ps.mixer.stopAllAction();
  ps.mixer.uncacheRoot(item);
  if (restore) restoreSubtree(ps.baseline);
  playstates.delete(item);
  app.events.emit('transform-changed', item);
}

function applyTime(t) {
  for (const item of armedItems()) {
    const ps = ensurePlaystate(item);
    if (!ps) continue;
    const d = ps.clip.duration;
    const ct = d > 0 ? (state.loop ? t % d : Math.min(t, d)) : 0;
    ps.action.time = ct;
    ps.mixer.update(0);
  }
}

export function play() {
  if (!armedItems().length) {
    toast('Nothing to play — pick a clip for an object (bottom bar), add keyframes with 🔑, or import an animation.', 'warn', 4600);
    return;
  }
  state.playing = true;
  refreshTransport();
}

export function pause() { state.playing = false; refreshTransport(); }

export function togglePlay() { state.playing ? pause() : play(); }

export function stop() {
  state.playing = false;
  state.time = 0;
  for (const item of [...playstates.keys()]) releaseItem(item, true);
  refreshTransport();
  refreshTrack();
}

export function setTime(t) {
  state.time = THREE.MathUtils.clamp(t, 0, state.duration);
  applyTime(state.time);
  refreshTrack();
}

function tick(dt) {
  if (!state.playing) return;
  let t = state.time + dt * state.speed;
  if (t >= state.duration) {
    if (state.loop) t = state.duration > 0 ? t % state.duration : 0;
    else { t = state.duration; state.playing = false; refreshTransport(); }
  }
  state.time = t;
  applyTime(t);
  refreshTrack();
}

function autoDuration() {
  let d = 0;
  for (const item of armedItems()) {
    const c = activeClip(item);
    if (c) d = Math.max(d, c.duration);
  }
  const keys = app.selected?.userData?.keys;
  if (keys?.length) d = Math.max(d, keys[keys.length - 1].t);
  if (d > 0.01) {
    state.duration = Math.ceil(d * 100) / 100;
    $('tl-dur').value = fmt(state.duration, 2);
  }
}

/* ---------------- keyframes ---------------- */
export function addKeyAtCurrentTime() {
  const item = app.selected;
  if (!item) { toast('Select an object first, then press 🔑 to key its position/rotation/scale.', 'warn'); return; }
  const keys = item.userData.keys;
  const t = Math.round(state.time * 100) / 100;
  const key = {
    t,
    p: item.position.toArray(),
    q: item.quaternion.toArray(),
    s: item.scale.toArray(),
  };
  const existing = keys.findIndex(k => Math.abs(k.t - t) < 1 / 60);
  const prev = existing >= 0 ? keys[existing] : null;
  if (existing >= 0) keys[existing] = key; else keys.push(key);
  keys.sort((a, b) => a.t - b.t);
  markKeysDirty(item);

  app.undo.push({
    label: 'Add keyframe',
    undo: () => {
      const i = keys.findIndex(k => k.t === t);
      if (i >= 0) { if (prev) keys[i] = prev; else keys.splice(i, 1); }
      markKeysDirty(item);
    },
    redo: () => {
      const i = keys.findIndex(k => Math.abs(k.t - t) < 1 / 120);
      if (i >= 0) keys[i] = key; else { keys.push(key); keys.sort((a, b) => a.t - b.t); }
      markKeysDirty(item);
    },
  });

  if (keys.length >= 2 && activeSel(item) === '-1') {
    item.userData.activeClipSel = 'k';
  }
  toast(`🔑 Key at ${fmt(t, 2)}s (${keys.length} total${keys.length < 2 ? ' — add another at a different time to create motion' : ''})`, 'good', 2600);
  refreshClipSelect();
  refreshKeys();
}

function removeKey(item, key) {
  const keys = item.userData.keys;
  const i = keys.indexOf(key);
  if (i === -1) return;
  keys.splice(i, 1);
  markKeysDirty(item);
  app.undo.push({
    label: 'Delete keyframe',
    undo: () => { keys.push(key); keys.sort((a, b) => a.t - b.t); markKeysDirty(item); },
    redo: () => {
      const j = keys.indexOf(key);
      if (j >= 0) { keys.splice(j, 1); markKeysDirty(item); }
    },
  });
  refreshKeys();
  refreshClipSelect();
}

function markKeysDirty(item) {
  const ps = playstates.get(item);
  if (ps && ps.sel === 'k') ps.dirty = true;
  refreshKeys();
}

/** Build an AnimationClip from an item's authored keys (null if < 2 keys). */
export function buildKeyframeClip(item) {
  const keys = item.userData?.keys || [];
  if (keys.length < 2) return null;
  const times = keys.map(k => k.t);
  const p = [], q = [], s = [];
  let prevQ = null;
  for (const k of keys) {
    p.push(...k.p);
    let quat = k.q;
    if (prevQ && (prevQ[0] * quat[0] + prevQ[1] * quat[1] + prevQ[2] * quat[2] + prevQ[3] * quat[3]) < 0) {
      quat = [-quat[0], -quat[1], -quat[2], -quat[3]];
    }
    q.push(...quat);
    prevQ = quat;
    s.push(...k.s);
  }
  const n = item.name;
  return new THREE.AnimationClip(`${n} keys`, times[times.length - 1], [
    new THREE.VectorKeyframeTrack(`${n}.position`, times, p),
    new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, q),
    new THREE.VectorKeyframeTrack(`${n}.scale`, times, s),
  ]);
}

/* ---------------- UI ---------------- */
function refreshTransport() {
  $('tl-play').textContent = state.playing ? '⏸' : '▶';
  $('tl-play').classList.toggle('on', state.playing);
}

function refreshTrack() {
  const frac = state.duration > 0 ? state.time / state.duration : 0;
  $('tl-cursor').style.left = `${(frac * 100).toFixed(2)}%`;
  $('tl-fill').style.width = `${(frac * 100).toFixed(2)}%`;
  $('tl-time').textContent = `${state.time.toFixed(2)} / ${state.duration.toFixed(2)}`;
}

function refreshKeys() {
  const host = $('tl-keys');
  host.innerHTML = '';
  const item = app.selected;
  if (!item) return;
  for (const k of item.userData.keys || []) {
    const m = document.createElement('div');
    m.className = 'tl-key';
    m.style.left = `${(state.duration > 0 ? (k.t / state.duration) * 100 : 0).toFixed(2)}%`;
    m.title = `Keyframe @ ${fmt(k.t, 2)}s — click to jump`;
    const del = document.createElement('span');
    del.className = 'delkey';
    del.textContent = '✕';
    del.title = 'Delete keyframe';
    del.addEventListener('pointerdown', e => { e.stopPropagation(); removeKey(item, k); });
    m.appendChild(del);
    m.addEventListener('pointerdown', e => { e.stopPropagation(); setTime(k.t); });
    host.appendChild(m);
  }
}

function refreshClipSelect() {
  const sel = $('tl-clip');
  const item = app.selected;
  sel.innerHTML = '';
  const optNone = new Option('— no clip —', '-1');
  sel.add(optNone);
  if (!item) { sel.disabled = true; return; }
  sel.disabled = false;
  if ((item.userData.keys || []).length >= 2) {
    sel.add(new Option(`✎ Keyframed motion (${item.userData.keys.length} keys)`, 'k'));
  }
  app.getClips(item).forEach((rec, i) => {
    sel.add(new Option(`🎞 ${rec.name} (${rec.clip.duration.toFixed(1)}s)`, String(i)));
  });
  sel.value = activeSel(item);
  if (sel.selectedIndex === -1) { sel.value = '-1'; item.userData.activeClipSel = '-1'; }
}

export function initTimeline() {
  $('tl-play').addEventListener('click', togglePlay);
  $('tl-stop').addEventListener('click', stop);
  $('tl-addkey').addEventListener('click', addKeyAtCurrentTime);
  $('tl-loop').addEventListener('click', () => {
    state.loop = !state.loop;
    $('tl-loop').classList.toggle('on', state.loop);
  });
  $('tl-speed').addEventListener('change', e => { state.speed = parseFloat(e.target.value); });
  $('tl-dur').value = fmt(state.duration, 2);
  $('tl-dur').addEventListener('change', e => {
    const v = parseFloat(e.target.value);
    if (isFinite(v) && v > 0.1) { state.duration = v; setTime(Math.min(state.time, v)); }
    e.target.value = fmt(state.duration, 2);
    refreshKeys();
  });

  $('tl-clip').addEventListener('change', e => {
    const item = app.selected;
    if (!item) return;
    const prev = playstates.get(item);
    if (prev) releaseItem(item, true);
    item.userData.activeClipSel = e.target.value;
    autoDuration();
    applyTime(state.time);
    refreshKeys();
    refreshTrack();
  });

  // scrubbing
  const track = $('tl-track');
  const scrub = e => {
    const r = track.getBoundingClientRect();
    setTime(((e.clientX - r.left) / r.width) * state.duration);
  };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId);
    scrub(e);
    const mv = ev => scrub(ev);
    const up = () => { track.removeEventListener('pointermove', mv); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', mv);
    track.addEventListener('pointerup', up);
  });

  app.events.on('selection-changed', () => { refreshClipSelect(); refreshKeys(); });
  app.events.on('clips-changed', item => {
    if (item === app.selected) refreshClipSelect();
    autoDuration();
  });
  app.events.on('item-removed', item => releaseItem(item, false));
  app.events.on('items-changed', () => autoDuration());

  app.tickers.push(tick);
  refreshTransport();
  refreshTrack();
  refreshClipSelect();
}

export const timelineState = state;
