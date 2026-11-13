// The clay-diorama look, ported from the art brief's design/capy-trail/scene.js (THE-1246), per the
// design doc: "port, don't redraw" -- spike 2 confirmed it renders the same on our vendored r170.
// S1 keeps the forest-only subset: palettes, clay/roundedBox/noise helpers, the forest prop set (plus a
// new boulder() for the block hazard, which the brief didn't need), the trail/ground builders, the sky
// dome, the chase camera and the renderer settings. Water, the one-pass post (shimmer/vignette/grade)
// and the lagoon/desert biomes land with S4/S5/S7.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const UI = { cream: "#FFF3E0", cocoa: "#3A2418", orange: "#FF8A2A", orangeLo: "#D9601A", leaf: "#6DB35C", tomato: "#E5484D", lilac: "#B9A6E6" };
export const CAPY = { fur: "#C99A68", furLo: "#A97C52", belly: "#E2C092", snout: "#A87A52", nose: "#3B2A22", eye: "#1E1612", ear: "#7E5638", inner: "#C98F78", orange: "#FF8A2A", leaf: "#4E9A45" };
// THE-1391: three.js materials can't read a CSS custom property directly, so these mirror tokens.css's
// own --pu-* values (design-toolkit: keep every JS colour mirror in step with its token by hand, same as
// UI/CAPY/BIOME above already do) -- only the kinds enabled so far; a slice turning on a new kind adds its
// own entry here to match.
export const PU = { honey: "#F2A93B", shield: "#5CC8E0", spring: "#A98BF0" };
export const BIOME = {
  forest: { skyTop: "#79B4DA", skyMid: "#D9EAD2", horizon: "#FFD9A0", sun: "#FFD49A", sunInt: 2.9, hemiSky: "#F2F0FF", hemiGround: "#7D6BB0", hemiInt: 1.1,
    fog: "#E6E2B8", fogD: 0.012, ground: "#86B85A", groundLo: "#56914A", groundHi: "#C2D46A", path: "#EBC892", pathLo: "#CFA06A", pathEdge: "#C08F5C",
    // A11.1 cue 3: a narrowed stretch's closed lane turns to moss/leaf litter -- a clear value shift off
    // both the path (light tan) and the open-lane ground (mid green), not just a hue change, so it still
    // reads as "not path" in grayscale (spec §8).
    moss: "#3F6B35", mossLo: "#2C4E26", leafLitter: "#6B4A2C" },
  // Lagoon (ART-BRIEF.md sec3 palette table, 700-1600m): anchors (skyTop/horizon/sun/hemiGround/ground/
  // path) are the brief's own hexes; Lo/Hi/Mid/Edge tonal variants follow forest's own derivation (a
  // darker and a lighter shade of each anchor), since the brief only gives one stop per field.
  lagoon: { skyTop: "#5FA8E0", skyMid: "#BFE0EA", horizon: "#FFD3C2", sun: "#FFF1D6", sunInt: 2.9, hemiSky: "#F2F0FF", hemiGround: "#5E8FB8", hemiInt: 1.1,
    fog: "#DCEEF0", fogD: 0.012, ground: "#E9D3A0", groundLo: "#C9AD74", groundHi: "#F3E2BC", path: "#C98E5A", pathLo: "#A96F3E", pathEdge: "#8F5C32",
    waterShallow: "#2FC2C0", waterDeep: "#167E9A" },
};

const C = (h) => new THREE.Color(h);
export function clay(hex, rough = 0.88, extra = {}) { return new THREE.MeshStandardMaterial({ color: C(hex), roughness: rough, metalness: 0, ...extra }); }
const VC = (rough = 0.9) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
function shade(o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }
export function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash(x, y) { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); }
export function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15; }

export function roundedBox(w, h, d, r, seg = 6) {
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg), p = g.attributes.position, v = new THREE.Vector3(), inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const c = v.clone().clamp(inner.clone().negate(), inner);
    const n = v.clone().sub(c);
    if (n.lengthSq() > 0) n.normalize().multiplyScalar(r);
    p.setXYZ(i, c.x + n.x, c.y + n.y, c.z + n.z);
  }
  g.computeVertexNormals();
  return g;
}
const sph = (r, sx = 1, sy = 1, sz = 1, ws = 28, hs = 20) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); return g; };
function M(geom, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); return m; }

// ---------------------------------------------------------------- the trail (one continuous ribbon)
// S1 simplification: one fixed-length ribbon built once from the generator's own junction directions,
// not the pooled-tile architecture the design calls for (render/trackview.js, pool of 12). A run that
// outgrows this ribbon keeps going at the last heading. True endless tile pooling is S3/S4 scope, once
// there's real content to pool.
// THE-1281 (board fix round): CatmullRomCurve3's default arc-length LUT (200 divisions, spread over the
// *whole* curve) gets coarser the longer the trail grows -- on a several-km trail each LUT bucket can
// span metres, so the same arc-length `d` within an already-built, early stretch of the trail resolves to
// a measurably different point once the curve is extended (noted as "sub-cm drift" by the CTO's P1 fix
// below). Scaling the LUT density with the point count keeps each bucket's own span roughly constant
// (sub-metre) regardless of how long the trail has grown, tightening both trail.at(s) itself and the
// corner ring density fix below.
export function makeTrail(points) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal", 0.5);
  curve.arcLengthDivisions = Math.max(200, points.length * 10);
  const len = curve.getLength();
  const at = (d) => {
    const u = THREE.MathUtils.clamp(d / len, 0, 1), p = curve.getPointAt(u), t = curve.getTangentAt(u);
    // P3: before the start the trail runs straight back along its first heading, so the chase camera
    // (4.4 m behind) and the geese behind the capy have somewhere to be at s = 0 (they used to clamp onto it)
    if (d < 0) p.addScaledVector(t, d);
    const side = new THREE.Vector3(t.z, 0, -t.x).normalize().negate();
    return { p, t, side };
  };
  return { curve, len, at };
}

// Builds the point list for makeTrail from the generator's junction list: straight by default, a 90
// degree bend (radius ~12 m) at each junction's distance, alternating with gentle 12-degree bends so the
// path reads as a winding trail rather than a ruler-straight line (spec: curve radius >= 40 m between
// junctions; this ribbon favours a believable look over that exact radius for S1).
//
// CTO fix F2b (THE-1259, 2026-11-05 22:38Z): the old fixed-10 m grid absorbed a junction's heading change
// into whichever step happened to cross it, so the drawn bend could land up to a full step early or late
// (measured 5-8 m) -- as large as the turn window itself. This splits the step exactly at each junction's
// `s`, so a vertex always lands there and the bend starts precisely at the sim's corner.
// CTO direction on THE-1280 (2026-11-06 07:03Z), replacing the old CORNER_PIN=2 pinned-chord approach:
// that window spread a 90 deg turn over a 4 m arc, a ~2.5 m centreline radius -- tighter than the 3.2 m
// ribbon half-width, so the inner ribbon edge (radius ~2.5-3.2 m, negative) sits BEHIND the centre of
// curvature and folds back over itself. No amount of ring density fixes a fold; it needs a real radius.
// CORNER_R=5 m keeps the inner ribbon edge at 1.8 m radius and the inner lane (1.6 m in) at 3.4 m, so
// nothing folds. Arc length = (pi/2)*CORNER_R ~= 7.85 m, centred on j.s (CORNER_PIN = half that, ~3.93 m)
// -- still inside the sim's own turn window (TURN_AFTER..TURN_BEFORE+TURN_BUFFER ~= -2..+8 m at 8 m/s), so
// junction scoring is unaffected. Points every CORNER_ARC_STEP (<=0.25 m) keep each step's curvature
// error below float noise -- small enough that a true circular arc and a heading-interpolated polyline
// at this resolution are visually and numerically the same.
const CORNER_R = 5;
const CORNER_ARC_LEN = (Math.PI / 2) * CORNER_R; // ~7.854 m
export const CORNER_PIN = CORNER_ARC_LEN / 2; // ~3.927 m each side of j.s, exported for render/fork.js's stub
const CORNER_ARC_STEP = 0.25;
export function trailPointsFromJunctions(junctions, totalLength) {
  const pts = [[0, 0]];
  let x = 0, z = 0, heading = 0, s = 0; // heading in radians, 0 = +Z
  const step = 10;
  const sorted = [...junctions].sort((a, b) => a.s - b.s);
  const pins = [];
  for (const j of sorted) {
    pins.push({ s: Math.max(0, j.s - CORNER_PIN), kind: "pre", j });
    pins.push({ s: j.s + CORNER_PIN, kind: "post" });
  }
  pins.sort((a, b) => a.s - b.s);
  let pi = 0;
  while (s < totalLength - 1e-9) {
    const nextPinS = pi < pins.length ? pins[pi].s : Infinity;
    const next = Math.min(s + step, nextPinS, totalLength);
    const dist = next - s;
    const nearJunction = sorted.some((j) => Math.abs(j.s - next) < step * 1.5);
    const stepHeading = nearJunction ? heading : heading + (Math.sin(next * 0.013) * 0.05);
    x += Math.sin(stepHeading) * dist; z += Math.cos(stepHeading) * dist;
    heading = stepHeading;
    s = next;
    pts.push([x, z]);
    while (pi < pins.length && Math.abs(pins[pi].s - s) < 1e-6) {
      if (pins[pi].kind === "pre") {
        // A true circular arc of length CORNER_ARC_LEN, heading turning by +-PI/2 total, centred on j.s
        // (half the arc before, half after -- matching where the sim scores the turn). Each step advances
        // heading by its own share of the turn, then moves in that new heading's direction -- the chord of
        // a CORNER_ARC_STEP-long piece of the arc, not a fixed-heading straight segment.
        const turn = pins[pi].j.dir === "L" ? Math.PI / 2 : -Math.PI / 2;
        const arcEndS = s + CORNER_ARC_LEN;
        const subSteps = Math.ceil(CORNER_ARC_LEN / CORNER_ARC_STEP);
        const subDist = CORNER_ARC_LEN / subSteps;
        for (let k = 1; k <= subSteps; k++) {
          heading += turn / subSteps;
          x += Math.sin(heading) * subDist; z += Math.cos(heading) * subDist;
          pts.push([x, z]);
        }
        s = arcEndS;
        pi += 2; // this group is always exactly [pre, post] (pushed together, in that order)
        break; // both pins through this corner are consumed; let the outer loop re-evaluate from here
      }
      pi++;
    }
  }
  return pts;
}

// CTO fix B11 (THE-1259 S2 review, 2026-11-05 23:53Z): a single exact vertex at +-0.8 m faded to its
// un-tinted neighbours (+-0.53/+-1.07 m, ~0.27 m away) over too wide a gap to read as a line. Three
// vertices per side (edge/centre/edge, ~10 cm apart) give the band real, roughly constant-width colour
// instead of a single-point gradient peak that washes out.
const LANE_CUE_X = 0.8, LANE_CUE_HALF_WIDTH = 0.05;
const TRAIL_W = 3.2;
const trailProfile = (() => {
  const baseXs = []; for (let i = 0; i <= 12; i++) baseXs.push(-TRAIL_W + 2 * TRAIL_W * (i / 12));
  const cueXs = [LANE_CUE_X - LANE_CUE_HALF_WIDTH, LANE_CUE_X, LANE_CUE_X + LANE_CUE_HALF_WIDTH];
  const xs = [...baseXs, ...cueXs, ...cueXs.map((x) => -x)].sort((a, b) => a - b);
  const prof = xs.map((x) => { const e = Math.max(0, Math.abs(x) - (TRAIL_W - 0.35)) / 0.35; return [x, 0.12 - e * e * 0.1, (x + TRAIL_W) / (2 * TRAIL_W)]; });
  prof.unshift([-TRAIL_W - 0.1, -0.25, -1]); prof.push([TRAIL_W + 0.1, -0.25, 2]);
  return prof;
})();

// THE-1281 (board fix round): one ring per integer metre is a straight-enough chord everywhere except
// near a junction's sharp corner -- there a 1 m chord cuts up to 0.4 m inside the arc, which is the "capy
// drifts off its lane" the board actually saw (the capy itself sits exactly on trail.at(s), see
// render/placement.js; it's the drawn ribbon that cut the corner). Now that trailPointsFromJunctions
// builds a true CORNER_R=5 m circular arc (not a sharp pinned chord CatmullRom had to overshoot to fit),
// densify exactly the arc's own window, per the CTO's direction on THE-1280: every CORNER_RING_STEP
// (0.25 m) inside [j.s-CORNER_PIN-0.5, j.s+CORNER_PIN+0.5], one ring per metre everywhere else. At 0.25 m
// spacing the chord sag on the 1.8 m inner edge is about 4 mm -- comfortably inside the 0.05 m tolerance.
//
// This intentionally stays a plain function of the junction list and these constants (no trail.at()
// threshold check) -- a per-cell decision based on sampling the curve itself would drift between an
// append and a full rebuild of a longer trail (CatmullRomCurve3's own arc-length LUT shifts as the curve
// grows, see makeTrail() above), flipping right at the threshold and breaking appendTrailMesh's "same
// data as a full rebuild" contract (render-geometry.test.mjs). Junction `s` values don't shift when the
// trail grows, so this window is stable across both calls.
const CORNER_RING_STEP = 0.25;
const CORNER_RING_MARGIN = 0.5;
// Fine (and plain) positions are both bounded by the *ceiled* fromS/toS, not the raw values -- fromS is
// always the previous call's toS exactly (appendTrailMesh resumes from the old ribbon's own length), so
// Math.ceil(fromS) on this call always equals Math.ceil(toS) on the call before it. Filtering fine points
// by that same ceiled bound on both sides (instead of the raw fromS/toS) keeps the two calls' positions
// partitioned at exactly that one shared point -- a fine grid point from a corner window straddling the
// seam can't land strictly between the two calls' bounds and get silently skipped by both.
// Exported so tests can check the *real* ring placement instead of re-assuming the old "always 1 m
// apart" layout.
// P3: the ribbon starts TRAIL_PRE metres before s = 0 (trail.at runs straight back there), so the intro's
// high camera and the chase camera at the start never see the trail end abruptly behind the capy.
export const TRAIL_PRE = -40;
export function ringPositions(junctions, fromS, toS) {
  const fromBound = Math.max(TRAIL_PRE, Math.ceil(fromS)), toBound = Math.ceil(toS);
  const set = new Set();
  for (let d = fromBound; d <= toBound; d++) set.add(d);
  for (const j of junctions) {
    const lo = Math.max(0, j.s - CORNER_PIN - CORNER_RING_MARGIN), hi = j.s + CORNER_PIN + CORNER_RING_MARGIN;
    if (hi < fromBound || lo > toBound) continue;
    for (let k = Math.ceil(lo / CORNER_RING_STEP); k * CORNER_RING_STEP <= hi + 1e-9; k++) {
      const d = Math.round(k * CORNER_RING_STEP * 1000) / 1000;
      if (d >= fromBound - 1e-9 && d <= toBound + 1e-9) set.add(d);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// Generates one ring of (position, color) per metre of arc-length over [fromS, trail.len) (plus extra
// corner rings, see ringPositions above), the same per-ring math trailMesh() always used. Shared by
// trailMesh() (fromS=0) and appendTrailRings() (fromS=the previous ribbon's length, CTO fix P1 below) so
// there's exactly one place the ring shape/colour is defined.
function buildTrailRings(trail, B, fromS, toS, junctions = []) {
  const pos = [], col = [];
  const cP = C(B.path), cLo = C(B.pathLo), cE = C(B.pathEdge), tmp = new THREE.Color();
  const ds = ringPositions(junctions, fromS, toS);
  for (const d of ds) {
    const { p, side } = trail.at(Math.min(d, trail.len));
    for (const [x, y, a] of trailProfile) {
      pos.push(p.x + side.x * x, y, p.z + side.z * x);
      if (a < 0 || a > 1) tmp.copy(cE);
      else {
        tmp.copy(cP); tmp.lerp(cLo, fbm(x * 0.7, d * 0.5) * 0.55);
        if (Math.abs(Math.abs(x) - 1.07) < 0.06) tmp.lerp(cLo, 0.35);
        // Two faint lane-boundary cues (ruts) at +-0.8 m, halfway between the centre and side lanes
        // (LANE_SPACING 1.6 m) -- readable without a token, so it survives grayscale same as hazard
        // silhouettes (spec §8 comforts).
        if (Math.abs(Math.abs(x) - LANE_CUE_X) < LANE_CUE_HALF_WIDTH + 1e-6) tmp.lerp(cLo, 0.5);
      }
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  return { pos, col, rings: ds.length };
}

function ringIndices(ringCount, n, ringOffset) {
  const idx = [];
  for (let s = 0; s < ringCount - 1; s++) for (let i = 0; i < n - 1; i++) { const a = (ringOffset + s) * n + i, b = a + n; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  return idx;
}

export function trailMesh(trail, B, kind, junctions = []) {
  const n = trailProfile.length;
  const { pos, col, rings } = buildTrailRings(trail, B, TRAIL_PRE, trail.len, junctions);
  const idx = ringIndices(rings, n, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, VC(0.92)); m.receiveShadow = true; return m;
}

// CTO fix P1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): "append the ribbon instead of rebuilding it...
// trailMesh rebuilds from 0 (57 ms at 3,000 m)." trailMesh()'s cost is O(trail.len) -- one ring of ~17
// profile vertices per metre, however long the trail has grown -- so every ~300 m growth trigger re-paid
// for the entire ribbon again. The curve's own arc-length parameterisation (CatmullRomCurve3.getPointAt)
// shifts by a sub-centimetre amount everywhere when the trail is extended (measured ~1-2 cm on a 3.2 m-wide
// ribbon), so this intentionally leaves already-built rings as they are rather than recomputing them --
// the drift is visually inert at chase-camera distance, and it keeps the win: only the newly grown suffix
// (from the old ribbon's length to the new one) is built and appended to the existing geometry's buffers.
//
// THE-1285 (CTO, R2 review): `keepToS` cuts the already-built ribbon back to its ring at that (integer) s
// before appending, for when a junction appears inside ribbon that's already built (the sim places
// junctions only ~130 m ahead; the ribbon is built up to ~450 m ahead). Without the cut the old straight
// rings stayed and the new curve was appended to their end: the drawn path split away from the capy's.
// Rings up to keepToS are the same for the old and new junction lists, as long as keepToS sits before the
// new corner's ring window (ringPositions).
// Where to cut the built ribbon back to when `junctions` has grown past the `builtCount` it was built from.
// A Catmull-Rom segment depends on 4 control points, so the new arc's first point reshapes the 2 straight
// segments before it (<= 10 m each, trailPointsFromJunctions): cut 2 steps + 2 m before the arc starts.
// null when nothing new lands inside the built ribbon.
const RESYNC_LEAD = 22;
export function ribbonResyncS(junctions, builtCount, meshedToS) {
  if (junctions.length <= builtCount) return null;
  let first = Infinity;
  for (let i = builtCount; i < junctions.length; i++) first = Math.min(first, junctions[i].s);
  const cut = Math.floor(first - CORNER_PIN - RESYNC_LEAD);
  return cut < meshedToS ? Math.max(0, cut) : null;
}
export function appendTrailMesh(mesh, trail, B, fromS, junctions = [], keepToS = null) {
  const n = trailProfile.length;
  let oldPos = mesh.geometry.attributes.position.array, oldCol = mesh.geometry.attributes.color.array;
  let oldIdx = mesh.geometry.index.array;
  // A plain grow cuts back too: extending the trail reshapes its last 2 Catmull-Rom segments (measured
  // ~1 m at every 300 m seam when the old end rings were kept).
  if (keepToS === null) keepToS = fromS - RESYNC_LEAD;
  {
    fromS = Math.max(0, Math.floor(keepToS));
    const keep = ringPositions(junctions, TRAIL_PRE, fromS).length;
    oldPos = oldPos.subarray(0, keep * n * 3); oldCol = oldCol.subarray(0, keep * n * 3);
    oldIdx = oldIdx.subarray(0, (keep - 1) * (n - 1) * 6); // ringIndices lays the index out ring by ring
  }
  const oldRingCount = oldPos.length / 3 / n;
  const { pos, col, rings } = buildTrailRings(trail, B, fromS, trail.len, junctions);
  // the new segment's first ring duplicates the old ribbon's last ring (ringPositions' shared ceiled
  // bound guarantees this, see above) -- drop it so ring indices stay a simple sequence with no seam gap
  // or overlap in the index buffer.
  const newPos = new Float32Array(oldPos.length + (pos.length - n * 3));
  const newCol = new Float32Array(oldCol.length + (col.length - n * 3));
  newPos.set(oldPos); newPos.set(pos.slice(n * 3), oldPos.length);
  newCol.set(oldCol); newCol.set(col.slice(n * 3), oldCol.length);
  const addedRings = rings - 1;
  const newIdx = ringIndices(addedRings + 1, n, oldRingCount - 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(newPos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(newCol, 3));
  const combinedIdx = new (oldIdx.length + newIdx.length > 65535 ? Uint32Array : Uint16Array)(oldIdx.length + newIdx.length);
  combinedIdx.set(oldIdx); combinedIdx.set(newIdx, oldIdx.length);
  g.setIndex(new THREE.BufferAttribute(combinedIdx, 1));
  g.computeVertexNormals();
  mesh.geometry.dispose();
  mesh.geometry = g;
  return mesh;
}
function distToTrail(pts, x, z) { let best = 1e9; for (const p of pts) { const dx = p.x - x, dz = p.z - z, d = dx * dx + dz * dz; if (d < best) best = d; } return Math.sqrt(best); }

// CTO fix F2a (THE-1259, 2026-11-05 22:38Z): the flat band used to start at 3.6 m, inside the 3.2 m
// ribbon half-width plus the capy's own 0.3 m half-width (3.5 m) -- a margin smaller than a grid cell, so
// the terrain's noisy rise could poke above the road on a bend. The flat band now starts at the ribbon
// half-width (trailMesh's own `W`) plus a 2 m margin, per the CTO's fix, and the sample count scales with
// the trail's own length so a long (rebuilt, grown) ribbon doesn't lose precision near the road.
const RIBBON_HALF_WIDTH = 3.2; // trailMesh's W
const GROUND_FLAT_TO = RIBBON_HALF_WIDTH + 2; // 5.2 m
// CTO fix B8 (THE-1259 S2 review): `center` used to be a fixed world point (effectively capped at s=40 by
// the caller), so a grown ribbon left no ground/decor past ~160 m from the trail's start, and sampling
// scaled with the whole (ever-growing) trail.len, stalling each rebuild (166 ms at 300 m, 371 ms at
// 1,200 m measured). `centerS` is now a distance along the trail (the capy's own `s` at rebuild time, see
// render/scene.js), and both the ground's reference points and the decor scatter below sample only a
// fixed-size window around it -- bounded, constant-ish cost regardless of how long the trail has grown.
const GROUND_WINDOW_MARGIN = 40; // beyond the ground plane's own half-size, covers decor's scatter reach
// CTO fix B8 r3 (THE-1259 S2 review, 2026-11-06 00:45Z): the windowed version from r1/r2 was still
// 75-93 ms/call once render/scene.js started re-centring more often than once per ribbon rebuild (to
// close the "no ground between rebuilds" gap below) -- vertex count (61x61) x sample count (up to 640)
// is ~2.4M distance checks per call. Lower density on both axes (37x37 verts, <=320 samples): terrain
// colour/height variation is decorative fbm noise, not gameplay-critical, so losing some of that
// resolution is a fair trade to stay under a frame budget on every re-centre, not just occasional ones.
export function groundMesh(trail, B, centerS, size = 240, seg = 36) {
  const clampedS = THREE.MathUtils.clamp(centerS, 0, trail.len);
  const center = trail.at(clampedS).p;
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(center.x, 0, center.z);
  const windowRadius = size / 2 + GROUND_WINDOW_MARGIN;
  const lo = Math.max(0, clampedS - windowRadius), hi = Math.min(trail.len, clampedS + windowRadius);
  const sampleCount = Math.min(320, Math.max(60, Math.ceil((hi - lo) / 1.5)));
  const pts = [];
  for (let i = 0; i <= sampleCount; i++) pts.push(trail.at(lo + (hi - lo) * (i / sampleCount)).p);
  const p = g.attributes.position, col = [], cG = C(B.ground), cLo = C(B.groundLo), cHi = C(B.groundHi), t = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = distToTrail(pts, x, z);
    const away = THREE.MathUtils.smoothstep(d, GROUND_FLAT_TO, GROUND_FLAT_TO + 10.4);
    const h = -0.2 + away * (fbm(x * 0.05, z * 0.05) * 5 - 1.2);
    p.setY(i, h);
    t.copy(cG);
    const n = fbm(x * 0.18, z * 0.18);
    t.lerp(n > 0.5 ? cHi : cLo, Math.abs(n - 0.5) * 1.6);
    col.push(t.r, t.g, t.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, VC(0.95)); m.receiveShadow = true; return m;
}

// ---------------------------------------------------------------- forest props
function bush(r, s = 1) { const hues = ["#5FAE52", "#4F9A4C", "#86C45E"]; const g = new THREE.Group(); for (let i = 0; i < 3; i++) g.add(M(sph((0.45 + r() * 0.3) * s, 1, 0.8, 1, 16, 12), clay(hues[i % hues.length]), (i - 1) * 0.45 * s, 0.32 * s, (r() - 0.5) * 0.4 * s)); return shade(g); }
// P6's tree/sheep/hut/flowers props used to be procedural clay shapes here (tree(), sheep(), hut(),
// flowers()); THE-1355 (board feedback #3 item 6, THE-1349) replaces them with the Designer's A14 GLBs
// (THE-1352, render/decor-models.js) -- see modelProp() below.
export function mushroom(s = 1) { const g = new THREE.Group(); g.add(M(new THREE.CylinderGeometry(0.07 * s, 0.09 * s, 0.3 * s, 10), clay("#F6EBD7"), 0, 0.15 * s, 0)); g.add(M(new THREE.SphereGeometry(0.2 * s, 16, 10, 0, 6.29, 0, 1.6), clay("#E5484D", 0.7), 0, 0.28 * s, 0)); return shade(g); }

// CTO fix P1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): "scatterForestDecor rebuilds 471 meshes (39 ms)
// [per ground re-centre]." tree()/bush()/mushroom() each built their own fresh CylinderGeometry/
// SphereGeometry and MeshStandardMaterial per call -- real allocation + GC cost paid again on every one of
// the hundreds of decorations, every re-centre. Bake each prop's group (random variant, built at scale 1)
// down into a single merged, vertex-coloured BufferGeometry once, up front; scatterForestDecor then only
// clones a lightweight Mesh referencing one of a handful of shared geometries and a single shared VC()
// material -- no new geometry or material allocation per decoration, same look (several baked variants
// per prop type keep the per-instance size/colour variety the old per-call randomisation gave).
function bakeColoredGeometry(group) {
  const geoms = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const count = geo.attributes.position.count;
    const col = o.material.color;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b; }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    // mergeGeometries requires identical attribute sets across inputs; drop anything tree()/bush()/
    // mushroom() didn't already have in common (uv, etc. -- none of these props are textured).
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "color"].includes(name)) geo.deleteAttribute(name);
    geoms.push(geo);
  });
  return mergeGeometries(geoms, false);
}

const VARIANTS_PER_PROP = 4;
let propVariants = null; // lazy: only forest decor needs these, and module load shouldn't pay for it
function getPropVariants() {
  if (propVariants) return propVariants;
  const r = rnd(1);
  const build = (fn) => Array.from({ length: VARIANTS_PER_PROP }, () => bakeColoredGeometry(fn(r, 1)));
  propVariants = { bush: build((r) => bush(r, 1)), mushroom: build(() => mushroom(1)) };
  return propVariants;
}
const propMaterial = VC(0.88);
function decorProp(kind, r, scale) {
  const variants = getPropVariants()[kind];
  const geo = variants[Math.floor(r() * variants.length) % variants.length];
  const m = new THREE.Mesh(geo, propMaterial);
  m.scale.setScalar(scale);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
// THE-1355: a tree/sheep/hut/flowers decor mesh from the Designer's A14 GLBs (render/decor-models.js's
// decorModelsForTier() shape -- {geometry, material}, already the right lod for this tier). Shares the
// template's geometry/material directly, same "never clone per instance" rule as decorProp()/bushDecor()
// above; a sheep still gets its own morphTargetInfluences array because that lives on the Mesh, not the
// shared BufferGeometry (three.js gives every Mesh built from a morph-target geometry its own influences).
function modelProp(template, scale) {
  if (!template) return null; // GLBs still loading (same gap as bird/props/filler templates elsewhere)
  const m = new THREE.Mesh(template.geometry, template.material);
  m.castShadow = true; m.receiveShadow = true;
  m.scale.setScalar(scale);
  return m;
}

// Forest's block hazard: a mossy clay boulder. Not in the art brief's scene.js (it only needed decor
// rocks for the desert); sized to the spec's 1.2 m-wide block hit box.
export function boulder(r = Math.random) {
  const g = new THREE.Group();
  g.add(M(sph(0.6, 1.15, 0.92, 1.05, 16, 12), clay("#8C8A78", 0.85)));
  g.add(M(sph(0.22, 1, 0.6, 1, 10, 8), clay("#6FA85C", 0.9), 0.25, 0.42, 0.1));
  g.add(M(sph(0.16, 1, 0.5, 1, 10, 8), clay("#5FAE52", 0.9), -0.2, 0.5, -0.15));
  return shade(g);
}
// A12.1/C2 (THE-1297): L1's "either" (log on stumps) and merged-row props (a long log, a branch bar +
// leaf curtain) are developer-built from the R3 log/bush meshes (propMesh(), scaled/grouped here) -- no
// new GLB. `logMesh`/`bushMesh` are already-instantiated per-hazard meshes (render/scene.js's own keyed
// pools own their lifetime); these just scale/group the one passed in, never clone.
export function logOnStumps(logMesh) {
  const g = new THREE.Group();
  logMesh.scale.set(0.9, 0.5, 0.9);
  logMesh.position.y = 0.42; // sits on the stumps, inside the either band's own 0.45-0.80 m gap
  g.add(logMesh);
  const stumpMat = clay("#7A5C3E", 0.9);
  for (const side of [-1, 1]) {
    const stump = M(new THREE.CylinderGeometry(0.12, 0.14, 0.42, 8), stumpMat, side * 0.5, 0.21, 0);
    g.add(stump);
  }
  return shade(g);
}

export function mergedLowLog(logMesh, width) {
  logMesh.scale.x *= width;
  return logMesh;
}

export function branchBar(logMesh, bushMesh, width) {
  const g = new THREE.Group();
  logMesh.scale.set(width, 0.3, 0.45);
  logMesh.position.y = 0.7; // mid of the high band's own 0.5-0.9 m bar height
  g.add(logMesh);
  if (bushMesh) {
    bushMesh.scale.set(width * 0.85, 0.55, 0.55);
    bushMesh.position.y = 1.5; // the leaf curtain, reaching up toward the band's 2.0 m top
    g.add(bushMesh);
  }
  return shade(g);
}

// Honey Jar pickup (spec Part 1: today's magnet, re-skinned). A small procedural clay jar -- no new GLB
// this slice, the Designer's later models land on their own ticket.
export function honeyJarMesh() {
  const g = new THREE.Group();
  g.add(M(roundedBox(0.34, 0.4, 0.34, 0.08), clay("#E8A33D", 0.5, { emissive: C("#B5721A"), emissiveIntensity: 0.25 })));
  g.add(M(roundedBox(0.38, 0.1, 0.38, 0.04), clay(UI.cocoa, 0.7), 0, 0.23, 0));
  g.position.y = 0.6; g.castShadow = true;
  return shade(g);
}
export function coinMesh() {
  const rim = clay("#F0A422", 0.35, { emissive: C("#B86A00"), emissiveIntensity: 0.45 });
  const face = clay("#FFD84A", 0.3, { emissive: C("#C98A00"), emissiveIntensity: 0.55 });
  const hi = clay("#FFF2A8", 0.25, { emissive: C("#E0B030"), emissiveIntensity: 0.6 });
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.09, 28), [rim, face, face]);
  c.rotation.x = Math.PI / 2; g.add(c);
  for (const s of [-1, 1]) g.add(M(sph(0.12, 0.55, 1, 0.2), hi, 0, 0, s * 0.048));
  g.position.y = 0.6; g.castShadow = true; c.castShadow = true;
  return g;
}
// Coin pop juice (spec §7: "1 -> 1.4 -> 0 in 0.15 s, plus a gold ring and sparkles"). A simple ring +
// a few spark motes; render/scene.js drives the 0.15 s scale pop, this just builds the static shape once
// per pool slot. Simplified from the full "sparkles" brief -- a cheap, honest stand-in given the scope.
export function coinPopMesh() {
  const ring = clay("#FFD84A", 0.3, { emissive: C("#E0B030"), emissiveIntensity: 0.6 });
  const spark = clay("#FFF2A8", 0.2, { emissive: C("#FFE7A0"), emissiveIntensity: 0.8 });
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 8, 20), ring);
  r.rotation.x = Math.PI / 2; g.add(r);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(M(sph(0.035, 1, 1, 1, 6, 4), spark, Math.cos(a) * 0.45, Math.sin(a) * 0.15, Math.sin(a) * 0.45));
  }
  g.position.y = 0.6;
  return g;
}

// Near-miss juice (spec §2: "'close!' pop, whoosh, 40 ms hit stop, +3 coins"). A wider, faster-expanding
// ring than the coin pop, in a cream/white "air" colour rather than gold, so it reads distinctly from a
// coin pickup even though it's the same visual language (ring + sparks) -- a cheap, honest stand-in for
// literal "close!" text, same simplification already made for coinPopMesh.
export function nearMissPopMesh() {
  const ring = clay(UI.cream, 0.25, { emissive: C("#B9B0A0"), emissiveIntensity: 0.35 });
  const spark = clay("#FFFFFF", 0.2, { emissive: C(UI.cream), emissiveIntensity: 0.5 });
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 24), ring);
  r.rotation.x = Math.PI / 2; g.add(r);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(M(sph(0.04, 1, 1, 1, 6, 4), spark, Math.cos(a) * 0.6, Math.sin(a) * 0.2, Math.sin(a) * 0.6));
  }
  g.position.y = 0.7;
  return g;
}

// THE-1391: the Picnic Shield bubble, copied from design/capy-trail/powerups.html's own bubbleMaterial()/
// bubble() "as they are" (README "1. Picnic Shield") -- one unlit sphere, a fresnel rim + a fixed fake
// highlight, cheap on Low (1 draw call, no lights). `box` is the hero's own measured local-space
// bounding box (hero.js's heroLocalBox()); the bubble is parented to the hero object so it follows lean,
// jump and duck, and is sized/centred off that box alone, never off bear-only bones.
export function bubbleMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
      void main() {
        vec3 n = normalize(vN); float f = pow(1.0 - abs(dot(n, vV)), 2.2);
        float hl = pow(max(dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0), 36.0);
        vec3 c = mix(uColor, vec3(1.0), 0.55 * f + hl);
        gl_FragColor = vec4(c, (0.07 + 0.6 * f + 0.7 * hl) * uAlpha);
      }`,
  });
}
export function bubble(box, color, segs = 24) {
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, segs, Math.round(segs * 0.7)), bubbleMaterial(color));
  // an ellipsoid 0.22 m clear of the hero on every side, a little rounder than the box so it reads as a bubble
  const r = Math.max(size.x, size.y, size.z) * 0.5;
  m.scale.set(Math.max(size.x / 2, r * 0.8) + 0.22, size.y / 2 + 0.22, Math.max(size.z / 2, r * 0.8) + 0.22);
  m.position.copy(c); m.renderOrder = 2;
  return m;
}

// THE-1398 "Spring Paws", README "Ring + aura": a soft ring on the ground under the hero, copied from
// design/capy-trail/powerups.html's own aura() "as is" -- additive would vanish on the pale orange trail,
// so this is normal blending (MeshBasicMaterial, no `blending` override) same as that file's own comment.
export function aura(box, color) {
  const size = box.getSize(new THREE.Vector3()), r = Math.max(size.x, size.z) * 0.5 + 0.2;
  const cv = document.createElement("canvas"); cv.width = cv.height = 64;
  const x = cv.getContext("2d");
  const g = x.createRadialGradient(32, 32, 10, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.55, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, 2 * r), new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, opacity: 0.6, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.15; m.renderOrder = 1; // the trail top is y 0.12 (trailProfile above)
  return m;
}

// THE-1391 (spec Part 1 "Picnic Shield", design/capy-trail/powerups/README.md "1. Picnic Shield"):
// "reuse coinPopMesh()'s ring + sparks tinted --pu-shield for the burst" -- same ring+spark shape and
// 1 -> 1.4 -> 0 pop timing family as coinPopMesh/nearMissPopMesh above, just in the shield's own aqua.
// Parented to the hero (not placed on the trail by s/lane, unlike every other pop above), at the hero's
// own measured box centre, no fixed y here -- render/scene.js positions it there each time the shield pops.
export function shieldPopMesh() {
  const ring = clay(PU.shield, 0.25, { emissive: C("#2E96A8"), emissiveIntensity: 0.5 });
  const spark = clay("#D7F3F8", 0.2, { emissive: C(PU.shield), emissiveIntensity: 0.6 });
  const g = new THREE.Group();
  const r = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.045, 8, 24), ring);
  r.rotation.x = Math.PI / 2; g.add(r);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(M(sph(0.035, 1, 1, 1, 6, 4), spark, Math.cos(a) * 0.5, Math.sin(a) * 0.18, Math.sin(a) * 0.5));
  }
  return g;
}

// CTO item 1 (THE-1259, 2026-11-05 22:43Z): the fork's dead-end stub "ends in a visible dead end (a bush
// wall on the forest skin)". A dense row of bushes spanning the ribbon's width, reusing the same bush()
// shape scatterForestDecor already places as loose decor, just packed edge to edge to read as a wall
// instead of scattered cover.
export function bushWall(seed = 1) {
  const r = rnd(seed), g = new THREE.Group();
  for (let x = -2.2; x <= 2.2; x += 0.9) {
    const b = bush(r, 1.1 + r() * 0.3);
    b.position.set(x, 0, (r() - 0.5) * 0.3);
    g.add(b);
  }
  return g;
}

// CTO fix F1 (THE-1259 S2 review r3, 2026-11-06 00:45Z): "draw the stub as a short piece of ribbon, flare
// the mouth." Built in local space with the mouth at local z=0 (the junction) and the dead end at
// z=length -- render/scene.js positions and orients the whole group at the stub's origin/heading
// (render/fork.js's stubDirection()), so this never has to know the junction's world position itself.
export function forkStub(length, B, seed = 1) {
  const steps = Math.max(2, Math.ceil(length / 2)), pos = [], col = [], idx = [];
  const cP = C(B.path), cLo = C(B.pathLo), tmp = new THREE.Color();
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, z = t * length;
    const halfW = THREE.MathUtils.lerp(1.6, 0.9, t); // flare the mouth: wider where it meets the branch
    for (const sgn of [-1, 1]) {
      pos.push(halfW * sgn, 0.1, z);
      tmp.copy(cP); tmp.lerp(cLo, 0.3 + t * 0.2);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let s = 0; s < steps; s++) { const a = s * 2, b = a + 2; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  rg.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  rg.setIndex(idx); rg.computeVertexNormals();
  const ribbon = new THREE.Mesh(rg, VC(0.92)); ribbon.receiveShadow = true;

  const g = new THREE.Group(); g.add(ribbon);
  const wall = bushWall(seed); wall.position.set(0, 0, length); g.add(wall);
  return g;
}

// CTO fix F2 (THE-1259 S2 review r3, 2026-11-06 00:45Z): built once in a canonical "points right" form
// (dir baked at construction used to mean a pooled sign could never show the other direction without
// rebuilding its geometry -- the pool was always built signpost(-1), so every sign pointed the same way
// regardless of the junction it sat at). render/scene.js now flips scale.x at placement time instead, per
// the actual junction's `dir`. Also moved the arrow to the *near* face (local -Z, the side facing the
// chase camera -- placeAt() points local +Z along the direction of travel, i.e. away from the camera) --
// it was on the far face, effectively invisible from behind the board.
export function signpost() {
  const g = new THREE.Group(); g.add(M(new THREE.CylinderGeometry(0.08, 0.1, 2.2, 10), clay("#7A5038"), 0, 1.1, 0));
  const board = M(roundedBox(1.5, 0.6, 0.12, 0.1, 3), clay(UI.cream), 0.45, 1.9, 0); g.add(board);
  const sh = new THREE.Shape(); sh.moveTo(-0.45, -0.1); sh.lineTo(0.1, -0.1); sh.lineTo(0.1, -0.22); sh.lineTo(0.45, 0); sh.lineTo(0.1, 0.22); sh.lineTo(0.1, 0.1); sh.lineTo(-0.45, 0.1); sh.closePath();
  const ar = M(new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false }), clay(UI.orange, 0.6), 0.45, 1.9, -0.07);
  g.add(ar);
  return shade(g);
}

// Scenery density by tier (design -> "Generator, solver and performance", G3 budgets: 100/70/40%).
export const SCENERY_DENSITY = { high: 0.6, mid: 0.42, low: 0.24 };
// THE-1284: bushVariants is {geometry, material} per props.glb bush_a/b/c mesh (render/scene.js extracts
// these once, when propsTemplate loads) -- GLTFLoader has no sync path, so the first call or two after a
// fresh boot/run (before it resolves) still falls back to the old procedural clay bush, same "a few
// frames of placeholder" pattern render/scene.js already uses for the capy itself.
// CTO fix P1's own reasoning (THE-1259 S2 review r4, see getPropVariants() above) applies here too: a
// `.clone(true)` of the GLB node per decor instance measured a real per-recentre hitch (THE-1284 frame-
// sampler regression, 104 ms at a mid-play rebuild that the pre-R3 baseline didn't have) -- scattering
// dozens of bush instances across a window is exactly the hot path that fix was for. Sharing the
// template's own geometry/material directly (one THREE.Mesh per instance, no clone/traverse) matches
// decorProp()'s own already-cheap shape exactly.
function bushDecor(bushVariants, r, scale) {
  if (!bushVariants) return decorProp("bush", r, scale);
  const idx = Math.floor(r() * bushVariants.length) % bushVariants.length;
  const { geometry, material } = bushVariants[idx];
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true; m.receiveShadow = true;
  m.scale.setScalar(scale);
  return m;
}
// P1 item 3 (THE-1320, "trees pop in and out"): each 3 m slot along the trail draws from its own RNG,
// seeded by (seed, slot, side), so a slot looks the same in every re-centred window. Before, one RNG ran
// from the window's start, so every re-centre re-rolled every tree, including the ones on screen. The
// window itself reaches ~170 m ahead of the capy, well past the fog, so new slots appear out of sight.
function slotSeed(seed, k, sd) {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ k;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ (sd + 2);
  h = Math.imul(h ^ (h >>> 16), 0x27d4eb2d);
  return (h ^ (h >>> 15)) >>> 0;
}
export const DECOR_STEP = 3;
// P1: the slot window is shifted forward: 80 m behind centreS, 290 m ahead (>= 300 m ahead of the capy along
// the trail, so even where the trail winds back toward the camera a new slot appears inside the fog).
// Removal is render/decor-window.js's job (only once a slot can't be on screen).
export const DECOR_BEHIND = 80, DECOR_AHEAD = 290;
export function decorSlotRange(trail, centerS) {
  const lo = Math.max(4, centerS - DECOR_BEHIND), hi = Math.min(trail.len, centerS + DECOR_AHEAD);
  return [Math.ceil(lo / DECOR_STEP), Math.ceil(hi / DECOR_STEP) - 1];
}
// P6 (THE-1330): every decor item keeps clear of the trail: its own radius plus TRAIL_CLEAR from the centre
// line of any trail within ±60 m of its slot, so at a corner nothing stands on the next leg of the trail
// (lanes reach 2.4 m out, the ribbon's edge 3.2 m). Samples are cached per trail object.
export const TRAIL_CLEAR = 3.6;
// THE-1355: hut raised from 1.9 to 2.1 -- the A14 hut's eave reaches 2.05 m (MODELS.md), wider than the
// procedural hut it replaces.
export const DECOR_RADIUS = { tree: 1.4, bush: 0.9, mushroom: 0.3, flowers: 0.6, sheep: 0.7, hut: 2.1 };
const SAMPLE_STEP = 2;
function trailSamples(trail) {
  if (trail._samples) return trail._samples;
  const n = Math.ceil(trail.len / SAMPLE_STEP) + 1, xs = new Float32Array(n), zs = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = trail.curve.getPointAt(Math.min(1, (i * SAMPLE_STEP) / trail.len)); xs[i] = p.x; zs[i] = p.z; }
  return (trail._samples = { xs, zs, n });
}
export function clearOfTrail(trail, d, x, z, radius) {
  const { xs, zs, n } = trailSamples(trail), need = (TRAIL_CLEAR + radius) ** 2;
  const i0 = Math.max(0, Math.floor((d - 60) / SAMPLE_STEP)), i1 = Math.min(n - 1, Math.ceil((d + 60) / SAMPLE_STEP));
  for (let i = i0; i <= i1; i++) if ((xs[i] - x) ** 2 + (zs[i] - z) ** 2 < need) return false;
  return true;
}
// P6 life per slot, as a share of slots at the high tier (scaled down with the tier's scenery density)
const LIFE = { flowers: 0.2, sheep: 0.045, hut: 0.016 };

// A variant-array model prop (tree_a/tree_b, flowers_a/flowers_b): picks one of decorModels[kind] by
// index, or null while the GLBs are still loading (decorModels null) or for a tier/kind with no array.
function modeledVariant(decorModels, kind, r, scale) {
  const variants = decorModels?.[kind];
  if (!variants) return null;
  return modelProp(variants[Math.floor(r() * variants.length) % variants.length], scale);
}

// One slot's decor: an array of 0-4 objects (the main tree/bush/mushroom plus, sometimes, a flower patch, a
// few sheep or a hut), the same objects wherever the window is centred.
export function decorSlot(trail, seed, k, sd, tier = "high", bushVariants = null, decorModels = null) {
  const density = SCENERY_DENSITY[tier] ?? SCENERY_DENSITY.high;
  const d = k * DECOR_STEP, { p, side, t } = trail.at(d), out = [];
  const place = (obj, kind, off, along = 0) => {
    if (!obj) return null; // decorModels hasn't loaded yet (THE-1355: same async-GLB gap as bird/props/filler)
    const x = p.x + side.x * off + t.x * along, z = p.z + side.z * off + t.z * along;
    if (!clearOfTrail(trail, d, x, z, DECOR_RADIUS[kind] * obj.scale.x)) return null;
    obj.position.set(x, 0, z); obj.userData.decor = kind;
    out.push(obj); return obj;
  };
  const r = rnd(slotSeed(seed, k, sd));
  if (r() <= density) {
    const off = sd * (5 + r() * 24);
    const pick = r();
    let obj, kind;
    if (pick < 0.55) { kind = "tree"; obj = modeledVariant(decorModels, "tree", r, 0.8 + r() * 0.7); }
    else if (pick < 0.85) { kind = "bush"; obj = bushDecor(bushVariants, r, 0.8 + r() * 0.6); }
    else { kind = "mushroom"; obj = decorProp("mushroom", r, 0.9 + r()); }
    if (obj) obj.rotation.y = r() * Math.PI * 2;
    place(obj, kind, off);
  }
  const L = rnd(slotSeed(seed ^ 0x51ab, k, sd)), tierK = density / SCENERY_DENSITY.high, roll = L();
  if (roll < LIFE.flowers * tierK) {
    const o = modeledVariant(decorModels, "flowers", L, 0.9 + L() * 0.5);
    if (o) o.rotation.y = L() * 6.28;
    place(o, "flowers", sd * (4.6 + L() * 9), (L() - 0.5) * 2);
  } else if (roll < (LIFE.flowers + LIFE.sheep) * tierK) {
    const n = 1 + Math.floor(L() * 3), off = sd * (8 + L() * 14);
    for (let i = 0; i < n; i++) {
      const o = modelProp(decorModels?.sheep, 0.9 + L() * 0.25);
      if (o) {
        o.rotation.y = L() * 6.28;
        // High/Mid only (decorModels.animate): the graze clip plays from render/scene.js's per-frame
        // update, which reads this flag off decorGroup's own children (THE-1355: Low keeps the static mesh).
        if (decorModels.animate) { o.updateMorphTargets(); o.userData.sheepAnim = true; o.userData.sheepOffset = L() * 4; }
      }
      place(o, "sheep", off + (L() - 0.5) * 3, (L() - 0.5) * 3);
    }
  } else if (roll < (LIFE.flowers + LIFE.sheep + LIFE.hut) * tierK) {
    const o = modelProp(decorModels?.hut, 1), off = sd * (13 + L() * 12);
    if (o) o.rotation.y = Math.atan2(-side.x * sd, -side.z * sd); // the door faces the trail
    place(o, "hut", off);
  }
  return out;
}
// Every slot in the window around centerS, as one group (the perf test's measure of a full window build).
export function scatterForestDecor(trail, B, seed, centerS, tier = "high", bushVariants = null, decorModels = null) {
  const group = new THREE.Group();
  const [k0, k1] = decorSlotRange(trail, centerS);
  for (let k = k0; k <= k1; k++) for (const sd of [-1, 1]) for (const o of decorSlot(trail, seed, k, sd, tier, bushVariants, decorModels)) group.add(o);
  return group;
}

// ---------------------------------------------------------------- sky
export function skyDome(B) {
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: C(B.skyTop) }, mid: { value: C(B.skyMid) }, hor: { value: C(B.horizon) }, sun: { value: C(B.sun) }, sd: { value: new THREE.Vector3(0.7, 0.42, -0.58).normalize() } },
    vertexShader: "varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `uniform vec3 top,mid,hor,sun,sd; varying vec3 vD; void main(){ float y=vD.y; vec3 c=mix(hor,mid,smoothstep(0.,.18,y)); c=mix(c,top,smoothstep(.18,.7,y)); float s=max(dot(vD,sd),0.); c+=sun*(pow(s,600.)*1.2+pow(s,12.)*.35); gl_FragColor=vec4(c,1.);
      #include <colorspace_fragment>
      }`,
  }));
}

// ---------------------------------------------------------------- renderer + camera
export function makeRenderer(canvas, w, h, dpr = 1) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(dpr); r.setSize(w, h, false);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
  r.toneMapping = THREE.NeutralToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

// Chase camera: back/up behind the capy, looking ahead; roll = lean in turns (spec §7: FOV 60, 4 m back,
// 2.6 m up; the brief's own numbers are close -- 4.2/2.7 -- and visually match, see risk spike 2).
//
// CTO fix C1 (THE-1259 S2 review r4, 2026-11-06 01:18Z): "the capy disappears during the crash gag." A
// missed-corner overrun (render/scene.js's cornerOverrun) moves the capy's rendered position straight down
// the dead-end stub, off the curved main trail entirely -- but this function always sampled position/look-
// at off `trail.at(d)`, so the camera kept looking down the (now-bent) curve while the capy ran straight
// off it, out of frame almost immediately. `follow` lets the caller override the camera's position/heading
// with the capy's own actual rendered state (position + direction of travel) during that gag, so the
// camera keeps the capy in frame the way it does for every other crash.
// CTO D1 fix (THE-1259 S3, THE-1272, 2026-11-06 02:16Z): "the capy reads as a teddy from behind." The
// Designer's chosen fix (candidate 2, the glance, plus a small camera nudge from candidate 1): back
// 4.2->4.4 m, up 2.7->3.0 m, side 0->+0.6 m (camera right of the trail centre; lookAt stays on the centre
// line so the yaw is ~2.6 deg -- just enough to clear a little flank and make the glance's silhouette
// read), FOV 60->58 deg. Spec §7 said FOV 60/4 m/2.6 m; this is a one-line amendment, CTO is decider.
export function chaseCam(trail, d, { aspect, back = 4.4, up = 3.0, ahead = 9, roll = 0, fov = 58, side = 0.6, follow = null }) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 400);
  if (follow) {
    const { x, z, dirX, dirZ } = follow;
    // D1: apply the same side offset along the stub's own right vector (perpendicular to its direction),
    // so the crash-overrun camera gets the same flank/clearer-glance framing as the normal chase camera.
    // Matches trail.at().side's own sign convention (side=(-t.z,0,t.x) in look.js's makeTrail): at heading
    // 0 (dir=(0,0,1)) that's (-1,0), i.e. screen-right is -X -- verified empirically earlier (chaseCam's
    // own non-follow branch moves toward -X for a positive `side` scalar, and that's confirmed screen-
    // right), not derived by hand a second time here.
    const rightX = -dirZ, rightZ = dirX;
    cam.position.set(x - dirX * back + rightX * side, up, z - dirZ * back + rightZ * side);
    cam.lookAt(x + dirX * ahead, 0.6, z + dirZ * ahead);
  } else {
    const a = trail.at(d - back), b = trail.at(d + ahead);
    cam.position.set(a.p.x + a.side.x * side, up, a.p.z + a.side.z * side);
    cam.lookAt(b.p.x, 0.6, b.p.z);
  }
  cam.rotateZ(roll);
  return cam;
}

export { THREE };
