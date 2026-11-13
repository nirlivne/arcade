"""In-house Blender build script for the Capy Trail A12 models (THE-1296, spec-a12 A12.2 / A12.4 / A12.13 C2):
the giant fallen trunk, the boulder-line module and the goose.

Run headless from the repo root:
    blender --background --python design/capy-trail/a12/make_a12.py -- design/capy-trail/a12

Writes trunk.glb, boulders.glb and goose.glb. Same R3 rules as games/capy-trail/build/make_props.py, whose
helpers this imports: no textures, per-vertex clay colours on one material, rigid named nodes, no skinning,
JS/glTF axes via P()/R() (+Y up, +Z forward).

Building blocks, not an endless-mode spawner (board rule, THE-1279 via THE-1296): every top-level node is a
piece a level generator places by track distance. Its glTF node `extras` carry what the placement and
validity checks need, in metres:
    kind      "trunk" | "boulderLine" | "goose"
    part      trunk: "plate" | "seg" | "end";  boulderLine: "module"
    lenZ      length along +Z the piece occupies (the next piece snaps at z = lenZ)
    topY      top of the solid band (the hit band is solid from 0 to topY: no jump clears it)
    drawW     drawn width (fills the 1.6 m lane pitch); hitW the lateral hit width (A12.2: 1.2)
    front     1 if this piece may open a run (its face at z = 0 is the A12.3 warning face)
    climb     1 if the top is walkable (trunk top: the flat moss strip, A12.6 / L4); boulders never
    stretchZ  "min,max" z-scale an instance may take to hit an exact run length (trunk seg only)

Assembling a filler run of length L (15-50 m, A12.2):
    trunk:   plate (1.0) + n segs + end (1.2), n = ceil((L - 2.2) / 5), each seg z-scaled (L - 2.2) / (5 n)
    boulder: round(L / 2.5) modules, boulder_a first (the tallest, clearest front), then b/c in any order;
             modules butt at 2.5 m with no seam (each overlaps its neighbours by 0.1 m)
Every piece's front face sits at z = 0 and it extends along +Z, like the A11 blockers.

goose: faces +Z, feet on y = 0. Nodes goose > goose_body > neck > head > jaw, wing_l/r, leg_l/r, tail.
The rest pose is the chase pose (neck out, wings folded). Clips:
    waddle_run  0.36 s loop: legs, body waddle/bob, wing flaps. Keys no neck/head/jaw.
    honk        0.50 s one-shot: neck thrust + beak open. Keys only neck/head/jaw, so play it on top of
                waddle_run with no blend fight.
    pounce      0.70 s one-shot: crouch, leap 0.9 m forward, land on the pile. Root motion is on goose_body;
                hold the last frame (clampWhenFinished).
"""
import bpy
import bmesh
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "..", "..", "games", "capy-trail", "build")))
import make_capy as mc  # noqa: E402
import make_props as mp  # noqa: E402
from make_capy import P, R, TAU, loft, paint, mix, smooth, hash3, hex_rgb, empty, parent_at, join_static, sphere, kf, start_clip, push_to_nla, sec  # noqa: E402
from make_props import BARK, BARK_LO, WOOD, RING, MOSS, MOSS_LO, STONE, STONE_LO, SOIL, ROOT, lump, solid, set_flat, set_smooth  # noqa: E402

SPLINTER = hex_rgb("#E8BE84")
ROOT_HI = hex_rgb("#C49264")  # the root plate's rim: lighter than the soil face so the disc edge reads at 44 m
GRASS = hex_rgb("#86C45E")


def tag(obj, **kv):
    for k, v in kv.items():
        obj[k] = v
    return obj


def tube(name, rings, cap0=True, cap1=True):
    """A closed tube through rings of JS points (all rings the same length), fan-capped at each end."""
    bm = bmesh.new()
    vs = [[bm.verts.new(P(*p)) for p in ring] for ring in rings]
    n = len(rings[0])
    for r0, r1 in zip(vs, vs[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    for ring, pts, on in ((vs[0], rings[0], cap0), (vs[-1], rings[-1], cap1)):
        if not on:
            continue
        c = bm.verts.new(P(*(sum(p[k] for p in pts) / n for k in range(3))))
        for i in range(n):
            bm.faces.new((ring[i], ring[(i + 1) % n], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return mc.new_object(name, mesh)


# ---------------------------------------------------------------- giant trunk (A12.2)
TOP = 1.6
# right half of the trunk's cross-section, top to bottom: a flat 0.9 m moss strip (|x| <= 0.45, the L4 high
# road), rounded shoulders, 1.6 m drawn width, a slightly flattened belly on the ground
HALF = [(0.22, TOP), (0.45, TOP), (0.6, 1.54), (0.73, 1.38), (0.8, 1.12), (0.8, 0.8), (0.76, 0.48), (0.64, 0.22), (0.44, 0.06), (0.2, 0.0)]
PROFILE = HALF + [(-x, y) for (x, y) in reversed(HALF)]
NP = len(PROFILE)
SEG_LEN = 5.0


def bark_ring(z, s=1.0, jit=0.0):
    """The trunk profile at z. Side points alternate in and out (bark ridges along the trunk; the same per
    index on every piece, so pieces butt with no seam). The flat top stays exactly at TOP * s."""
    ring = []
    for i, (x, y) in enumerate(PROFILE):
        flat = y >= TOP - 1e-6
        k = 1.0 if flat else (1.03 if i % 2 == 0 else 0.97)
        cx, cy = 0.0, 0.8
        px, py = cx + (x - cx) * k, (cy + (y - cy) * k) if not flat else y
        py = max(0.0, py)
        if jit and not flat:
            j = 1.0 + jit * (hash3(x * 9.1, y * 9.3, z * 3.7) - 0.5)
            px, py = px * j, cy + (py - cy) * j if py > 0.05 else py
        ring.append((px * s, py * s, z))
    return ring


def bark_col(phase0):
    """Bark grooves by angle round the trunk axis, a mossy top strip, dark belly. phase0 makes the colour
    noise periodic in SEG_LEN, so plate -> seg -> seg -> end show no colour seam either."""
    step = TAU / NP

    def fn(x, y, z):
        ph = TAU * (z - phase0) / SEG_LEN
        a = math.atan2(y - 0.8, x)
        groove = int(round(a / step)) % 2
        c = mix(BARK, BARK_LO, 0.5 * groove + 0.2 * (0.5 + 0.5 * math.sin(2 * ph + x * 5.0)))
        c = mix(c, BARK_LO, 0.6 * smooth(0.35, 0.0, y))
        patch = 0.5 + 0.5 * math.sin(2 * ph + x * 3.0) * math.cos(ph + x * 1.7)
        top = smooth(TOP - 0.1, TOP - 0.01, y)
        drip = smooth(1.2, 1.5, y) * smooth(0.45, 0.75, patch)
        m = max(top, drip)
        return mix(c, mix(MOSS, MOSS_LO, 0.25 + 0.5 * patch), m)
    return fn


def build_trunk_seg():
    g = tag(empty("trunk_seg"), kind="trunk", part="seg", lenZ=SEG_LEN, topY=TOP, drawW=1.6, hitW=1.2, front=0, climb=1, stretchZ="0.6,1.4")
    zs = [0.0, 1.25, 2.5, 3.75, SEG_LEN]
    rings = [bark_ring(z, 1.0, 0.06 * math.sin(math.pi * z / SEG_LEN)) for z in zs]  # jitter is 0 at both ends
    body = tube("ts_bark", rings, False, False)  # open ends: always butted, never seen
    paint(body, bark_col(0.0))
    set_flat(body)
    knot = lump("ts_knot", 0.13, 1.0, 0.8, 1.2, subdiv=1, jitter=0.25, seed=4.0)  # side knot, below the moss strip
    solid(knot, BARK_LO)
    knot.location = P(0.78, 0.9, 3.1)
    mesh = join_static([body, knot], "trunk_seg_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


def build_trunk_plate():
    """The warning face: a 1.7 m clay root-plate disc facing the player (-Z), roots and soil clods, then a
    short trunk stub that the first seg butts onto at z = 1.0."""
    g = tag(empty("trunk_plate"), kind="trunk", part="plate", lenZ=1.0, topY=1.7, drawW=1.7, hitW=1.2, front=1, climb=0)
    stub = tube("tp_stub", [bark_ring(0.2), bark_ring(0.6, 1.0, 0.05), bark_ring(1.0)], True, False)
    paint(stub, bark_col(1.0))
    set_flat(stub)
    R0, CY = 0.85, 0.85
    disc = loft("tp_disc", [
        (0.0, 0, CY, R0, R0, R0, 2.0),
        (0.32, 0, CY, R0 * 0.88, R0 * 0.88, R0 * 0.88, 2.0),
    ], segs=18, axis="z", dome=(0.04, 0.0), wobble=lambda i: (1.0, 0.9, 0.97, 0.86, 1.0, 0.93)[i % 6], jitter=0.08)

    def disc_col(x, y, z):
        d = math.hypot(x, y - CY) / R0
        c = mix(SOIL, ROOT, 0.45 * hash3(x * 5, y * 5, 0.0))
        c = mix(c, ROOT_HI, smooth(0.7, 0.92, d))  # light rim: the disc edge reads against the dark forest
        c = mix(c, GRASS, smooth(0.6, 0.9, (y - CY) / R0) * smooth(0.1, 0.25, z))  # grass fringe on top, behind the face
        return c
    paint(disc, disc_col)
    set_smooth(disc)  # smooth soil + roots: flat shading splits every vertex and put trunk.glb over 60 KB
    parts = [stub, disc]
    # roots: thick, short and bent, lying in the plane of the face and running past the rim (a torn-up
    # root plate, not spikes; roots pointing at the camera read as a chestnut husk at 44 m). The low ones
    # run down into the ground.
    # rim roots (k < 9) start on the rim at irregular angles and curl out; face roots (k >= 9) lie across
    # the soil off-centre, so nothing converges on the middle (a converging set reads as wheel spokes)
    rim_a = (0.15, 0.7, 1.35, 1.75, 2.6, 3.3, 3.9, 4.75, 5.5)
    for k in range(12):
        if k < 9:
            a = rim_a[k] + 0.2 * (hash3(k, 3.0, 1.0) - 0.5)
            r_in = 0.55 + 0.15 * hash3(k, 1.0, 2.0)
            ln = 0.3 + 0.3 * hash3(k, 2.0, 5.0)
        else:
            a = (2.2, 4.3, 0.9)[k - 9]
            r_in = 0.2
            ln = 0.5
        bend = (0.12 + 0.16 * hash3(k, 6.0, 1.0)) * (1 if hash3(k, 7.0, 2.0) > 0.5 else -1)
        th = 0.08 + 0.05 * hash3(k, 4.0, 4.0)
        # a flat ribbon (thin along the face normal, wide in the face plane) with a wiggle and a blunt,
        # rounded end: pointed or round-section roots read as thorns at every distance
        fl = 0.4  # thickness / width
        rt = loft(f"tp_root{k}", [
            (-0.05, 0.0, 0, th * fl, th, th, 2.0),
            (ln * 0.35, -0.01, bend * 0.6, th * fl * 0.9, th * 0.85, th * 0.85, 2.0),
            (ln * 0.7, -0.03, -bend * 0.2, th * fl * 0.8, th * 0.7, th * 0.7, 2.0),
            (ln, -0.05, bend * 0.4, th * fl * 0.7, th * 0.6, th * 0.6, 2.0),
        ], segs=6, axis="x", dome=(0.0, th * 0.5))
        solid(rt, ROOT_HI if k % 4 == 0 else ROOT)
        set_smooth(rt)
        rt.location = P(r_in * math.cos(a), CY + r_in * math.sin(a), -0.07)  # just proud of the face
        rt.rotation_euler = R(0, 0, a)
        parts.append(rt)
    for k, (x, y, r) in enumerate(((-0.3, 0.5, 0.24), (0.32, 1.1, 0.2), (0.05, 0.85, 0.22), (-0.28, 1.2, 0.16), (0.4, 0.5, 0.17))):
        cl = lump(f"tp_clod{k}", r, 1, 0.8, 0.5, subdiv=1, jitter=0.3, seed=k + 2.0)
        set_smooth(cl)
        solid(cl, mix(SOIL, ROOT, 0.25 * k / 4))
        cl.location = P(x, y, -0.07)
        parts.append(cl)
    mesh = join_static(parts, "trunk_plate_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


def build_trunk_end():
    """The broken far end: the trunk tapers a little, then snaps in a ring of splinters around end grain."""
    g = tag(empty("trunk_end"), kind="trunk", part="end", lenZ=1.2, topY=TOP, drawW=1.6, hitW=1.2, front=0, climb=1)
    rings = [bark_ring(0.0), bark_ring(0.5, 0.97, 0.05), bark_ring(0.9, 0.93)]
    teeth = []
    for i, (x, y, _) in enumerate(bark_ring(0.0, 0.9)):
        teeth.append((x, y, 0.9 + (0.32 if i % 3 == 0 else 0.1 + 0.12 * hash3(i, 0.0, 1.0))))
    rings.append(teeth)
    cy = 0.8 * 0.9
    for s in (0.78, 0.5, 0.25):  # end grain, recessed below the splinter tips
        rings.append([(x * s, cy + (y - cy) * s, 0.96) for (x, y, _) in bark_ring(0.0, 0.9)])
    end = tube("te_end", rings, False, True)
    bark = bark_col(0.0)

    def fn(x, y, z):
        if z < 0.89:
            return bark(x, y, z)
        d = math.hypot(x, (y - cy) * 1.0) / 0.72
        if d > 0.85:
            return SPLINTER
        return WOOD if (d < 0.2 or 0.42 < d < 0.62) else RING
    paint(end, fn)
    set_flat(end)
    mesh = join_static([end], "trunk_end_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


# ---------------------------------------------------------------- boulder-line module (A12.2)
MOD_LEN = 2.5


def boulder_col(r0):
    def fn(px, py, pz):
        t = py / r0
        c = mix(STONE_LO, STONE, smooth(-0.8, 0.3, t))
        c = mix(c, (c[0] * 0.93, c[1] * 0.93, c[2] * 0.9), hash3(px * 4, py * 4, pz * 4))
        m = smooth(0.35, 0.7, t) * smooth(0.25, 0.5, hash3(px * 2.5, 1.0, pz * 2.5) * 0.6 + 0.4 * smooth(0.6, 0.9, t))
        return mix(c, mix(MOSS, MOSS_LO, hash3(px * 6, 2.0, pz * 6) * 0.6), m)  # moss caps
    return fn


def build_boulder_module(name, rocks, top, front, seed):
    """rocks: (z, x, r, sx, sy, sz, y-centre). A long low skirt rock under them spans -0.1 .. 2.6 m, so
    butted modules never show a gap at the base, and the end rocks overhang z = 0 / 2.5 by ~0.1 m."""
    g = tag(empty(name), kind="boulderLine", part="module", lenZ=MOD_LEN, topY=top, drawW=1.6, hitW=1.2, front=front, climb=0)
    parts = []
    skirt = lump(f"{name}_skirt", 0.62, 1.1, 0.75, 2.15, subdiv=2, jitter=0.18, seed=seed)
    # as dark as the rocks' own feet, so it reads as their base and not a pale pedestal
    paint(skirt, lambda px, py, pz: mix(STONE_LO, STONE, 0.25 + 0.2 * hash3(px * 4, py * 4, pz * 4)))
    skirt.location = P(0.0, 0.32, MOD_LEN / 2)
    parts.append(skirt)
    for k, (z, x, r, sx, sy, sz, yc) in enumerate(rocks):
        rk = lump(f"{name}_r{k}", r, sx, sy, sz, subdiv=2, jitter=0.24, seed=seed + 3.1 * (k + 1))
        paint(rk, boulder_col(r * sy))
        rk.location = P(x, yc, z)
        rk.rotation_euler = R(0, 0.4 * (hash3(k, seed, 0) - 0.5), 0)
        parts.append(rk)
    for k, (x, z) in enumerate(((0.78, 0.6 + seed * 0.1), (-0.8, 1.7 - seed * 0.1))):  # pebbles at the foot
        pb = lump(f"{name}_p{k}", 0.16, 1.2, 0.7, 1.0, subdiv=1, jitter=0.3, seed=seed + k)
        paint(pb, boulder_col(0.12))
        pb.location = P(x, 0.08, z)
        parts.append(pb)
    mesh = join_static(parts, f"{name}_mesh")
    set_smooth(mesh)
    parent_at(mesh, g, (0, 0, 0))
    return g


def build_boulders():
    # a: the front module, one big 1.8 m boulder with a near-vertical face at z ~ 0, a 1.6 m one behind
    build_boulder_module("boulder_a", [
        (0.78, 0.0, 0.86, 0.95, 1.0, 0.95, 0.94),
        (1.95, 0.05, 0.72, 1.08, 1.0, 0.95, 0.9),
    ], 1.8, 1, 1.0)
    # b: two boulders, 1.65 m
    build_boulder_module("boulder_b", [
        (0.62, -0.04, 0.78, 1.0, 1.0, 0.95, 0.88),
        (1.86, 0.06, 0.76, 1.02, 1.0, 1.0, 0.88),
    ], 1.65, 0, 2.0)
    # c: three smaller boulders and a capstone across the middle seam, 1.7 m
    build_boulder_module("boulder_c", [
        (0.42, 0.06, 0.62, 1.25, 1.1, 0.9, 0.74),
        (1.25, -0.08, 0.66, 1.2, 1.1, 0.9, 0.78),
        (2.08, 0.04, 0.6, 1.3, 1.1, 0.95, 0.72),
        (0.85, 0.0, 0.42, 1.3, 0.7, 1.2, 1.38),
    ], 1.7, 0, 3.0)


# ---------------------------------------------------------------- goose (A12.4)
G_WHITE, G_SHADE, G_GREY, G_DARK = hex_rgb("#F7F4EC"), hex_rgb("#DCD5C6"), hex_rgb("#BDB5A6"), hex_rgb("#8C8576")
G_ORANGE = "#F59A3C"  # beak and feet: near the signature orange, a nod rather than a clash (A12.4)


def build_goose():
    root = tag(empty("goose"), kind="goose")
    body = empty("goose_body")
    parent_at(body, root, (0, 0, 0))
    torso = loft("g_torso", [
        (-0.34, 0, 0.42, 0.05, 0.03, 0.03, 2.0),   # tail point, raised
        (-0.24, 0, 0.38, 0.13, 0.1, 0.1, 2.0),
        (-0.06, 0, 0.35, 0.18, 0.15, 0.15, 2.0),
        (0.12, 0, 0.36, 0.17, 0.14, 0.14, 2.0),
        (0.24, 0, 0.4, 0.11, 0.1, 0.09, 2.0),      # breast up into the neck
    ], segs=12, dome=(0.02, 0.03))
    paint(torso, lambda x, y, z: mix(G_WHITE, G_SHADE, smooth(0.36, 0.22, y) * 0.8 + 0.25 * smooth(-0.15, -0.34, z)))
    parent_at(join_static([torso], "goose_body_mesh"), body, (0, 0, 0))

    tail = empty("tail")
    parent_at(tail, body, P(0, 0.43, -0.3), R(-0.35, 0, 0))
    fan = loft("g_tail", [(0.02, 0, 0, 0.06, 0.04, 0.03, 2.0), (-0.06, 0, 0.01, 0.045, 0.03, 0.02, 2.0), (-0.11, 0, 0.03, 0.012, 0.01, 0.01, 2.0)], segs=8)
    paint(fan, lambda x, y, z: mix(G_WHITE, G_SHADE, smooth(0.0, -0.11, z)))  # a white upturned tuft
    parent_at(fan, tail, (0, 0, 0))

    # neck: rest pose IS the chase pose (thrust forward and low, A12.4 "necks out")
    neck = empty("neck")
    parent_at(neck, body, P(0, 0.42, 0.2), R(0.95, 0, 0))
    nk = loft("g_neck", [
        (0.0, 0, 0.0, 0.08, 0.08, 0.08, 2.0),
        (0.12, 0, 0.025, 0.055, 0.055, 0.055, 2.0),
        (0.27, 0, 0.02, 0.05, 0.05, 0.05, 2.0),
    ], segs=8, axis="y")
    paint(nk, lambda x, y, z: mix(G_WHITE, G_SHADE, 0.3 * smooth(0.0, -0.05, z)))
    parent_at(nk, neck, (0, 0, 0))
    head = empty("head")
    parent_at(head, neck, P(0, 0.3, 0.02), R(-0.85, 0, 0))  # head held level while the neck leans out
    hd = sphere("g_head", 0.07, 0.95, 0.95, 1.3, segs=10, rings=7, hex_color="#F7F4EC")
    upper = loft("g_beak", [
        (0.06, 0, -0.005, 0.034, 0.03, 0.012, 2.0),
        (0.12, 0, -0.008, 0.024, 0.02, 0.008, 2.0),
        (0.17, 0, -0.012, 0.012, 0.012, 0.006, 2.0),
    ], segs=8, dome=(0, 0.01))
    solid(upper, hex_rgb(G_ORANGE))
    parts = [hd, upper]
    for s in (-1, 1):
        eye = sphere(f"g_eye_{s}", 0.016, segs=6, rings=4, hex_color="#1E1612")
        eye.location = P(s * 0.055, 0.02, 0.035)
        brow = sphere(f"g_brow_{s}", 0.022, 1.0, 0.3, 0.45, segs=6, rings=4, hex_color="#4A453C")  # the angry brow, slanting down to the beak
        brow.location = P(s * 0.05, 0.036, 0.05)
        brow.rotation_euler = R(0, 0, s * 0.5)
        parts += [eye, brow]
    parent_at(join_static(parts, "head_mesh"), head, (0, 0, 0))
    jaw = empty("jaw")
    parent_at(jaw, head, P(0, -0.02, 0.06))
    lower = loft("g_jaw", [
        (0.0, 0, -0.005, 0.028, 0.008, 0.01, 2.0),
        (0.1, 0, -0.005, 0.012, 0.005, 0.006, 2.0),
    ], segs=6, dome=(0, 0.006))
    solid(lower, hex_rgb("#D9772A"))
    parent_at(lower, jaw, (0, 0, 0))

    wings = {}
    for side, s in (("l", -1), ("r", 1)):
        w = empty(f"wing_{side}")
        parent_at(w, body, P(s * 0.15, 0.44, 0.08), R(0, s * 1.45, s * -0.15))  # folded along the flank
        # a long swept wing: a broad arm, then primaries that narrow and sweep back to a dark tip
        wm = loft(f"g_wing_{side}", [
            (0.0, -0.02, 0, 0.11, 0.028, 0.018, 2.0),
            (s * 0.16, -0.06, 0, 0.13, 0.022, 0.014, 2.2),
            (s * 0.3, -0.12, 0, 0.1, 0.015, 0.01, 2.4),
            (s * 0.42, -0.2, 0, 0.055, 0.01, 0.007, 2.4),
            (s * 0.5, -0.29, 0, 0.015, 0.006, 0.005, 2.0),
        ], segs=8, axis="x", dome=(0, 0.0))
        paint(wm, lambda x, y, z, s=s: mix(G_WHITE, mix(G_GREY, G_DARK, smooth(0.34, 0.48, abs(x))), smooth(0.18, 0.34, abs(x)) + 0.35 * smooth(-0.05, -0.12, z - 0.0)))
        parent_at(wm, w, (0, 0, 0))
        wings[side] = w

    legs = {}
    for side, s in (("l", -1), ("r", 1)):
        lg = empty(f"leg_{side}")
        parent_at(lg, body, P(s * 0.075, 0.27, 0.02))
        shin = loft(f"g_shin_{side}", [(0.0, 0, 0, 0.026, 0.026, 0.026, 2.0), (-0.25, 0, 0, 0.018, 0.018, 0.018, 2.0)], segs=6, axis="y")
        foot = loft(f"g_foot_{side}", [
            (-0.02, 0, -0.262, 0.02, 0.008, 0.008, 2.0),
            (0.05, 0, -0.264, 0.05, 0.007, 0.007, 2.4),
            (0.1, 0, -0.266, 0.055, 0.006, 0.006, 3.0),
        ], segs=6, dome=(0, 0.0))
        for o in (shin, foot):
            solid(o, hex_rgb(G_ORANGE))
        parent_at(join_static([shin, foot], f"leg_{side}_mesh"), lg, (0, 0, 0))
        legs[side] = lg
    return {"root": root, "body": body, "tail": tail, "neck": neck, "head": head, "jaw": jaw, "wings": wings, "legs": legs}


def bake_goose(c):
    body, tail, neck, head, jaw = c["body"], c["tail"], c["neck"], c["head"], c["jaw"]
    wl, wr, ll, lr = c["wings"]["l"], c["wings"]["r"], c["legs"]["l"], c["legs"]["r"]
    every = [body, tail, neck, head, jaw, wl, wr, ll, lr]
    rest = {o.name: (tuple(o.location), tuple(o.rotation_euler)) for o in every}

    # waddle_run: 0.36 s loop, two flaps per stride, body rolls side to side
    objs = [body, tail, wl, wr, ll, lr]
    start_clip(objs)
    period, steps = 0.36, 12
    for i in range(steps + 1):
        t, ph = period * i / steps, TAU * i / steps
        kf(ll, sec(t), rot=R(0.75 * math.sin(ph), 0, 0))
        kf(lr, sec(t), rot=R(-0.75 * math.sin(ph), 0, 0))
        kf(body, sec(t), loc=P(0, 0.03 * abs(math.cos(ph)), 0), rot=R(0.08, 0, 0.16 * math.sin(ph)))
        flap = 0.35 + 0.45 * math.sin(2 * ph)  # half-spread, beating: the angry-goose chase silhouette
        kf(wl, sec(t), rot=R(0, -0.45, -flap))  # same sign rule as the R3 bird: -rz lifts the left wing
        kf(wr, sec(t), rot=R(0, 0.45, flap))
        kf(tail, sec(t), rot=R(-0.35, 0.25 * math.sin(ph), 0))
    push_to_nla(objs, "waddle_run", 0, sec(period))

    # honk: neck thrust, head up, beak wide, back to rest
    objs = [neck, head, jaw]
    start_clip(objs)
    for t, n, h, j in ((0.0, 0.0, 0.0, 0.0), (0.1, 0.2, -0.25, 0.75), (0.28, 0.25, -0.3, 0.8), (0.4, 0.05, -0.05, 0.15), (0.5, 0.0, 0.0, 0.0)):
        kf(neck, sec(t), rot=R(0.95 + n, 0, 0))
        kf(head, sec(t), rot=R(-0.85 + h, 0, 0))
        kf(jaw, sec(t), rot=R(j, 0, 0))
    push_to_nla(objs, "honk", 0, sec(0.5))

    # pounce: crouch, leap 0.9 m forward onto the capy, wings up, land on the pile, keep honking
    objs = [body, neck, head, jaw, wl, wr, ll, lr]
    start_clip(objs)
    keys = (
        # t,   body y, z,   pitch, neck, head, jaw, wing yaw, wing up, legs
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.45, 0.15, 0.0),
        (0.14, -0.07, -0.05, -0.25, -0.35, 0.3, 0.2, 0.3, 1.1, 0.35),
        (0.32, 0.42, 0.5, 0.3, 0.35, -0.3, 0.7, 0.15, 0.2, -0.9),
        (0.5, 0.3, 0.88, 0.45, 0.45, -0.4, 0.5, 0.2, 1.0, -0.5),
        (0.7, 0.24, 0.92, 0.32, 0.3, -0.35, 0.6, 0.35, 0.6, -0.3),
    )
    for (t, by, bz, pitch, n, h, j, wy, wu, lg) in keys:
        kf(body, sec(t), loc=P(0, by, bz), rot=R(pitch, 0, 0))
        kf(neck, sec(t), rot=R(0.95 + n, 0, 0))
        kf(head, sec(t), rot=R(-0.85 + h, 0, 0))
        kf(jaw, sec(t), rot=R(j, 0, 0))
        kf(wl, sec(t), rot=R(0, -wy, -wu))
        kf(wr, sec(t), rot=R(0, wy, wu))
        kf(ll, sec(t), rot=R(lg, 0, 0))
        kf(lr, sec(t), rot=R(lg * 0.8, 0, 0))
    push_to_nla(objs, "pounce", 0, sec(0.7))
    # back to the rest (chase) pose for the exported bind pose
    for o in every:
        o.location, o.rotation_euler = rest[o.name]


# ---------------------------------------------------------------- export
def export(path):
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False,
        export_animation_mode="NLA_TRACKS", export_merge_animation="NLA_TRACK", export_bake_animation=False,
        export_optimize_animation_size=True, export_apply=True, export_materials="EXPORT",
        export_vertex_color="ACTIVE", export_normals=True, export_yup=True, export_cameras=False, export_lights=False,
        export_extras=True,
    )


def main():
    argv = sys.argv
    out_dir = argv[argv.index("--") + 1] if "--" in argv else HERE
    os.makedirs(out_dir, exist_ok=True)

    mc.reset_scene()
    build_trunk_plate()
    build_trunk_seg()
    build_trunk_end()
    p = os.path.join(out_dir, "trunk.glb")
    export(p)
    print(f"A12_BUILD_OK trunk tris={mp.per_root_tris()} bytes={os.path.getsize(p)}")

    mc.reset_scene()
    build_boulders()
    p = os.path.join(out_dir, "boulders.glb")
    export(p)
    print(f"A12_BUILD_OK boulders tris={mp.per_root_tris()} bytes={os.path.getsize(p)}")

    mc.reset_scene()
    c = build_goose()
    for o in bpy.data.objects:
        if o.type == "MESH":
            set_smooth(o)
    bake_goose(c)
    p = os.path.join(out_dir, "goose.glb")
    export(p)
    print(f"A12_BUILD_OK goose tris={mp.per_root_tris()} bytes={os.path.getsize(p)}")


if __name__ == "__main__":
    main()
