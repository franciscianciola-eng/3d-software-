// Built-in shapes for map building, plus a rigged demo mannequin.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { app } from './app.js';
import { rigItemAuto } from './autorig.js';
import { toast } from './utils.js';

const DEFAULT_COLORS = [0x8fb3ff, 0xffb37a, 0x9be8b0, 0xf2a0c0, 0xc9b8ff, 0xffe08a];
let colorIdx = 0;

function nextColor() {
  return DEFAULT_COLORS[colorIdx++ % DEFAULT_COLORS.length];
}

function stdMat(color) {
  return new THREE.MeshStandardMaterial({
    color: color ?? nextColor(),
    roughness: 0.72,
    metalness: 0.05,
  });
}

function wedgeGeometry(w = 1, h = 1, d = 1) {
  // triangular ramp: rises from -z to +z
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(d / 2, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

export const PRIMITIVES = [
  { id: 'box', label: '📦 Cube', make: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stdMat()), lift: 0.5 },
  { id: 'sphere', label: '🔮 Sphere', make: () => new THREE.Mesh(new THREE.SphereGeometry(0.55, 40, 24), stdMat()), lift: 0.55 },
  { id: 'cylinder', label: '🛢 Cylinder', make: () => new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 32), stdMat()), lift: 0.55 },
  { id: 'cone', label: '🍦 Cone', make: () => new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 32), stdMat()), lift: 0.55 },
  { id: 'torus', label: '🍩 Torus', make: () => new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 18, 40), stdMat()), lift: 0.61 },
  { id: 'wedge', label: '📐 Ramp', make: () => new THREE.Mesh(wedgeGeometry(1, 0.8, 1.4), stdMat()), lift: 0.4 },
  { id: 'plane', label: '⬜ Floor tile', make: () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 2), stdMat(0x7d8699));
      return m;
    }, lift: 0.03 },
  { id: 'wall', label: '🧱 Wall', make: () => new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 0.12), stdMat(0xb9a58c)), lift: 0.6 },
  { id: 'tree', label: '🌲 Tree', make: makeTree, lift: 0 },
  { id: 'mannequin', label: '🧍 Mannequin (rigged)', make: null, lift: 0 }, // special-cased
];

function makeTree() {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.7, 10), stdMat(0x8a6a4a));
  trunk.position.y = 0.35;
  const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.9, 10), stdMat(0x4e9e63));
  crown1.position.y = 1.05;
  const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.75, 10), stdMat(0x57b06f));
  crown2.position.y = 1.5;
  g.add(trunk, crown1, crown2);
  return g;
}

/** Boxy humanoid in T-pose (1.7 units tall), auto-rigged and ready for mocap. */
export function makeMannequin() {
  const H = 1.7;
  const parts = [];
  const B = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
    g.translate(x, y, z);
    parts.push(g);
  };
  // torso / head
  B(0.34 * H, 0.13 * H, 0.16 * H, 0, 0.555 * H, 0);           // pelvis
  B(0.30 * H, 0.24 * H, 0.15 * H, 0, 0.74 * H, 0);            // chest
  B(0.07 * H, 0.05 * H, 0.07 * H, 0, 0.875 * H, 0);           // neck
  B(0.15 * H, 0.15 * H, 0.15 * H, 0, 0.955 * H, 0);           // head
  for (const s of [1, -1]) {
    // arms (T-pose along X)
    B(0.14 * H, 0.075 * H, 0.075 * H, s * 0.245 * H, 0.815 * H, 0); // upper arm
    B(0.13 * H, 0.065 * H, 0.065 * H, s * 0.375 * H, 0.815 * H, 0); // forearm
    B(0.08 * H, 0.055 * H, 0.06 * H, s * 0.478 * H, 0.815 * H, 0);  // hand
    // legs
    B(0.105 * H, 0.24 * H, 0.11 * H, s * 0.083 * H, 0.385 * H, 0);  // thigh
    B(0.09 * H, 0.23 * H, 0.095 * H, s * 0.083 * H, 0.155 * H, 0);  // shin
    B(0.095 * H, 0.05 * H, 0.19 * H, s * 0.083 * H, 0.025 * H, 0.04 * H); // foot
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xcfd6e4, roughness: 0.55, metalness: 0.08,
  }));
  mesh.castShadow = mesh.receiveShadow = true;
  const item = new THREE.Group();
  item.name = 'Mannequin';
  item.add(mesh);
  return item;
}

export function addPrimitive(id) {
  const def = PRIMITIVES.find(p => p.id === id);
  if (!def) return null;

  let item;
  if (id === 'mannequin') {
    item = makeMannequin();
    app.contentGroup.add(item); // temporarily, for world-space rigging
    item.updateMatrixWorld(true);
    try {
      rigItemAuto(item);
    } catch (e) {
      console.error(e);
    }
    app.contentGroup.remove(item);
    toast('🧍 Mannequin added — it is already <b>rigged</b>. Import a BVH/FBX motion and press Apply on it.', 'good', 6000);
  } else {
    const obj = def.make();
    obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    item = new THREE.Group();
    item.add(obj);
    item.position.y = def.lift;
    item.name = def.label.replace(/^[^\s]+\s/, '');
  }
  return app.addItem(item, { select: true });
}
