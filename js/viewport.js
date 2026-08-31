// 3D viewport: renderer, lights, grid, orbit + transform controls, picking, selection box.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { app } from './app.js';
import { pushTransformUndo, snapshotTransform } from './undo.js';

let boxHelper = null;
let dragStartSnapshot = null;
const clock = new THREE.Clock();

export function initViewport() {
  const container = document.getElementById('viewport');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14171e);
  scene.fog = new THREE.Fog(0x14171e, 60, 160);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
  camera.position.set(5, 3.6, 6.5);

  // environment for nice PBR response
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  if ('environmentIntensity' in scene) scene.environmentIntensity = 0.55;

  // lights
  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x3a3f4c, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(7, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18; sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18; sun.shadow.camera.bottom = -18;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // ground: grid + shadow catcher
  const grid = new THREE.GridHelper(80, 80, 0x39415a, 0x232837);
  grid.material.transparent = true;
  grid.material.opacity = 0.85;
  scene.add(grid);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.ShadowMaterial({ opacity: 0.34 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.001;
  ground.receiveShadow = true;
  scene.add(ground);

  const contentGroup = new THREE.Group();
  contentGroup.name = 'Scene';
  scene.add(contentGroup);

  // controls
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.12;
  orbit.maxPolarAngle = Math.PI * 0.55;
  orbit.target.set(0, 0.8, 0);

  const tc = new TransformControls(camera, renderer.domElement);
  tc.setSize(0.95);
  scene.add(tc.getHelper());

  tc.addEventListener('dragging-changed', e => {
    orbit.enabled = !e.value;
    if (e.value && tc.object) {
      dragStartSnapshot = snapshotTransform(tc.object);
    } else if (!e.value && tc.object && dragStartSnapshot) {
      pushTransformUndo(tc.object, dragStartSnapshot, `${tc.mode} ${tc.object.name}`);
      dragStartSnapshot = null;
    }
  });
  tc.addEventListener('objectChange', () => {
    app.events.emit('transform-changed', tc.object);
  });

  // selection outline
  boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0x4f8cff);
  boxHelper.visible = false;
  scene.add(boxHelper);

  Object.assign(app, { renderer, scene, camera, orbit, tc, contentGroup });

  // ---- picking (click that isn't a drag) ----
  const raycaster = new THREE.Raycaster();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    downPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (e.button !== 0 || !downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5 || tc.dragging) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    if (app.pickOverride && app.pickOverride(raycaster)) return;
    const hits = raycaster.intersectObjects(contentGroup.children, true);
    let item = null;
    for (const h of hits) {
      let o = h.object;
      if (!o.visible) continue;
      while (o && o.parent !== contentGroup) o = o.parent;
      if (o && o.visible) { item = o; break; }
    }
    app.select(item);
  });

  // resize
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  // selection visuals + gizmo attach
  app.events.on('selection-changed', obj => {
    if (obj) {
      tc.attach(obj);
      updateSelectionBox();
      boxHelper.visible = true;
    } else {
      tc.detach();
      boxHelper.visible = false;
    }
  });
  app.events.on('item-removed', obj => {
    if (tc.object === obj) tc.detach();
  });
  app.events.on('transform-changed', obj => {
    if (obj === app.selected) updateSelectionBox();
  });

  // render loop
  let frames = 0, statTimer = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    orbit.update();
    for (const t of app.tickers) t(dt);
    if (boxHelper.visible && app.selected) updateSelectionBox();
    renderer.render(scene, camera);
    frames++;
    statTimer += dt;
    if (statTimer > 0.8) {
      updateStats();
      statTimer = 0; frames = 0;
    }
  });

  window.addEventListener('keydown', e => {
    if (isTyping()) return;
    if (e.key === 'f' || e.key === 'F') focusSelection();
    if (e.key === 'Home') frameAll();
  });

  return { renderer, scene, camera, orbit, tc, contentGroup };
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

function updateSelectionBox() {
  if (!app.selected) return;
  boxHelper.box.setFromObject(app.selected);
  if (boxHelper.box.isEmpty()) boxHelper.box.setFromCenterAndSize(app.selected.position, new THREE.Vector3(0.2, 0.2, 0.2));
}

function updateStats() {
  const elStats = document.getElementById('status-stats');
  if (!elStats) return;
  let tris = 0;
  app.contentGroup.traverse(o => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      tris += g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
    }
  });
  elStats.textContent = `${app.items.length} object${app.items.length === 1 ? '' : 's'} · ${Math.round(tris).toLocaleString()} tris`;
}

export function setGizmoMode(mode) {
  app.tc.setMode(mode);
  document.querySelectorAll('#modegroup .tb').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === mode));
}

let snapping = false;
export function toggleSnap(force) {
  snapping = force !== undefined ? force : !snapping;
  app.tc.setTranslationSnap(snapping ? 0.5 : null);
  app.tc.setRotationSnap(snapping ? THREE.MathUtils.degToRad(15) : null);
  app.tc.setScaleSnap(snapping ? 0.1 : null);
  document.getElementById('btn-snap')?.classList.toggle('on', snapping);
  return snapping;
}

export function focusSelection() {
  if (app.selected) focusObject(app.selected);
  else frameAll();
}

export function frameAll() {
  if (!app.items.length) {
    app.orbit.target.set(0, 0.8, 0);
    app.camera.position.set(5, 3.6, 6.5);
    return;
  }
  focusBox(new THREE.Box3().setFromObject(app.contentGroup));
}

export function focusObject(obj) {
  focusBox(new THREE.Box3().setFromObject(obj));
}

function focusBox(box) {
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  const dir = new THREE.Vector3().subVectors(app.camera.position, app.orbit.target);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0.6, 1);
  dir.normalize();
  const dist = radius / Math.tan(THREE.MathUtils.degToRad(app.camera.fov / 2)) * 1.15;
  app.orbit.target.copy(center);
  app.camera.position.copy(center).addScaledVector(dir, dist);
}

/** Render one frame and return a PNG blob of the viewport. */
export function screenshot() {
  return new Promise(resolve => {
    app.renderer.render(app.scene, app.camera);
    app.renderer.domElement.toBlob(b => resolve(b), 'image/png');
  });
}
