// Easy3D Studio — bootstrap & global UI wiring.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { app } from './app.js';
import { UndoStack } from './undo.js';
import { initViewport, setGizmoMode, toggleSnap, frameAll, focusSelection } from './viewport.js';
import { initOutliner } from './outliner.js';
import { initProperties } from './properties.js';
import { initTimeline, togglePlay, addKeyAtCurrentTime, setTime, stop as timelineStop, timelineState } from './timeline.js';
import { initAnimatePanel } from './animate.js';
import { initRigToolbar, rigEditActive, cancelJointEdit } from './autorig.js';
import { PRIMITIVES, addPrimitive } from './primitives.js';
import { openFiles } from './importers.js';
import { exportScene } from './exporters.js';
import { startTour, maybeAutoStart } from './tutorial.js';
import { toast } from './utils.js';

/* ---------------- boot ---------------- */
try {
  app.undo = new UndoStack();
  initViewport();
  initOutliner();
  initProperties();
  initTimeline();
  initAnimatePanel();
  initRigToolbar();
} catch (e) {
  console.error('Easy3D boot failed:', e);
  window.__showBootOverlay?.("The 3D engine couldn't start", [
    String((e && e.message) || e),
    '• If this mentions WebGL or a context: turn ON hardware acceleration in your browser settings (usually under System), then restart the browser.',
    '• Trying a different browser (Chrome or Edge) also rules out driver issues.',
  ]);
  throw e;
}

/* ---------------- ops shared with panels ---------------- */
app.ops = {
  duplicateSelected() {
    const item = app.selected;
    if (!item) return;
    const ud = item.userData;
    item.userData = {};
    let copy;
    try {
      copy = skeletonClone(item);
    } catch (e) {
      item.userData = ud;
      app.error('Could not duplicate this object.', e);
      return;
    }
    item.userData = ud;
    copy.userData = {
      isItem: true,
      clips: (ud.clips || []).map(r => ({ name: r.name, clip: r.clip })),
      keys: (ud.keys || []).map(k => ({ t: k.t, p: [...k.p], q: [...k.q], s: [...k.s] })),
      activeClipSel: ud.activeClipSel,
      rigged: ud.rigged,
    };
    // decouple materials so recoloring the copy doesn't touch the original
    copy.traverse(o => {
      if (o.isMesh && o.material) {
        o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      }
    });
    copy.name = item.name.replace(/ \d+$/, '');
    copy.position.x += 0.6;
    copy.position.z += 0.6;
    app.addItem(copy, { select: true });
    toast(`⧉ Duplicated → <b>${copy.name}</b>`, 'good', 2200);
  },
};

/* ---------------- toolbar ---------------- */
const $ = id => document.getElementById(id);

$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => {
  openFiles(e.target.files);
  e.target.value = '';
});

// Add menu
{
  const menu = $('menu-add');
  menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-head', textContent: 'Shapes' }));
  for (const p of PRIMITIVES) {
    if (p.id === 'mannequin') menu.appendChild(Object.assign(document.createElement('div'), { className: 'menu-head', textContent: 'Characters' }));
    const b = document.createElement('button');
    b.innerHTML = p.label;
    b.addEventListener('click', () => { closeMenus(); addPrimitive(p.id); });
    menu.appendChild(b);
  }
}

// dropdowns
function closeMenus() {
  document.querySelectorAll('.dropdown.open').forEach(d => d.classList.remove('open'));
}
for (const dd of document.querySelectorAll('.dropdown')) {
  dd.querySelector(':scope > .tb').addEventListener('click', e => {
    e.stopPropagation();
    const was = dd.classList.contains('open');
    closeMenus();
    if (!was) dd.classList.add('open');
  });
}
document.addEventListener('click', closeMenus);

// gizmo modes
for (const b of document.querySelectorAll('#modegroup .tb')) {
  b.addEventListener('click', () => setGizmoMode(b.dataset.mode));
}
$('btn-snap').addEventListener('click', () => toggleSnap());
$('btn-frame').addEventListener('click', () => frameAll());

// undo / redo
const refreshUndoButtons = () => {
  $('btn-undo').disabled = !app.undo.canUndo();
  $('btn-redo').disabled = !app.undo.canRedo();
};
app.undo.onChange = refreshUndoButtons;
refreshUndoButtons();
$('btn-undo').addEventListener('click', () => app.undo.undo());
$('btn-redo').addEventListener('click', () => app.undo.redo());

// export menu
for (const b of document.querySelectorAll('#dd-export .menu button')) {
  b.addEventListener('click', () => { closeMenus(); exportScene(b.dataset.export); });
}

$('btn-help').addEventListener('click', startTour);

/* ---------------- empty-state hint ---------------- */
app.events.on('items-changed', () => {
  $('empty-hint').style.display = app.items.length ? 'none' : '';
});

/* ---------------- drag & drop ---------------- */
{
  let depth = 0;
  const overlay = $('drop-overlay');
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    if (e.dataTransfer?.types?.includes('Files')) {
      depth++;
      overlay.classList.remove('hidden');
    }
  });
  window.addEventListener('dragleave', e => {
    e.preventDefault();
    if (--depth <= 0) { depth = 0; overlay.classList.add('hidden'); }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    depth = 0;
    overlay.classList.add('hidden');
    if (e.dataTransfer?.files?.length) openFiles(e.dataTransfer.files);
  });
}

/* ---------------- keyboard ---------------- */
function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

window.addEventListener('keydown', e => {
  if (isTyping()) return;
  const k = e.key.toLowerCase();

  if ((e.ctrlKey || e.metaKey) && k === 'z') {
    e.preventDefault();
    e.shiftKey ? app.undo.redo() : app.undo.undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); app.undo.redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); app.ops.duplicateSelected(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (k) {
    case 'w': if (!rigEditActive()) setGizmoMode('translate'); break;
    case 'e': if (!rigEditActive()) setGizmoMode('rotate'); break;
    case 'r': if (!rigEditActive()) setGizmoMode('scale'); break;
    case 'k': addKeyAtCurrentTime(); break;
    case ' ': e.preventDefault(); togglePlay(); break;
    case 'delete': case 'backspace':
      if (app.selected) app.removeItem(app.selected);
      break;
    case 'escape':
      if (rigEditActive()) cancelJointEdit();
      else app.select(null);
      break;
  }
});

/* ---------------- expose for power users & tests ---------------- */
window.easy3d = {
  app, addPrimitive, openFiles, exportScene, focusSelection, THREE,
  timeline: { setTime, togglePlay, stop: timelineStop, addKey: addKeyAtCurrentTime, state: timelineState },
};
window.__EASY3D_READY = true;
document.dispatchEvent(new CustomEvent('easy3d-ready'));

maybeAutoStart();
