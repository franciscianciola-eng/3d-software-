// Import pipeline. Drop or pick files in any of:
//   GLB/GLTF, FBX, OBJ(+MTL), STL, PLY, DAE (Collada), 3DS, 3MF, USDZ — models
//   BVH — mocap; animated FBX/GLB/DAE also feed the motion library.
// Multi-file drops (gltf+bin+textures, obj+mtl+jpg…) are resolved via a
// LoadingManager URL rewriter over the dropped file set.
import * as THREE from 'three';
import { app } from './app.js';
import { toast, basename, stripExt, extOf } from './utils.js';
import { captureRestPose } from './retarget.js';
import { focusObject } from './viewport.js';

const MODEL_EXTS = ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', 'dae', '3ds', '3mf', 'usdz', 'usda', 'usdc', 'usd'];
const AUX_EXTS = ['bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tga', 'dds', 'ktx2'];

let dracoLoader = null;
async function getDraco() {
  if (!dracoLoader) {
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
  }
  return dracoLoader;
}

export async function openFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  // build lookup of every dropped file for cross-references
  const fileMap = new Map();
  for (const f of files) fileMap.set(basename(f.name).toLowerCase(), f);

  const urls = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob|data):/.test(url)) return url;
    let name;
    try { name = basename(decodeURIComponent(new URL(url, 'http://x/').pathname)).toLowerCase(); }
    catch { name = basename(url).toLowerCase(); }
    const f = fileMap.get(name);
    if (f) {
      const u = URL.createObjectURL(f);
      urls.push(u);
      return u;
    }
    return url;
  });

  const models = files.filter(f => MODEL_EXTS.includes(extOf(f.name)));
  const mocaps = files.filter(f => extOf(f.name) === 'bvh');
  const known = new Set([...models, ...mocaps]);
  const strays = files.filter(f => !known.has(f) && !AUX_EXTS.includes(extOf(f.name)));

  if (!models.length && !mocaps.length) {
    app.error(`No 3D files found. Supported: ${MODEL_EXTS.join(', ').toUpperCase()}, BVH.`);
    return;
  }
  for (const s of strays) toast(`🤷 Skipped <b>${s.name}</b> (unsupported type)`, 'warn');

  let firstItem = null;
  for (const f of mocaps) {
    try { await importBVH(f); }
    catch (e) { app.error(`Could not read ${f.name}: ${e.message}`, e); }
  }
  for (const f of models) {
    try {
      const item = await importModel(f, manager, fileMap);
      if (item && !firstItem) firstItem = item;
    } catch (e) {
      app.error(`Could not import ${f.name}: ${e.message || e}`, e);
    }
  }
  if (firstItem) focusObject(firstItem);
  setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 15000);
}

/* -------------------- BVH mocap -------------------- */
async function importBVH(file) {
  const text = await file.text();
  const { BVHLoader } = await import('three/addons/loaders/BVHLoader.js');
  const result = new BVHLoader().parse(text);
  const root = new THREE.Group();
  root.name = stripExt(file.name);
  root.add(result.skeleton.bones[0]);
  root.userData._skeleton = result.skeleton;
  captureRestPose(root);
  const entry = app.addMocap(stripExt(file.name), result.clip, root);
  toast(`🎬 Mocap <b>${entry.name}</b> added to the Motion library (${entry.duration.toFixed(1)}s). Select a rigged model and press <b>Apply</b>.`, 'good', 6500);
  return entry;
}

/* -------------------- models -------------------- */
async function importModel(file, manager, fileMap) {
  const ext = extOf(file.name);
  const name = stripExt(file.name);
  let root = null;
  let clips = [];

  switch (ext) {
    case 'glb': case 'gltf': {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loader = new GLTFLoader(manager);
      loader.setDRACOLoader(await getDraco());
      const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
      const gltf = await new Promise((res, rej) => loader.parse(data, '', res, rej));
      root = gltf.scene;
      clips = gltf.animations || [];
      break;
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const loader = new FBXLoader(manager);
      root = loader.parse(await file.arrayBuffer(), '');
      clips = root.animations || [];
      break;
    }
    case 'obj': {
      const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
      const loader = new OBJLoader(manager);
      const text = await file.text();
      const mtlRef = (text.match(/^[ \t]*mtllib[ \t]+(.+)$/m) || [])[1]?.trim();
      let mtlFile = mtlRef ? fileMap.get(basename(mtlRef).toLowerCase()) : null;
      if (!mtlFile) mtlFile = [...fileMap.values()].find(f => extOf(f.name) === 'mtl');
      if (mtlFile) {
        try {
          const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
          const mtl = new MTLLoader(manager).parse(await mtlFile.text(), '');
          mtl.preload();
          loader.setMaterials(mtl);
        } catch (e) { console.warn('MTL parse failed', e); }
      }
      root = loader.parse(text);
      break;
    }
    case 'stl': {
      const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
      const geo = new STLLoader().parse(await file.arrayBuffer());
      root = meshFromGeometry(geo);
      break;
    }
    case 'ply': {
      const { PLYLoader } = await import('three/addons/loaders/PLYLoader.js');
      const geo = new PLYLoader().parse(await file.arrayBuffer());
      root = meshFromGeometry(geo);
      break;
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
      const collada = new ColladaLoader(manager).parse(await file.text(), '');
      root = collada.scene;
      clips = root.animations || [];
      break;
    }
    case '3ds': {
      const { TDSLoader } = await import('three/addons/loaders/TDSLoader.js');
      root = new TDSLoader(manager).parse(await file.arrayBuffer(), '');
      break;
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
      root = new ThreeMFLoader(manager).parse(await file.arrayBuffer());
      break;
    }
    case 'usdz': case 'usda': case 'usdc': case 'usd': {
      const { USDLoader } = await import('three/addons/loaders/USDLoader.js');
      root = new USDLoader(manager).parse(await file.arrayBuffer());
      break;
    }
    default:
      throw new Error(`unsupported extension .${ext}`);
  }

  if (!root) throw new Error('file produced no scene');

  // wrap in an item group
  const item = new THREE.Group();
  item.name = name;
  item.add(root);

  let meshCount = 0;
  item.traverse(o => {
    if (o.isMesh) {
      meshCount++;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
  });

  // register animations on the item and, if skeletal, in the motion library
  item.userData.clips = clips.map(c => ({ name: c.name || 'Animation', clip: c }));
  const hasBones = (() => { let b = false; item.traverse(o => { if (o.isBone) b = true; }); return b; })();
  if (clips.length && hasBones) {
    captureRestPose(root);
    for (const c of clips) {
      if (c.tracks.some(t => t.name.endsWith('.quaternion'))) {
        app.addMocap(`${name} · ${c.name || 'clip'}`, c, root);
      }
    }
  }

  if (meshCount === 0 && hasBones && clips.length) {
    // pure mocap file (e.g. Mixamo animation-only FBX): library entry only
    toast(`🎬 <b>${name}</b> has no mesh — its ${clips.length} animation${clips.length > 1 ? 's were' : ' was'} added to the Motion library.`, 'good', 6000);
    return null;
  }
  if (meshCount === 0 && !clips.length) throw new Error('no meshes found in file');

  autoScaleAndPlace(item);
  app.addItem(item, { select: true });
  const rigNote = hasBones ? ' · rigged ✓' : '';
  const animNote = clips.length ? ` · ${clips.length} animation${clips.length > 1 ? 's' : ''}` : '';
  toast(`✅ Imported <b>${item.name}</b>${rigNote}${animNote}`, 'good');
  return item;
}

function meshFromGeometry(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb9c2d4,
    roughness: 0.6,
    metalness: 0.1,
    vertexColors: !!geo.attributes.color,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return mesh;
}

/** Fix wildly wrong units (cm/mm exports) and sit the object on the ground. */
function autoScaleAndPlace(item) {
  item.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(item);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 80 || (maxDim > 0 && maxDim < 0.15)) {
    const factor = Math.pow(10, -Math.round(Math.log10(maxDim / 2)));
    item.scale.multiplyScalar(factor);
    toast(`📏 Auto-scaled ×${factor >= 1 ? factor : factor.toFixed(factor < 0.01 ? 4 : 2)} (was ${maxDim.toFixed(1)} units tall/wide)`, '', 4200);
    item.updateMatrixWorld(true);
    box.setFromObject(item);
  }
  // sit on ground, centered
  const center = box.getCenter(new THREE.Vector3());
  item.position.x -= center.x;
  item.position.z -= center.z;
  item.position.y -= box.min.y;
}

/* -------------------- texture for materials panel -------------------- */
export function loadTextureFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
      resolve(tex);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, undefined, reject);
  });
}
