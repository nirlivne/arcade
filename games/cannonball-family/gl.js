// WebGL 1 compositor (THE-523 S4; spec v2 §G1-G3, §G8). Hand-written, no libraries. Each frame the 2D scene
// (render.js's draw(), backdrop included - §G4's GL-native backdrop textures are a later pass, not in this
// slice) is uploaded as a texture and drawn through a full-screen post-process pass: shockwave rings,
// chromatic aberration, an additive clear flash, film grain and a vignette, every number read straight from
// the chapter palette (CBF.CHAPTERS) or the triggers fed in by fx.js (a later slice; for now game.js feeds
// the same handful of trigger events directly - see postTrigger() below).
//
// Render only: nothing here reads or writes the sim. If WebGL isn't available, or the context is lost, ok is
// false and the caller shows the 2D canvas directly (spec G2) - the game stays fully playable either way.

// v_uv is top-down (v = 0 at the top edge), matching the canvas texture's row order (uploaded without
// UNPACK_FLIP_Y) and the ring centres game.js passes in. a_pos.y = +1 is the top of clip space, hence the flip.
const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_scene;
uniform vec2 u_resolution;
uniform vec3 u_ring0; uniform float u_ringAmp0;
uniform vec3 u_ring1; uniform float u_ringAmp1;
uniform vec3 u_ring2; uniform float u_ringAmp2;
uniform vec3 u_ring3; uniform float u_ringAmp3;
uniform float u_ca;
uniform float u_flash;
uniform vec3 u_flashColor;
uniform float u_grain;
uniform float u_grainSeed;
uniform float u_vignette;
uniform vec3 u_gradeColor;
uniform float u_gradeAmp;
uniform float u_gradeMode; // 0 none, 1 soft-light (sunset), 2 multiply (night)
varying vec2 v_uv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

vec2 ringOffset(vec3 ring, float amp, vec2 uv, float aspect, inout float rim) {
  if (amp <= 0.0) return vec2(0.0);
  vec2 d = uv - ring.xy;
  d.x *= aspect;
  float dist = length(d);
  float distFromRing = abs(dist - ring.z);
  float mask = smoothstep(0.06, 0.0, distFromRing) * amp;
  vec2 dir = dist > 0.0001 ? d / dist : vec2(0.0);
  rim += mask * 0.08;
  vec2 off = dir * mask * 0.012;
  off.x /= aspect;
  return off;
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  float rim = 0.0;
  vec2 offset = vec2(0.0);
  offset += ringOffset(u_ring0, u_ringAmp0, uv, aspect, rim);
  offset += ringOffset(u_ring1, u_ringAmp1, uv, aspect, rim);
  offset += ringOffset(u_ring2, u_ringAmp2, uv, aspect, rim);
  offset += ringOffset(u_ring3, u_ringAmp3, uv, aspect, rim);

  vec2 toCenter = uv - vec2(0.5);
  toCenter.x *= aspect;
  float distFromCenter = length(toCenter);
  float halfDiag = length(vec2(0.5 * aspect, 0.5));
  vec2 caDir = distFromCenter > 0.0001 ? toCenter / distFromCenter : vec2(0.0);
  float caUV = (u_ca * 1.5 / u_resolution.y) * (distFromCenter / halfDiag);
  vec2 caOff = caDir * caUV;
  caOff.x /= aspect;

  vec3 col;
  col.r = texture2D(u_scene, uv + offset + caOff).r;
  col.g = texture2D(u_scene, uv + offset).g;
  col.b = texture2D(u_scene, uv + offset - caOff).b;

  col += vec3(1.0, 0.957, 0.878) * rim; // cream rim, additive

  col += u_flashColor * u_flash;

  if (u_gradeMode > 0.5 && u_gradeMode < 1.5) {
    col = mix(col, col * col + 2.0 * col * u_gradeColor * (1.0 - col), u_gradeAmp);
  } else if (u_gradeMode >= 1.5) {
    col = mix(col, col * u_gradeColor, u_gradeAmp);
  }

  float vigT = smoothstep(0.45, 0.62, distFromCenter / halfDiag);
  col *= mix(1.0, 1.0 - u_vignette, vigT);

  float g = (hash(uv * u_resolution.xy + u_grainSeed) - 0.5) * 2.0 * u_grain;
  col += vec3(g);

  gl_FragColor = vec4(col, 1.0);
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

function hexToRgb01(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// DPR cap (spec G8): 2, or 1.5 under a 900 CSS-px-wide viewport.
export function dprFor(cssW) {
  const base = Math.min(window.devicePixelRatio || 1, cssW < 900 ? 1.5 : 2);
  return base;
}

// canvas: the visible GL <canvas>. sceneCanvas: the existing offscreen/onscreen 2D canvas render.js draws to;
// its pixels are uploaded as the scene texture every frame. Returns { ok, ... } - ok is false the moment GL
// isn't usable (missing support, or context lost), and the caller shows sceneCanvas directly instead (G2).
export function createCompositor(canvas, sceneCanvas) {
  const state = { ok: false, gl: null, lost: false };
  let gl, prog, posBuf, sceneTex, uniforms = {};

  function init() {
    gl = canvas.getContext("webgl", { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) { state.ok = false; return; }
    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("program link failed: " + gl.getProgramInfoLog(prog));
      posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      sceneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const names = ["u_scene", "u_resolution", "u_ring0", "u_ringAmp0", "u_ring1", "u_ringAmp1", "u_ring2", "u_ringAmp2",
        "u_ring3", "u_ringAmp3", "u_ca", "u_flash", "u_flashColor", "u_grain", "u_grainSeed", "u_vignette",
        "u_gradeColor", "u_gradeAmp", "u_gradeMode"];
      uniforms = {};
      for (const n of names) uniforms[n] = gl.getUniformLocation(prog, n);
      state.ok = true;
      state.lost = false;
    } catch (e) {
      state.ok = false;
    }
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    state.ok = false;
    state.lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    init();
  });

  init();

  // Resizes the GL canvas's drawing buffer to match the CSS box, at the capped DPR (spec G8).
  function resize(cssW, cssH) {
    if (!state.ok) return;
    const dpr = dprFor(cssW);
    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  // post: { rings: [{x,y,r,amp}] (screen-space 0-1 uv, up to 4), ca, flash, grainSeed, chapter (the
  // CBF.CHAPTERS entry, for grain/vignette/flash colour/grade), neutral (test-only, CTO review on THE-561 B3:
  // zeroes grain/vignette/grade regardless of chapter, so the S4 parity test can compare the GL and 2D-fallback
  // paths' geometry alone - the fallback path never applies tone at all, so this is what "matching" means for
  // it). Uploads sceneCanvas and draws the post pass.
  function render(post) {
    if (!state.ok) return;
    const cssW = canvas.clientWidth || canvas.width, cssH = canvas.clientHeight || canvas.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    const posLoc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneCanvas);
    gl.uniform1i(uniforms.u_scene, 0);
    gl.uniform2f(uniforms.u_resolution, cssW, cssH);

    const rings = post.rings || [];
    const ringUniforms = ["u_ring0", "u_ring1", "u_ring2", "u_ring3"];
    const ampUniforms = ["u_ringAmp0", "u_ringAmp1", "u_ringAmp2", "u_ringAmp3"];
    for (let i = 0; i < 4; i++) {
      const r = rings[i];
      gl.uniform3f(uniforms[ringUniforms[i]], r ? r.x : 0, r ? r.y : 0, r ? r.r : 0);
      gl.uniform1f(uniforms[ampUniforms[i]], r ? r.amp : 0);
    }
    gl.uniform1f(uniforms.u_ca, post.ca || 0);
    gl.uniform1f(uniforms.u_flash, post.flash || 0);
    const flashCol = hexToRgb01(post.chapter?.flash || "#FFE6B0");
    gl.uniform3f(uniforms.u_flashColor, flashCol[0], flashCol[1], flashCol[2]);
    const grade = post.neutral ? null : post.chapter?.grade;
    gl.uniform1f(uniforms.u_grain, post.neutral ? 0 : post.chapter?.grain ?? 0.012);
    gl.uniform1f(uniforms.u_grainSeed, post.grainSeed || Math.random() * 1000);
    gl.uniform1f(uniforms.u_vignette, post.neutral ? 0 : post.chapter?.vignette ?? 0.35);
    const gradeCol = hexToRgb01(grade?.col || "#000000");
    gl.uniform3f(uniforms.u_gradeColor, gradeCol[0], gradeCol[1], gradeCol[2]);
    gl.uniform1f(uniforms.u_gradeAmp, grade?.a || 0);
    gl.uniform1f(uniforms.u_gradeMode, !grade ? 0 : grade.mode === "soft-light" ? 1 : 2);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return { state, resize, render };
}
