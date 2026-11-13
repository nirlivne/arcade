// P1 item 4 (THE-1320, board feedback #2: "shadows blink"). The sun used to sit at a fixed world point
// while its target jumped ahead every 50 m, so the light direction swung at each ground re-centre, and once
// the target was past the shadow camera's 90 m far plane the shadows vanished. Now the sun keeps one fixed
// direction (SUN_OFFSET from its target) and follows an anchor near the capy every frame, snapped to whole
// shadow-map texels across the light so shadow edges don't crawl or shimmer as it moves.
export const SUN_OFFSET = [14, 22, -10]; // the old fixed sun position, now relative to the target

const len = Math.hypot(...SUN_OFFSET);
const L = SUN_OFFSET.map((c) => c / len); // towards the sun
// The shadow camera looks along -L with three's default up (0,1,0): its right axis u = up x L, up axis v = L x u.
const uRaw = [L[2], 0, -L[0]], uLen = Math.hypot(...uRaw);
const u = uRaw.map((c) => c / uLen);
const v = [L[1] * u[2] - L[2] * u[1], L[2] * u[0] - L[0] * u[2], L[0] * u[1] - L[1] * u[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// anchor {x,y,z} -> { target, position } for the DirectionalLight; texel = shadow frustum width / map size
export function sunFollow(anchor, texel) {
  const a = [anchor.x, anchor.y, anchor.z];
  const su = Math.round(dot(a, u) / texel) * texel, sv = Math.round(dot(a, v) / texel) * texel, sl = dot(a, L);
  const t = [0, 1, 2].map((i) => u[i] * su + v[i] * sv + L[i] * sl);
  return {
    target: { x: t[0], y: t[1], z: t[2] },
    position: { x: t[0] + SUN_OFFSET[0], y: t[1] + SUN_OFFSET[1], z: t[2] + SUN_OFFSET[2] },
  };
}
sunFollow.axes = { u, v };
