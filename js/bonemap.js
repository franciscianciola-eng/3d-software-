// Canonical humanoid bone slots + fuzzy name matching so mocap from any
// skeleton (Mixamo, CMU/BVH, Rokoko, Xsens, custom rigs…) can be paired with
// any rigged model automatically.

// Order matters for UI display; `key` is the canonical slot id.
export const CORE_SLOTS = [
  { key: 'hips',          label: 'Hips' },
  { key: 'spine',         label: 'Spine' },
  { key: 'spine1',        label: 'Chest' },
  { key: 'spine2',        label: 'Upper chest' },
  { key: 'neck',          label: 'Neck' },
  { key: 'head',          label: 'Head' },
  { key: 'leftshoulder',  label: 'L shoulder' },
  { key: 'leftarm',       label: 'L upper arm' },
  { key: 'leftforearm',   label: 'L forearm' },
  { key: 'lefthand',      label: 'L hand' },
  { key: 'rightshoulder', label: 'R shoulder' },
  { key: 'rightarm',      label: 'R upper arm' },
  { key: 'rightforearm',  label: 'R forearm' },
  { key: 'righthand',     label: 'R hand' },
  { key: 'leftupleg',     label: 'L thigh' },
  { key: 'leftleg',       label: 'L shin' },
  { key: 'leftfoot',      label: 'L foot' },
  { key: 'lefttoebase',   label: 'L toes' },
  { key: 'rightupleg',    label: 'R thigh' },
  { key: 'rightleg',      label: 'R shin' },
  { key: 'rightfoot',     label: 'R foot' },
  { key: 'righttoebase',  label: 'R toes' },
];

// synonym → canonical body-part (side handled separately). Longest names
// are tested first so "forearm" wins over "arm".
const PART_SYNONYMS = [
  ['toebase', 'toebase'], ['toe_end', null], ['toeend', null],
  ['toes', 'toebase'], ['toe', 'toebase'], ['ball', 'toebase'],
  ['upperleg', 'upleg'], ['upleg', 'upleg'], ['thigh', 'upleg'], ['hipjoint', null],
  ['lowerleg', 'leg'], ['calf', 'leg'], ['shin', 'leg'], ['knee', 'leg'], ['leg', 'leg'],
  ['ankle', 'foot'], ['foot', 'foot'],
  ['clavicle', 'shoulder'], ['collar', 'shoulder'], ['shoulder', 'shoulder'],
  ['upperarm', 'arm'], ['uparm', 'arm'],
  ['forearm', 'forearm'], ['lowerarm', 'forearm'], ['elbow', 'forearm'],
  ['wrist', 'hand'], ['hand', 'hand'],
  ['arm', 'arm'],
  ['pelvis', 'hips'], ['hips', 'hips'], ['hip', 'hips'],
  ['lowerback', 'spine'], ['chest', 'spine1'], ['upperchest', 'spine2'],
  ['torso', 'spine'],
  ['neck', 'neck'],
  ['headtop', null], ['head', 'head'],
];

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/** normalize a bone name: lowercase, strip common rig prefixes + separators */
function norm(name) {
  let n = String(name).toLowerCase();
  n = n.replace(/^.*[|]/, '');            // "Armature|mixamorig:Hips"
  n = n.replace(/mixamorig\d*[:_.]?/g, '');
  n = n.replace(/^(bip\d*|bone|def|rig|skeleton|character\d*)[:_.\- ]/, '');
  return n;
}

/** detect left/right and return [side, nameWithoutSideMarkers] */
function sideOf(rawLower) {
  let n = rawLower;
  const seps = '[\\s_.:\\-]';
  const tests = [
    [new RegExp(`(^|${seps})left(${seps}|(?=[a-z0-9])|$)`), 'left', /(^|[\s_.:\-])left([\s_.:\-]|$)?/],
    [new RegExp(`(^|${seps})right(${seps}|(?=[a-z0-9])|$)`), 'right', /(^|[\s_.:\-])right([\s_.:\-]|$)?/],
    [new RegExp(`^l(${seps})`), 'left', new RegExp(`^l${seps}`)],
    [new RegExp(`^r(${seps})`), 'right', new RegExp(`^r${seps}`)],
    [new RegExp(`(${seps})l$`), 'left', new RegExp(`${seps}l$`)],
    [new RegExp(`(${seps})r$`), 'right', new RegExp(`${seps}r$`)],
  ];
  for (const [re, side] of tests) {
    if (re.test(n)) {
      n = n.replace(/left|right/g, '')
        .replace(new RegExp(`^l${seps}|^r${seps}`), '')
        .replace(new RegExp(`${seps}l$|${seps}r$`), '');
      return [side, n];
    }
  }
  // CMU style "LHipJoint", "LeftUpLeg" already caught; also "LThigh"
  if (/^l[a-z]/.test(n) && !startsWithPart(n)) return ['left', n.slice(1)];
  if (/^r[a-z]/.test(n) && !startsWithPart(n)) return ['right', n.slice(1)];
  return ['', n];
}

function startsWithPart(n) {
  // avoid stripping the leading letter of real part names (leg, lowerback…)
  return PART_SYNONYMS.some(([syn]) => n.startsWith(syn));
}

/** canonical slot key for a bone name, or null */
export function canonicalFor(name) {
  const base = norm(name);
  const [side, rest0] = sideOf(base);
  const rest = rest0.replace(/[\s_.:\-]/g, '');

  // fingers: thumb/index/…(1-4)
  for (const f of FINGERS) {
    const m = rest.match(new RegExp(`${f}0*(\\d)`));
    if (m && side) {
      const idx = Math.min(parseInt(m[1], 10), 3);
      if (idx >= 1) return `${side}hand${f}${idx}`;
    }
  }

  // spine chain with digits: spine, spine1, spine2, spine3…
  const sm = rest.match(/^spine0*(\d)$/);
  if (sm) {
    const i = Math.min(parseInt(sm[1], 10), 2);
    return i === 0 ? 'spine' : `spine${i}`;
  }
  if (rest === 'spine') return 'spine';

  for (const [syn, canon] of PART_SYNONYMS) {
    if (canon === null) { if (rest.includes(syn)) return null; continue; }
    if (rest === syn || rest.startsWith(syn) || rest.endsWith(syn)) {
      if (['hips', 'spine', 'spine1', 'spine2', 'neck', 'head'].includes(canon)) {
        return side ? null : canon;  // center bones must not be sided
      }
      return side ? `${side}${canon}` : null; // limb bones must be sided
    }
  }
  return null;
}

export function collectBones(root) {
  const bones = [];
  root.traverse(o => { if (o.isBone) bones.push(o); });
  if (!bones.length) root.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton) {
      for (const b of o.skeleton.bones) if (!bones.includes(b)) bones.push(b);
    }
  });
  return bones;
}

/** Map bones of a root to canonical slots: { slotKey: bone } (first match wins). */
export function classifyBones(root) {
  const out = {};
  for (const b of collectBones(root)) {
    const key = canonicalFor(b.name);
    if (key && !(key in out)) out[key] = b;
  }
  return out;
}

/**
 * Pair source (mocap) bones with target (model) bones.
 * Returns { pairs: [{key, source, target}], missing: [labels], srcMap, tgtMap }
 */
export function guessBoneMap(sourceRoot, targetRoot) {
  const srcMap = classifyBones(sourceRoot);
  const tgtMap = classifyBones(targetRoot);
  const keys = new Set([...Object.keys(srcMap), ...Object.keys(tgtMap)]);
  const pairs = [];
  const missing = [];
  for (const key of keys) {
    if (srcMap[key] && tgtMap[key]) pairs.push({ key, source: srcMap[key], target: tgtMap[key] });
  }
  for (const slot of CORE_SLOTS) {
    if (tgtMap[slot.key] && !srcMap[slot.key]) missing.push(slot.label);
  }
  pairs.sort((a, b) => slotRank(a.key) - slotRank(b.key));
  return { pairs, missing, srcMap, tgtMap };
}

function slotRank(key) {
  const i = CORE_SLOTS.findIndex(s => s.key === key);
  return i === -1 ? 100 + key.length : i;
}
