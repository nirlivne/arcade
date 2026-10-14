// Juice: speed lines (>400 kt), rudder shards (on a rudderChunk event) and cabin debris (shake/g).
// Render only: one InstancedMesh per effect, seeded only by the `fx` rng stream (cosmetic, never fed
// back into the sim).
import * as THREE from "../vendor/three.module.min.js";

const WHITE = new THREE.Color("#FFFFFF"), AMBER = new THREE.Color("#FFB224");

export function createSpeedLines(max = 90) {
  const geo = new THREE.PlaneGeometry(0.01, 0.6);
  const mat = new THREE.MeshBasicMaterial({ color: "#FFFFFF", transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.count = 0;
  const lines = [];
  for (let i = 0; i < max; i++) lines.push({ x: 0, y: 0, z: 0, speed: 0 });
  const d = new THREE.Object3D();

  // v: current airspeed (kt). fxRand: a 0..1 draw from the fx stream. dt: seconds this frame.
  // reduced: true = 12 static streaks regardless of speed, no motion (spec Comforts). scale: particle
  // count multiplier (perf auto-degrade halves it, spec §10.6).
  function update(v, fxRand, dt, reduced, scale = 1) {
    const over = Math.max(0, v - 400);
    const target = Math.round((reduced ? (over > 0 ? 12 : 0) : Math.round(Math.min(1, over / 80) * (max - 24) + (over > 0 ? 24 : 0))) * scale);
    im.count = target;
    if (reduced) {
      const color = v > 340 ? AMBER : WHITE;
      for (let i = 0; i < target; i++) {
        const l = lines[i];
        if (l.speed === 0) { l.x = (fxRand() - 0.5) * 2; l.y = (fxRand() - 0.5) * 1.2; l.z = -1 - fxRand() * 4; l.speed = 1; }
        d.position.set(l.x * 2.2, l.y * 1.3 + 1.2, l.z);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, color);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      return;
    }
    const color = v > 340 ? AMBER : WHITE;
    for (let i = 0; i < target; i++) {
      const l = lines[i];
      if (l.speed === 0) { l.x = (fxRand() - 0.5) * 2; l.y = (fxRand() - 0.5) * 1.2; l.z = -1 - fxRand() * 4; l.speed = 6 + fxRand() * 6; }
      l.z += l.speed * dt;
      if (l.z > -0.3) { l.x = (fxRand() - 0.5) * 2; l.y = (fxRand() - 0.5) * 1.2; l.z = -5; }
      d.position.set(l.x * 2.2, l.y * 1.3 + 1.2, l.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
      im.setColorAt(i, color);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }
  return { mesh: im, update };
}

// 8 tetrahedra shards per rudder chunk, teal, tumble ~1.2s then hide. No fire, no smoke.
export function createDebris(max = 24) {
  const geo = new THREE.TetrahedronGeometry(0.12, 0);
  const mat = new THREE.MeshLambertMaterial({ color: "#135560", flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.count = 0;
  const parts = Array.from({ length: max }, () => ({ alive: false, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0 }));
  const d = new THREE.Object3D();

  function spawn(origin, fxRand, n = 8, scale = 1) {
    n = Math.round(n * scale);
    let spawned = 0;
    for (const p of parts) {
      if (p.alive || spawned >= n) continue;
      p.alive = true; p.t = 0;
      p.x = origin.x; p.y = origin.y; p.z = origin.z;
      p.vx = (fxRand() - 0.5) * 2; p.vy = fxRand() * 1.5; p.vz = (fxRand() - 0.5) * 2;
      p.rx = fxRand() * 6; p.ry = fxRand() * 6;
      spawned++;
    }
  }
  function update(dt) {
    let count = 0;
    for (const p of parts) {
      if (!p.alive) continue;
      p.t += dt;
      if (p.t > 1.2) { p.alive = false; continue; }
      p.x += p.vx * dt; p.y += p.vy * dt - 1.5 * dt * dt; p.z += p.vz * dt;
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx * p.t, p.ry * p.t, 0);
      d.scale.setScalar(1 - p.t / 1.2);
      d.updateMatrix();
      im.setMatrixAt(count, d.matrix);
      count++;
    }
    im.count = count;
    im.instanceMatrix.needsUpdate = true;
  }
  return { mesh: im, spawn, update };
}

// Cabin/cockpit loose debris during heavy shake: a slow drifting instanced cloud, visible once trauma
// crosses a floor, invisible otherwise (count 0).
export function createCabinDebris(max = 16) {
  const geo = new THREE.BoxGeometry(0.03, 0.02, 0.05);
  const mat = new THREE.MeshLambertMaterial({ color: "#C9C6BE", flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, max);
  im.count = 0;
  const bits = Array.from({ length: max }, () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }));
  const d = new THREE.Object3D();
  let seeded = false;

  function update(trauma, fxRand, t, scale = 1) {
    if (trauma <= 0) { im.count = 0; return; }
    if (!seeded) {
      for (const b of bits) { b.x = (fxRand() - 0.5) * 0.8; b.y = 0.5 + fxRand() * 0.6; b.z = -0.6 + (fxRand() - 0.5) * 0.6; b.rx = fxRand() * 6; b.ry = fxRand() * 6; b.rz = fxRand() * 6; }
      seeded = true;
    }
    const n = Math.round(Math.min(1, trauma) * max * scale);
    im.count = n;
    for (let i = 0; i < n; i++) {
      const b = bits[i];
      d.position.set(b.x + Math.sin(t * 3 + i) * 0.03 * trauma, b.y + Math.cos(t * 2.3 + i) * 0.02 * trauma, b.z);
      d.rotation.set(b.rx + t, b.ry + t * 0.7, b.rz);
      d.scale.setScalar(1);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  }
  return { mesh: im, update };
}
