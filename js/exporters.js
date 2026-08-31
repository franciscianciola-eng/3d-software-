// Scene export: GLB (with rigs + animations), OBJ, STL, PNG screenshot.
import * as THREE from 'three';
import { app } from './app.js';
import { toast, download } from './utils.js';
import { buildKeyframeClip } from './timeline.js';
import { screenshot } from './viewport.js';

function collectAnimations() {
  const clips = [];
  for (const item of app.items) {
    for (const rec of app.getClips(item)) clips.push(rec.clip);
    if (item.userData.keys?.length >= 2) {
      const kc = buildKeyframeClip(item);
      if (kc) clips.push(kc);
    }
  }
  // unique names so exporters don't merge them (wrap, don't mutate originals)
  const seen = new Map();
  return clips.map(c => {
    const base = c.name || 'clip';
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n === 0 ? c : new THREE.AnimationClip(`${base}.${n}`, c.duration, c.tracks);
  });
}

export async function exportScene(kind) {
  if (!app.items.length && kind !== 'png') {
    toast('Nothing to export yet — add or import something first.', 'warn');
    return;
  }
  try {
    if (kind === 'glb') {
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      const animations = collectAnimations();
      exporter.parse(
        app.contentGroup,
        result => {
          const blob = new Blob([result], { type: 'model/gltf-binary' });
          download(blob, 'easy3d-scene.glb');
          toast(`💾 Exported <b>easy3d-scene.glb</b> (${(blob.size / 1e6).toFixed(2)} MB${animations.length ? `, ${animations.length} animation${animations.length > 1 ? 's' : ''}` : ''})`, 'good');
        },
        err => app.error(`GLB export failed: ${err?.message || err}`, err),
        { binary: true, animations }
      );
    } else if (kind === 'obj') {
      const { OBJExporter } = await import('three/addons/exporters/OBJExporter.js');
      const text = new OBJExporter().parse(app.contentGroup);
      download(new Blob([text], { type: 'text/plain' }), 'easy3d-scene.obj');
      toast('💾 Exported <b>easy3d-scene.obj</b>', 'good');
    } else if (kind === 'stl') {
      const { STLExporter } = await import('three/addons/exporters/STLExporter.js');
      const data = new STLExporter().parse(app.contentGroup, { binary: true });
      download(new Blob([data], { type: 'model/stl' }), 'easy3d-scene.stl');
      toast('💾 Exported <b>easy3d-scene.stl</b>', 'good');
    } else if (kind === 'png') {
      const blob = await screenshot();
      if (blob) {
        download(blob, 'easy3d-screenshot.png');
        toast('📸 Screenshot saved', 'good');
      }
    }
  } catch (e) {
    app.error(`Export failed: ${e.message || e}`, e);
  }
}
