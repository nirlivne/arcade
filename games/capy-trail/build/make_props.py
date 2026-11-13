"""In-house Blender build script for the Capy Trail R3 props (THE-1282): the flapping bird, the logs, the
bushes and the two A11 lane-blocker pieces.

Run headless:
    blender --background --python build/make_props.py -- <assets dir>

Writes <assets dir>/bird.glb (one bird, a looping "flap" clip) and <assets dir>/props.glb (static:
log_a/b/c, bush_a/b/c, blocker_tree, blocker_rocks, each a top-level node at the origin). Same rules as
make_capy.py, whose helpers this imports: no textures, per-vertex clay colours on one material,
rigid named nodes, no skinning. All in JS/glTF axes via P()/R(): +Y up, +Z forward.

Contracts for render code (developer wires these in):
  bird      faces +Z (beak), body centre at the origin; the high-hazard placement adds the 1.0 m
            height. Nodes: bird > bird_body > wing_l/wing_r > wing_l_tip/wing_r_tip, tail. Clip
            "flap" is a 0.40 s loop; bob/swoop-in to duck height stays in code.
  log_*     lies across the lane along X, sits on y = 0, drawn top <= 0.5 m (sim HAZARD_BAND.low),
            depth <= 0.5 m along Z (HAZARD_LEN.low).
  bush_*    decor, sits on y = 0, about 1.0-1.3 m wide; scale it like look.js decorProp("bush").
  blocker_* spec A11.2: front face at z = 0, extends along +Z, fills the 1.6 m lane pitch.
"""
import bpy
import bmesh
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_capy as mc  # noqa: E402  (helpers only; its main() is guarded)
from make_capy import P, R, TAU, loft, paint, mix, smooth, hash3, hex_rgb, empty, parent_at, join_static, sphere, kf, start_clip, push_to_nla, sec  # noqa: E402

BARK, BARK_LO, WOOD, RING = hex_rgb("#8A5A36"), hex_rgb("#5A3820"), hex_rgb("#F1C98E"), hex_rgb("#C99A62")
MOSS, MOSS_LO = hex_rgb("#6FA85C"), hex_rgb("#4F8A45")
LEAF_LO, LEAF_HI = hex_rgb("#3F7F3E"), hex_rgb("#86C45E")
STONE, STONE_LO = hex_rgb("#9A9784"), hex_rgb("#6A685A")
SOIL, ROOT = hex_rgb("#8A6446"), hex_rgb("#A57A50")  # lit clay soil; darker read as a black hole at play distance
BIRD_SCALE = 1.35  # the S2 bird's size (0.32 m body), so the duck hazard reads as early as before
BIRD, BIRD_LO, BIRD_BELLY, BEAK = hex_rgb("#3FA7C9"), hex_rgb("#26799C"), hex_rgb("#FFE7BF"), hex_rgb("#FF8A2A")


def lump(name, r, sx=1.0, sy=1.0, sz=1.0, subdiv=2, jitter=0.18, seed=1.0):
    """A lumpy clay ball (icosphere pushed in and out by a smooth hash): bush foliage and rocks."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        d = v.co.normalized()
        n = 0.5 * hash3(d.x * 2.3 + seed, d.y * 2.3, d.z * 2.3) + 0.5 * hash3(d.x * 4.1, d.y * 4.1 + seed, d.z * 4.1)
        v.co = v.co * (1.0 + jitter * (n - 0.5))
        v.co.x *= sx
        v.co.y *= sz  # Blender y = -JS z
        v.co.z *= sy  # Blender z = JS y
    bm.to_mesh(mesh)
    bm.free()
    return mc.new_object(name, mesh)


def solid(obj, rgb):
    return paint(obj, lambda x, y, z: rgb)


def set_flat(obj):
    obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))


def set_smooth(obj):
    obj.data.polygons.foreach_set("use_smooth", [True] * len(obj.data.polygons))


# ---------------------------------------------------------------- bird
def build_bird():
    root = empty("bird")
    body = empty("bird_body")
    parent_at(body, root, (0, 0, 0))
    body.scale = (BIRD_SCALE,) * 3  # on bird_body, not the root, so render code can set the root freely
    torso = loft("bird_torso", [
        (-0.3, 0, 0.02, 0.06, 0.05, 0.05, 2.0),
        (-0.18, 0, 0.0, 0.15, 0.14, 0.13, 2.0),
        (0.0, 0, 0.0, 0.2, 0.19, 0.19, 2.0),
        (0.16, 0, 0.04, 0.17, 0.17, 0.15, 2.0),
        (0.24, 0, 0.09, 0.13, 0.13, 0.11, 2.0),  # neck into the head
    ], segs=16, dome=(0.03, 0.02))
    paint(torso, lambda x, y, z: mix(BIRD_BELLY, mix(BIRD, BIRD_LO, smooth(0.08, 0.2, y)), smooth(-0.1, 0.02, y)))
    head = sphere("bird_head", 0.14, 1.0, 0.95, 1.05, segs=14, rings=10)
    paint(head, lambda x, y, z: mix(BIRD_BELLY, mix(BIRD, BIRD_LO, smooth(0.04, 0.13, y)), smooth(-0.08, 0.0, y + 0.03 * (z > 0.06))))
    parent_at(head, body, P(0, 0.13, 0.29))
    beak = loft("bird_beak", [
        (0.0, 0, 0.0, 0.055, 0.04, 0.035, 2.0),
        (0.08, 0, -0.008, 0.03, 0.022, 0.02, 2.0),
        (0.13, 0, -0.015, 0.006, 0.006, 0.006, 2.0),
    ], segs=8)
    solid(beak, BEAK)
    parent_at(beak, body, P(0, 0.11, 0.41))
    parts = [torso, head, beak]
    for s in (-1, 1):
        eye = sphere(f"bird_eye_{s}", 0.032, segs=8, rings=6, hex_color="#1E1612")
        parent_at(eye, body, P(s * 0.1, 0.17, 0.37))
        hi = sphere(f"bird_eye_hi_{s}", 0.011, segs=5, rings=3, hex_color="#FFFFFF")
        parent_at(hi, body, P(s * 0.112, 0.183, 0.392))
        cheek = sphere(f"bird_cheek_{s}", 0.035, 1, 0.7, 1, segs=8, rings=5, hex_color="#FFB08A")
        parent_at(cheek, body, P(s * 0.115, 0.1, 0.33))
        parts += [eye, hi, cheek]
    parent_at(join_static(parts, "bird_body_mesh"), body, (0, 0, 0))

    tail = empty("tail")
    parent_at(tail, body, P(0, 0.03, -0.28), R(-0.25, 0, 0))
    fan = loft("tail_fan", [
        (0.0, 0, 0, 0.05, 0.02, 0.02, 2.0),
        (-0.14, 0, 0, 0.11, 0.018, 0.018, 2.0),
        (-0.24, 0, 0, 0.14, 0.012, 0.012, 2.6),
    ], segs=10, dome=(0, 0.01), wobble=None)
    solid(fan, BIRD_LO)
    parent_at(fan, tail, (0, 0, 0))

    wings = {}
    for side, s in (("l", -1), ("r", 1)):
        w = empty(f"wing_{side}")
        parent_at(w, body, P(s * 0.15, 0.08, 0.02))
        # inner wing: a flat lofted paddle along X (sections: x, cz, cy, half-chord, half-thick up/down)
        inner = loft(f"wing_{side}_inner", [
            (0.0, 0.0, 0, 0.15, 0.035, 0.025, 2.0),
            (s * 0.16, -0.01, 0, 0.16, 0.03, 0.02, 2.2),
            (s * 0.3, -0.02, 0, 0.14, 0.025, 0.017, 2.2),
        ], segs=12, axis="x")
        paint(inner, lambda x, y, z: mix(BIRD, BIRD_LO, 0.25 + 0.4 * smooth(0.0, -0.12, z)))
        parent_at(inner, w, (0, 0, 0))
        tip = empty(f"wing_{side}_tip")
        parent_at(tip, w, P(s * 0.3, 0, -0.02))
        # the tip: tapered and swept back
        outer = loft(f"wing_{side}_outer", [
            (0.0, 0.0, 0, 0.14, 0.022, 0.016, 2.2),
            (s * 0.12, -0.02, 0, 0.12, 0.018, 0.013, 2.2),
            (s * 0.22, -0.05, 0, 0.085, 0.014, 0.01, 2.2),
            (s * 0.29, -0.08, 0, 0.04, 0.01, 0.008, 2.0),
        ], segs=12, axis="x", dome=(0, 0.015))
        paint(outer, lambda x, y, z: mix(BIRD, hex_rgb("#1C5E7A"), 0.3 + 0.7 * smooth(0.1, 0.24, abs(x))))  # dark flight feathers
        parent_at(outer, tip, (0, 0, 0))
        outer.name = f"wing_{side}_tip_mesh"
        wings[side] = (w, tip)
    return {"root": root, "body": body, "tail": tail, "wings": wings}


def bake_flap(c):
    body, tail = c["body"], c["tail"]
    (wl, tl), (wr, tr) = c["wings"]["l"], c["wings"]["r"]
    objs = [body, tail, wl, tl, wr, tr]
    start_clip(objs)
    period, steps = 0.4, 8
    for i in range(steps + 1):
        t = period * i / steps
        ph = TAU * i / steps
        up = 0.2 + 0.85 * math.cos(ph)            # inner wing: +57 deg up .. -37 deg down
        lag = 0.45 * math.cos(ph - 1.1)           # the tip trails the inner wing by ~70 deg
        kf(wl, sec(t), rot=R(0, 0, -up))
        kf(wr, sec(t), rot=R(0, 0, up))
        kf(tl, sec(t), rot=R(0, 0, -lag))
        kf(tr, sec(t), rot=R(0, 0, lag))
        kf(body, sec(t), loc=P(0, 0.035 * math.cos(ph + math.pi), 0), rot=R(0.06 * math.cos(ph), 0, 0))
        kf(tail, sec(t), rot=R(-0.25 + 0.12 * math.cos(ph + 0.6), 0, 0))
    push_to_nla(objs, "flap", 0, sec(period))


# ---------------------------------------------------------------- logs
def bark_fn(cy, segs, moss_amt=0.0, moss_seed=0.0):
    step = TAU / segs

    def fn(x, y, z):
        a = math.atan2(y - cy, z)
        groove = int(round(a / step)) % 2
        c = mix(BARK, BARK_LO, 0.55 * groove + 0.15 * hash3(x * 7, y * 7, z * 7))
        top = smooth(0.55, 0.95, (y - cy) / 0.25)
        m = top * moss_amt * smooth(0.35, 0.65, hash3(x * 1.7 + moss_seed, 0.0, z * 1.3))
        return mix(c, mix(MOSS, MOSS_LO, groove * 0.5), m)
    return fn


def end_disc(name, r, x, cy, s, segs):
    """A log's end grain: concentric light/dark rings on a disc facing +-X."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    centre = bm.verts.new(P(x, cy, 0))
    rings = []
    for k, rr in enumerate((0.3, 0.62, 0.9)):
        rings.append([bm.verts.new(P(x, cy + r * rr * math.sin(TAU * i / segs), r * rr * math.cos(TAU * i / segs))) for i in range(segs)])
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new((centre, rings[0][i], rings[0][j]) if s > 0 else (centre, rings[0][j], rings[0][i]))
        for a, b in zip(rings, rings[1:]):
            bm.faces.new((a[i], b[i], b[j], a[j]) if s > 0 else (a[j], b[j], b[i], a[i]))
    bm.to_mesh(mesh)
    bm.free()
    obj = mc.new_object(name, mesh)

    def fn(px, py, pz):
        d = math.hypot(py - cy, pz) / r
        return WOOD if (d < 0.2 or 0.45 < d < 0.75) else RING
    return paint(obj, fn)


def build_log(name, length, r_l, r_r, stubs, moss, mushrooms, seed):
    g = empty(name)
    segs = 12
    cy = max(r_l, r_r)
    half = length / 2
    secs = []
    for k in range(5):
        u = k / 4
        x = -half + length * u
        r = r_l + (r_r - r_l) * u
        secs.append((x, 0.0, cy - 0.012 * math.sin(math.pi * u), r, r, r, 2.0))
    bark = loft(f"{name}_bark", secs, segs=segs, axis="x", wobble=lambda i: 1.0 if i % 2 == 0 else 0.9, jitter=0.05)
    paint(bark, bark_fn(cy, segs, moss, seed))
    set_flat(bark)
    parts = [bark]
    parts.append(end_disc(f"{name}_end_l", r_l * 0.9, -half - 0.004, cy, -1, segs))
    parts.append(end_disc(f"{name}_end_r", r_r * 0.9, half + 0.004, cy, 1, segs))
    for (sx, ang, ln) in stubs:  # broken branch stubs, pointing backwards (-Z) so the top stays <= 0.5 m
        st = loft(f"{name}_stub{sx}", [
            (0.0, 0, 0, 0.06, 0.06, 0.06, 2.0),
            (-ln, 0, 0, 0.04, 0.04, 0.04, 2.0),
        ], segs=7, axis="z", dome=(0, 0))
        paint(st, lambda x, y, z: mix(BARK, WOOD, smooth(-ln + 0.02, -ln, z)))
        set_flat(st)
        st.location = P(sx, cy + 0.05, -cy * 0.6)
        st.rotation_euler = R(ang, 0, 0)
        parts.append(st)
    for (mx, mz) in mushrooms:
        stem = loft(f"{name}_mstem{mx}", [(0, 0, 0, 0.022, 0.022, 0.022, 2.0), (0.07, 0, 0, 0.018, 0.018, 0.018, 2.0)], segs=6, axis="y")
        solid(stem, hex_rgb("#F6EBD7"))
        stem.location = P(mx, cy * 0.55, mz)
        cap = sphere(f"{name}_mcap{mx}", 0.05, 1, 0.55, 1, segs=8, rings=5, hex_color="#E5484D")
        cap.location = P(mx, cy * 0.55 + 0.075, mz)
        parts += [stem, cap]
    mesh = join_static(parts, f"{name}_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


# ---------------------------------------------------------------- bushes
BUSH_SCALE = 1.5  # matches look.js bush() lumps (r 0.45-0.75): the decor reads at the old size


def build_bush(name, lumps, berries, seed):
    g = empty(name)
    parts = []
    for k, (x, y, z, r, sy, sub) in enumerate(lumps):
        x, y, z, r = x * BUSH_SCALE, y * BUSH_SCALE, z * BUSH_SCALE, r * BUSH_SCALE
        b = lump(f"{name}_l{k}", r, 1.0, sy, 1.0, subdiv=sub + 1, jitter=0.22, seed=seed + k * 3.7)
        hue = (0.0, 0.08, -0.06, 0.04, -0.03, 0.06)[k % 6]

        def fn(px, py, pz, y0=y, r0=r * sy, hue=hue):
            t = smooth(-0.9, 0.9, py / r0)
            c = mix(LEAF_LO, LEAF_HI, 0.15 + 0.75 * t + hue)
            return mix(c, (c[0] * 0.92, c[1] * 1.0, c[2] * 0.9), hash3(px * 6, py * 6, pz * 6))
        paint(b, fn)
        b.location = P(x, y, z)
        parts.append(b)
    for k, (x, y, z) in enumerate(berries):
        x, y, z = x * BUSH_SCALE, y * BUSH_SCALE, z * BUSH_SCALE
        be = sphere(f"{name}_berry{k}", 0.06, segs=6, rings=4, hex_color="#E5484D")
        be.location = P(x, y, z)
        parts.append(be)
    mesh = join_static(parts, f"{name}_mesh")
    set_smooth(mesh)
    parent_at(mesh, g, (0, 0, 0))
    return g


# ---------------------------------------------------------------- A11 blockers
def build_blocker_tree():
    """Spec A11.2: a fallen tree lying along the lane, root plate first (front face at z = 0)."""
    g = empty("blocker_tree")
    segs = 12
    trunk = loft("bt_trunk", [
        (0.15, 0, 0.5, 0.5, 0.5, 0.5, 2.0),
        (1.5, 0, 0.47, 0.45, 0.45, 0.45, 2.0),
        (3.2, 0, 0.42, 0.38, 0.38, 0.38, 2.0),
        (4.8, 0, 0.36, 0.3, 0.3, 0.3, 2.0),
    ], segs=segs, axis="z", wobble=lambda i: 1.0 if i % 2 == 0 else 0.9, jitter=0.05)
    def trunk_col(x, y, z):  # bark_fn's grooves, but around the Z axis, plus a mossy top
        groove = int(round(math.atan2(y - 0.45, x) / (TAU / segs))) % 2
        c = mix(BARK, BARK_LO, 0.55 * groove + 0.15 * hash3(x * 7, y * 7, z * 7))
        return mix(c, MOSS, 0.8 * smooth(0.72, 0.9, y) * smooth(0.3, 0.6, hash3(x * 2, 0.0, z * 1.1)))
    paint(trunk, trunk_col)
    set_flat(trunk)
    plate = loft("bt_plate", [
        (0.0, 0, 0.75, 0.78, 0.75, 0.75, 2.0),
        (0.3, 0, 0.72, 0.62, 0.6, 0.6, 2.0),
    ], segs=16, axis="z", dome=(0.06, 0.0), wobble=lambda i: (1.0, 0.86, 0.96, 0.82)[i % 4], jitter=0.08)
    paint(plate, lambda x, y, z: mix(SOIL, ROOT, 0.5 * hash3(x * 5, y * 5, 0) + 0.4 * smooth(0.05, 0.25, z)))
    set_flat(plate)
    parts = [trunk, plate]
    for k in range(6):  # roots fanning out of the plate's face
        a = TAU * (k + 0.3) / 6
        rt = loft(f"bt_root{k}", [(0.0, 0, 0, 0.07, 0.07, 0.07, 2.0), (-0.28, 0, 0, 0.03, 0.03, 0.03, 2.0)], segs=6, axis="z")
        solid(rt, ROOT)
        rt.location = P(0.55 * math.cos(a), 0.75 + 0.52 * math.sin(a), 0.0)
        rt.rotation_euler = R(0.5 * math.sin(a), -0.5 * math.cos(a), 0)
        parts.append(rt)
    for k, (x, y) in enumerate(((-0.3, 0.35), (0.35, 1.05), (0.1, 0.6))):  # soil clods on the face
        cl = lump(f"bt_clod{k}", 0.13, 1, 0.8, 0.6, subdiv=1, jitter=0.3, seed=k)
        solid(cl, SOIL)
        cl.location = P(x, y, -0.04)
        parts.append(cl)
    br = loft("bt_branch", [(0.0, 0, 0, 0.09, 0.09, 0.09, 2.0), (0.6, 0, 0, 0.05, 0.05, 0.05, 2.0)], segs=7, axis="x")
    solid(br, BARK)
    br.location = P(0.3, 0.7, 2.6)
    br.rotation_euler = R(0, 0.5, 0.6)
    parts.append(br)
    mesh = join_static(parts, "blocker_tree_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


def build_blocker_rocks():
    """Spec A11.2: a mossy rock pile, 1.6 x 2.8 x ~1.4 m, front face at z = 0."""
    g = empty("blocker_rocks")
    parts = []
    for k, (x, y, z, r, sx, sy, sz) in enumerate((
        (0.0, 0.62, 0.75, 0.72, 1.1, 0.95, 1.0),
        (-0.35, 0.42, 1.8, 0.55, 1.0, 0.85, 1.1),
        (0.4, 0.38, 1.6, 0.48, 0.9, 0.85, 1.1),
        (0.05, 0.4, 2.35, 0.45, 1.3, 0.9, 1.0),
    )):
        rk = lump(f"br_rock{k}", r, sx, sy, sz, subdiv=3 if k == 0 else 2, jitter=0.28, seed=11 + k)  # Blender 5: subdivisions=1 is the bare icosahedron

        def fn(px, py, pz, r0=r * sy):
            t = py / r0
            c = mix(STONE_LO, STONE, smooth(-0.8, 0.3, t))
            m = smooth(0.45, 0.8, t) * smooth(0.3, 0.55, hash3(px * 3, 1.0, pz * 3))
            return mix(c, MOSS, m)
        paint(rk, fn)
        set_flat(rk)
        rk.location = P(x, y, z)
        parts.append(rk)
    mesh = join_static(parts, "blocker_rocks_mesh")
    parent_at(mesh, g, (0, 0, 0))
    return g


# ---------------------------------------------------------------- export
def export(path):
    bpy.context.scene.frame_set(0)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=False,
        export_animation_mode="NLA_TRACKS", export_merge_animation="NLA_TRACK", export_bake_animation=False,
        export_optimize_animation_size=True, export_apply=True, export_materials="EXPORT",
        export_vertex_color="ACTIVE", export_normals=True, export_yup=True, export_cameras=False, export_lights=False,
    )


def per_root_tris():
    out = {}
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        top = o
        while top.parent:
            top = top.parent
        o.data.calc_loop_triangles()
        out[top.name] = out.get(top.name, 0) + len(o.data.loop_triangles)
    return out


def main():
    argv = sys.argv
    out_dir = argv[argv.index("--") + 1] if "--" in argv else "assets"
    os.makedirs(out_dir, exist_ok=True)

    mc.reset_scene()
    c = build_bird()
    for o in bpy.data.objects:
        if o.type == "MESH":
            set_smooth(o)
    bake_flap(c)
    p = os.path.join(out_dir, "bird.glb")
    export(p)
    print(f"PROPS_BUILD_OK bird tris={per_root_tris()} bytes={os.path.getsize(p)}")

    mc.reset_scene()
    build_log("log_a", 1.7, 0.24, 0.23, [(-0.3, 0.5, 0.2)], 0.9, [], 1.0)
    build_log("log_b", 1.5, 0.22, 0.25, [(0.35, 0.6, 0.16), (-0.45, 0.35, 0.12)], 0.0, [], 2.0)
    build_log("log_c", 1.8, 0.24, 0.24, [], 1.0, [(0.45, 0.2), (0.56, 0.14)], 3.0)
    build_bush("bush_a", [(0, 0.38, 0, 0.42, 0.85, 2), (-0.42, 0.3, 0.05, 0.33, 0.85, 1), (0.42, 0.3, -0.05, 0.34, 0.85, 1), (0.1, 0.3, 0.3, 0.28, 0.8, 1)], [], 1.0)
    build_bush("bush_b", [(0, 0.45, 0, 0.42, 1.0, 2), (0.05, 0.92, 0.0, 0.3, 1.0, 1), (-0.3, 0.3, 0.1, 0.28, 0.9, 1), (0.32, 0.32, -0.08, 0.27, 0.9, 1)], [], 2.0)
    build_bush("bush_c", [(0, 0.4, 0, 0.4, 0.9, 2), (-0.38, 0.32, 0.06, 0.3, 0.85, 1), (0.36, 0.3, 0.0, 0.32, 0.85, 1)],
               [(0.12, 0.72, 0.28), (-0.2, 0.62, 0.3), (0.35, 0.5, 0.25), (-0.45, 0.42, 0.22), (0.02, 0.55, 0.4), (0.25, 0.75, 0.05)], 3.0)
    build_blocker_tree()
    build_blocker_rocks()
    p = os.path.join(out_dir, "props.glb")
    export(p)
    print(f"PROPS_BUILD_OK props tris={per_root_tris()} bytes={os.path.getsize(p)}")


if __name__ == "__main__":
    main()
