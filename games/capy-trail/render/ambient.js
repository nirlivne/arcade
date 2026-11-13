// P6 (THE-1330, board feedback #2 item 7): ambient movement. Falling leaves drift down around the camera
// and a few birds wheel high over the trail ahead. Purely cosmetic and render-only (never in the sim, never
// near a lane at capy height): leaves fall in a box in front of the camera, birds fly 9-15 m up.
// Low tier: fewer leaves, 2 birds. Reduce motion: half the leaves, falling slower without spinning, and
// the birds glide (no flapping) on a slower circle.
// THE-1353 (board feedback #3 item 2-3): leaves cut way down (<=12/8/4) and pinned to the forest edges --
// when a `trail` is given, a leaf's (x, z) comes from the real path's own side vector at a distance just
// ahead of the capy, offset at least FOREST_EDGE_OFFSET out (beyond the 2.4 m lane + margin look.js's own
// forest decor already uses as its closest approach, see render/look.js's decorSlot `off = sd * (5 + ...)`),
// so a leaf is never over the path regardless of how sharp the trail bends. A few soft clay clouds join
// the sky, standing still under reduce motion.
import * as THREE from "three";

const LEAF_COUNT = { high: 12, mid: 8, low: 4 }, BIRD_COUNT = { high: 4, mid: 3, low: 2 };
const LEAF_COLS = ["#6FB04F", "#A8C94A", "#E2B33C", "#D9772E"];
const FOREST_EDGE_OFFSET = 6, FOREST_EDGE_SPAN = 14; // a leaf's |across| is always in [6, 20] m from the centreline
const CLOUD_COUNT = { high: 7, mid: 5, low: 0 };
const CLOUD_COLOR = "#FFF4E2", CLOUD_TURN = 0.006; // rad/s, the whole sky ring

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function createAmbient(scene, { tier = "high", seed = 1 } = {}) {
  const r = rng(seed * 7 + 3);
  // ---- leaves: one InstancedMesh, each leaf a small bent quad tinted per instance
  const nLeaves = LEAF_COUNT[tier] ?? LEAF_COUNT.high;
  const leafGeo = new THREE.PlaneGeometry(0.22, 0.15, 2, 1);
  leafGeo.attributes.position.setZ(1, 0.025); leafGeo.attributes.position.setZ(4, 0.025); // a slight fold down the middle
  leafGeo.computeVertexNormals();
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, nLeaves);
  leaves.frustumCulled = false; // instances move around the camera; the mesh's own bounds would be stale
  const L = [];
  const col = new THREE.Color();
  for (let i = 0; i < nLeaves; i++) {
    L.push({ x: 0, y: 0, z: 0, d: 0, vy: 0, phase: r() * 6.28, spin: (r() - 0.5) * 5, sway: 0.4 + r() * 0.6, rx: r() * 6.28, ry: r() * 6.28, live: false });
    leaves.setColorAt(i, col.set(LEAF_COLS[Math.floor(r() * LEAF_COLS.length)]));
  }
  scene.add(leaves);

  // ---- birds: a dark little body and two wings that flap
  const birdMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#3A3550"), roughness: 0.9, side: THREE.DoubleSide });
  const wingGeo = new THREE.PlaneGeometry(0.9, 0.32); wingGeo.translate(0.45, 0, 0); wingGeo.rotateX(-Math.PI / 2);
  const bodyGeo = new THREE.SphereGeometry(0.16, 8, 6); bodyGeo.scale(0.8, 0.7, 1.9);
  const birds = [];
  for (let i = 0; i < (BIRD_COUNT[tier] ?? 2); i++) {
    const g = new THREE.Group(), lw = new THREE.Mesh(wingGeo, birdMat), rw = new THREE.Mesh(wingGeo, birdMat);
    rw.scale.x = -1;
    g.add(new THREE.Mesh(bodyGeo, birdMat), lw, rw);
    g.userData = { lw, rw, phase: r() * 6.28, radius: 18 + r() * 16, height: 9 + r() * 6, speed: 0.18 + r() * 0.12, flap: 7 + r() * 3 };
    scene.add(g); birds.push(g);
  }
  const centre = new THREE.Vector3(), tmp = new THREE.Object3D(), fwd = new THREE.Vector3(), right = new THREE.Vector3(), target = new THREE.Vector3();
  const cloudTmp = new THREE.Object3D(); // CTO review THE-1356: never share `tmp` -- its puff scale leaked into every leaf
  let t = 0, haveCentre = false;

  // ---- clouds (THE-1353): a handful of soft puff clusters, one shared InstancedMesh (opaque, no
  // transparency sorting cost). Low tier: none (frame budget).
  // CTO review THE-1356: they used to circle a lagging anchor 42-62 m up, which put them at or past the
  // frame's top edge (look.js chaseCam: 58 deg, ~10 deg down, top edge ~19 deg up, the HUD row below it)
  // and swung them out of view after every 90-degree turn. Now they sit on a sky ring around the camera,
  // like a far skybox layer: evenly spread in azimuth (so one or two are always in front, whatever the
  // heading), 200-320 m out, 4-9 deg above the horizon (the band between the treeline and the HUD),
  // slowly turning. Puffs spread in puff-size units so a cluster reads as a cloud, not one lump; no fog,
  // a little self-light, so they stay white.
  const nClouds = CLOUD_COUNT[tier] ?? 0;
  const clouds = [];
  let cloudMesh = null;
  if (nClouds > 0) {
    for (let c = 0; c < nClouds; c++) {
      const nPuffs = 3 + Math.floor(r() * 4); // 3-6
      const puffs = [];
      for (let i = 0; i < nPuffs; i++) {
        const k = i / (nPuffs - 1) - 0.5; // a row of puffs, biggest in the middle
        puffs.push({ lx: k * 26 + (r() - 0.5) * 4, ly: (r() - 0.5) * 2, lz: (r() - 0.5) * 8, scale: (1 - Math.abs(k)) * (5 + r() * 3) + 3 });
      }
      const dist = 200 + r() * 120, elev = (4 + r() * 5) * Math.PI / 180;
      // one shared turning speed: per-cloud speeds would bunch the ring up over a long run and leave gaps
      clouds.push({ phase: (c + r() * 0.1) / nClouds * Math.PI * 2, dist, rise: dist * Math.tan(elev), speed: CLOUD_TURN, puffs });
    }
    const totalPuffs = clouds.reduce((n, c) => n + c.puffs.length, 0);
    const puffGeo = new THREE.SphereGeometry(1, 12, 8); puffGeo.scale(1, 0.62, 1);
    const cloudMat = new THREE.MeshStandardMaterial({ color: CLOUD_COLOR, emissive: CLOUD_COLOR, emissiveIntensity: 0.45, roughness: 1, fog: false });
    cloudMesh = new THREE.InstancedMesh(puffGeo, cloudMat, totalPuffs);
    cloudMesh.frustumCulled = false;
    scene.add(cloudMesh);
  }

  // Pin a leaf's (x, z) to the real trail at an along-path distance `d` just ahead of the capy, offset
  // FOREST_EDGE_OFFSET..+FOREST_EDGE_OFFSET+FOREST_EDGE_SPAN out to one random side -- always clear of the
  // path by construction, whatever the trail does underneath it. `anywhere`: the very first fill spreads
  // leaves' starting height (a respawn later always drops in from the top).
  function respawn(l, trail, s, cam, fwdV, rightV, anywhere) {
    const sgn = r() < 0.5 ? -1 : 1, across = sgn * (FOREST_EDGE_OFFSET + r() * FOREST_EDGE_SPAN);
    if (trail) {
      const d = s + 6 + r() * 26; // 6-32 m ahead of the capy along the real path
      const { p, side } = trail.at(d);
      l.x = p.x + side.x * across; l.z = p.z + side.z * across; l.d = d;
    } else { // no trail given (e.g. a bare test harness): fall back to the camera-relative box
      const ahead = 6 + r() * 24;
      l.x = cam.x + fwdV.x * ahead + rightV.x * across; l.z = cam.z + fwdV.z * ahead + rightV.z * across; l.d = 0;
    }
    l.y = anywhere ? 0.5 + r() * 8 : 7 + r() * 2.5;
    l.vy = 0.55 + r() * 0.5; l.live = true;
  }

  // camera: the frame's camera; reduceMotion: calmer movement; visible: false hides it all (e.g. title);
  // trail/s (THE-1353): the real path and the capy's distance along it, so leaves can pin to it exactly.
  function update(dt, camera, { reduceMotion = false, visible = true, trail = null, s = 0 } = {}) {
    leaves.visible = visible; for (const b of birds) b.visible = visible; if (cloudMesh) cloudMesh.visible = visible;
    if (!visible) return;
    t += dt;
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    right.set(-fwd.z, 0, fwd.x); const cam = camera.position;
    const slow = reduceMotion ? 0.45 : 1, shown = reduceMotion ? Math.ceil(nLeaves / 2) : nLeaves;
    for (let i = 0; i < nLeaves; i++) {
      const l = L[i];
      if (i >= shown) { tmp.position.set(0, -50, 0); tmp.updateMatrix(); leaves.setMatrixAt(i, tmp.matrix); continue; }
      const outOfRange = trail ? (l.d - s < -2 || l.d - s > 34) : Math.hypot(l.x - cam.x, l.z - cam.z) > 40;
      if (!l.live || l.y < 0.02 || outOfRange) respawn(l, trail, s, cam, fwd, right, !l.live || outOfRange);
      l.y -= l.vy * slow * dt;
      const sw = Math.sin(t * 1.7 * slow + l.phase) * l.sway * slow * dt;
      l.x += right.x * sw; l.z += right.z * sw;
      if (!reduceMotion) { l.rx += l.spin * dt; l.ry += l.spin * 0.6 * dt; }
      tmp.position.set(l.x, l.y, l.z); tmp.rotation.set(l.rx, l.ry, 0); tmp.updateMatrix();
      leaves.setMatrixAt(i, tmp.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;

    // birds circle a point that trails ~60 m ahead of the camera, eased so turns of the trail don't jerk them
    target.set(cam.x + fwd.x * 60, 0, cam.z + fwd.z * 60);
    if (!haveCentre) { centre.copy(target); haveCentre = true; } else centre.lerp(target, Math.min(1, dt * 0.6));
    for (const b of birds) {
      const u = b.userData, a = u.phase + t * u.speed * slow;
      b.position.set(centre.x + Math.cos(a) * u.radius, u.height + Math.sin(t * 0.4 + u.phase) * 1.2, centre.z + Math.sin(a) * u.radius);
      b.rotation.y = -a; // tangent to the circle
      const flap = reduceMotion ? 0.12 : Math.sin(t * u.flap + u.phase) * 0.55;
      u.lw.rotation.z = flap; u.rw.rotation.z = -flap;
    }

    // clouds: each on the sky ring around the camera at its own azimuth, slowly turning. Reduce motion:
    // the ring still follows the camera, but each cloud's azimuth is frozen -- "the clouds stand still".
    if (cloudMesh) {
      let idx = 0;
      for (const c of clouds) {
        if (!reduceMotion) c.phase += c.speed * dt;
        const ox = Math.cos(c.phase), oz = Math.sin(c.phase); // outward from the camera
        const cx = cam.x + ox * c.dist, cz = cam.z + oz * c.dist, cy = cam.y + c.rise;
        for (const p of c.puffs) {
          // the cluster's long axis runs across the line of sight, so a cloud reads as a wide puff row
          cloudTmp.position.set(cx - oz * p.lx + ox * p.lz, cy + p.ly, cz + ox * p.lx + oz * p.lz);
          cloudTmp.scale.setScalar(p.scale);
          cloudTmp.updateMatrix();
          cloudMesh.setMatrixAt(idx++, cloudTmp.matrix);
        }
      }
      cloudMesh.instanceMatrix.needsUpdate = true;
    }
  }
  // a new run (or the title) starts somewhere else: drop the leaves so they respawn around the new camera
  function reset() { for (const l of L) l.live = false; haveCentre = false; }
  // test-only (leaf-forest-edge.test.mjs): the live leaves' current world (x, z), never read by the game.
  function leafPositions() { return L.filter((l) => l.live).map((l) => ({ x: l.x, z: l.z })); }
  // test-only: each cloud's current drift angle, so a test can confirm reduce motion freezes it.
  function cloudPhases() { return clouds.map((c) => c.phase); }
  // cloudPuffCounts (test-only): how many cloud-mesh instances each cloud owns, in order.
  return { update, reset, leafPositions, cloudPhases, cloudPuffCounts: clouds.map((c) => c.puffs.length), leafCount: nLeaves, birdCount: birds.length, cloudCount: nClouds };
}
