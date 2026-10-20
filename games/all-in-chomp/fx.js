// The fx layer (2026-10-19 design §4): WebGL over the 2D maze. The 2D canvas (#chomp-canvas, drawn exactly as
// before) is a texture on a full-screen quad; emissive glows and particles go over it; then the post passes:
// shockwaves, the lamp pool, grey and flash (ChompFX), a colour split (ChromaFX), bloom and a vignette. Loaded
// with import() after the title. On any failure game.js keeps the plain 2D canvas (createFx throws, or onFail).
// Coordinates are CSS px, y down (the camera's top is 0), so every material is double-sided (Junkies Pro lost
// all its effect quads to back-face culling under the same flip).
import * as V from "./vendor/fx-vendor.js";

const MAX_GLOW = 700, MAX_SOLID = 300;
const QUALITY_DPR = [0, 1.25, 1.5, 2]; // q1..q3; q0 = off

function texture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new V.CanvasTexture(c);
  t.colorSpace = V.SRGBColorSpace;
  return t;
}
const glowTex = () => texture(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
// a poker chip, tinted per particle: a grey disc (it takes the colour darker), white edge spots, an ink rim
const chipTex = () => texture(64, (g, s) => {
  const r = s / 2 - 3;
  g.fillStyle = "#bdbdbd"; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffffff";
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; g.beginPath(); g.arc(s / 2 + Math.cos(a) * r * 0.78, s / 2 + Math.sin(a) * r * 0.78, r * 0.16, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(s / 2, s / 2, r * 0.42, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#1A1210"; g.lineWidth = 3; g.beginPath(); g.arc(s / 2, s / 2, r, 0, Math.PI * 2); g.stroke();
});
const paperTex = () => texture(16, (g, s) => { g.fillStyle = "#ffffff"; g.fillRect(1, 1, s - 2, s - 2); });

class Batch {
  constructor(scene, map, blending, max, order) {
    const mat = new V.MeshBasicMaterial({ map, transparent: true, blending, depthWrite: false, depthTest: false, side: V.DoubleSide, toneMapped: false });
    this.mesh = new V.InstancedMesh(new V.PlaneGeometry(1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(V.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.col = new V.Color();
    this.mesh.setColorAt(0, this.col); // creates instanceColor
    this.o = new V.Object3D();
    this.max = max;
    this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  quad(x, y, sx, sy, rot, r, g, b) {
    if (this.n >= this.max) return;
    const o = this.o;
    o.position.set(x, y, 0); o.rotation.set(0, 0, rot); o.scale.set(sx || 1e-4, sy || 1e-4, 1); o.updateMatrix();
    this.mesh.setMatrixAt(this.n, o.matrix);
    this.col.setRGB(r, g, b);
    this.mesh.setColorAt(this.n, this.col);
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

class ChompFX extends V.Effect {
  constructor() {
    super("ChompFX", `
uniform vec4 waves[4]; uniform vec2 asp; uniform float flash; uniform vec3 flashCol; uniform float gray; uniform vec3 lamp; uniform float lampAmt;
void mainUv(inout vec2 uv) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < 4; i++) { vec4 w = waves[i]; if (w.w > 0.0) {
    vec2 d = (uv - w.xy) * asp; float L = length(d) + 1e-5; float x = (L - w.z) / 0.035;
    off += (d / L) / asp * exp(-x * x) * w.w * sin(x * 1.6) * 0.022; } }
  uv -= off;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  float d = length((uv - lamp.xy) * asp);
  c *= mix(1.0 - 0.12 * lampAmt, 1.0 + 0.1 * lampAmt, smoothstep(lamp.z, 0.0, d));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l) * vec3(1.02, 0.98, 0.92), gray);
  c += flashCol * flash;
  outputColor = vec4(c, inputColor.a);
}`, { uniforms: new Map([
      ["waves", new V.Uniform([new V.Vector4(), new V.Vector4(), new V.Vector4(), new V.Vector4()])],
      ["asp", new V.Uniform(new V.Vector2(1, 1))], ["flash", new V.Uniform(0)], ["flashCol", new V.Uniform(new V.Color(1, 1, 1))],
      ["gray", new V.Uniform(0)], ["lamp", new V.Uniform(new V.Vector3(0.5, 0.5, 0.3))], ["lampAmt", new V.Uniform(1)],
    ]) });
  }
}
class ChromaFX extends V.Effect {
  constructor() {
    super("ChromaFX", `
uniform float ca;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = (uv - 0.5) * ca * 0.012;
  outputColor = vec4(texture2D(inputBuffer, uv + dir).r, inputColor.g, texture2D(inputBuffer, uv - dir).b, inputColor.a);
}`, { attributes: V.EffectAttribute.CONVOLUTION, uniforms: new Map([["ca", new V.Uniform(0)]]) });
  }
}

const hex = (h, k = 1) => { const c = new V.Color(h); return [c.r * k, c.g * k, c.b * k]; };

export function createFx(canvas, source, { reduced, quality = null, onFail = () => {}, onQuality = () => {} }) {
  const renderer = new V.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: false, powerPreference: "default" });
  renderer.setClearColor(0x110c0a, 1);
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); onFail(); });
  const scene = new V.Scene();
  const camera = new V.OrthographicCamera(0, 1, 0, 1, -10, 10); // left, right, top, bottom: y down
  const srcTex = new V.CanvasTexture(source);
  srcTex.colorSpace = V.SRGBColorSpace; srcTex.minFilter = V.LinearFilter; srcTex.generateMipmaps = false;
  const bg = new V.Mesh(new V.PlaneGeometry(1, 1), new V.MeshBasicMaterial({ map: srcTex, side: V.DoubleSide, toneMapped: false }));
  bg.renderOrder = 0;
  scene.add(bg);
  const glow = new Batch(scene, glowTex(), V.AdditiveBlending, MAX_GLOW, 3);
  const chips = new Batch(scene, chipTex(), V.NormalBlending, MAX_SOLID, 2);
  const paper = new Batch(scene, paperTex(), V.NormalBlending, MAX_SOLID, 1);

  const composer = new V.EffectComposer(renderer, { frameBufferType: V.HalfFloatType });
  composer.addPass(new V.RenderPass(scene, camera));
  const fxA = new ChompFX(), fxB = new ChromaFX();
  const passA = new V.EffectPass(camera, fxA), passB = new V.EffectPass(camera, fxB);
  composer.addPass(passA); composer.addPass(passB);
  const bloom = new V.BloomEffect({ intensity: 0.75, luminanceThreshold: 0.98, luminanceSmoothing: 0.12, mipmapBlur: true, radius: 0.6 });
  const bloomPass = new V.EffectPass(camera, bloom, new V.VignetteEffect({ offset: 0.38, darkness: 0.45 }));
  const plainPass = new V.EffectPass(camera, new V.VignetteEffect({ offset: 0.38, darkness: 0.45 }));
  let finalPass = null;
  function useBloom(on) {
    const want = on ? bloomPass : plainPass;
    if (finalPass === want) return;
    if (finalPass) composer.removePass(finalPass);
    composer.addPass(want);
    passA.renderToScreen = passB.renderToScreen = false; want.renderToScreen = true;
    finalPass = want;
  }

  const fixedQ = quality ? Math.max(1, Math.min(3, Number(quality))) : null;
  let q = fixedQ || 3, W = 1, H = 1;
  const parts = [], waves = [];
  let srcW = 0, srcH = 0; // the 2D canvas's size at the texture's last allocation
  let flash = 0, flashCol = [1, 1, 1], ca = 0, grayHit = 0, shake = 0, bloomKick = 0, lastNow = null, slowFor = 0, ema = 16, frames = 0;

  function dpr() { return Math.min(window.devicePixelRatio || 1, QUALITY_DPR[q]); }
  function resize(w, h) {
    W = w; H = h;
    renderer.setPixelRatio(dpr());
    renderer.setSize(W, H, false);
    canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
    composer.setSize(W, H);
    camera.left = 0; camera.right = W; camera.top = 0; camera.bottom = H; camera.updateProjectionMatrix();
    bg.position.set(W / 2, H / 2, 0); bg.scale.set(W, -H, 1); // the texture's top row is the screen's top
    fxA.uniforms.get("asp").value.set(W / H, 1);
    useBloom(q >= 2);
  }
  // judged from a drawn frame to the next animation frame, before the next draw (Junkies Pro's lesson)
  function watch(now) {
    if (lastNow != null) {
      const ms = now - lastNow;
      if (ms < 200) {
        ema += (ms - ema) * 0.05;
        frames++;
        if (frames > 120 && ema > 24) slowFor++; else slowFor = 0;
        if (slowFor > 90 && !fixedQ) {
          slowFor = 0; frames = 0; ema = 16;
          q -= 1;
          if (q <= 0) { onFail(); return false; }
          resize(W, H);
          onQuality();
        }
      }
    }
    lastNow = now;
    return true;
  }

  const rnd = (a, b) => a + Math.random() * (b - a);
  function add(p) { if (parts.length < 900) parts.push({ age: 0, rot: 0, vr: 0, flip: 0, g: 0, drag: 0, s1: p.s0, ...p }); }
  function wave(x, y, strength) { waves.push({ x, y, r: 0, s: strength, age: 0 }); if (waves.length > 4) waves.shift(); }

  // one-off effects at a screen point; T = the tile in CSS px
  function burst(type, x, y, { T = 24, color = "#FFC233", look = [] } = {}) {
    const red = reduced();
    if (type === "chip") {
      for (let i = 0; i < 5; i++) { const a = rnd(0, Math.PI * 2), v = rnd(30, 75); add({ kind: "glow", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s0: T * 0.45, s1: 0, life: 0.35, col: [2.2, 2.0, 1.5], drag: 3 }); }
    } else if (type === "allin") {
      if (!red) wave(x, y, 1);
      flash = 0.35; flashCol = [1.0, 0.55, 0.25]; bloomKick = 0.9;
      for (let i = 0; i < 24; i++) { const a = rnd(0, Math.PI * 2), v = rnd(90, 240); add({ kind: "glow", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s0: T * 0.95, s1: 0, life: rnd(0.4, 0.7), col: i % 2 ? [2.6, 0.9, 0.4] : [2.4, 1.9, 0.6], drag: 2.5 }); }
    } else if (type === "eat") {
      if (!red) wave(x, y, 0.45);
      const col = hex(color);
      for (let i = 0; i < 3; i++) add({ kind: "chip", x, y, vx: rnd(-90, 90), vy: rnd(-170, -90), g: 420, s0: T * 0.55, life: rnd(0.75, 0.95), rot: rnd(0, 6), vr: rnd(-9, 9), flip: rnd(8, 14), col });
      for (let i = 0; i < 8; i++) { const a = rnd(0, Math.PI * 2), v = rnd(50, 120); add({ kind: "glow", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s0: T * 0.4, s1: 0, life: 0.45, col: [2.2, 2.0, 1.6], drag: 3 }); }
    } else if (type === "caught") {
      if (!red) shake = 4;
      ca = 1; grayHit = 0.6;
    } else if (type === "jokerTaken") {
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; add({ kind: "glow", x: x + Math.cos(a) * T * 0.8, y: y + Math.sin(a) * T * 0.8, vx: -Math.sin(a) * 90, vy: Math.cos(a) * 90 - 20, s0: T * 0.5, s1: 0, life: 0.7, col: [2.4, 1.9, 0.5], drag: 1 }); }
    } else if (type === "clear") {
      const n = red ? 35 : 70, cols = [...look, "#FFC233", "#E2412E", "#FFF4DC", "#2F6BD6"].map((h) => hex(h));
      for (let i = 0; i < n; i++) add({ kind: "paper", x: rnd(0, W), y: rnd(-0.3 * H, 0), vx: rnd(-30, 30), vy: rnd(60, 120), g: 30, s0: T * rnd(0.36, 0.56), life: rnd(1.8, 2.4), rot: rnd(0, 6), vr: rnd(-4, 4), flip: rnd(6, 11), col: cols[i % cols.length], sway: rnd(0, 6) });
    }
  }

  // info: { now, T, chips: [x, y, ...], allIns: [x, y, ...], jokerFelt: [x, y] | null, held: [x, y] | null,
  //         lamp: [x, y], gray } (CSS px)
  function frame(info) {
    if (!watch(info.now)) return;
    const dt = Math.min(0.05, info.dt || 1 / 60), T = info.T, t = info.now / 1000;
    // three.js allocates a texture once, at its image's size on the first upload, and later uploads only fill it.
    // A new canvas size (a window resize, a quality step) needs a new texture, or the board shows shrunk in a
    // corner over the stale one (Nir's phone, 2026-10-20).
    if (source.width !== srcW || source.height !== srcH) { srcTex.dispose(); srcW = source.width; srcH = source.height; }
    srcTex.needsUpdate = true;
    glow.begin(); chips.begin(); paper.begin();
    // the always-on glows: chips, ALL IN halos, the felt joker, the held-joker ring
    const c = info.chips;
    for (let i = 0; i < c.length; i += 2) glow.quad(c[i], c[i + 1], T * 0.55, T * 0.55, 0, 0.32, 0.29, 0.22);
    const a = info.allIns, ap = 0.6 + 0.4 * Math.sin(t * Math.PI * 2.4);
    for (let i = 0; i < a.length; i += 2) glow.quad(a[i], a[i + 1], T * 1.5, T * 1.5, 0, 1.1 * ap, 0.45 * ap, 0.18 * ap);
    if (info.jokerFelt) glow.quad(info.jokerFelt[0], info.jokerFelt[1], T * 1.6, T * 1.6, 0, 1.0, 0.8, 0.3);
    if (info.held) { const hp = 0.7 + 0.3 * Math.sin(t * Math.PI * 2.4); glow.quad(info.held[0], info.held[1] + T * 0.62, T * 1.9, T * 0.8, 0, 1.3 * hp, 1.0 * hp, 0.3 * hp); }
    // particles: keep moving while they fade (nothing comes to rest)
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      const k = p.age / p.life;
      p.vy += p.g * dt;
      const dmp = 1 - Math.min(1, p.drag * dt);
      p.vx *= dmp; p.vy *= dmp;
      p.x += (p.vx + (p.sway ? Math.sin(p.age * 3 + p.sway) * 25 : 0)) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === "glow") {
        const s = p.s0 + (p.s1 - p.s0) * k, f = 1 - k;
        glow.quad(p.x, p.y, s, s, 0, p.col[0] * f, p.col[1] * f, p.col[2] * f);
      } else {
        const shrink = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1, s = p.s0 * shrink, fx = Math.max(0.15, Math.abs(Math.cos(p.age * p.flip)));
        (p.kind === "chip" ? chips : paper).quad(p.x, p.y, s * fx, p.kind === "paper" ? s * 0.6 : s, p.rot, p.col[0], p.col[1], p.col[2]);
      }
    }
    glow.end(); chips.end(); paper.end();
    // post
    const u = fxA.uniforms, arr = u.get("waves").value;
    for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; w.age += dt; w.r += dt * 0.9; if (w.age > 0.9) waves.splice(i, 1); }
    for (let i = 0; i < 4; i++) {
      const w = waves[i];
      if (!w) { arr[i].set(0, 0, 0, 0); continue; }
      arr[i].set(w.x / W, 1 - w.y / H, w.r, w.s * (1 - w.age / 0.9));
    }
    flash *= Math.exp(-dt / 0.12); ca *= Math.exp(-dt / 0.3); grayHit *= Math.exp(-dt / 0.35); shake *= Math.exp(-dt / 0.2); bloomKick *= Math.exp(-dt / 0.3);
    u.get("flash").value = flash;
    u.get("flashCol").value.setRGB(flashCol[0], flashCol[1], flashCol[2]);
    u.get("gray").value = Math.min(1, Math.max(info.gray || 0, grayHit));
    u.get("lamp").value.set(info.lamp[0] / W, 1 - info.lamp[1] / H, (T * 6) / H);
    fxB.uniforms.get("ca").value = ca;
    passB.enabled = ca > 0.01;
    bloom.intensity = 0.75 + bloomKick;
    const sx = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake : 0, sy = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake : 0;
    camera.left = sx; camera.right = W + sx; camera.top = sy; camera.bottom = H + sy; camera.updateProjectionMatrix();
    composer.render(dt);
  }

  function dispose() {
    try { composer.dispose(); renderer.dispose(); } catch { /* already gone */ }
  }

  return { frame, burst, resize, dpr, dispose, quality: () => q };
}
