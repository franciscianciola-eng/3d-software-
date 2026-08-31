// End-to-end smoke test: boots the app headless, adds primitives, rigs the
// mannequin, imports a generated BVH mocap clip, retargets it, verifies bones
// actually move, and exports a GLB.
//
//   npm i -D playwright   (once; browsers via playwright or a system chromium)
//   npm test
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8931;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('✖ playwright is not installed. Run: npm i -D playwright');
  process.exit(1);
}

/* ---------- generate a small humanoid BVH (wave + sway) ---------- */
function makeBVH() {
  const J = (n, off, kids = []) => ({ n, off, kids });
  const skel =
    J('Hips', [0, 0, 0], [
      J('Spine', [0, 10, 0], [
        J('Neck', [0, 9, 0], [J('Head', [0, 3, 0], [])]),
        J('LeftArm', [3, 8, 0], [J('LeftForeArm', [5, 0, 0], [J('LeftHand', [4, 0, 0], [])])]),
        J('RightArm', [-3, 8, 0], [J('RightForeArm', [-5, 0, 0], [J('RightHand', [-4, 0, 0], [])])]),
      ]),
      J('LeftUpLeg', [2, -1, 0], [J('LeftLeg', [0, -8, 0], [J('LeftFoot', [0, -8, 0], [])])]),
      J('RightUpLeg', [-2, -1, 0], [J('RightLeg', [0, -8, 0], [J('RightFoot', [0, -8, 0], [])])]),
    ]);

  const names = [];
  let out = 'HIERARCHY\n';
  (function emit(j, depth, isRoot) {
    const ind = '  '.repeat(depth);
    out += `${ind}${isRoot ? 'ROOT' : 'JOINT'} ${j.n}\n${ind}{\n`;
    out += `${ind}  OFFSET ${j.off.join(' ')}\n`;
    out += `${ind}  CHANNELS ${isRoot ? '6 Xposition Yposition Zposition Zrotation Xrotation Yrotation' : '3 Zrotation Xrotation Yrotation'}\n`;
    names.push(j.n);
    for (const k of j.kids) emit(k, depth + 1, false);
    if (!j.kids.length) out += `${ind}  End Site\n${ind}  {\n${ind}    OFFSET 0 ${j.n.includes('Foot') ? -2 : 2} 0\n${ind}  }\n`;
    out += `${ind}}\n`;
  })(skel, 0, true);

  const nFrames = 9;
  out += `MOTION\nFrames: ${nFrames}\nFrame Time: 0.125\n`;
  for (let f = 0; f < nFrames; f++) {
    const ph = f / (nFrames - 1);
    const vals = [];
    for (const n of names) {
      if (n === 'Hips') {
        vals.push(Math.sin(ph * Math.PI * 2) * 1.5, 17, 0);      // sway x, stand y
        vals.push(0, 0, Math.sin(ph * Math.PI * 2) * 10);        // z x y rot
      } else if (n === 'LeftArm') {
        vals.push(Math.sin(ph * Math.PI * 2) * 60, 0, 0);        // wave (Z rot)
      } else if (n === 'RightArm') {
        vals.push(-Math.sin(ph * Math.PI * 2) * 40, 0, 0);
      } else if (n === 'Spine') {
        vals.push(Math.sin(ph * Math.PI * 2) * 8, 0, 0);
      } else {
        vals.push(0, 0, 0);
      }
    }
    out += vals.map(v => (Math.round(v * 1000) / 1000)).join(' ') + '\n';
  }
  return out;
}

/* ---------- helpers ---------- */
const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  ✓' : '  ✖'} ${name}${extra ? ` — ${extra}` : ''}`);
  return ok;
}

/* ---------- run ---------- */
const server = spawn(process.execPath, ['serve.mjs'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});
await new Promise(r => setTimeout(r, 700));

let browser;
const launchOpts = { args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] };
try {
  browser = await chromium.launch(launchOpts);
} catch {
  browser = await chromium.launch({ ...launchOpts, executablePath: '/opt/pw-browsers/chromium' });
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.addInitScript(() => { try { localStorage.setItem('easy3d_tour_done', '1'); } catch {} });

try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__EASY3D_READY === true, null, { timeout: 20000 });
  check('app boots', true);

  // 1. add a cube, move it, undo/redo
  await page.evaluate(() => easy3d.addPrimitive('box'));
  let n = await page.evaluate(() => easy3d.app.items.length);
  check('add cube', n === 1);

  await page.evaluate(() => { easy3d.app.selected.position.set(2, 0.5, -1); });
  await page.evaluate(() => easy3d.app.undo.undo());   // undo the "Add"
  n = await page.evaluate(() => easy3d.app.items.length);
  check('undo add', n === 0);
  await page.evaluate(() => easy3d.app.undo.redo());
  n = await page.evaluate(() => easy3d.app.items.length);
  check('redo add', n === 1);

  // 2. rigged mannequin
  await page.evaluate(() => easy3d.addPrimitive('mannequin'));
  const rig = await page.evaluate(() => {
    const it = easy3d.app.items[1];
    let bones = 0, skinned = 0;
    it.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
    return { bones, skinned, name: it.name };
  });
  check('mannequin rigged', rig.skinned >= 1 && rig.bones >= 20, `${rig.bones} bones, ${rig.skinned} skinned mesh`);

  // 3. import BVH mocap
  const bvh = makeBVH();
  await page.evaluate(async text => {
    const f = new File([text], 'wave-test.bvh', { type: 'text/plain' });
    await easy3d.openFiles([f]);
  }, bvh);
  await page.waitForFunction(() => easy3d.app.mocap.length === 1, null, { timeout: 10000 });
  const mocapInfo = await page.evaluate(() => ({
    name: easy3d.app.mocap[0].name, dur: easy3d.app.mocap[0].duration,
  }));
  check('BVH imported to motion library', mocapInfo.dur > 0.5, `${mocapInfo.name}, ${mocapInfo.dur.toFixed(2)}s`);

  // 4. retarget via the actual UI button
  await page.evaluate(() => easy3d.app.select(easy3d.app.items[1]));
  await page.click('.mocap-item .tb.accent');
  await page.waitForFunction(() => {
    const it = easy3d.app.items[1];
    return (it.userData.clips || []).length === 1;
  }, null, { timeout: 10000 });
  const clipInfo = await page.evaluate(() => {
    const it = easy3d.app.items[1];
    const c = it.userData.clips[0].clip;
    return { tracks: c.tracks.length, dur: c.duration };
  });
  check('mocap retargeted onto mannequin', clipInfo.tracks >= 10 && clipInfo.dur > 0.5,
    `${clipInfo.tracks} tracks, ${clipInfo.dur.toFixed(2)}s`);

  // 5. bones actually move when the timeline advances (deterministic scrub)
  const playing = await page.evaluate(() => easy3d.timeline.state.playing);
  const sampleAt = t => page.evaluate(tt => {
    easy3d.timeline.setTime(tt);
    let q = null;
    easy3d.app.items[1].traverse(o => { if (!q && o.isBone && o.name === 'LeftArm') q = o.quaternion.toArray(); });
    return q;
  }, t);
  const q0 = await sampleAt(0);
  const q1 = await sampleAt(0.25);
  const moved = q0 && q1 && q0.some((v, i) => Math.abs(v - q1[i]) > 1e-3);
  check('bones animate on the timeline', !!moved && playing, `auto-play=${playing}, LeftArm Δq=${moved ? 'yes' : 'no'}`);

  // 6. keyframe authoring on the cube
  await page.evaluate(() => {
    easy3d.timeline.stop();
    easy3d.app.select(easy3d.app.items[0]);
    easy3d.timeline.setTime(0);
    easy3d.timeline.addKey();
    easy3d.timeline.setTime(1.5);
    easy3d.app.selected.position.set(0, 2, 0);
    easy3d.timeline.addKey();
  });
  const keyed = await page.evaluate(() => easy3d.app.items[0].userData.keys.length);
  check('keyframes recorded', keyed === 2, `${keyed} keys`);

  // 7. GLB export with animations
  const glbBytes = await page.evaluate(async () => {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const clips = [];
    for (const it of easy3d.app.items) for (const r of (it.userData.clips || [])) clips.push(r.clip);
    return await new Promise(res => {
      new GLTFExporter().parse(easy3d.app.contentGroup,
        r => res(r.byteLength || 0), () => res(-1),
        { binary: true, animations: clips });
    });
  });
  check('GLB export (rig + animation)', glbBytes > 20000, `${(glbBytes / 1024).toFixed(0)} KB`);

  // 8. OBJ import path (another loader + auto-placement)
  await page.evaluate(async () => {
    const obj = `v -0.5 0 -0.5\nv 0.5 0 -0.5\nv 0.5 1 -0.5\nv -0.5 1 -0.5\nv -0.5 0 0.5\nv 0.5 0 0.5\nv 0.5 1 0.5\nv -0.5 1 0.5\nf 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 5 1 4 8\n`;
    await easy3d.openFiles([new File([obj], 'shed.obj', { type: 'text/plain' })]);
  });
  const objOk = await page.evaluate(() => easy3d.app.items.some(i => i.name === 'shed'));
  check('OBJ import', objOk);

  // 9. GLB round-trip: export the scene, re-import it, rig + clips survive
  const roundtrip = await page.evaluate(async () => {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const clips = [];
    for (const it of easy3d.app.items) for (const r of (it.userData.clips || [])) clips.push(r.clip);
    const buf = await new Promise((res, rej) =>
      new GLTFExporter().parse(easy3d.app.contentGroup, res, rej, { binary: true, animations: clips }));
    const before = easy3d.app.items.length;
    await easy3d.openFiles([new File([buf], 'roundtrip.glb')]);
    const item = easy3d.app.items.find(i => i.name === 'roundtrip');
    if (!item) return { ok: false, why: 'item missing' };
    let bones = 0, skinned = 0;
    item.traverse(o => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
    const nClips = (item.userData.clips || []).length;
    // clean up so the scene isn't polluted for the screenshot
    easy3d.app.removeItem(item, { undoable: false });
    return { ok: easy3d.app.items.length === before && bones >= 20 && skinned >= 1 && nClips >= 1, bones, skinned, nClips };
  });
  check('GLB round-trip (rig + animations survive)', roundtrip.ok,
    roundtrip.ok ? `${roundtrip.bones} bones, ${roundtrip.nClips} clip(s)` : JSON.stringify(roundtrip));

  // 10. interactive auto-rig via the real UI (sidebar button → bind)
  await page.evaluate(() => {
    const it = easy3d.addPrimitive('box');
    it.name = '';
    it.name = 'RigMe';
    it.scale.set(0.6, 1.8, 0.4); // person-ish proportions
    it.updateMatrixWorld(true);
    easy3d.app.select(null);
    easy3d.app.select(it);
  });
  await page.click('#sel-props button:has-text("Auto-Rig")');
  const barShown = await page.evaluate(() => !document.getElementById('rig-toolbar').classList.contains('hidden'));
  await page.click('#rig-bind');
  const rigged2 = await page.evaluate(() => {
    const it = easy3d.app.items.find(i => i.name === 'RigMe');
    let skinned = 0, bones = 0;
    it.traverse(o => { if (o.isSkinnedMesh) skinned++; if (o.isBone) bones++; });
    return { skinned, bones, extraGeo: it.isMesh ? it.geometry.attributes.position?.count || 0 : 0 };
  });
  check('interactive Auto-Rig (UI flow)', barShown && rigged2.skinned === 1 && rigged2.bones >= 20,
    `${rigged2.bones} bones`);

  // 11. bone-map dialog opens prefilled
  await page.click('.mocap-item button:has-text("Bone map")');
  const mapInfo = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('.map-grid select')];
    const filled = selects.filter(s => s.value).length;
    return { rows: selects.length / 2, filled };
  });
  check('bone-map dialog prefilled', mapInfo.rows >= 20 && mapInfo.filled >= 20,
    `${mapInfo.filled} prefilled selects across ${mapInfo.rows} slots`);
  await page.click('.modal-foot button:has-text("Cancel")');

  // 12. material editing via the panel
  const matOk = await page.evaluate(() => {
    easy3d.app.select(null);
    easy3d.app.select(easy3d.app.items[0]); // cube
    const picker = document.querySelector('#sel-props input[type=color]');
    picker.value = '#ff0000';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    let hex = null;
    easy3d.app.items[0].traverse(o => { if (!hex && o.isMesh) hex = o.material.color.getHexString(); });
    return hex;
  });
  check('material color edit', matOk === 'ff0000', `#${matOk}`);

  // 13. guided tour renders and completes (fresh page without the done-flag)
  {
    const p2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p2.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
    await p2.waitForFunction(() => window.__EASY3D_READY === true, null, { timeout: 20000 });
    const cardVisible = await p2.locator('#tour-card').isVisible();
    let steps = 0;
    while (steps++ < 20) {
      const btn = p2.locator('#tour-card .tb.accent');
      if (!(await btn.count())) break;
      const label = await btn.textContent();
      await btn.click();
      if (label.includes('Done')) break;
    }
    const closed = await p2.evaluate(() =>
      document.getElementById('tour-root').classList.contains('hidden') &&
      localStorage.getItem('easy3d_tour_done') === '1');
    check('guided tour auto-starts & completes', cardVisible && closed, `${steps} steps`);
    await p2.close();
  }

  // 14. screenshot for the record
  await page.evaluate(() => {
    easy3d.app.select(easy3d.app.items[1]);
    easy3d.timeline.togglePlay();
  });
  await page.waitForTimeout(350);
  const shot = process.env.SHOT_PATH;
  if (shot) await page.screenshot({ path: shot });

  const realErrors = pageErrors.filter(e =>
    !/favicon|Download the React DevTools|SwiftShader|GroupMarkerNotSet|WebGL.*deprecated|Automatic fallback/i.test(e));
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'clean');
} catch (e) {
  check('test run completed', false, String(e).slice(0, 400));
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `\n✖ ${failed.length}/${results.length} checks failed` : `\n✅ all ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
