// Lazy GLB loads for the power-up pickups (spec Part 1). Same "a few frames with no mesh, not a blocked
// boot" async pattern as every other GLB in this game: render/scene.js fires loadPowerupTemplates() once.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();

export async function loadPowerupTemplates({ shield = "./assets/pu-shield.glb", balloon = "./assets/pu-balloon.glb", spring = "./assets/pu-spring.glb", mystery = "./assets/pu-mystery.glb" } = {}) {
  const [shieldG, balloonG, springG, mysteryG] = await Promise.all([loader.loadAsync(shield), loader.loadAsync(balloon), loader.loadAsync(spring), loader.loadAsync(mystery)]);
  shieldG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  balloonG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  springG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  mysteryG.scene.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  return { shieldG, balloonG, springG, mysteryG };
}

// Object3D.clone() (unlike a geometry/material clone) shares the template's geometry and material by
// reference -- same "clone the node, never the material" rule as render/obstacles.js's own piece().
function piece(g, name) { const o = g.scene.getObjectByName(name).clone(true); o.position.set(0, 0, 0); return o; }
export function shieldPickupMesh(templates) { return piece(templates.shieldG, "shield_pickup"); }
export function balloonPickupMesh(templates) { return piece(templates.balloonG, "balloon_pickup"); }
export function springPickupMesh(templates) { return piece(templates.springG, "spring_pickup"); }
// mystery_pickup -> mystery_body + mystery_lid (hinge); the clone keeps that hierarchy for mysteryLid().
export function mysteryPickupMesh(templates) { return piece(templates.mysteryG, "mystery_pickup"); }
export function mysteryLid(mesh) { return mesh.getObjectByName("mystery_lid"); }
// The ride balloon carried on the hero's back while aloft (hi: 6 gores, Mid+High; lo: plain pink, Low).
export function rideBalloonMesh(templates, tier) { return piece(templates.balloonG, `balloon_ride_${tier === "low" ? "lo" : "hi"}`); }
