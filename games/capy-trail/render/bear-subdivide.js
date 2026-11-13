// THE-1582: the "HD bear" setting's geometry pass -- one level of Loop subdivision, written in-house, run
// once at load on the same free CC BY 4.0 Polyfork mesh (assets/bear.glb). No new asset, no new download.
// Pure typed-array math (no three.js import) so it runs as a plain node test.
//
// Input/output: { position: Float32Array (xyz), color: Float32Array|null (3 or 4 per vertex, itemSize given),
// joints: Uint8|Uint16Array|null (4 per vertex), weights: Float32Array|null (4 per vertex), index: Uint*Array }.
// Each triangle becomes 4. Original vertices are Loop-smoothed; each edge gets one new vertex. Colour and
// skin weights at a new edge vertex are the 50/50 blend of the edge's two ends (top 4 joints, renormalised),
// so the subdivided body stays on the same skeleton and the pose tables in bear.js need no change.
// The GLB duplicates a vertex wherever two colour zones meet (bear.glb: 1447 vertices, 1279 positions), so
// the smoothing rules run on a position-welded topology (`canon`): every copy of a seam vertex lands on the
// same smoothed point and the seam neither cracks nor creases. Colour/skin stay per copy. Edges that are
// still open after welding use the Loop boundary rules.

function edgeKey(a, b, n) { return a < b ? a * n + b : b * n + a; }

function weld(position) {
  const n = position.length / 3;
  const canon = new Int32Array(n);
  const seen = new Map();
  const q = (x) => Math.round(x * 1e5);
  for (let v = 0; v < n; v++) {
    const k = `${q(position[v * 3])},${q(position[v * 3 + 1])},${q(position[v * 3 + 2])}`;
    const c = seen.get(k);
    if (c === undefined) { seen.set(k, v); canon[v] = v; } else canon[v] = c;
  }
  return canon;
}

export function loopSubdivide({ position, color = null, colorSize = 3, joints = null, weights = null, index }) {
  const n = position.length / 3;
  const triCount = index.length / 3;
  const canon = weld(position);

  // welded topology: canonical edge -> opposite canonical vertices; per-copy edges -> new vertex id
  const cEdges = new Map();
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    for (const [a, b, c] of [[i0, i1, i2], [i1, i2, i0], [i2, i0, i1]]) {
      const ca = canon[a], cb = canon[b];
      const ck = edgeKey(ca, cb, n);
      let ce = cEdges.get(ck);
      if (!ce) { ce = { a: Math.min(ca, cb), b: Math.max(ca, cb), opp: [] }; cEdges.set(ck, ce); }
      ce.opp.push(canon[c]);
      const k = edgeKey(a, b, n);
      if (!edges.has(k)) edges.set(k, { a, b, ce, id: -1 });
    }
  }

  // neighbours per canonical vertex, and the boundary neighbours separately
  const nbr = Array.from({ length: n }, () => []);
  const bnd = Array.from({ length: n }, () => []);
  for (const e of cEdges.values()) {
    nbr[e.a].push(e.b); nbr[e.b].push(e.a);
    if (e.opp.length !== 2) { bnd[e.a].push(e.b); bnd[e.b].push(e.a); }
  }

  const outN = n + edges.size;
  const pos = new Float32Array(outN * 3);
  const col = color ? new Float32Array(outN * colorSize) : null;
  const jnt = joints ? new joints.constructor(outN * 4) : null;
  const wgt = weights ? new Float32Array(outN * 4) : null;

  // smoothed original vertices
  for (let v = 0; v < n; v++) {
    if (canon[v] !== v) continue; // copies take their canonical vertex's point below
    let wSelf, wEach, list;
    if (bnd[v].length > 0) {
      if (bnd[v].length === 2) { wSelf = 0.75; wEach = 0.125; list = bnd[v]; } else { wSelf = 1; wEach = 0; list = []; }
    } else {
      const k = nbr[v].length;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      wSelf = 1 - k * beta; wEach = beta; list = nbr[v];
    }
    for (let c = 0; c < 3; c++) {
      let s = wSelf * position[v * 3 + c];
      for (const u of list) s += wEach * position[u * 3 + c];
      pos[v * 3 + c] = s;
    }
  }
  for (let v = 0; v < n; v++) {
    if (canon[v] !== v) for (let c = 0; c < 3; c++) pos[v * 3 + c] = pos[canon[v] * 3 + c];
    if (col) for (let c = 0; c < colorSize; c++) col[v * colorSize + c] = color[v * colorSize + c];
    if (jnt) for (let c = 0; c < 4; c++) { jnt[v * 4 + c] = joints[v * 4 + c]; wgt[v * 4 + c] = weights[v * 4 + c]; }
  }

  // new edge vertices
  let next = n;
  for (const e of edges.values()) {
    const id = next++;
    e.id = id;
    const { a, b } = e;
    const { a: ca, b: cb, opp } = e.ce;
    for (let c = 0; c < 3; c++) {
      pos[id * 3 + c] = opp.length === 2
        ? 0.375 * (position[ca * 3 + c] + position[cb * 3 + c]) + 0.125 * (position[opp[0] * 3 + c] + position[opp[1] * 3 + c])
        : 0.5 * (position[ca * 3 + c] + position[cb * 3 + c]);
    }
    if (col) for (let c = 0; c < colorSize; c++) col[id * colorSize + c] = 0.5 * (color[a * colorSize + c] + color[b * colorSize + c]);
    if (jnt) blendSkin(joints, weights, a, b, jnt, wgt, id);
  }

  const IndexType = outN > 65535 ? Uint32Array : Uint16Array;
  const idx = new IndexType(triCount * 12);
  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    const m01 = edges.get(edgeKey(i0, i1, n)).id, m12 = edges.get(edgeKey(i1, i2, n)).id, m20 = edges.get(edgeKey(i2, i0, n)).id;
    idx.set([i0, m01, m20, m01, i1, m12, m20, m12, i2, m01, m12, m20], t * 12);
  }
  return { position: pos, color: col, colorSize, joints: jnt, weights: wgt, index: idx };
}

// Half of each end's influences, summed per joint, top 4 kept and renormalised to 1.
function blendSkin(joints, weights, a, b, outJ, outW, id) {
  const acc = new Map();
  for (const v of [a, b]) {
    for (let c = 0; c < 4; c++) {
      const w = weights[v * 4 + c] * 0.5;
      if (w > 0) { const j = joints[v * 4 + c]; acc.set(j, (acc.get(j) || 0) + w); }
    }
  }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  for (let c = 0; c < 4; c++) {
    outJ[id * 4 + c] = top[c] ? top[c][0] : 0;
    outW[id * 4 + c] = top[c] ? top[c][1] / sum : 0;
  }
}

// Normals averaged over every vertex sharing a position (to 1e-5), so a colour seam reads as one smooth
// surface in HD rather than a lit crease. Area-weighted (unnormalised cross products).
export function smoothNormals(position, index) {
  const n = position.length / 3;
  const acc = new Float32Array(n * 3);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a], vy = position[c + 1] - position[a + 1], vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const p of [a, b, c]) { acc[p] += nx; acc[p + 1] += ny; acc[p + 2] += nz; }
  }
  const groups = new Map();
  const q = (x) => Math.round(x * 1e5);
  for (let v = 0; v < n; v++) {
    const k = `${q(position[v * 3])},${q(position[v * 3 + 1])},${q(position[v * 3 + 2])}`;
    let g = groups.get(k); if (!g) { g = []; groups.set(k, g); } g.push(v);
  }
  const out = new Float32Array(n * 3);
  for (const g of groups.values()) {
    let x = 0, y = 0, z = 0;
    for (const v of g) { x += acc[v * 3]; y += acc[v * 3 + 1]; z += acc[v * 3 + 2]; }
    const len = Math.hypot(x, y, z) || 1;
    for (const v of g) { out[v * 3] = x / len; out[v * 3 + 1] = y / len; out[v * 3 + 2] = z / len; }
  }
  return out;
}
