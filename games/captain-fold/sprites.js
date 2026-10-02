// Captain Fold sprites.js: SVG builders for the Captain bust, the paper plane and the porthole face (THE-264
// M4). Ported from design/captain-fold/pilot.js (a moodboard recipe, not shippable code - DESIGN.md: "neither
// file ships"). Colours here are the SVG's own fallback palette; render.js recolours the fold wing print from
// tokens.css before calling plane(). Every shape is a flat cut-paper layer with a soft "lift" shadow and a
// faint fibre grain, so the board reads as part of the paper world, never a photo.

const C = {
  skin: "#F1C4A5", skinShade: "#DDA283", skinLight: "#FBE2CF", blush: "#EE9C86",
  stubble: "#D8C9AA", stubbleDot: "#B3A283", brow: "#C7AC8B",
  iris: "#5E7690", pupil: "#1B2530", frame: "#1B1C1F", rivet: "#C9CDD2",
  tee: "#B4CFEE", teeShade: "#93B3DC", teeRib: "#C8DCF4",
  scarf: "#E5534B", scarfShade: "#BE3D37",
  strap: "#6B4A3A", gogRim: "#8C969F", lensA: "#DDF1F7", lensB: "#86B8EA",
  ink: "#1E2A33", lip: "#8A4E3E", teeth: "#FFFDF7",
  paper: "#FFFDF7", rule: "#9DBDE3", margin: "#E5534B", paperShade: "#DCE5F0", paperFar: "#EAF0F7",
  star: "#FFB627", starShade: "#E08F10", sweat: "#DDF1F7",
};
let uid = 0;

function defs(id) {
  return `<defs>
    <filter id="lift${id}" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.6" stdDeviation="0.9" flood-color="${C.ink}" flood-opacity="0.28"/>
    </filter>
    <filter id="grain${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.40  0 0 0 0 0.35  0 0 0 0.10 0" result="g"/>
      <feComposite in="g" in2="SourceGraphic" operator="in" result="gi"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="gi"/></feMerge>
    </filter>
    <pattern id="stip${id}" width="5" height="5" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.7" fill="${C.stubbleDot}"/><circle cx="3.6" cy="3.2" r="0.6" fill="${C.stubbleDot}"/>
    </pattern>
    <linearGradient id="lens${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.lensA}"/><stop offset="1" stop-color="${C.lensB}"/>
    </linearGradient>
  </defs>`;
}

// Eyes, brows and mouth per expression. Face centre is (120,112) in a 240x260 bust.
const EXPR = {
  neutral: { brows: "M88,97 Q98,93 108,96 M132,96 Q142,93 152,97", eyes: "open", mouth: "M108,154 C115,158 127,158 135,152", tilt: 0 },
  wave: { brows: "M88,95 Q98,90 108,94 M132,94 Q142,90 152,95", eyes: "open", mouth: "M104,151 C112,162 130,162 138,150", tilt: -3, hand: "wave" },
  strain: { brows: "M88,94 Q100,98 110,102 M130,102 Q140,98 152,94", eyes: "squint", mouth: "teeth", tilt: -7 },
  wince: { brows: "M88,99 Q98,95 110,100 M132,92 Q142,86 152,91", eyes: "wince", mouth: "eek", tilt: 8, sweat: true },
  crash: { brows: "M88,92 Q98,88 108,92 M132,92 Q142,88 152,92", eyes: "dizzy", mouth: "O", tilt: 10, askew: true, stars: true },
  best: { brows: "M88,93 Q98,87 108,91 M132,91 Q142,87 152,93", eyes: "happy", mouth: "grin", tilt: -4, hand: "thumb" },
};

function eyes(kind) {
  const iris = (x, r = 4.3) => `<circle cx="${x}" cy="113" r="${r}" fill="${C.iris}"/><circle cx="${x}" cy="113" r="${r * 0.48}" fill="${C.pupil}"/><circle cx="${x + 1.4}" cy="111.6" r="1.1" fill="#fff"/>`;
  const arc = (x, up) => up
    ? `<path d="M${x - 6},115 Q${x},108 ${x + 6},115" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`
    : `<path d="M${x - 6},111 Q${x},117 ${x + 6},111" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  switch (kind) {
    case "squint":
      return `<path d="M91,114 Q97,110 103,114" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>
              <path d="M137,114 Q143,110 149,114" fill="none" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>`;
    case "wince":
      return `<path d="M91,110 L103,114 L91,117" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${iris(143, 5.2)}`;
    case "dizzy": {
      const sp = (x) => `<path d="M${x},113 m-1,0 a1,1 0 1,1 2,0 a2.5,2.5 0 1,1 -5,0 a4,4 0 1,1 8,0" fill="none" stroke="${C.ink}" stroke-width="1.8" stroke-linecap="round"/>`;
      return sp(97) + sp(143);
    }
    case "happy": return arc(97, true) + arc(143, true);
    default: return iris(97) + iris(143);
  }
}

function mouth(kind) {
  switch (kind) {
    case "teeth":
      return `<rect x="107" y="149" width="27" height="9" rx="3" fill="${C.teeth}" stroke="${C.lip}" stroke-width="2.4"/>
              <path d="M107,153.5 H134 M116,149 V158 M125,149 V158" stroke="${C.lip}" stroke-width="1.2"/>`;
    case "eek":
      return `<path d="M104,153 C110,148 118,158 126,151 C130,148 134,149 138,147 L139,154 C132,160 118,162 105,158 Z" fill="${C.teeth}" stroke="${C.lip}" stroke-width="2.2" stroke-linejoin="round"/>`;
    case "O":
      return `<ellipse cx="121" cy="155" rx="6.5" ry="8" fill="#5A2E27" stroke="${C.lip}" stroke-width="2"/>`;
    case "grin":
      return `<path d="M103,147 C112,152 130,152 139,146 C137,160 128,167 121,167 C113,167 105,160 103,147 Z" fill="#5A2E27" stroke="${C.lip}" stroke-width="2.2" stroke-linejoin="round"/>
              <path d="M106,149 C114,153 128,153 136,148 L135,152 C127,156 115,156 107,153 Z" fill="${C.teeth}"/>`;
    default:
      return `<path d="${kind}" fill="none" stroke="${C.lip}" stroke-width="3" stroke-linecap="round"/>`;
  }
}

function glasses(askew) {
  const lens = (x) => `M${x},100 h36 a3,3 0 0 1 3,3 v17 a3,3 0 0 1 -3,3 h-36 a3,3 0 0 1 -3,-3 v-17 a3,3 0 0 1 3,-3 Z
                       M${x + 2},105 v13 a1,1 0 0 0 1,1 h30 a1,1 0 0 0 1,-1 v-13 a1,1 0 0 0 -1,-1 h-30 a1,1 0 0 0 -1,1 Z`;
  return `<g ${askew ? 'transform="rotate(-17 120 112) translate(6 5)"' : ""}>
    <path d="M78,104 L68,106 M162,104 L172,106" stroke="${C.frame}" stroke-width="3.2" stroke-linecap="round"/>
    <rect x="81" y="104" width="34" height="16" rx="2" fill="#fff" opacity="0.16"/>
    <rect x="125" y="104" width="34" height="16" rx="2" fill="#fff" opacity="0.16"/>
    <path d="M86,118 L96,106 M130,118 L140,106" stroke="#fff" stroke-width="2" opacity="0.45"/>
    <path d="${lens(80)} ${lens(124)}" fill="${C.frame}" fill-rule="evenodd"/>
    <path d="M116,106 Q120,103 124,106" fill="none" stroke="${C.frame}" stroke-width="4"/>
    <circle cx="82.5" cy="103.5" r="1.3" fill="${C.rivet}"/><circle cx="157.5" cy="103.5" r="1.3" fill="${C.rivet}"/>
  </g>`;
}

function hand(kind) {
  if (kind === "wave") {
    return `<g transform="rotate(-14 196 150)">
      <path d="M184,236 C186,210 188,190 190,168" stroke="${C.tee}" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M181,172 C179,150 181,134 188,128 L192,146 L194,122 C196,118 201,118 202,122 L203,146 L207,124 C209,120 214,121 214,126 L211,150 L217,136 C219,132 224,134 223,138 L216,164 C212,176 190,182 181,172 Z" fill="${C.skin}"/>
    </g>`;
  }
  if (kind === "thumb") {
    return `<g>
      <path d="M200,248 C200,226 196,210 190,196" stroke="${C.tee}" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M176,200 C174,186 178,176 190,174 L192,152 C193,144 203,144 204,152 L204,174 C214,174 220,180 218,190 L216,206 C214,214 206,218 196,218 L186,218 C179,216 177,208 176,200 Z" fill="${C.skin}"/>
      <path d="M180,190 H214 M181,202 H213" stroke="${C.skinShade}" stroke-width="1.6"/>
    </g>`;
  }
  return "";
}

function stars(id) {
  const s = (x, y, r, rot) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${r})" d="M0,-10 L3,-3 L10,-3 L4.5,1.5 L6.5,9 L0,4.5 L-6.5,9 L-4.5,1.5 L-10,-3 L-3,-3 Z" fill="${C.star}" stroke="${C.starShade}" stroke-width="1.2"/>`;
  return `<g filter="url(#lift${id})"><ellipse cx="120" cy="40" rx="52" ry="11" fill="none" stroke="${C.ink}" stroke-width="1.2" stroke-dasharray="3 5" opacity="0.5"/>
    ${s(72, 42, 0.9, -10)}${s(160, 34, 0.75, 20)}${s(128, 52, 0.6, 5)}</g>`;
}

// The bust. opts: {expr, size, detail(bool), scarfTail(bool), bg}
export function pilot(opts = {}) {
  const id = ++uid;
  const e = EXPR[opts.expr || "neutral"];
  const size = opts.size || 240;
  const detail = opts.detail !== false;
  const h = Math.round((size * 260) / 240);
  const scarfTail = opts.scarfTail !== false;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 260" width="${size}" height="${h}" role="img" aria-label="Captain (the board), ${opts.expr || "neutral"}">
    ${defs(id)}
    ${opts.bg || ""}
    <g filter="url(#grain${id})">
    ${scarfTail ? `<path filter="url(#lift${id})" d="M98,206 C78,204 60,214 40,206 C28,201 18,204 8,212 C14,196 30,188 44,192 C62,196 76,188 96,196 Z" fill="${C.scarf}"/>
      <path d="M44,194 C58,197 72,192 90,197" stroke="${C.scarfShade}" stroke-width="2" fill="none"/>` : ""}
    <g filter="url(#lift${id})">
      <path d="M34,262 C38,220 66,202 100,196 L140,196 C174,202 202,220 206,262 Z" fill="${C.tee}"/>
      <path d="M160,204 C176,212 192,228 196,262 L178,262 C176,236 170,220 160,204 Z" fill="${C.teeShade}" opacity="0.7"/>
    </g>
    <g transform="rotate(${e.tilt} 120 180)">
      <path d="M101,168 L139,168 L141,200 C130,208 110,208 99,200 Z" fill="${C.skinShade}"/>
      <g filter="url(#lift${id})">
        <ellipse cx="67" cy="117" rx="9" ry="15" fill="${C.skin}"/><ellipse cx="173" cy="117" rx="9" ry="15" fill="${C.skin}"/>
        <path d="M67,109 Q63,117 68,125 M173,109 Q177,117 172,125" stroke="${C.skinShade}" stroke-width="2" fill="none"/>
        <path d="M120,40 C155,40 172,68 172,104 C172,128 166,148 156,162 C146,176 134,183 120,183 C106,183 94,176 84,162 C74,148 68,128 68,104 C68,68 85,40 120,40 Z" fill="${C.skin}"/>
      </g>
      <ellipse cx="104" cy="58" rx="24" ry="12" fill="${C.skinLight}" opacity="0.85" transform="rotate(-12 104 58)"/>
      <path d="M70,96 C69,104 70,112 72,118 L76,117 C75,110 75,102 76,94 Z M170,96 C171,104 170,112 168,118 L164,117 C165,110 165,102 164,94 Z" fill="${C.stubble}" opacity="0.85"/>
      <circle cx="88" cy="136" r="9" fill="${C.blush}" opacity="0.32"/><circle cx="152" cy="136" r="9" fill="${C.blush}" opacity="0.32"/>
      <path d="M75,134 C77,152 86,170 100,180 C108,186 132,186 140,180 C154,170 163,152 165,134 C160,144 152,149 145,149 C140,153 132,160 120,160 C108,160 100,153 95,147 C88,149 80,144 75,134 Z" fill="${C.stubble}" opacity="0.9"/>
      ${detail ? `<path d="M75,134 C77,152 86,170 100,180 C108,186 132,186 140,180 C154,170 163,152 165,134 C160,144 152,149 145,149 C140,153 132,160 120,160 C108,160 100,153 95,147 C88,149 80,144 75,134 Z" fill="url(#stip${id})" opacity="0.45"/>` : ""}
      <path d="M101,148 C109,141 131,141 139,148 C131,145 109,145 101,148 Z" fill="${C.stubble}" stroke="${C.stubble}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M116,114 C114,127 109,135 111,140 C114,146 126,146 129,140 C131,135 126,127 124,114" fill="${C.skinShade}" opacity="0.55"/>
      <path d="M113,140 Q116,143 119,141 M121,141 Q124,143 127,140" stroke="${C.lip}" stroke-width="1.4" fill="none" opacity="0.6"/>
      ${mouth(e.mouth)}
      ${eyes(e.eyes)}
      <path d="${e.brows}" fill="none" stroke="${C.brow}" stroke-width="3.2" stroke-linecap="round"/>
      ${glasses(e.askew)}
      ${e.sweat ? `<path filter="url(#lift${id})" d="M168,84 C172,92 175,97 175,100 C175,104 172,106 169,106 C165,106 163,103 163,100 C163,96 165,91 168,84 Z" fill="${C.sweat}" stroke="${C.lensB}" stroke-width="1.4"/>` : ""}
    </g>
    <g filter="url(#lift${id})">
      <path d="M92,196 C100,214 140,214 148,196 L152,208 C140,226 100,226 88,208 Z" fill="${C.scarf}"/>
      <path d="M96,212 C108,220 132,220 144,212" stroke="${C.scarfShade}" stroke-width="2" fill="none"/>
    </g>
    <g filter="url(#lift${id})">
      <path d="M86,214 C98,230 142,230 154,214" stroke="${C.strap}" stroke-width="6" fill="none"/>
      <circle cx="105" cy="226" r="10" fill="url(#lens${id})" stroke="${C.gogRim}" stroke-width="3.5"/>
      <circle cx="135" cy="226" r="10" fill="url(#lens${id})" stroke="${C.gogRim}" stroke-width="3.5"/>
      <path d="M115,227 H125" stroke="${C.gogRim}" stroke-width="3"/>
      <path d="M100,222 Q103,218 108,218 M130,222 Q133,218 138,218" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    </g>
    ${hand(e.hand)}
    ${e.stars ? stars(id) : ""}
    </g>
  </svg>`;
}

// Side-view paper dart, nose to the right, ~130x56 box. f = {paper, rule, margin, shade, far, kind}.
function wingPrint(f) {
  const slant = (y) => `M-10,${y + 6} L140,${y}`;
  const star = "M0,-10 L3,-3 L10,-3 L4.5,1.5 L6.5,9 L0,4.5 L-6.5,9 L-4.5,1.5 L-10,-3 L-3,-3 Z";
  switch (f.kind) {
    case "grid":
      return [0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="${slant(14 + i * 4.2)}" stroke="${f.rule}" stroke-width="0.7"/>`).join("")
        + Array.from({ length: 34 }, (_, i) => `<path d="M${i * 4.2},10 L${i * 4.2 - 1.2},44" stroke="${f.rule}" stroke-width="0.7"/>`).join("");
    case "print":
      return `<path d="${slant(18)}" stroke="${f.margin}" stroke-width="2.6"/>`
        + [0, 1, 2, 3, 4, 5].map((i) => `<path d="${slant(23 + i * 2.6)}" stroke="${f.rule}" stroke-width="1.1" stroke-dasharray="14 3 9 3 18 3"/>`).join("")
        + `<path d="M70,10 L66,44" stroke="${f.paper}" stroke-width="2.5"/>`;
    case "map":
      return `<path d="M20,34 C34,22 52,40 70,28 C84,19 100,32 124,26" stroke="${f.rule}" stroke-width="1.6" fill="none"/>
        <ellipse cx="92" cy="28" rx="12" ry="3.5" stroke="${f.shade}" stroke-width="0.9" fill="none"/>
        <ellipse cx="92" cy="28" rx="6" ry="1.8" stroke="${f.shade}" stroke-width="0.9" fill="none"/>
        <path d="M8,24 L126,31" stroke="${f.margin}" stroke-width="1.2" stroke-dasharray="4 3"/>`;
    case "solid":
      return `<path d="M8,24 L136,30" stroke="${f.rule}" stroke-width="1.2"/>`;
    case "stars":
      return Array.from({ length: 16 }, (_, i) => {
        const x = 8 + (i % 8) * 16 + (i >= 8 ? 8 : 0), y = i >= 8 ? 31 : 24;
        return `<path transform="translate(${x} ${y}) scale(0.24)" d="${star}" fill="${i % 3 ? f.rule : f.margin}"/>`;
      }).join("");
    default:
      return [0, 1, 2, 3, 4].map((i) => `<path d="M-10,${22 + i * 5} L140,${16 + i * 5}" stroke="${f.rule}" stroke-width="0.9"/>`).join("")
        + `<path d="M16,10 L12,40" stroke="${f.margin}" stroke-width="1.2"/>`;
  }
}

function stripSvgTag(svg) {
  return svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
}

export function plane(opts = {}) {
  const id = ++uid;
  const w = opts.width || 130;
  const pitch = opts.pitch || 0;
  const expr = opts.expr || "neutral";
  const f = Object.assign({ paper: C.paper, rule: C.rule, margin: C.margin, shade: C.paperShade, far: C.paperFar, kind: "lines" }, opts.fold || {});
  const head = opts.noPilot ? "" : `<g transform="translate(34 -13) scale(0.19)">${stripSvgTag(pilot({ expr, size: 240, detail: false, scarfTail: false }))}</g>
    <path d="M52,31 C40,29 30,33 16,30 C10,29 6,31 2,34 C6,26 14,23 22,25 C32,27 42,24 52,28 Z" fill="${C.scarf}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -18 146 76" width="${w}" height="${Math.round((w * 76) / 146)}" role="img" aria-label="paper plane with the pilot">
    ${defs(id)}
    <g transform="rotate(${pitch} 70 30)" filter="url(#grain${id})">
      <g filter="url(#lift${id})"><path d="M10,6 L136,30 L40,26 Z" fill="${f.far}"/></g>
      ${head}
      <g filter="url(#lift${id})"><path d="M16,30 L136,30 L34,50 Z" fill="${f.shade}"/></g>
      <g filter="url(#lift${id})">
        <clipPath id="nw${id}"><path d="M0,20 L136,30 L44,36 Z"/></clipPath>
        <path d="M0,20 L136,30 L44,36 Z" fill="${f.paper}"/>
        <g clip-path="url(#nw${id})">${wingPrint(f)}</g>
        <path d="M0,20 L136,30" stroke="#fff" stroke-width="1"/>
      </g>
    </g>
  </svg>`;
}

// The porthole's glass only (no ring): what render.js pre-renders per reaction for .cf-porthole__face.
export function face(opts = {}) {
  const id = ++uid;
  const d = opts.size || 134;
  const inner = stripSvgTag(pilot({ expr: opts.expr || "neutral", size: 240, detail: d >= 120, scarfTail: false }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 80 80" width="${d}" height="${d}" role="img" aria-label="the Captain, ${opts.expr || "neutral"}">
    ${defs(id)}
    <clipPath id="fc${id}"><circle cx="50" cy="50" r="40"/></clipPath>
    <g clip-path="url(#fc${id})">
      <rect width="100" height="100" fill="${C.lensA}"/>
      <path d="M0,0 H100 V44 C80,40 60,48 40,44 C24,41 10,46 0,44 Z" fill="${C.lensB}" opacity="0.6"/>
      <g transform="translate(-24 -9) scale(0.62)">${inner}</g>
    </g>
    <path d="M26,24 A34,34 0 0 1 58,17" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.8"/>
  </svg>`;
}

export function luckyStar(size = 22) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 24 24" width="${size}" height="${size}">
    <path d="M0,-10 L3,-3 L10,-3 L4.5,1.5 L6.5,9 L0,4.5 L-6.5,9 L-4.5,1.5 L-10,-3 L-3,-3 Z" fill="${C.star}" stroke="${C.ink}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M0,-10 L0,4.5 M-10,-3 L4.5,1.5" stroke="${C.starShade}" stroke-width="0.9"/>
  </svg>`;
}

export const EXPRESSIONS = Object.keys(EXPR);

export function rasterSVG(svg, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = Math.ceil(w);
      cv.height = Math.ceil(h);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv);
    };
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
