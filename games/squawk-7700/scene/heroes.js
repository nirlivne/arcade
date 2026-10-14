// The heroes (original, faceless, read by silhouette), from the designer's recipe (THE-734 scene.js
// section 5 / recipe.md). Units: a standing hero is 2.75 units tall; scale 0.66 = 1.8 m in the metre
// scenes (cockpit, cabin, tarmac). No face, no features -- read by silhouette and colour. Render only.
import * as THREE from "../vendor/three.module.min.js";
import { bake, solid, MAT } from "./world.js";

const SKIN = { captain: "#C2916A", passenger: "#E2B892", pilot: "#9E7055" };
export const HEROES = {
  captain: { coat: "#173B45", trim: "#F2D9A0", legs: "#1A2A33", hair: "#2B2420", skin: SKIN.captain },
  passenger: { coat: "#E8566E", trim: "#FFE4D6", legs: "#3B5A8C", hair: "#5A3A28", skin: SKIN.passenger },
  pilot: { coat: "#7FA38A", trim: "#F4F1EA", legs: "#33363E", hair: "#8A8F96", skin: SKIN.pilot },
};

// kind: "captain" | "passenger" | "pilot". pose: "stand" | "run" | "brace" | "sit" | "wave".
// opts.live: keep the 4 limbs as live groups (userData.keep) instead of baking them static (the
// aisle's run cycle). opts.scale: uniform scale after baking (metre scenes use 0.66).
export function hero(kind, pose = "stand", opts = {}) {
  const h = HEROES[kind], g = new THREE.Group();
  const torso = solid(new THREE.CylinderGeometry(0.44, 0.36, 1.05, 6), h.coat); torso.position.y = 1.55; g.add(torso);
  const head = solid(new THREE.IcosahedronGeometry(0.33, 0), h.skin); head.position.y = 2.42; g.add(head);
  const neck = solid(new THREE.CylinderGeometry(0.13, 0.15, 0.2, 6), h.skin); neck.position.y = 2.12; g.add(neck);
  const legs = [], arms = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * 0.2, 1.05, 0); leg.name = sx < 0 ? "legL" : "legR";
    const lm = solid(new THREE.BoxGeometry(0.26, 1.0, 0.3), h.legs); lm.position.y = -0.5; leg.add(lm);
    const shoe = solid(new THREE.BoxGeometry(0.28, 0.16, 0.44), kind === "passenger" ? "#F6F2EA" : "#15161A"); shoe.position.set(0, -1.0, 0.07); leg.add(shoe);
    g.add(leg); legs.push(leg);
    const arm = new THREE.Group(); arm.position.set(sx * 0.55, 1.98, 0); arm.name = sx < 0 ? "armL" : "armR";
    const am = solid(new THREE.BoxGeometry(0.22, 0.9, 0.24), h.coat); am.position.y = -0.42; arm.add(am);
    const hand = solid(new THREE.IcosahedronGeometry(0.13, 0), h.skin); hand.position.y = -0.92; arm.add(hand);
    if (kind === "captain") { // two cream cuff stripes read as "captain" with no face
      for (let i = 0; i < 2; i++) { const st = solid(new THREE.BoxGeometry(0.235, 0.04, 0.255), h.trim); st.position.y = -0.74 - i * 0.07; arm.add(st); }
      if (sx < 0) { const band = solid(new THREE.BoxGeometry(0.25, 0.16, 0.27), "#FFFFFF"); band.position.y = -0.5; arm.add(band); } // white bandage, no blood
    }
    g.add(arm); arms.push(arm);
  }
  if (kind === "captain") {
    const cap = solid(new THREE.CylinderGeometry(0.36, 0.33, 0.2, 8), h.coat); cap.position.y = 2.66; g.add(cap);
    const brim = solid(new THREE.BoxGeometry(0.46, 0.05, 0.3), "#0D1F25"); brim.position.set(0, 2.57, 0.3); g.add(brim);
    const badge = solid(new THREE.BoxGeometry(0.16, 0.08, 0.02), h.trim); badge.position.set(0, 2.68, 0.36); g.add(badge);
    const tie = solid(new THREE.BoxGeometry(0.1, 0.45, 0.03), "#F4F1EA"); tie.position.set(0, 1.85, 0.38); g.add(tie);
    for (const sx of [-1, 1]) { const ep = solid(new THREE.BoxGeometry(0.22, 0.04, 0.2), h.trim); ep.position.set(sx * 0.42, 2.05, 0); g.add(ep); }
    const hair = solid(new THREE.IcosahedronGeometry(0.33, 0), h.hair); hair.position.set(0, 2.46, -0.07); hair.scale.set(1.04, 0.86, 0.96); g.add(hair);
  } else if (kind === "passenger") {
    const hood = solid(new THREE.IcosahedronGeometry(0.36, 0), h.coat); hood.position.set(0, 2.2, -0.26); hood.scale.set(1.1, 0.7, 0.8); g.add(hood);
    const hair = solid(new THREE.IcosahedronGeometry(0.34, 0), h.hair); hair.position.set(0, 2.52, -0.04); hair.scale.set(1, 0.7, 1); g.add(hair);
    const pocket = solid(new THREE.BoxGeometry(0.5, 0.2, 0.04), h.trim); pocket.position.set(0, 1.3, 0.38); g.add(pocket);
  } else {
    const hair = solid(new THREE.IcosahedronGeometry(0.34, 0), h.hair); hair.position.set(0, 2.55, -0.03); hair.scale.set(1, 0.6, 1); g.add(hair);
    const band = solid(new THREE.TorusGeometry(0.38, 0.05, 4, 10, Math.PI), "#23262D"); band.position.y = 2.45; g.add(band);
    for (const sx of [-1, 1]) { const cup = solid(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 8).rotateZ(Math.PI / 2), "#23262D"); cup.position.set(sx * 0.37, 2.42, 0); g.add(cup); }
    const mic = solid(new THREE.BoxGeometry(0.04, 0.04, 0.32), "#23262D"); mic.position.set(-0.3, 2.3, 0.2); mic.rotation.y = 0.5; g.add(mic);
    const collar = solid(new THREE.CylinderGeometry(0.2, 0.3, 0.16, 6), h.trim); collar.position.y = 2.06; g.add(collar);
    const lanyard = solid(new THREE.BoxGeometry(0.16, 0.22, 0.03), "#FFB224"); lanyard.position.set(0.12, 1.4, 0.37); g.add(lanyard);
  }
  if (pose === "run") {
    legs[0].rotation.x = 0.75; legs[1].rotation.x = -0.6; arms[0].rotation.x = -0.9; arms[1].rotation.x = 0.8;
    g.rotation.x = 0.18;
  } else if (pose === "brace") {
    arms[0].rotation.x = arms[1].rotation.x = -1.25; g.rotation.x = -0.12;
  } else if (pose === "sit") {
    legs[0].rotation.x = legs[1].rotation.x = -1.45; arms[0].rotation.x = arms[1].rotation.x = -1.15;
    arms[0].rotation.z = 0.12; arms[1].rotation.z = -0.12; g.position.y = -0.95;
  } else if (pose === "wave") {
    arms[1].rotation.z = 2.5; arms[0].rotation.z = -0.08;
  } else { arms[0].rotation.z = -0.08; arms[1].rotation.z = 0.08; }
  if (opts.live) for (const l of [...legs, ...arms]) l.userData.keep = true;
  const out = new THREE.Group(); out.add(g);
  const baked = bake(out);
  if (pose !== "sit") { const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })); blob.position.y = 0.01; baked.add(blob); }
  if (opts.scale) baked.scale.setScalar(opts.scale);
  return baked;
}

export { MAT };
