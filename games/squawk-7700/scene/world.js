// Shared low-poly helpers (THE-734 recipe, lifted from design/squawk-7700/scene.js): flat-shaded faces
// coloured per triangle (vertex colours, no textures), merged into one draw call per material. Colours
// here are the recipe's rough placeholders for S1; S7 swaps them for theme.js slots and the designer's
// skin. Render only: no game logic.
import * as THREE from "../vendor/three.module.min.js";

export const PAL = {
  cruise: ["#17143A", "#4B3478", "#C66A86", "#FFD9A8", "#6A4A86"], // FL340 dusk: the title, door, aisle windows
  dive: ["#2A1F5C", "#7E4C8C", "#F2A272", "#FFE1B0", "#9C6A8E"], // [zenith, mid, horizon, sun, fog]
  escort: ["#3A3678", "#B0688E", "#F7B878", "#FFF0C8", "#D88E86"],
  land: ["#231D4C", "#7A4A7A", "#FF9A5C", "#FFE6B8", "#B86A6A"],
  dawn: ["#3B4C8A", "#9A86B8", "#FFD2A1", "#FFF4DC", "#D9A894"], // the ending, tarmac at dawn
  cloud: "#F6E6DF", cloudShade: "#A98BB0",
  deck: "#363B45", panel: "#262B33", shield: "#1A1E24", frame: "#2E333C", cwall: "#4A505C", cseat: "#3A4656",
  pfdSky: "#2A5CA8", pfdGround: "#7A4B2A", screen: "#0B1A2A", screenHi: "#123A3F", lampRed: "#FF3344", lampAmber: "#FFB224",
  yokeHub: "#F2994A",
  sand: "#C9834F", sandLo: "#8E4E35", sandFlat: "#B97446", rock: "#6B3B33", runway: "#3A3944", paint: "#E9E4DA", edge: "#FFB224",
  apron: "#4A4550", gear: "#9A9AA2", tyre: "#22242A",
  jet: "#8C95A3", jetLo: "#5E6673", canopy: "#2B3D55",
};

const C = (h) => new THREE.Color(h);

// Flat-shaded per-face colour: fn(centroid, normal) -> hex.
export function paint(geom, fn) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3(), e = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    m.copy(a).add(b).add(c).divideScalar(3);
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize();
    const k = C(fn(m, n));
    for (let j = 0; j < 3; j++) { col[(i + j) * 3] = k.r; col[(i + j) * 3 + 1] = k.g; col[(i + j) * 3 + 2] = k.b; }
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  g.computeVertexNormals();
  return g;
}

export const MAT = {
  lit: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }),
  glow: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
};
export const mesh = (g, fn, mat = MAT.lit) => new THREE.Mesh(paint(g, fn), mat);
export const solid = (g, hex) => mesh(g, () => hex);
export const glow = (g, hex) => mesh(g, () => hex, MAT.glow);

// Merge every MAT.lit / MAT.glow mesh under `group` into one mesh per material (one draw call each).
// Children marked userData.keep stay live (the yoke).
export function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), mtx = new THREE.Matrix4(), out = new THREE.Group();
  out.position.copy(group.position); out.quaternion.copy(group.quaternion); out.scale.copy(group.scale);
  out.name = group.name; out.userData = { ...group.userData }; out.visible = group.visible;
  const buckets = new Map(), keep = [];
  const walk = (o) => {
    for (const ch of [...o.children]) {
      if (ch.userData.keep || ch.isInstancedMesh || (ch.isMesh && !(ch.material === MAT.lit || ch.material === MAT.glow))) { keep.push(ch); continue; }
      if (ch.isMesh) {
        mtx.multiplyMatrices(inv, ch.matrixWorld);
        const g = ch.geometry.clone().applyMatrix4(mtx);
        if (!buckets.has(ch.material)) buckets.set(ch.material, []);
        buckets.get(ch.material).push(g);
      }
      walk(ch);
    }
  };
  walk(group);
  for (const [mat, list] of buckets) {
    let n = 0; for (const g of list) n += g.attributes.position.count;
    const P = new Float32Array(n * 3), K = new Float32Array(n * 3); let o = 0;
    for (const g of list) { P.set(g.attributes.position.array, o * 3); K.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(P, 3)); geo.setAttribute("color", new THREE.BufferAttribute(K, 3));
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    out.add(new THREE.Mesh(geo, mat));
  }
  for (const k of keep) { k.parent.updateMatrixWorld(true); mtx.multiplyMatrices(inv, k.matrixWorld); mtx.decompose(k.position, k.quaternion, k.scale); out.add(k); }
  return out;
}

// One inverted-sphere sky dome, posterised gradient + a sun disc. `dome.userData.sunDir` can be moved.
export function skyDome(p) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { z: { value: C(p[0]) }, m: { value: C(p[1]) }, h: { value: C(p[2]) }, s: { value: C(p[3]) }, sd: { value: new THREE.Vector3(0.42, 0.06, -0.9).normalize() } },
    vertexShader: "varying vec3 v; void main(){ v = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
    fragmentShader: `uniform vec3 z,m,h,s,sd; varying vec3 v;
      void main(){ float y = v.y; vec3 c = y > 0.18 ? mix(m, z, smoothstep(0.18, 0.75, y)) : mix(h, m, smoothstep(-0.05, 0.18, y));
        if (y < -0.02) c = mix(h, m * 0.62, smoothstep(-0.02, -0.4, y));
        float sun = max(dot(v, sd), 0.); float halo = pow(sun, 6.) * 0.22;
        c = floor((c + s * halo) * 26.) / 26. + s * pow(sun, 700.) * 1.3; gl_FragColor = vec4(c, 1.); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), mat);
  dome.userData.sunDir = mat.uniforms.sd.value;
  dome.renderOrder = -1; dome.frustumCulled = false;
  return dome;
}

// Cloud deck: one InstancedMesh of faceted icosahedron puffs, 1 draw call for any count.
export function clouds(n, spread, y0, seed = 1) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const geo = paint(new THREE.IcosahedronGeometry(1, 0), (m, nn) => (nn.y < -0.2 ? PAL.cloudShade : PAL.cloud));
  const list = [];
  for (let i = 0; i < n; i++) {
    const k = 3 + Math.floor(rnd() * 4), sc = 4 + rnd() * 9, cx = (rnd() - 0.5) * spread, cy = y0 + (rnd() - 0.5) * 20, cz = (rnd() - 0.5) * spread;
    for (let j = 0; j < k; j++) list.push([cx + (j - k / 2) * 1.2 * sc * 1.6, cy + rnd() * 0.5 * sc * 0.7, cz + rnd() * 0.8 * sc, sc * (0.9 + rnd() * 0.8)]);
  }
  const im = new THREE.InstancedMesh(geo, MAT.lit, list.length);
  const d = new THREE.Object3D();
  list.forEach(([x, y, z, k], i) => { d.position.set(x, y, z); d.scale.set(k * 1.6, k * 0.7, k); d.rotation.y = i; d.updateMatrix(); im.setMatrixAt(i, d.matrix); });
  return im;
}

// A duned desert ground plane (THE-734 recipe), for the approach/landing.
export function desert(seed = 7, size = 1600) {
  const geo = new THREE.PlaneGeometry(size, size, 60, 60); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < p.count; i++) {
    // The far dunes rise 40-130 m, but never inside the runway corridor (|x| < 100 m -- the grid is
    // ~87 m, so the vertex columns either side of the 45 m runway stay flat too -- ramping up by
    // 220 m): the runway sits 1-6 km out along -z for the whole approach and was buried under them
    // until ~100 ft (sign-off r2 D2-12, THE-768).
    const x = p.getX(i), z = p.getZ(i), ax = Math.abs(x);
    const far = Math.min(1, Math.max(0, (-z - 250) / 400)) * Math.min(1, Math.max(0, (ax - 100) / 120));
    p.setY(i, (rnd() - 0.5) * 6 + far * (40 + rnd() * 90) * (0.6 + 0.4 * Math.sin(x * 0.01)) - (ax < 100 ? 3 : 0));
  }
  return mesh(geo, (m, n) => (m.y > 50 ? PAL.rock : n.y < 0.93 ? PAL.sandLo : m.y > 1 ? PAL.sand : PAL.sandFlat));
}

// Runway 27 at Dune Field (fictional), 45 m wide, centreline dashes, threshold bars, amber edge lights
// (1 instanced draw). Long axis along z, threshold at +len/2.
export function runway(len = 2400) {
  const g = new THREE.Group(), W = 45;
  g.add(solid(new THREE.PlaneGeometry(W, len).rotateX(-Math.PI / 2), PAL.runway));
  for (let i = 0; i < len / 60 - 2; i++) { const m = glow(new THREE.PlaneGeometry(0.9, 30).rotateX(-Math.PI / 2), PAL.paint); m.position.set(0, 0.05, len / 2 - 120 - i * 60); g.add(m); }
  for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) { const m = glow(new THREE.PlaneGeometry(1.8, 30).rotateX(-Math.PI / 2), PAL.paint); m.position.set(sx * (4 + i * 2.4), 0.05, len / 2 - 22); g.add(m); }
  for (const sx of [-1, 1]) { const m = glow(new THREE.PlaneGeometry(0.6, len).rotateX(-Math.PI / 2), PAL.paint); m.position.set(sx * (W / 2 - 1), 0.04, 0); g.add(m); }
  const n = Math.floor(len / 60), lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.MeshBasicMaterial({ color: PAL.edge }), n * 2), d = new THREE.Object3D();
  for (let i = 0; i < n; i++) for (const sx of [-1, 1]) { d.position.set(sx * (W / 2 + 1.5), 0.3, len / 2 - i * 60); d.updateMatrix(); lights.setMatrixAt(i * 2 + (sx > 0), d.matrix); }
  const out = bake(g); out.add(lights);
  return out;
}

// Escort fighter: generic grey delta, no roundels, no national marks, no real type. 1 draw.
export function fighter() {
  const g = new THREE.Group();
  const body = new THREE.LatheGeometry([[0, 7], [0.45, 5.2], [0.7, 2], [0.75, -4], [0.55, -5.4]].map(([r, y]) => new THREE.Vector2(r, y)), 8);
  body.rotateX(Math.PI / 2);
  g.add(mesh(body, (m) => (m.z > 3.4 && m.y > 0.2 ? PAL.canopy : m.y < -0.3 ? PAL.jetLo : PAL.jet)));
  const ws = new THREE.Shape([[0, 1.5], [4.4, -3.6], [4.4, -4.4], [0, -4.6]].map(([x, z]) => new THREE.Vector2(x, z)));
  for (const sx of [-1, 1]) {
    const wg = new THREE.ExtrudeGeometry(ws, { depth: 0.12, bevelEnabled: false }); wg.rotateX(Math.PI / 2);
    const w = solid(wg, PAL.jet); w.scale.x = sx; w.position.y = -0.1; g.add(w);
    const fs = new THREE.Shape([[0, 0], [1.6, 0], [2.4, 2.2], [1.8, 2.2]].map(([x, y]) => new THREE.Vector2(x, y)));
    const fgeo = new THREE.ExtrudeGeometry(fs, { depth: 0.1, bevelEnabled: false }); fgeo.rotateY(Math.PI / 2);
    const f = solid(fgeo, PAL.jetLo); f.position.set(sx * 0.6, 0.4, -2.8); f.rotation.z = -sx * 0.3; g.add(f);
  }
  return bake(g);
}

export { THREE };
