// Hero and Watcher silhouettes via the vendored rig (engine/chars.js already carries the
// plain-ink options: porkpie crown, tuck = scarf tucked away when hidden, a col override for
// the coat side). The 2px cream rim and dashed "cut here" line come from paper.js's silhouette().
import { agentSide, runPose, AGENT_POSE } from '../engine/chars.js';
import { C, dpr, curScale } from '../engine/paper.js';
import { EYE_H } from '../sim/seekers.js';

export const HERO_SCALE = 0.42;
// F2 (CTO review on THE-1551): Watchers read 1.2x taller than the hero (the wide-brim scale cue).
export const WATCHER_SCALE = HERO_SCALE * 1.2;

// F1 (THE-1539 S1 look notes): silhouette()'s outline ring and dash are drawn in screen/device
// pixels (after a setTransform(1,0,0,1,0,0)), not local shape units -- dividing by HERO_SCALE
// inflated a 2px rim to ~5px and a 7px dash cell to ~17px, breaking up the hidden look. These are
// css-pixel targets (CTO's tuned range), scaled by the canvas backing ratio only.
const RIM_CSS_PX = 2, DASH_W_CSS_PX = 1.75, DASH_CELL_CSS_PX = 4.5;

// untuck (S8, spec §3.6): the ending's single frame where the scarf slips out, so the player sees
// themselves in the I -- still hidden otherwise (no rim, the dashed line stays).
//
// THE-1648 (rework H6): opt.rework draws the hidden outline to the rework spec -- a 4 u dashed cut-line at
// ~10/8 u cells in the opposite ink of the coat (cream dashes on ink, ink on cream), no tie. dashOnly draws
// just that outline (on top of a go-behind letter), in dashCol (the colour opposite the letter's fill).
export const HERO_DASH_W_U = 4, HERO_DASH_CELL_U = 9;
export function drawHero({ x, y, coat, hidden, facingLeft, runPhase, grounded, untuck = false, rework = false, dashOnly = false, dashCol = null }) {
  const pose = grounded && runPhase != null ? runPose(runPhase) : AGENT_POSE.stand;
  const col = coat === 'ink' ? C.ink : C.paper;
  const px = dpr();
  const u = curScale(); // device px per world u
  const dash = !hidden ? null
    : rework ? { col: dashCol || (coat === 'ink' ? C.paper : C.ink), w: HERO_DASH_W_U * u, cell: HERO_DASH_CELL_U * u }
      : { col: C.paper, w: DASH_W_CSS_PX * px, cell: DASH_CELL_CSS_PX * px };
  agentSide(x, y, HERO_SCALE, pose, {
    col,
    porkpie: true,
    accent: C.red,
    tuck: hidden && !untuck,
    flip: facingLeft,
    sil: {
      outline: hidden ? 0 : RIM_CSS_PX * px,
      outlineCol: C.paper,
      shadow: !hidden, // the brief's "shadow drops" when hidden
      dash,
      dashOnly,
    },
  });
}

// x, y: the watcher's sim position -- y is its EYE (spec: the wedge is "from the eye, 175u up"),
// not its feet. agentSide draws from the feet, so the feet anchor is y + EYE_H (CTO review on
// THE-1551: Watchers were floating 175u above the ground, feet drawn at the eye).
export function drawWatcher({ x, y, facingAngle, exposure }) {
  const facingLeft = Math.cos(facingAngle) < 0;
  agentSide(x, y + EYE_H, WATCHER_SCALE, AGENT_POSE.stand, {
    col: C.ink,
    accent: C.red,
    flip: facingLeft,
    eye: exposure > 0 ? 'alert' : null,
  });
}
