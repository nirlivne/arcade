// Junkies Matkot beach recipe (THE-1107): every number the WebGL layer needs, in one data module.
// Copy it to games/junkies-matkot/render/recipe.js (or type the values in) and read the colours from tokens.css
// where you can; the hex values here are the same tokens. DESIGN.md §4 explains each block.
// Units: "u" = court units (court 1600 x 900 u, spec §2); "px" = CSS px; times in ms; alpha 0..1.
// Caps marked G12 are hard limits: never exceed them, whatever the tier.

export const COLORS = {
  skyTop: '#3B1F5E', skyMid: '#C8436A', skyLow: '#FFAA4C',  // stops at 0, 0.55, 1 of the sky band
  sun: '#FFE7A1', sunTop: '#FFF3C4', sunRim: '#FFC25A',      // disc gradient top -> bottom
  sunHalo: '#FFD68C',                                        // additive halo, alpha 0.75 at 0.6 r -> 0 at 4.5 r
  sunBands: '#C8436A',                                       // 3 heat bands across the disc, alpha 0.35
  glint: '#FFD27A',
  sea: '#1F4C7A', seaDeep: '#173A63',                        // deep at the horizon -> sea at the foam line
  foam: '#FFF4E0',
  sandWet: '#C9876C', sand: '#F0B489', sandMid: '#E7A584', sandShade: '#C47E7C', // stops 0, 0.08, 0.55, 1 (foam -> rope)
  sandPool: '#FFE2A0',                                       // the sun's light pool on the sand, alpha 0.35 centre -> 0
  shadow: '#4A2E6B',                                         // every long shadow
  tower: '#4A2147', towerWindow: '#FFD68C', rescue: '#E8402F', cream: '#FFF6E2', plum: '#2A1638',
  hotels: '#5C285A',                                         // far-left/right skyline, alpha 0.55
  p1: '#0FA3B1', p2: '#E8457C',
  wood: '#C98B4E', woodHi: '#F2C489', woodLo: '#8F5A33', grip: '#8A5A2E', rimLight: '#FFECBE',
  ball: '#FFF6D6', ballCore: '#FFFFFF', ballRim: '#F2D9A6',
  heat: [ // G5: index = heat level (0 rest, 1 = rally 8, 2 = rally 12)
    { core: '#FFE7A8', edge: null /* the hitter's colour */, ballMid: '#FFF6D6', ballRim: '#F2D9A6' },
    { core: '#FFB45A', edge: '#FF8A2E', ballMid: '#FFE9B0', ballRim: '#FFB45A' },
    { core: '#FFF2C0', edge: '#FF5A1F', ballMid: '#FFE08A', ballRim: '#FF8A2E', glow: '#FF8C32' },
  ],
  guestTint: '#6FA8DC',                                      // no eyes-closed frame: cool wash (18 %)
  faceFlash: '#FFF4D8',
  confetti: ['#0FA3B1', '#E8457C', '#FFC25A', '#FFF6E2', '#E8402F'],
};

// Screen layout (spec §6, Δ7). Returns CSS px. The game sets --jm-court-l/-r/-t/-b on .jm-app from this.
export function courtLayout(W, H, safe = { l: 0, r: 0, t: 0, b: 0 }) {
  const m = Math.max(0.08 * W, Math.max(safe.l, safe.r) + 16);
  const ch = Math.min(0.8 * H, (W - 2 * m) * 9 / 16), cw = ch * 16 / 9;
  const b = H - 0.05 * H, t = b - ch, l = (W - cw) / 2;
  const k = ch / 900; // px per court unit
  const horizon = t * 0.58; // sky above, sea from here to the foam line (= court top)
  return { W, H, l, r: l + cw, t, b, cw, ch, k, horizon, sunX: W / 2, sunR: horizon * 0.8, rope: 0.05 * H,
    guideX: (l - 0.1044 * ch) / 2 }; // first-match guides: centre of the free sand outside the head's reach
}

export const WORLD = {
  sky: { stops: [0, 0.55, 1] },
  sun: { rOfHorizon: 0.8, cyOffsetR: 0.15, bands: 3, bandAlpha: 0.35, haloOfR: [0.6, 4.5] }, // centre at horizon + 0.15 r: it sits in the sea
  tower: { heightOfHorizon: 0.9, baseOffsetOfHorizon: 0.033 },          // back-lit, top centre, in front of the sun (signature)
  clouds: { n: 6, alpha: 0.35, color: '#FFBE96', yBand: [0.25, 0.7] },   // thin streaks in the sky band
  glint: { streaks: 70, alpha: [0.35, 0.85], spreadOfSunR: [0.18, 1.65], sparkleHz: 1.4 },
  // The sun's path: streaks spread wider toward the foam; each streak's alpha sparkles on its own phase.
  foam: { ampU: 3.5, waveLenU: 36, breatheHz: 0.35, lineU: 5, washU: 12, washAlpha: 0.35,
    burst: { droplets: 22, radiusU: [2, 6], spreadU: [11, 55], ms: 400 } },        // top-wall bounce
  heelLine: { dashU: 38, gapU: 0, widthU: [4, 6], shadowAlpha: 0.28, lightAlpha: 0.45 }, // half-court groove
  rope: { floatStepU: 47, floatRxU: 15, floatRyU: 8.5, sagU: 6, bobU: 9, bobMs: 500, bobFloats: 3, stakeEvery: 8 },
  sand: { grainPer1000px2: 4.2, grainAlpha: [0.16, 0.10], footprints: 18, footprintAlpha: 0.22,
    shimmer: { amp: 0.003, cyclesPerCourtH: 3, hz: 0.6, band: [0.65, 1] } }, // High only, nice-to-have #2 (spec §9)
};

// Head on a matka (spec §7, brief §5). The capsule (220 x 72 u) is invisible; the art is placed from it.
export const HEAD = {
  discU: 220,                // matka disc diameter = capsule length; 76 px at 844x390 (19.5 % H)
  discCenterXU: 16,          // left player; right = 1600 - 16. The disc's court-side rim lands on the capsule front face (x 126)
  headScale: 1.08,           // face cut-out height = 1.08 x disc, nudged up 5 % of the disc
  headOffsetY: -0.05,
  rimW: 0.06,                // player-colour rim, x disc
  dieCut: 0.018,             // plum die-cut around the face, x disc (4 offset copies, or one SDF dilate)
  plumRing: 0.015,           // plum ring outside the rim
  rimLight: { from: -149, to: -32, w: 0.02, alpha: 0.9 },      // degrees, the sun-side (top) arc
  faceRimGlow: { color: '#FFD889', alpha: 0.85, offsetY: -0.02, blur: 0.01 }, // golden rim light behind the face
  grip: { angleDeg: 49, lenOfR: 0.62, wOfR: 0.2, bands: 3 },  // points down and out of court (mirror for the right)
  shadow: { dxOfD: 0.1, dyOfD: 0.35 + 0.75, rxOfD: 0.42, ryOfD: 0.825, blurOfD: 0.06, alpha: 0.32 }, // long, toward camera
  hitSquash: { sx: 0.88, sy: 1.07, backMs: 140, ease: 'spring(.2,1.4,.4,1)' },
  moveStretch: { max: 0.06, atSpeedUps: 1300 },               // along the motion, linear from 0
  faceFlash: { ms: 60, alpha: 0.25 },                         // local, G12
  concede: { eyesClosedMs: 600, tiltDeg: 15, puff: 12 },      // tilt away from the court
  fallback: { tintAlpha: 0.18, squash: { sx: 1.08, sy: 0.9 }, wobbleDeg: 6, wobbleHz: 6, wobbleMs: 500 }, // סאעלם + guests
  grin: { scale: 1.06, ms: 220 },                             // the scorer, on a point
  mirrorTint: 0.18,                                           // second copy in a mirror match: its player colour, source-atop
  bigHead: { scale: 1.15, ms: 220 },                          // G6 comeback, art and capsule together
  maxUpscale: 1.6,                                            // never draw a face > 1.6x its native px (spec §6)
};

export const BALL = {
  hitRU: 14, drawRU: 16, minDrawPx: 5,  // drawn 15 % larger than the hitbox so it reads on a phone (1.4 px at 844x390)
  outline: { ofR: 0.2, minPx: 2, color: '#2A1638' },  // plum; min 2 px (was 1.5, THE-1110): the cream ball reads on sand by its outline
  highlight: { dxOfR: -0.35, dyOfR: -0.35 },  // radial fill centre
  shadow: { dxOfR: 0.6, dyOfR: 2.2, rxOfR: 0.9, ryOfR: 1.6, alpha: 0.35 }, // the ball's height reads from its shadow
  glow: { rOfR: 5, alpha: 0.6 },              // heat 2 only, additive
  serveRing: { ms: 800, rOfR: [6, 1.4], w: 2, color: '#FFF6E2', alpha: 0.8 }, // the 0.8 s count: a ring closing on the ball
};

export const TRAIL = { // G5. High = feedback buffer; Mid = half-res buffer; Low = drawn tail
  decayPerFrame60: 0.9,        // use decay^(dt*60)
  widthOfR: [1.6, 1.6, 2.2],   // core width x ball draw radius, by heat
  edgeOfCore: 2.2, edgeAlpha: 0.55, coreAlpha: 0.95,
  fireOuter: { ofCore: 3.6, alpha: 0.5, additive: true },
  flicker: { amp: 0.25, hz: 9 }, // heat 2 width wobble
  lowTailPoints: 12, reduceMotionTailPoints: 6,
  thresholds: [8, 12],         // hits (spec §2 Rally heat)
};

export const IMPACT = { // every paddle hit
  ringOfDisc: 0.29, rings: [0.45, 0.77, 1.09], ringAlpha: [0.75, 0.53, 0.31], ringW: [0.08, 0.06, 0.04],
  chips: 10, grains: 26, ms: 260, firstRing: 'hitter colour', otherRings: '#FFF4E0',
};

export const POST = { // G10 chain: trail feedback -> bloom -> composite (chromatic + ripple) -> grade
  bloom: { threshold: 0.8, knee: 0.1, intensity: { high: 0.25, mid: 0.2, low: 0 }, res: { high: 0.5, mid: 0.25 },
    blurPasses: 2, taps: 9 },  // what crosses 0.8 luma: the sun (0.90), the glint (0.83), the fire core, flashes.
  // Sand #F0B489 is 0.757 luma (Rec.601), so it must stay under the threshold. Erratum, THE-1110: was 0.7 with "sand ~0.6".
  // Composite = base + bloom x intensity. Checked at 844x390: threshold 0.8 + intensity 0.25 renders the court #F0B489 exactly.
  chromatic: { rallyFirePx: 2, smashPx: 4, capPx: 4, ms: 120, maxPerSec: 3, falloff: 'radial: 0 at centre -> 1 at the edge' }, // G12
  ripple: { high: { ms: 200, amp: 0.012 }, mid: { ms: 150, amp: 0.008 }, ringSpeedOfCourtH: 0.9, ringWOfCourtH: 0.04 }, // amp x min(W,H)
  shake: { hitPx: 2, hitMs: 90, pointPx: 4, pointMs: 120, smashPx: 6, smashMs: 200, winPx: 8, winMs: 200, capPlayPx: 6 }, // G12
  hitStop: { normalMs: 40, fastMs: 60, fastAtSpeed: 0.8, pointMs: 120, smashMs: 90, winMs: 200 },
  grade: { liftColor: '#3B1F5E', lift: 0.06, gainColor: '#FFE7A1', gain: 0.04 },
  vignette: { color: '#3B1F5E', alpha: 0.35, inner: 0.4, outer: 0.75, cy: 0.4 },
  grain: { alpha: 0.035, high: 'animated 24 fps', mid: 'static', low: 'off' },
  flashCapPerSec: 3,           // full-field flashes (sunburst, confetti burst); G12. No full-field white, ever.
};

export const TIERS = { // brief §7 table, spec §7
  high: { trail: 'feedback', bloomRes: 0.5, ripple: true, chromatic: true, shimmer: true, grain: 'animated' },
  mid: { trail: 'feedback-half', bloomRes: 0.25, ripple: true, chromatic: true, shimmer: false, grain: 'static' },
  low: { trail: 'tail', bloomRes: 0, ripple: 'rings', chromatic: false, shimmer: false, grain: 'off' },
  reduceMotion: { shake: false, chromatic: false, ripple: 'rings', shimmer: false, zoomPunch: false, tail: 6 },
};

export const MOMENTS = { // G13 layouts (DOM in skin.css: .jm-meme--*), GL side here
  smash: { veilBlurPx: 5, veil: '#FFAA4C', veilAlpha: 0.22, faceX: 0.34, faceY: 0.58, faceHOfH: 0.7, rays: 18, raysDegPerSec: 8.3 },
  matchPoint: { zoom: 1.08, zoomMs: 500, faceScale: 1.12 },   // camera on the court centre; both heads grin-scale
  comeback: { headScaleMs: 220 },
  win: { confetti: 70, confettiMs: 1600, poolRingOfDisc: 1.4 },
};

// Result card PNG 1080 x 1080 (G14, DESIGN.md §5). Boxes as fractions of the card side S.
export const CARD = {
  size: 1080, paper: '#FBF6EA', pad: 0.035, foot: 0.15,      // photo = S - 2 pad wide, S - pad - foot tall
  photo: { world: 'courtLayout(photoW, photoH) without the heel line', rallyTrail: 'the winning rally, full length, 0.35 u wide',
    winner: { x: 0.33, y: 0.57, discOfH: 0.46 }, loser: { x: 0.8, y: 0.52, discOfH: 0.17, squash: 0.22, tiltDeg: 17, eyesClosed: true },
    poolRing: { x: 0.8, y: 0.62, wOfH: 0.3 }, scoreY: 0.065, scoreDx: 0.12, scoreSizeOfH: 0.1,
    megaphone: { x: 0.64, y: 0.84, sizeOfH: 0.065, rotDeg: -4.6, text: "the winner's line 2" },
    leak: { from: 'rgba(255,120,60,0.18)', to: 0.25 }, grain: 0.045, vignette: 0.3, bloom: 0.22 },
  dateStamp: { font: 'Varela JM', size: 0.03, color: '#FF7A2E', glow: '#FF3D1D', format: 'DD MM YY, LTR, bottom-right of the photo' },
  headline: { font: 'Secular JM', size: 0.048, color: '#2A1638', y: 1 - 0.15 * 0.66, align: 'right', text: '{winner} ניצח את {loser} ⁦{w}–{l}⁩' },
  sub: { font: 'Varela JM', size: 0.027, alpha: 0.75, y: 1 - 0.15 * 0.36, text: '{place} · ראלי מנצח: {hits} מכות' },
  url: { font: 'Varela JM', size: 0.022, alpha: 0.65, y: 1 - 0.15 * 0.16, align: 'left' },
  logo: { font: 'Secular JM', size: 0.042, color: '#E8402F', y: 1 - 0.15 * 0.58, align: 'left', text: 'ג׳אנקיס מטקות' },
};
