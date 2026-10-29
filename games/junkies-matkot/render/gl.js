// WebGL2: one instanced quad batch for the scene (backdrop, court, rope, paddles, ball, heads), then a
// tiered post chain on top of it (G10): trail feedback (ping-pong fade-and-redraw) -> half-res bloom
// (bright-pass + a cheap blur) -> composite (chromatic aberration + heat ripple, both skippable per fx
// tier/reduce-motion). High runs the full chain; Mid skips the blur pass and the ripple; Low renders
// the scene straight to the screen, no post chain at all -- the same Low path a WebGL1-only context
// uses (G11: no Canvas2D fallback to test separately). A context-loss listener pauses play and rebuilds
// every GL resource (programs, buffers, the atlas texture, the FBOs) on restore.
//
// THE-1119 M1: the beach world (sky/sun/tower/sea/sand/rope, 13 layers) is too detailed for the
// 96-instance quad batch and has no gradients in SCENE_FRAG, so it's painted once per resize with
// Canvas2D (render/backdrop.js) and uploaded as a single full-bleed texture (`setBackground`),
// drawn as its own fullscreen pass before the instanced batch. The batch itself only carries the
// dynamic pieces (paddles, heads, ball) -- well under the cap.
const SCENE_VERT_300 = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec2 aPos;
layout(location=2) in vec2 aSize;
layout(location=3) in vec4 aColor;
layout(location=4) in float aShape;
layout(location=5) in vec4 aUv;
layout(location=6) in float aUseTex;
layout(location=7) in float aRotation;
uniform vec2 uResolution;
out vec2 vCorner;
out vec4 vColor;
out float vShape;
out vec2 vUv;
out float vUseTex;
void main() {
  vec2 local = aCorner * aSize;
  float c = cos(aRotation), s = sin(aRotation);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 px = aPos + rotated;
  vec2 ndc = (px / uResolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vCorner = aCorner; vColor = aColor; vShape = aShape;
  vUv = aUv.xy + (aCorner + 0.5) * (aUv.zw - aUv.xy);
  vUseTex = aUseTex;
}`;

const SCENE_FRAG_300 = `#version 300 es
precision mediump float;
in vec2 vCorner; in vec4 vColor; in float vShape; in vec2 vUv; in float vUseTex;
uniform sampler2D uAtlas;
out vec4 outColor;
void main() {
  if (vShape > 0.5 && length(vCorner) > 0.5) discard;
  if (vUseTex > 0.5) { vec4 tex = texture(uAtlas, vUv); outColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a); }
  else { outColor = vColor; }
}`;

// Fullscreen-quad passes share one vertex shader (a single big triangle covering the viewport).
const FS_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const BG_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uBg; out vec4 outColor;
void main() { outColor = texture(uBg, vec2(vUv.x, 1.0 - vUv.y)); }`;

const FADE_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uSrc; uniform float uDecay; out vec4 outColor;
void main() { outColor = texture(uSrc, vUv) * uDecay; }`;

const BRIGHT_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uSrc; out vec4 outColor;
void main() {
  // threshold 0.8, knee 0.1 (DESIGN.md/recipe.js POST.bloom, erratum THE-1110): lit sand #F0B489 is
  // 0.757 luma (Rec.601) and must stay under this or the whole court glows -- only the sun (0.90),
  // the glint (0.83), the fire core and flashes should cross it.
  vec4 c = texture(uSrc, vUv);
  float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float k = smoothstep(0.8, 0.9, lum);
  outColor = vec4(c.rgb * k, c.a * k);
}`;

const BLUR_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv; uniform sampler2D uSrc; uniform vec2 uTexel; out vec4 outColor;
void main() {
  vec4 sum = texture(uSrc, vUv) * 0.4;
  sum += texture(uSrc, vUv + uTexel * vec2(1.5, 0.0)) * 0.15;
  sum += texture(uSrc, vUv - uTexel * vec2(1.5, 0.0)) * 0.15;
  sum += texture(uSrc, vUv + uTexel * vec2(0.0, 1.5)) * 0.15;
  sum += texture(uSrc, vUv - uTexel * vec2(0.0, 1.5)) * 0.15;
  outColor = sum;
}`;

const COMPOSITE_FRAG = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uBase; uniform sampler2D uBloom;
uniform float uChromaticPx; uniform vec2 uTexel; uniform float uRippleAmount; uniform float uTime;
uniform float uBloomIntensity;
out vec4 outColor;
void main() {
  vec2 uv = vUv;
  if (uRippleAmount > 0.0) {
    float d = sin(uv.y * 40.0 + uTime * 4.0) * uRippleAmount * 0.003;
    uv.x += d;
  }
  vec2 off = vec2(uChromaticPx, 0.0) * uTexel;
  float r = texture(uBase, uv + off).r;
  float g = texture(uBase, uv).g;
  float b = texture(uBase, uv - off).b;
  float a = texture(uBase, uv).a;
  vec3 bloom = texture(uBloom, uv).rgb * uBloomIntensity;
  outColor = vec4(vec3(r, g, b) + bloom, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error("shader compile failed: " + log);
  }
  return sh;
}
function link(gl, vertSrc, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("program link failed: " + gl.getProgramInfoLog(p));
  return p;
}

const MAX_INSTANCES = 96;
const FLOATS_PER_INSTANCE = 2 + 2 + 4 + 1 + 4 + 1 + 1; // pos, size, color, shape, uv, useTex, rotation

// Bloom intensity (recipe.js POST.bloom.intensity): 0.25 high, 0.2 mid, 0 low (low skips the chain).
function bloomIntensityFor(tier) { return tier === "high" ? 0.25 : tier === "mid" ? 0.2 : 0; }

function makeFbo(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

// The WebGL2 renderer: full tiered post chain. Returns null if webgl2 is unavailable so the caller
// (createRenderer below) falls back to the WebGL1 Low-only path.
function createRenderer2(canvas) {
  let gl = canvas.getContext("webgl2");
  if (!gl) return null;

  let res = {}; // rebuilt by build(); read by render()/resize()
  let tier = "high";
  let contextLost = false;
  let onRestore = null;

  function build() {
    const sceneProg = link(gl, SCENE_VERT_300, SCENE_FRAG_300);
    const bgProg = link(gl, FS_VERT, BG_FRAG);
    const fadeProg = link(gl, FS_VERT, FADE_FRAG);
    const brightProg = link(gl, FS_VERT, BRIGHT_FRAG);
    const blurProg = link(gl, FS_VERT, BLUR_FRAG);
    const compositeProg = link(gl, FS_VERT, COMPOSITE_FRAG);

    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);

    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);

    const sceneVao = gl.createVertexArray();
    gl.bindVertexArray(sceneVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 8); gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 16); gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 32); gl.vertexAttribDivisor(4, 1);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 36); gl.vertexAttribDivisor(5, 1);
    gl.enableVertexAttribArray(6); gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 52); gl.vertexAttribDivisor(6, 1);
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 1, gl.FLOAT, false, stride, 56); gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);

    // -1..1 single triangle covering the viewport (cheaper than a quad, no seam).
    const fsBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const fsVao = gl.createVertexArray();
    gl.bindVertexArray(fsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (res.atlasSource) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, res.atlasSource);

    const bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (res.bgSource) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, res.bgSource);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    res = {
      ...res,
      sceneProg, bgProg, fadeProg, brightProg, blurProg, compositeProg,
      instBuf, sceneVao, fsVao, atlasTex, bgTex,
      uResolution: gl.getUniformLocation(sceneProg, "uResolution"),
      uAtlas: gl.getUniformLocation(sceneProg, "uAtlas"),
      uBg: gl.getUniformLocation(bgProg, "uBg"),
      uFadeSrc: gl.getUniformLocation(fadeProg, "uSrc"), uFadeDecay: gl.getUniformLocation(fadeProg, "uDecay"),
      uBrightSrc: gl.getUniformLocation(brightProg, "uSrc"),
      uBlurSrc: gl.getUniformLocation(blurProg, "uSrc"), uBlurTexel: gl.getUniformLocation(blurProg, "uTexel"),
      uCompBase: gl.getUniformLocation(compositeProg, "uBase"), uCompBloom: gl.getUniformLocation(compositeProg, "uBloom"),
      uCompChroma: gl.getUniformLocation(compositeProg, "uChromaticPx"), uCompTexel: gl.getUniformLocation(compositeProg, "uTexel"),
      uCompRipple: gl.getUniformLocation(compositeProg, "uRippleAmount"), uCompTime: gl.getUniformLocation(compositeProg, "uTime"),
      uCompBloomIntensity: gl.getUniformLocation(compositeProg, "uBloomIntensity"),
      data: new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE),
      trailA: null, trailB: null, bloomA: null, bloomB: null, srcIsA: true,
      w: 0, h: 0,
    };
  }
  build();

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); contextLost = true; });
  canvas.addEventListener("webglcontextrestored", () => { contextLost = false; build(); if (onRestore) onRestore(); });

  function setAtlas(source) {
    res.atlasSource = source;
    if (contextLost) return;
    gl.bindTexture(gl.TEXTURE_2D, res.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  // THE-1119 M1: the full-bleed beach world, pre-painted with Canvas2D (render/backdrop.js) at the
  // current resolution and uploaded whole. Replaces the old flat-rect placeholder.
  function setBackground(source) {
    res.bgSource = source;
    res.bgReady = true;
    if (contextLost) return;
    gl.bindTexture(gl.TEXTURE_2D, res.bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  function resize(w, h) {
    canvas.width = w; canvas.height = h;
    if (contextLost) return;
    if (res.trailA) { gl.deleteFramebuffer(res.trailA.fbo); gl.deleteTexture(res.trailA.tex); }
    if (res.trailB) { gl.deleteFramebuffer(res.trailB.fbo); gl.deleteTexture(res.trailB.tex); }
    if (res.bloomA) { gl.deleteFramebuffer(res.bloomA.fbo); gl.deleteTexture(res.bloomA.tex); }
    if (res.bloomB) { gl.deleteFramebuffer(res.bloomB.fbo); gl.deleteTexture(res.bloomB.tex); }
    res.trailA = makeFbo(gl, w, h);
    res.trailB = makeFbo(gl, w, h);
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    res.bloomA = makeFbo(gl, bw, bh);
    res.bloomB = makeFbo(gl, bw, bh);
    res.w = w; res.h = h;
  }

  function fullscreen(prog, toFbo, setUniforms) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, toFbo ? toFbo.fbo : null);
    gl.viewport(0, 0, toFbo ? toFbo.w : canvas.width, toFbo ? toFbo.h : canvas.height);
    gl.useProgram(prog);
    if (setUniforms) setUniforms();
    gl.bindVertexArray(res.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  // Opaque full-bleed background draw: overwrites whatever was in the target (the previous frame's
  // faded trail, or raw screen) before the dynamic instances blend on top of it.
  function drawBackground(toFbo) {
    if (!res.bgReady) return false;
    gl.disable(gl.BLEND);
    fullscreen(res.bgProg, toFbo, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.bgTex);
      gl.uniform1i(res.uBg, 0);
    });
    gl.enable(gl.BLEND);
    return true;
  }

  function drawScene(instances, clearColor, toFbo) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, toFbo ? toFbo.fbo : null);
    gl.viewport(0, 0, toFbo ? toFbo.w : canvas.width, toFbo ? toFbo.h : canvas.height);
    if (!toFbo && !res.bgReady) { gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    const n = Math.min(instances.length, MAX_INSTANCES);
    const data = res.data;
    for (let i = 0; i < n; i++) {
      const it = instances[i];
      const o = i * FLOATS_PER_INSTANCE;
      data[o] = it.x; data[o + 1] = it.y;
      data[o + 2] = it.w; data[o + 3] = it.h;
      data[o + 4] = it.color[0]; data[o + 5] = it.color[1]; data[o + 6] = it.color[2]; data[o + 7] = it.color[3] ?? 1;
      data[o + 8] = it.shape === "circle" ? 1 : 0;
      const uv = it.uv || [0, 0, 1, 1];
      data[o + 9] = uv[0]; data[o + 10] = uv[1]; data[o + 11] = uv[2]; data[o + 12] = uv[3];
      data[o + 13] = it.uv ? 1 : 0;
      data[o + 14] = it.rotation || 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, res.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * FLOATS_PER_INSTANCE);
    gl.useProgram(res.sceneProg);
    gl.uniform2f(res.uResolution, toFbo ? toFbo.w : canvas.width, toFbo ? toFbo.h : canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.atlasTex);
    gl.uniform1i(res.uAtlas, 0);
    gl.bindVertexArray(res.sceneVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  // instances: see the scene shader comment above. clearColor: [r,g,b] 0-1. effects (optional):
  // { tier: "high"|"mid"|"low", chromaticPx, rippleAmount, timeS, dt }. Falls back to a single direct
  // draw (the old S1/S2 path) with no `effects` or at Low tier.
  function render(instances, clearColor, effects) {
    if (contextLost) return;
    const t = (effects && effects.tier) || tier;
    if (t === "low" || !res.trailA) {
      drawBackground(null);
      drawScene(instances, clearColor, null);
      return;
    }

    if (!res.w) resize(canvas.width, canvas.height);
    const src = res.srcIsA ? res.trailA : res.trailB;
    const dst = res.srcIsA ? res.trailB : res.trailA;
    res.srcIsA = !res.srcIsA;

    // THE-1119 M3: decay^(dt*60) (recipe.js TRAIL.decayPerFrame60 = 0.9), not a constant per-frame
    // value -- so the ball's warm streak keeps the same length regardless of frame rate.
    const dt = (effects && effects.dt) || 1 / 60;
    const decay = Math.pow(0.9, dt * 60);

    // 1) fade the previous trail into the new target, 2) paint the full-bleed background over it
    // (opaque: this is what makes the trail apply only to what's drawn on top, e.g. the ball), then
    // 3) draw this frame's dynamic instances on top of it.
    gl.disable(gl.BLEND);
    fullscreen(res.fadeProg, dst, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(res.uFadeSrc, 0);
      gl.uniform1f(res.uFadeDecay, decay);
    });
    gl.enable(gl.BLEND);
    drawBackground(dst);
    drawScene(instances, clearColor, dst);

    // Bright-pass -> (High only) blur -> bloomB holds the final bloom texture either way. Blending off for
    // both: each must overwrite its FBO. With it on, the bright pass's alpha-0 texels kept the old bloom,
    // so every bright ball frame stayed on the court for good (THE-1111). The composite below blends as
    // before: the canvas is cleared every frame, so it has no history to keep.
    gl.disable(gl.BLEND);
    fullscreen(res.brightProg, res.bloomA, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.tex);
      gl.uniform1i(res.uBrightSrc, 0);
    });
    let bloomTex = res.bloomA.tex;
    if (t === "high") {
      fullscreen(res.blurProg, res.bloomB, () => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.bloomA.tex);
        gl.uniform1i(res.uBlurSrc, 0);
        gl.uniform2f(res.uBlurTexel, 1 / res.bloomA.w, 1 / res.bloomA.h);
      });
      bloomTex = res.bloomB.tex;
    }
    gl.enable(gl.BLEND);

    const chromaticPx = (effects && effects.chromaticPx) || 0;
    const rippleAmount = t === "high" ? (effects && effects.rippleAmount) || 0 : 0;
    fullscreen(res.compositeProg, null, () => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, dst.tex); gl.uniform1i(res.uCompBase, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomTex); gl.uniform1i(res.uCompBloom, 1);
      gl.uniform1f(res.uCompChroma, chromaticPx);
      gl.uniform2f(res.uCompTexel, 1 / canvas.width, 1 / canvas.height);
      gl.uniform1f(res.uCompRipple, rippleAmount);
      gl.uniform1f(res.uCompTime, (effects && effects.timeS) || 0);
      gl.uniform1f(res.uCompBloomIntensity, bloomIntensityFor(t));
    });
  }

  // THE-1123 M7: draws instances straight onto the canvas, on top of whatever render() just produced,
  // bypassing the trail/bloom chain entirely. The main batch (paddles/heads/ball) goes through that
  // chain on purpose (the ball's heat trail), but a burst of 70 fast-moving confetti pieces fed through
  // the same feedback buffer leaves a field of bright comet-tail streaks instead of discrete pieces --
  // not what a confetti moment should look like. bgReady is true by the time this can be called, so
  // drawScene's toFbo=null path skips its clear and just blends on top.
  function renderOverlay(instances) {
    if (contextLost) return;
    drawScene(instances, [0, 0, 0], null);
  }

  return {
    resize, render, renderOverlay, setAtlas, setBackground, gl,
    setTier(t) { tier = t; },
    isWebGL2: true,
    isContextLost: () => contextLost,
    setOnRestore(cb) { onRestore = cb; },
  };
}

// N3/THE-1117: test-only -- ?gl=1 forces the WebGL1 fallback path even on a WebGL2-capable browser,
// so QA can verify the Low tier + the instanced-arrays shader without needing a WebGL2-less device.
// Never set in production.
const forceWebGL1 = new URLSearchParams(location.search).get("gl") === "1";

export function createRenderer(canvas) {
  const r2 = forceWebGL1 ? null : createRenderer2(canvas);
  if (r2) return r2;
  return createRendererLow1(canvas); // WebGL1 -> Low only, no post chain (G11)
}

// --- WebGL1 fallback: the same instanced-quad scene, no post chain. Uses ANGLE_instanced_arrays,
// which every WebGL1-capable device in practice ships (it's required by the WebGL1 conformance
// suite's baseline extension set). GLSL ES 1.00 syntax (attribute/varying, texture2D). ---
const SCENE_VERT_100 = `
attribute vec2 aCorner; attribute vec2 aPos; attribute vec2 aSize; attribute vec4 aColor;
attribute float aShape; attribute vec4 aUv; attribute float aUseTex; attribute float aRotation;
uniform vec2 uResolution;
varying vec2 vCorner; varying vec4 vColor; varying float vShape; varying vec2 vUv; varying float vUseTex;
void main() {
  vec2 local = aCorner * aSize;
  float c = cos(aRotation), s = sin(aRotation);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 px = aPos + rotated;
  vec2 ndc = (px / uResolution) * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
  vCorner = aCorner; vColor = aColor; vShape = aShape;
  vUv = aUv.xy + (aCorner + 0.5) * (aUv.zw - aUv.xy);
  vUseTex = aUseTex;
}`;
const SCENE_FRAG_100 = `
precision mediump float;
varying vec2 vCorner; varying vec4 vColor; varying float vShape; varying vec2 vUv; varying float vUseTex;
uniform sampler2D uAtlas;
void main() {
  if (vShape > 0.5 && length(vCorner) > 0.5) discard;
  if (vUseTex > 0.5) { vec4 tex = texture2D(uAtlas, vUv); gl_FragColor = vec4(tex.rgb * vColor.rgb, tex.a * vColor.a); }
  else { gl_FragColor = vColor; }
}`;
const BG_VERT_100 = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const BG_FRAG_100 = `
precision mediump float;
varying vec2 vUv; uniform sampler2D uBg;
void main() { gl_FragColor = texture2D(uBg, vec2(vUv.x, 1.0 - vUv.y)); }`;

function createRendererLow1(canvas) {
  const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) return null;
  const ext = gl.getExtension("ANGLE_instanced_arrays");
  if (!ext) return null; // no realistic device lacks this; nothing left to fall back to

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, SCENE_VERT_100));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, SCENE_FRAG_100));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("program link failed: " + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const loc = (name) => gl.getAttribLocation(prog, name);
  const aCorner = loc("aCorner"), aPos = loc("aPos"), aSize = loc("aSize"), aColor = loc("aColor"), aShape = loc("aShape"), aUv = loc("aUv"), aUseTex = loc("aUseTex"), aRotation = loc("aRotation");
  const uResolution = gl.getUniformLocation(prog, "uResolution");
  const uAtlas = gl.getUniformLocation(prog, "uAtlas");

  const bgProg = gl.createProgram();
  gl.attachShader(bgProg, compile(gl, gl.VERTEX_SHADER, BG_VERT_100));
  gl.attachShader(bgProg, compile(gl, gl.FRAGMENT_SHADER, BG_FRAG_100));
  gl.linkProgram(bgProg);
  const bgAPos = gl.getAttribLocation(bgProg, "aPos");
  const uBg = gl.getUniformLocation(bgProg, "uBg");
  const fsBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const atlasTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  function setAtlas(source) {
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  const bgTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bgTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let bgReady = false;
  function setBackground(source) {
    bgReady = true;
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  const quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);
  const data = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  function resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }

  function drawInstances(instances) {
    const n = Math.min(instances.length, MAX_INSTANCES);
    for (let i = 0; i < n; i++) {
      const it = instances[i];
      const o = i * FLOATS_PER_INSTANCE;
      data[o] = it.x; data[o + 1] = it.y;
      data[o + 2] = it.w; data[o + 3] = it.h;
      data[o + 4] = it.color[0]; data[o + 5] = it.color[1]; data[o + 6] = it.color[2]; data[o + 7] = it.color[3] ?? 1;
      data[o + 8] = it.shape === "circle" ? 1 : 0;
      const uv = it.uv || [0, 0, 1, 1];
      data[o + 9] = uv[0]; data[o + 10] = uv[1]; data[o + 11] = uv[2]; data[o + 12] = uv[3];
      data[o + 13] = it.uv ? 1 : 0;
      data[o + 14] = it.rotation || 0;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
    ext.vertexAttribDivisorANGLE(aCorner, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * FLOATS_PER_INSTANCE));
    const stride = FLOATS_PER_INSTANCE * 4;
    for (const [attr, size, offset] of [[aPos, 2, 0], [aSize, 2, 8], [aColor, 4, 16], [aShape, 1, 32], [aUv, 4, 36], [aUseTex, 1, 52], [aRotation, 1, 56]]) {
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, size, gl.FLOAT, false, stride, offset);
      ext.vertexAttribDivisorANGLE(attr, 1);
    }

    gl.useProgram(prog);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(uAtlas, 0);
    ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, n);
  }

  function render(instances, clearColor) {
    if (bgReady) {
      gl.disable(gl.BLEND);
      gl.useProgram(bgProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, fsBuf);
      gl.enableVertexAttribArray(bgAPos);
      gl.vertexAttribPointer(bgAPos, 2, gl.FLOAT, false, 0, 0);
      ext.vertexAttribDivisorANGLE(bgAPos, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.uniform1i(uBg, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND);
    } else {
      gl.clearColor(clearColor[0], clearColor[1], clearColor[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    drawInstances(instances);
  }

  // THE-1123 M7: no FBO/trail chain exists on this path at all (comment at the top of this file), so
  // instances drawn here already land straight on the canvas with no feedback streaking. Kept as its
  // own entry point purely so game.js can call one `renderOverlay` name on either renderer.
  function renderOverlay(instances) { drawInstances(instances); }

  return {
    resize, render, renderOverlay, setAtlas, setBackground, gl,
    setTier() {}, // always Low
    isWebGL2: false,
    isContextLost: () => false,
    setOnRestore() {},
  };
}
