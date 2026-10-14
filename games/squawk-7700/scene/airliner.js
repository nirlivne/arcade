// The airliner (Dunelark Air, fictional), from the designer's recipe (THE-734 scene.js), trimmed to
// what the dive's look-back needs: the hull + fin + the rudder in 3 live pieces. No gear (dive only).
// opts.rudder: 1 (intact) / 0.67 / 0.33 / 0 -- which rudder pieces are visible.
import * as THREE from "../vendor/three.module.min.js";
import { bake, solid, mesh, PAL as WORLD_PAL } from "./world.js";

const PAL = {
  ...WORLD_PAL,
  hull: "#F4F1EA", hullLo: "#C9C6BE", belly: "#1C6B74", cheat: "#F2994A", fin: "#135560", rudder: "#0F4851",
  lark: "#F7E7C4", window: "#1A1F2B", engine: "#D9D6CF", intake: "#2A2F3A",
};

function larkMark(size) {
  const g = new THREE.Group(), s = size / 100;
  const pts = [[10, 56], [50, 34], [92, 16], [70, 38], [88, 42], [58, 48], [40, 64], [34, 54]];
  const sun = solid(new THREE.CircleGeometry(30 * s, 12), PAL.cheat); sun.position.set((58 - 50) * s, (50 - 44) * s, 0); g.add(sun);
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2((x - 50) * s, (50 - y) * s)));
  const bird = solid(new THREE.ShapeGeometry(sh), PAL.lark); bird.position.z = 0.01; g.add(bird);
  return g;
}

export function airliner(opts = {}) {
  const g = new THREE.Group(), R = 1.9;
  const prof = [[0, 17.2], [0.7, 16.6], [1.35, 15.4], [1.75, 13.6], [1.9, 11.5], [1.9, -7], [1.7, -10.5], [1.2, -13.6], [0.55, -16], [0.15, -16.6]];
  const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12);
  lathe.rotateX(Math.PI / 2); lathe.rotateZ(Math.PI / 12);
  g.add(mesh(lathe, (m) => {
    const y = m.y / R, z = m.z;
    if (z > 13.6 && y > 0.05 && y < 0.62 && Math.abs(m.x) < 1.5) return PAL.window;
    if (y < -0.62) return PAL.belly;
    const band = -0.42 + Math.max(0, -z - 2) * 0.075;
    if (y > band && y < band + 0.26 && z < 12.5) return PAL.cheat;
    if (z < -9 && y > band + 0.26) return PAL.fin;
    return PAL.hull;
  }));
  const wingShape = new THREE.Shape([[0, 3.4], [13.6, -4.4], [14.4, -5.6], [13.6, -6.2], [0, -3.2]].map(([x, z]) => new THREE.Vector2(x, z)));
  for (const sx of [-1, 1]) {
    const wgeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.36, bevelEnabled: false });
    wgeo.rotateX(Math.PI / 2); wgeo.translate(0, 0.18, 0);
    const w = mesh(wgeo, (m, n) => (n.y < -0.5 ? PAL.hullLo : PAL.hull));
    w.scale.x = sx; w.rotation.z = sx * 0.09; w.position.set(sx * 0.8, -1.0, 0.6); g.add(w);
    const eg = new THREE.CylinderGeometry(0.78, 0.62, 3.4, 10, 1); eg.rotateX(Math.PI / 2);
    const e = mesh(eg, (m) => (m.z > 1.4 ? PAL.intake : m.y < -0.3 ? PAL.belly : PAL.engine));
    e.position.set(sx * 5.2, -1.75, 2.4); g.add(e);
  }
  // fin (fixed) + rudder in 3 live pieces stacked up the trailing edge
  const fin = new THREE.Shape([[0, 0], [3.6, 0], [6.4, 6.4], [4.4, 6.4]].map(([x, y]) => new THREE.Vector2(x, y)));
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.32, bevelEnabled: false }); fg.translate(0, 0, -0.16); fg.rotateY(Math.PI / 2);
  const finM = solid(fg, PAL.fin); finM.position.set(0, 1.3, -9.4); g.add(finM);
  const rudder = opts.rudder ?? 1, pieces = Math.round(rudder === 0.67 ? 2 : rudder === 0.33 ? 1 : rudder === 0 ? 0 : 3);
  for (let i = 0; i < 3; i++) {
    const y0 = i * 2.133, y1 = y0 + 2.133, x0 = 3.6 + y0 * 0.4375, x1 = 3.6 + y1 * 0.4375;
    const rg = new THREE.ExtrudeGeometry(new THREE.Shape([[x0, y0], [x0 + 1.7, y0], [x1 + 1.7 - 0.4, y1], [x1, y1]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.3, bevelEnabled: false });
    rg.translate(0, 0, -0.15); rg.rotateY(Math.PI / 2);
    const rp = solid(rg, PAL.rudder); rp.position.copy(finM.position); rp.name = "rudder" + i; rp.userData.keep = true;
    rp.visible = i < pieces; g.add(rp);
  }
  if (pieces < 3) {
    const sy = pieces * 2.133, sx0 = 3.6 + sy * 0.4375;
    const st = new THREE.ExtrudeGeometry(new THREE.Shape([[sx0, sy], [sx0 + 1.7, sy], [sx0 + 1.3, sy + 0.45], [sx0 + 0.8, sy + 0.2], [sx0 + 0.4, sy + 0.5]].map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.28, bevelEnabled: false });
    st.translate(0, 0, -0.14); st.rotateY(Math.PI / 2);
    const s = solid(st, "#0B3A41"); s.position.copy(finM.position); g.add(s);
  }
  for (const sx of [-1, 1]) { const mk = larkMark(3.0); mk.rotation.y = sx * Math.PI / 2; mk.position.set(sx * 0.18, 4.6, -13.0); g.add(mk); }
  // Gear: live group, hidden until opts.gear (the recipe's ending/tarmac parking shot).
  const gear = new THREE.Group(); gear.name = "gear"; gear.userData.keep = true; gear.visible = !!opts.gear;
  for (const [x, z] of [[0, 12], [-2.6, -0.6], [2.6, -0.6]]) {
    const leg = solid(new THREE.BoxGeometry(0.18, 1.8, 0.18), PAL.gear); leg.position.set(x, -2.6, z); gear.add(leg);
    const wh = solid(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 8).rotateZ(Math.PI / 2), PAL.tyre); wh.position.set(x, -3.5, z); gear.add(wh);
  }
  g.add(bake(gear));
  return bake(g);
}
