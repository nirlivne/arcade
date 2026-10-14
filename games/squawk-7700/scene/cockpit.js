// The flight deck (right seat), from the designer's recipe (THE-734 scene.js): the shell bakes to 2
// draws (lit + glow), the right yoke and the caution lamps stay live. The world outside rotates with
// the attitude; the cockpit stays put. opts.outside: "dive" (sky + clouds) | "land" (desert + runway).
// Render only: no game logic, no input handling.
import * as THREE from "../vendor/three.module.min.js";
import { bake, solid, glow, skyDome, clouds, desert, runway, PAL } from "./world.js";
import { hero } from "./heroes.js";

export function createCockpitScene(opts = {}) {
  const outside = opts.outside || "dive";
  const pal = PAL[outside];
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(pal[4], 160, outside === "land" ? 2600 : 900);
  const world = new THREE.Group(); scene.add(world);
  world.add(skyDome(pal));
  if (outside === "land") {
    const ds = desert(5, 5200); ds.name = "desert"; ds.position.y = -(opts.agl ?? 300); world.add(ds);
    const rw = runway(2400); rw.name = "runway"; rw.position.set(opts.lateral || 0, -(opts.agl ?? 300) + 0.2, -(opts.range ?? 1400) - 1200); world.add(rw);
  } else {
    world.add(clouds(40, 1100, -110, 37));
  }
  scene.add(new THREE.HemisphereLight(new THREE.Color(pal[1]).lerp(new THREE.Color("#ffffff"), 0.35), new THREE.Color(pal[2]), 2.0));
  const sun = new THREE.DirectionalLight(new THREE.Color(pal[3]), 2.4); sun.position.set(60, 30, -90); scene.add(sun);

  const deck = new THREE.Group();
  const box = (w, h, d, x, y, z, hex, rx = 0) => { const b = solid(new THREE.BoxGeometry(w, h, d), hex); b.position.set(x, y, z); b.rotation.x = rx; deck.add(b); return b; };
  box(3.2, 0.1, 3.2, 0, -0.05, 0.2, PAL.deck);
  box(3.0, 0.62, 0.42, 0, 0.72, -1.15, PAL.panel);
  box(3.06, 0.1, 0.55, 0, 1.06, -1.08, PAL.shield, 0.08);
  box(0.5, 0.72, 0.95, 0, 0.36, -0.5, PAL.deck);
  for (const sx of [-1, 1]) {
    box(0.07, 0.86, 0.07, sx * 0.02, 1.48, -1.28, PAL.frame).rotation.x = -0.35;
    box(0.09, 0.9, 0.08, sx * 0.86, 1.46, -1.18, PAL.frame).rotation.set(-0.35, 0, sx * 0.12);
    box(0.12, 0.95, 0.1, sx * 1.48, 1.4, -0.95, PAL.frame).rotation.set(-0.25, sx * 0.5, 0);
    box(0.12, 1.06, 2.6, sx * 1.58, 0.53, 0.1, PAL.cwall);
    box(0.12, 0.3, 2.6, sx * 1.56, 1.98, 0.1, PAL.cwall);
    box(0.08, 0.66, 0.1, sx * 1.56, 1.5, -0.1, PAL.frame);
    box(0.24, 0.05, 0.45, sx * 1.3, 1.02, 0.2, PAL.deck);
  }
  box(3.1, 0.12, 0.14, 0, 1.92, -1.02, PAL.frame);
  box(2.6, 0.1, 1.9, 0, 2.08, -0.05, PAL.cwall, -0.12);
  box(3.2, 1.0, 0.1, 0, 1.45, 1.75, PAL.cwall);
  const scr = (w, h, x, y, hex) => { const s = glow(new THREE.PlaneGeometry(w, h), hex); s.position.set(x, y, -0.935); deck.add(s); };
  for (const sx of [-1, 1]) {
    scr(0.32, 0.13, sx * 1.05, 0.83, PAL.pfdSky); scr(0.32, 0.13, sx * 1.05, 0.7, PAL.pfdGround); scr(0.32, 0.02, sx * 1.05, 0.765, "#FFFFFF");
    scr(0.32, 0.26, sx * 0.62, 0.76, PAL.screen); scr(0.12, 0.012, sx * 0.62, 0.76, "#4ADE80");
  }
  scr(0.3, 0.24, 0, 0.82, PAL.screenHi); scr(0.3, 0.14, 0, 0.6, PAL.screen);
  const xp = glow(new THREE.PlaneGeometry(0.24, 0.05), PAL.lampAmber); xp.position.set(0, 0.73, -0.02); xp.rotation.x = -Math.PI / 2 + 0.25; deck.add(xp);
  // Master caution lamps: their own material instance (not the shared glow material) so S2 can flicker
  // them independently of the screens.
  const cautionLamps = [];
  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.04), new THREE.MeshBasicMaterial({ color: PAL.lampRed }));
    l.position.set(sx * 0.5, 1.1, -0.83); l.name = "caution" + (sx < 0 ? "L" : "R"); l.userData.keep = true;
    deck.add(l); cautionLamps.push(l);
  }
  for (const sx of [-1, 1]) { box(0.05, 0.26, 0.05, sx * 0.08, 0.86, -0.62, "#9A9AA2", -0.4); box(0.1, 0.05, 0.07, sx * 0.08, 0.98, -0.67, "#5A616C"); }
  for (const sx of [-1, 1]) {
    box(0.56, 0.14, 0.56, sx * 0.55, 0.5, 0.25, PAL.cseat);
    box(0.56, 0.88, 0.14, sx * 0.55, 0.98, 0.55, PAL.cseat, 0.12);
    box(0.34, 0.22, 0.12, sx * 0.55, 1.5, 0.62, PAL.cseat, 0.12);
    box(0.36, 0.42, 0.36, sx * 0.55, 0.22, 0.25, PAL.deck);
  }

  const makeYoke = () => {
    const y = new THREE.Group();
    const col = solid(new THREE.BoxGeometry(0.06, 0.62, 0.06), "#7A828E"); col.position.y = 0.31; y.add(col);
    const hub = solid(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 8).rotateX(Math.PI / 2), PAL.yokeHub); hub.position.y = 0.64; y.add(hub);
    for (const sx of [-1, 1]) {
      const arm = solid(new THREE.BoxGeometry(0.15, 0.045, 0.05), "#9AA2AE"); arm.position.set(sx * 0.12, 0.64, 0); y.add(arm);
      const grip = solid(new THREE.BoxGeometry(0.05, 0.16, 0.06), "#1A1D22"); grip.position.set(sx * 0.2, 0.7, 0); grip.rotation.z = -sx * 0.18; y.add(grip);
    }
    return y;
  };
  const yl = makeYoke(); yl.position.set(-0.55, 0.42, -0.58); deck.add(yl);
  const yoke = bake(makeYoke()); yoke.position.set(0.55, 0.42, -0.58); yoke.name = "yoke"; yoke.userData.keep = true; deck.add(yoke);

  // The Captain (D2-5): seated left, braced on the yoke, door beat only. Added before baking so it
  // merges into the same 1-2 draws as the rest of the shell (no live limbs needed here).
  if (opts.captain) {
    const cpt = hero("captain", "sit", { scale: 0.62 });
    cpt.position.set(-0.55, 0.58, 0.32);
    cpt.rotation.y = Math.PI;
    cpt.rotation.x = 0.12;
    deck.add(cpt);
  }

  const baked = bake(deck); scene.add(baked);
  const view = opts.view || "rightSeat";
  const camera = new THREE.PerspectiveCamera(opts.fov || 60, 16 / 9, 0.05, 3000);
  if (view === "aft") {
    camera.position.set(1.0, 1.72, 1.55);
    camera.lookAt(-0.2, 1.15, -1.4);
  } else {
    const eye = opts.eye ?? 1.24;
    camera.position.set(0.55, eye, 0.12);
    camera.lookAt(0.5, opts.look ?? eye - 0.16, -2);
  }

  return {
    scene, camera, world,
    yoke: baked.getObjectByName("yoke"),
    cautionLamps: [baked.getObjectByName("cautionL"), baked.getObjectByName("cautionR")],
  };
}
