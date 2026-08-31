// "Learn it in 10 minutes" — a guided tour that spotlights real UI.
import { el } from './utils.js';

const STEPS = [
  {
    title: '🧊 Welcome to Easy3D Studio',
    html: `Model, build maps and animate — right in your browser, nothing to install.
      <br><br>This tour takes <b>under 10 minutes</b> and shows you everything:
      shapes, importing any 3D file, resizing, materials, keyframe animation,
      rigging and mocap. Click <b>Next</b> to start.`,
  },
  {
    target: '#dd-add',
    title: '＋ Add shapes',
    html: `Start building instantly: cubes, walls, ramps, trees… perfect for
      blocking out <b>maps and levels</b>.
      <br><br>The <b>🧍 Mannequin</b> is special — it comes already rigged, so you
      can test animations on it right away.`,
  },
  {
    target: '#modegroup',
    title: '✥ Move · ⟳ Rotate · ⤢ Scale',
    html: `Click an object, then drag the colored handles in the viewport.
      <br><br><kbd>W</kbd> move &nbsp;·&nbsp; <kbd>E</kbd> rotate &nbsp;·&nbsp; <kbd>R</kbd> scale
      <br><br>With <b>Scale</b> active you literally <i>drag the size</i> of things.
      Turn on <b>⌗ Snap</b> for tidy grid placement.`,
  },
  {
    target: '#props',
    title: '🎛 Exact numbers, zero math',
    html: `Everything about the selected object lives here: position, rotation,
      scale — and <b>Size</b>, the real bounding size. Type <i>2</i> to make
      something exactly 2 units tall.
      <br><br>Pro move: <b>drag the X/Y/Z letters</b> left‑right to slide values.
      The 🔗 lock keeps proportions.`,
  },
  {
    target: '#btn-import',
    title: '⬆ Import anything',
    html: `Drop files anywhere in the window — no dialogs needed.
      <br><br>Supported: <b>GLB · GLTF · FBX · OBJ · STL · PLY · DAE · 3DS ·
      3MF · USDZ</b> and <b>BVH</b> motion capture. Wrong-unit files (giant cm
      exports) are auto-scaled for you.`,
  },
  {
    target: '#viewport',
    title: '🎥 Flying around',
    html: `<b>Drag</b> to orbit · <b>right‑drag</b> to pan · <b>wheel</b> to zoom.
      <br><br><kbd>F</kbd> frames the selected object, <kbd>Home</kbd> frames the
      whole scene. <kbd>Ctrl+D</kbd> duplicates, <kbd>Del</kbd> deletes,
      <kbd>Ctrl+Z</kbd> undoes anything.`,
  },
  {
    target: '#timeline',
    title: '🎬 Animate anything',
    html: `The timeline plays every object's chosen clip in sync.
      <br><br>To animate by hand: move the time cursor, pose your object, press
      <b>🔑 Key</b> — then move the cursor and pose again. Press
      <kbd>Space</kbd> and it moves! Diamonds on the bar are your keyframes.`,
  },
  {
    target: '#mocap-list',
    title: '🦴 Rigging & motion capture',
    html: `Import a <b>BVH</b> file (or animated FBX/GLB) and it appears here.
      Select any <b>rigged</b> model and press <b>▶ Apply</b> — bones are matched
      by name automatically, and ⚙ lets you fix the map by hand.
      <br><br>Static model? Sidebar → <b>Rigging → Auto‑Rig</b>: drag a few dots
      onto the body, click <b>Bind skin</b>, done — it now accepts any mocap.`,
  },
  {
    target: '#dd-export',
    title: '⬇ Ship it',
    html: `Export the whole scene as <b>GLB</b> (meshes, rigs <i>and</i>
      animations — drops straight into Unity, Unreal, Godot, Blender or the web),
      as OBJ/STL for printing, or grab a PNG screenshot.
      <br><br>That's the whole app — have fun! Reopen this tour any time with
      <b>🎓 Learn it</b>.`,
  },
];

let idx = 0;
let root, dim, ring, card;

export function startTour() {
  idx = 0;
  build();
  show();
}

export function maybeAutoStart() {
  try {
    if (!localStorage.getItem('easy3d_tour_done')) startTour();
  } catch { /* storage blocked — skip */ }
}

function build() {
  root = document.getElementById('tour-root');
  root.classList.remove('hidden');
  root.innerHTML = '';
  dim = el('div', '');
  dim.id = 'tour-dim';
  ring = el('div', '');
  ring.id = 'tour-ring';
  card = el('div', '');
  card.id = 'tour-card';
  root.append(dim, ring, card);
  window.addEventListener('resize', onResize);
}

function onResize() { if (root && !root.classList.contains('hidden')) show(); }

function finish() {
  try { localStorage.setItem('easy3d_tour_done', '1'); } catch { /* ignore */ }
  window.removeEventListener('resize', onResize);
  root.classList.add('hidden');
  root.innerHTML = '';
}

function show() {
  const step = STEPS[idx];
  const target = step.target ? document.querySelector(step.target) : null;

  if (target) {
    const r = target.getBoundingClientRect();
    const pad = 6;
    ring.style.display = 'block';
    ring.style.left = `${r.left - pad}px`;
    ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;
  } else {
    ring.style.display = 'none';
  }

  card.innerHTML = '';
  card.appendChild(el('h3', '', step.title));
  card.appendChild(el('div', 'tour-body', step.html));
  const foot = el('div', 'tour-foot');
  foot.appendChild(el('span', 'steps', `${idx + 1} / ${STEPS.length}`));
  foot.appendChild(el('span', 'flex'));
  const bSkip = el('button', 'tb', 'Skip');
  bSkip.addEventListener('click', finish);
  foot.appendChild(bSkip);
  if (idx > 0) {
    const bBack = el('button', 'tb', '← Back');
    bBack.addEventListener('click', () => { idx--; show(); });
    foot.appendChild(bBack);
  }
  const bNext = el('button', 'tb accent', idx === STEPS.length - 1 ? '✓ Done' : 'Next →');
  bNext.addEventListener('click', () => {
    if (idx === STEPS.length - 1) finish();
    else { idx++; show(); }
  });
  foot.appendChild(bNext);
  card.appendChild(foot);

  // place the card near the ring (or centered)
  const cw = 340, chGuess = 260;
  let x, y;
  if (target) {
    const r = target.getBoundingClientRect();
    const below = r.bottom + 14;
    if (below + chGuess < innerHeight) { y = below; }
    else { y = Math.max(12, r.top - chGuess - 14); }
    x = Math.min(Math.max(12, r.left), innerWidth - cw - 12);
  } else {
    x = (innerWidth - cw) / 2;
    y = Math.max(60, innerHeight * 0.3);
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}
