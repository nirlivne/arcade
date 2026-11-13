"""In-house Blender build script for the Capy Trail capybara (THE-1259 S2, spec G4).

Run headless:
    blender --background --python build/make_capy.py -- <out.glb>

Ports the proportions, palette and pose math of the S1 procedural stand-in
(render/capy.js, itself ported from the art brief's design/capy-trail/scene.js)
into a real low-poly mesh + node hierarchy, so the model sheet (brief png/14)
and key poses (png/15) are the ground truth this script targets, not a fresh
sculpt. No textures: flat per-part vertex colours, matching render/look.js's
CAPY palette. Nodes are NOT skinned (no armature) -- every part is its own
rigid glTF node parented in the same tree buildCapy() builds with THREE.Group
pivots, so render/capy.js can keep driving lids/lean/coin-grab by rotating
named nodes directly, exactly as it drove pivot groups in S1.

Axis note: Blender is Z-up, three.js/glTF is Y-up. Blender's glTF exporter
auto-converts Z-up -> Y-up on export (+Y Up, forward -Y), which works out to
this basis change from a JS (x,y,z) triple: Blender(x,y,z) = (x, -z, y). That
map is a proper rotation (+90 deg about X), so JS local-axis rotations carry
over as: JS rotation.x -> Blender rotation_euler.x (same sign), JS
rotation.y -> Blender rotation_euler.z (same sign), JS rotation.z -> Blender
rotation_euler.y (negated). P()/R()/S() below apply exactly that, so the
numbers below are transcribed straight from buildCapy()/pose() in
render/capy.js without re-deriving the mapping at each call site.
"""
import bpy
import bmesh
import math
import mathutils
import os
import sys

TAU = math.pi * 2


def P(x, y, z):
    return (x, -z, y)


def R(rx=0.0, ry=0.0, rz=0.0):
    return (rx, -rz, ry)


def S(sx=1.0, sy=1.0, sz=1.0):
    return (sx, sz, sy)


# ---------------------------------------------------------------- scene reset
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.render.fps = FPS


# ---------------------------------------------------------------- geometry
def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def set_vertex_color(obj, hex_color, alpha=1.0):
    # CTO fix B3 (THE-1259 S2 review): hex bytes are sRGB; Attribute.data[i].color is linear, so writing
    # raw hex/255 there (skipping the sRGB->linear conversion) rendered pale. color_srgb does that
    # conversion on write.
    r = int(hex_color[1:3], 16) / 255.0
    g = int(hex_color[3:5], 16) / 255.0
    b = int(hex_color[5:7], 16) / 255.0
    mesh = obj.data
    attr = mesh.color_attributes.new(name="Color", type="BYTE_COLOR", domain="CORNER")
    for d in attr.data:
        d.color_srgb = (r, g, b, alpha)
    mesh.color_attributes.active_color = attr
    mat = bpy.data.materials.get("CapyVertexColor")
    if mat is None:
        mat = bpy.data.materials.new("CapyVertexColor")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        vc = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Color"
        mat.node_tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        mat.roughness = 0.88
    if mesh.materials:
        mesh.materials[0] = mat
    else:
        mesh.materials.append(mat)


def sphere(name, radius, sx=1.0, sy=1.0, sz=1.0, segs=12, rings=8, hex_color="#C99A68"):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    obj = new_object(name, mesh)
    obj.scale = S(sx, sy, sz)
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_vertex_color(obj, hex_color)
    return obj


def hemisphere(name, radius, segs=12, rings=6, hex_color="#C99A68"):
    """The lid: JS builds a half SphereGeometry (thetaLength=PI/2, the +Y cap)
    so rotating it actually covers/uncovers the eyeball -- a full sphere is
    rotationally symmetric and looks identical at every angle. JS +Y is
    Blender +Z (P()'s mapping), so keep the z >= 0 cap and drop the rest."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    obj = new_object(name, mesh)
    set_vertex_color(obj, hex_color)
    return obj


def rounded_box(name, w, h, d, r, seg=3, hex_color="#C99A68"):
    """Port of render/look.js roundedBoxLocal: a segmented box with each vertex
    clamped toward an inset core and pushed out radius r, same algorithm, same
    corner feel, lower seg for a lower poly count."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=seg, use_grid_fill=True)
    bm.to_mesh(mesh)
    bm.free()
    obj = new_object(name, mesh)
    obj.scale = (w, d, h)
    select_only(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    inner = mathutils.Vector((w / 2 - r, d / 2 - r, h / 2 - r))
    for v in obj.data.vertices:
        c = mathutils.Vector(v.co)
        cc = mathutils.Vector((
            max(-inner.x, min(inner.x, c.x)),
            max(-inner.y, min(inner.y, c.y)),
            max(-inner.z, min(inner.z, c.z)),
        ))
        n = c - cc
        if n.length_squared > 0:
            n = n.normalized() * r
        v.co = cc + n
    obj.data.update()
    set_vertex_color(obj, hex_color)
    return obj


# ---------------------------------------------------------------- R3 (THE-1282) lofted clay shapes
def hex_rgb(h):
    return (int(h[1:3], 16) / 255.0, int(h[3:5], 16) / 255.0, int(h[5:7], 16) / 255.0)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def hash3(x, y, z):
    v = math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return v - math.floor(v)


def superellipse_ring(hw, ht, hb, n, segs, wobble=None):
    """Points of a superellipse cross-section: exponent n=2 is an ellipse, higher
    is boxier (capybara heads are blocks with round corners, n ~3). ht/hb are
    the half-heights above/below the centre, so a section can sag (a belly) or
    flatten (a skull top). wobble(i) scales the radius per point (bark ridges)."""
    pts = []
    for i in range(segs):
        a = TAU * i / segs
        c, s = math.cos(a), math.sin(a)
        k = wobble(i) if wobble else 1.0
        x = hw * k * math.copysign(abs(c) ** (2.0 / n), c)
        y = (ht if s >= 0 else hb) * k * math.copysign(abs(s) ** (2.0 / n), s)
        pts.append((x, y))
    return pts


def loft(name, sections, segs=20, axis="z", dome=(0.0, 0.0), wobble=None, jitter=0.0):
    """A closed tube through superellipse sections (JS coords, converted with
    P()). axis "z": each section is (z, cx, cy, hw, ht, hb, n), a ring in the
    XY plane; axis "y": (y, cx, cz, hw, hfront, hback, n), a ring in XZ; axis
    "x": (x, cz, cy, hd, ht, hb, n), a ring in ZY. Both ends are capped with a
    fan whose centre is pushed out by dome[0]/dome[1] for a rounded end.
    jitter adds a small deterministic lumpiness (hand-made clay)."""
    bm = bmesh.new()
    rings = []

    def js_point(t, ca, cb, u, v):
        if axis == "z":
            return (ca + u, cb + v, t)
        if axis == "y":
            return (ca + u, t, cb + v)
        return (t, cb + v, ca + u)

    for (t, ca, cb, hw, ht, hb, n) in sections:
        ring = []
        for (u, v) in superellipse_ring(hw, ht, hb, n, segs, wobble):
            x, y, z = js_point(t, ca, cb, u, v)
            if jitter:
                j = 1.0 + jitter * (hash3(x * 9.1, y * 9.3, z * 9.7) - 0.5)
                cx, cy, cz = js_point(t, ca, cb, 0.0, 0.0)
                x, y, z = cx + (x - cx) * j, cy + (y - cy) * j, cz + (z - cz) * j
            ring.append(bm.verts.new(P(x, y, z)))
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
    sign = 1 if sections[-1][0] > sections[0][0] else -1
    for ring, sec, d, end in ((rings[0], sections[0], dome[0], -1), (rings[-1], sections[-1], dome[1], 1)):
        t, ca, cb = sec[0], sec[1], sec[2]
        c = bm.verts.new(P(*js_point(t + end * sign * d, ca, cb, 0.0, 0.0)))
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((ring[i], ring[j], c) if end > 0 else (ring[j], ring[i], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return new_object(name, mesh)


def paint(obj, fn):
    """Per-vertex colour from fn(js_x, js_y, js_z) -> sRGB (r, g, b) in the
    object's local space. Same material and attribute as set_vertex_color."""
    mesh = obj.data
    if "Color" not in mesh.color_attributes:
        set_vertex_color(obj, "#FFFFFF")
    attr = mesh.color_attributes["Color"]
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            r, g, b = fn(co.x, co.z, -co.y)  # Blender (x, y, z) -> JS (x, z, -y)
            attr.data[li].color_srgb = (r, g, b, 1.0)
    return obj


def capsule_leg(name, radius, length, hex_color="#C99A68"):
    """Approximates three's CapsuleGeometry (round caps, straight middle) with
    a stretched UV sphere -- a fair stand-in at this silhouette scale and far
    cheaper to build reliably than hand-joining cylinder + 2 hemispheres."""
    stretch = (length / 2 + radius) / radius
    return sphere(name, radius, 1.0, stretch, 1.0, segs=10, rings=7, hex_color=hex_color)


def empty(name):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_size = 0.02
    return obj


def parent_at(child, parent, loc, rot=(0, 0, 0)):
    child.parent = parent
    child.location = loc
    child.rotation_euler = rot
    return child


def join_static(parts, result_name):
    """Merge sibling mesh parts that never move independently of each other
    into one glTF primitive -- fewer accessors/bufferViews, smaller JSON. Only
    called on parts under a pivot that, if it animates at all, moves them all
    together (e.g. a leg's capsule + paw); anything independently keyframed
    (lids, mouth) is kept as its own object so it stays its own node."""
    if len(parts) == 1:
        parts[0].name = result_name
        return parts[0]
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = result_name
    return parts[0]


# ---------------------------------------------------------------- palette (render/look.js CAPY)
FUR, FUR_LO, BELLY, SNOUT = "#C99A68", "#A97C52", "#E2C092", "#A87A52"
NOSE, EYE, EAR, INNER = "#3B2A22", "#1E1612", "#7E5638", "#C98F78"
ORANGE, LEAF, STEM = "#FF8A2A", "#4E9A45", "#5A3A22"
WHITE = "#FFFFFF"
# R3 (THE-1282): the darker back, the nose pad and the near-black feet of a real capybara, in the clay key
BACK, PAD, FOOT = "#A06C44", "#5E4130", "#4A3326"
LID = "#B4845A"  # the head's own colour at eye height (FUR -> BACK gradient), so the lids don't read as pale patches
FUR_RGB, BACK_RGB, BELLY_RGB = hex_rgb(FUR), hex_rgb(BACK), hex_rgb(BELLY)
SNOUT_RGB, FOOT_RGB = hex_rgb(SNOUT), hex_rgb(FOOT)


def build_capy():
    root = empty("root")

    body = empty("body")
    parent_at(body, root, P(0, 0.5, 0))

    # R3 (THE-1282): a lofted barrel instead of a squashed sphere. A capybara is a long, deep barrel
    # with a high round rump, no tail and a thick neck rising into the head; from the chase camera
    # (behind and above) the rump, the back gradient and the blocky head past the shoulders are what
    # say "capybara", not "teddy". Sections are (z, cx, cy, half-width, half-height up, down, n).
    trunk = loft("body_loaf", [
        (-0.53, 0, 0.05, 0.12, 0.10, 0.10, 2.0),
        (-0.48, 0, 0.05, 0.25, 0.25, 0.22, 2.2),
        (-0.36, 0, 0.05, 0.335, 0.31, 0.27, 2.3),   # haunches, the widest point
        (-0.16, 0, 0.03, 0.335, 0.30, 0.30, 2.4),
        (0.06, 0, 0.02, 0.32, 0.29, 0.31, 2.4),      # deep chest / belly sag
        (0.25, 0, 0.04, 0.285, 0.27, 0.28, 2.3),     # shoulders
        (0.38, 0, 0.09, 0.225, 0.23, 0.22, 2.2),     # neck, rising
        (0.47, 0, 0.14, 0.17, 0.18, 0.16, 2.2),
    ], segs=22, dome=(0.03, 0.03), jitter=0.035)
    top_y, bot_y = 0.36, -0.29

    def body_col(x, y, z):
        t = (y - bot_y) / (top_y - bot_y)
        c = mix(BELLY_RGB, FUR_RGB, smooth(0.12, 0.45, t))
        c = mix(c, BACK_RGB, smooth(0.62, 0.95, t))
        c = mix(c, BACK_RGB, 0.35 * smooth(-0.30, -0.50, z) * smooth(0.3, 0.7, t))  # darker rump cap
        k = 0.95 + 0.1 * hash3(x * 13.0, y * 13.0, z * 13.0)  # coarse-fur mottling
        return tuple(min(1.0, v * k) for v in c)

    paint(trunk, body_col)
    parent_at(trunk, body, P(0, 0, 0))
    haunches = []
    for side, s in (("l", -1), ("r", 1)):  # haunch bulges over the hind legs
        h = sphere(f"haunch_{side}", 0.2, 0.75, 1.0, 1.15, segs=12, rings=8)
        paint(h, lambda x, y, z: mix(FUR_RGB, BACK_RGB, smooth(0.0, 0.18, y)))
        parent_at(h, body, P(s * 0.2, 0.02, -0.3))
        haunches.append(h)
    join_static([trunk] + haunches, "body_mesh")

    head = empty("head")
    parent_at(head, body, P(0, 0.16, 0.42))

    # The head: one blocky lofted skull + muzzle. Capybara cues: a flat top sloping straight to the
    # nose, a deep square muzzle (taller than it is wide at the front), the eyes and ears set high and
    # back, and the dark nose pad on top of the snout (it reads from behind and above).
    skull = loft("head_skull", [
        (-0.07, 0, 0.11, 0.13, 0.13, 0.12, 2.2),
        (0.00, 0, 0.11, 0.205, 0.21, 0.19, 2.6),
        (0.12, 0, 0.11, 0.225, 0.22, 0.21, 2.8),     # cheeks, at the eyes
        (0.28, 0, 0.08, 0.205, 0.205, 0.215, 3.0),
        (0.44, 0, 0.05, 0.185, 0.19, 0.205, 3.2),    # deep, square muzzle
        (0.56, 0, 0.04, 0.17, 0.17, 0.185, 3.2),
        (0.625, 0, 0.04, 0.14, 0.14, 0.155, 2.8),
    ], segs=20, dome=(0.02, 0.035), jitter=0.025)

    def head_col(x, y, z):
        c = mix(FUR_RGB, BACK_RGB, smooth(0.12, 0.3, y))
        c = mix(c, BELLY_RGB, 0.45 * smooth(-0.02, -0.14, y) * smooth(0.25, 0.05, z))  # pale jaw
        c = mix(c, SNOUT_RGB, smooth(0.42, 0.62, z))  # darker muzzle front
        k = 0.96 + 0.08 * hash3(x * 15.0, y * 15.0, z * 15.0)
        return tuple(min(1.0, v * k) for v in c)

    paint(skull, head_col)
    parent_at(skull, head, P(0, 0, 0))
    pad = sphere("nose_pad", 0.085, 1.25, 0.32, 1.0, segs=10, rings=6, hex_color=PAD)  # the morrillo
    parent_at(pad, head, P(0, 0.235, 0.43))
    nose_l = sphere("nose_l", 0.04, 1.2, 0.55, 0.7, segs=6, rings=4, hex_color=NOSE)
    parent_at(nose_l, head, P(-0.06, 0.12, 0.655))
    nose_r = sphere("nose_r", 0.04, 1.2, 0.55, 0.7, segs=6, rings=4, hex_color=NOSE)
    parent_at(nose_r, head, P(0.06, 0.12, 0.655))
    join_static([skull, pad, nose_l, nose_r], "head_mesh")

    mouth = rounded_box("mouth", 0.13, 0.022, 0.04, 0.01, seg=1, hex_color=NOSE)
    parent_at(mouth, head, P(0, -0.05, 0.655))

    eyes = {}
    for side, s in (("l", -1), ("r", 1)):
        e = empty(f"eye_{side}")
        parent_at(e, head, P(s * 0.205, 0.2, 0.2), R(0, s * 0.5, 0))
        ball = sphere(f"eye_{side}_ball", 0.06, 1, 1, 0.75, segs=8, rings=6, hex_color=EYE)
        parent_at(ball, e, (0, 0, 0))
        hi = sphere(f"eye_{side}_hi", 0.019, segs=5, rings=3, hex_color=WHITE)
        parent_at(hi, e, P(0.0, 0.006, 0.045))
        join_static([ball, hi], f"eye_{side}_ball")
        lid = empty(f"eye_{side}_lid")
        parent_at(lid, e, (0, 0, 0), R(0.25, 0, 0))
        lid_mesh = hemisphere(f"eye_{side}_lid_mesh", 0.068, segs=9, rings=5, hex_color=LID)
        parent_at(lid_mesh, lid, (0, 0, 0))
        eyes[side] = {"pivot": e, "lid": lid}

    ears = {}
    for side, s in (("l", -1), ("r", 1)):
        p = empty(f"ear_{side}")
        parent_at(p, head, P(s * 0.17, 0.3, 0.0), R(0, 0, s * -0.35))
        outer = sphere(f"ear_{side}_outer", 0.065, 1, 0.9, 0.45, segs=10, rings=7, hex_color=EAR)
        parent_at(outer, p, (0, 0, 0))
        innr = sphere(f"ear_{side}_inner", 0.042, 1, 0.85, 0.3, segs=6, rings=4, hex_color=INNER)
        parent_at(innr, p, P(0, 0, 0.018))
        join_static([outer, innr], f"ear_{side}_mesh")
        ears[side] = p

    topper = empty("topper")
    parent_at(topper, head, P(0, 0.34, 0.16))
    orange = sphere("topper_orange", 0.115, 1, 0.92, 1, segs=13, rings=9, hex_color=ORANGE)
    parent_at(orange, topper, P(0, 0.1, 0))
    leaf = sphere("topper_leaf", 0.06, 1.6, 0.25, 0.8, segs=6, rings=4, hex_color=LEAF)
    parent_at(leaf, topper, P(0.04, 0.215, 0), R(0, 0, -0.5))
    # stem: a short cylinder, built directly (no sph helper -- matches the JS CylinderGeometry call)
    stem_mesh = bpy.data.meshes.new("topper_stem")
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.012, radius2=0.01, depth=0.04)
    bm.to_mesh(stem_mesh)
    bm.free()
    stem = new_object("topper_stem", stem_mesh)
    stem.rotation_euler = R(math.pi / 2, 0, 0)
    select_only(stem)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    set_vertex_color(stem, STEM)
    parent_at(stem, topper, P(0, 0.21, 0))
    join_static([orange, leaf, stem], "topper_mesh")

    legs = {}
    for k, x, z in (("fl", -0.18, 0.3), ("fr", 0.18, 0.3), ("bl", -0.2, -0.28), ("br", 0.2, -0.28)):
        p = empty(f"leg_{k}")
        parent_at(p, body, P(x, -0.12, z))
        # R3: a tapered leg (thick upper, slim lower; hind legs thicker at the thigh) that darkens to
        # near-black feet, as a capybara's do. Same pivot and the same reach as S2, so the clips hold.
        hind = k[0] == "b"
        top = 0.115 if hind else 0.1
        leg = loft(f"leg_{k}_capsule", [
            (0.05, 0, 0, top, top * 1.05, top, 2.0),
            (-0.08, 0, 0.0, 0.085, 0.085, 0.085, 2.0),
            (-0.2, 0, 0.01, 0.064, 0.064, 0.064, 2.0),
            (-0.27, 0, 0.015, 0.06, 0.062, 0.058, 2.0),
        ], segs=10, axis="y", dome=(0.03, 0.02))
        paint(leg, lambda x, y, z: mix(FUR_RGB if not hind else BACK_RGB, FOOT_RGB, smooth(-0.1, -0.24, y)))
        parent_at(leg, p, (0, 0, 0))
        paw = sphere(f"leg_{k}_paw", 0.075, 1.1, 0.55, 1.35, segs=9, rings=6, hex_color=FOOT)
        parent_at(paw, p, P(0, -0.29, 0.03))
        join_static([leg, paw], f"leg_{k}_mesh")
        legs[k] = p

    return {
        "root": root, "body": body, "head": head, "eyes": eyes, "ears": ears,
        "legs": legs, "mouth": mouth, "topper": topper,
    }


# ---------------------------------------------------------------- animation (5 clips, G4)
def kf(obj, frame, loc=None, rot=None, scale=None):
    bpy.context.scene.frame_set(frame)
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert(data_path="location", frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert(data_path="rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert(data_path="scale", frame=frame)


def start_clip(objs):
    for o in objs:
        o.animation_data_create()
        o.animation_data.action = bpy.data.actions.new(f"{o.name}_tmp")


def push_to_nla(objs, clip_name, start_frame, end_frame):
    for o in objs:
        ad = o.animation_data
        action = ad.action
        action.name = f"{o.name}__{clip_name}"
        track = ad.nla_tracks.new()
        track.name = clip_name
        track.strips.new(clip_name, start_frame, action)
        ad.action = None


FPS = 120  # fine enough that frame rounding doesn't drift jump/duck timings off spec


def sec(s):
    # Blender's glTF exporter samples keyframe time as frame / scene.fps
    # directly (no "first frame" offset), so frame 0 must be t=0.
    return round(s * FPS)


def bake_idle(c):
    body, head, mouth = c["body"], c["head"], c["mouth"]
    legs, ears = c["legs"], c["ears"]
    objs = [body, head, mouth, legs["fl"], legs["fr"], legs["bl"], legs["br"]]
    start_clip(objs)
    dur = 2.0
    n = 16
    for i in range(n + 1):
        t = i / n
        f = sec(t * dur)
        kf(body, f, loc=P(0, 0.42, 0), rot=R(-0.22, 0, 0))
        kf(head, f, rot=R(0.18 + math.sin(t * TAU) * 0.02, 0, 0))
        kf(mouth, f, scale=(1 + 0.3 * math.sin(t * TAU * 3), 1, 1))
        kf(legs["fl"], f, rot=R(0.1, 0, 0))
        kf(legs["fr"], f, rot=R(0.1, 0, 0))
        kf(legs["bl"], f, loc=P(-0.2, -0.12 - 0.02, -0.28), rot=R(-1.2, 0, 0))
        kf(legs["br"], f, loc=P(0.2, -0.12 - 0.02, -0.28), rot=R(-1.2, 0, 0))
    push_to_nla(objs, "idle", 0, sec(dur))


def bake_gallop(c):
    body, head = c["body"], c["head"]
    legs, ears, topper = c["legs"], c["ears"], c["topper"]
    objs = [body, head, legs["fl"], legs["fr"], legs["bl"], legs["br"], ears["l"], ears["r"], topper]
    start_clip(objs)
    dur = 0.42  # base cycle at 8 m/s; render/capy.js timeScales the action by v/8
    n = 16
    for i in range(n + 1):
        t = i / n
        a = t * TAU
        f = sec(t * dur)
        kf(body, f, loc=P(0, 0.5 + abs(math.sin(a)) * 0.06, 0), rot=R(math.sin(a) * 0.12, 0, 0))
        kf(head, f, rot=R(-math.sin(a) * 0.1, 0, 0))
        fl_fr = math.sin(a) * 0.9
        kf(legs["fl"], f, rot=R(fl_fr, 0, 0))
        kf(legs["fr"], f, rot=R(fl_fr + 0.12, 0, 0))
        bl_br = math.sin(a + math.pi) * 0.9
        kf(legs["bl"], f, rot=R(bl_br, 0, 0))
        kf(legs["br"], f, rot=R(bl_br + 0.12, 0, 0))
        er = -0.25 - math.sin(a) * 0.25
        kf(ears["l"], f, rot=R(er, 0, -0.35))
        kf(ears["r"], f, rot=R(er, 0, 0.35))
        kf(topper, f, rot=R(0, math.sin(a) * 0.08, 0))
    push_to_nla(objs, "gallop", 0, sec(dur))


def bake_jump(c):
    body, head = c["body"], c["head"]
    legs, ears, topper = c["legs"], c["ears"], c["topper"]
    objs = [body, head, legs["fl"], legs["fr"], legs["bl"], legs["br"], ears["l"], ears["r"], topper]
    start_clip(objs)
    dur = 0.65  # G4: lifts on press frame, 0.65 s air, tuck, squash + ear flop on landing
    t_liftoff, t_apex, t_land = 0.0, dur * 0.45, dur
    # liftoff: legs start tucking, body already rising off the gallop pose
    kf(body, sec(t_liftoff), loc=P(0, 0.52, 0), rot=R(-0.1, 0, 0))
    kf(head, sec(t_liftoff), rot=R(-0.05, 0, 0))
    kf(legs["fl"], sec(t_liftoff), rot=R(-0.4, 0, 0))
    kf(legs["fr"], sec(t_liftoff), rot=R(-0.4, 0, 0))
    kf(legs["bl"], sec(t_liftoff), rot=R(0.4, 0, 0))
    kf(legs["br"], sec(t_liftoff), rot=R(0.4, 0, 0))
    kf(ears["l"], sec(t_liftoff), rot=R(0.2, 0, -0.35))
    kf(ears["r"], sec(t_liftoff), rot=R(0.2, 0, 0.35))
    # apex: full tuck (S1 "jump" pose)
    kf(body, sec(t_apex), loc=P(0, 0.5, 0), rot=R(-0.18, 0, 0))
    kf(head, sec(t_apex), rot=R(-0.15, 0, 0))
    kf(legs["fl"], sec(t_apex), rot=R(-1.1, 0, 0))
    kf(legs["fr"], sec(t_apex), rot=R(-1.1, 0, 0))
    kf(legs["bl"], sec(t_apex), rot=R(1.1, 0, 0))
    kf(legs["br"], sec(t_apex), rot=R(1.1, 0, 0))
    kf(ears["l"], sec(t_apex), rot=R(0.6, 0, -0.35))
    kf(ears["r"], sec(t_apex), rot=R(0.6, 0, 0.35))
    kf(topper, sec(t_apex), loc=P(0, 0.34 + 0.08, 0.16))
    # landing: squash (S1 "land" pose) + ear flop
    kf(body, sec(t_land), loc=P(0, 0.4, 0), rot=R(-0.04, 0, 0))
    kf(head, sec(t_land), rot=R(0.05, 0, 0))
    kf(legs["fl"], sec(t_land), rot=R(-0.15, 0, 0))
    kf(legs["fr"], sec(t_land), rot=R(-0.15, 0, 0))
    kf(legs["bl"], sec(t_land), rot=R(0.15, 0, 0))
    kf(legs["br"], sec(t_land), rot=R(0.15, 0, 0))
    kf(ears["l"], sec(t_land), rot=R(-0.7, 0, -0.35))
    kf(ears["r"], sec(t_land), rot=R(-0.7, 0, 0.35))
    kf(topper, sec(t_land), loc=P(0, 0.34, 0.16))
    push_to_nla(objs, "jump", 0, sec(dur))


def bake_duck(c):
    body, head = c["body"], c["head"]
    legs, ears = c["legs"], c["ears"]
    objs = [body, head, legs["fl"], legs["fr"], legs["bl"], legs["br"], ears["l"], ears["r"]]
    start_clip(objs)
    dur = 0.6  # G4: 0.6 s belly-slide, ears flat
    t_enter = 0.12
    kf(body, sec(0), loc=P(0, 0.5, 0), rot=R(0, 0, 0))
    kf(legs["fl"], sec(0), rot=R(0, 0, 0))
    kf(legs["fr"], sec(0), rot=R(0, 0, 0))
    kf(legs["bl"], sec(0), rot=R(0, 0, 0))
    kf(legs["br"], sec(0), rot=R(0, 0, 0))
    kf(ears["l"], sec(0), rot=R(-0.25, 0, -0.35))
    kf(ears["r"], sec(0), rot=R(-0.25, 0, 0.35))
    slide = dict(loc=P(0, 0.3, 0), rot=R(0.05, 0, 0))
    kf(body, sec(t_enter), **slide)
    kf(head, sec(t_enter), rot=R(0.12, 0, 0))
    kf(legs["fl"], sec(t_enter), loc=P(-0.18, -0.16, 0.3), rot=R(-1.45, 0, 0))
    kf(legs["fr"], sec(t_enter), loc=P(0.18, -0.16, 0.3), rot=R(-1.45, 0, 0))
    kf(legs["bl"], sec(t_enter), loc=P(-0.2, -0.16, -0.28), rot=R(1.45, 0, 0))
    kf(legs["br"], sec(t_enter), loc=P(0.2, -0.16, -0.28), rot=R(1.45, 0, 0))
    kf(ears["l"], sec(t_enter), rot=R(1.1, 0, -0.35))
    kf(ears["r"], sec(t_enter), rot=R(1.1, 0, 0.35))
    kf(body, sec(dur), **slide)
    kf(head, sec(dur), rot=R(0.12, 0, 0))
    push_to_nla(objs, "duck", 0, sec(dur))


def bake_crash(c):
    """G4's 5th clip, 'stumble/crash': one clip shared by the 0.6 s grace-period
    stumble and the full 1.2 s crash gag. render/capy.js S2 plays the first 0.6 s
    for a stumble (then blends back to gallop) and the full clip, held on its
    last frame, for a crash."""
    root, body, head, topper = c["root"], c["body"], c["head"], c["topper"]
    legs, ears = c["legs"], c["ears"]
    objs = [root, body, head, topper, legs["fl"], legs["fr"], legs["bl"], legs["br"], ears["l"], ears["r"]]
    start_clip(objs)
    t_stumble, t_settle = 0.6, 1.0
    kf(root, sec(0), rot=R(0, 0, 0))
    kf(body, sec(0), loc=P(0, 0.5, 0), rot=R(0, 0, 0))
    kf(head, sec(0), rot=R(0, 0, 0))
    kf(topper, sec(0), loc=P(0, 0.34, 0.16), rot=R(0, 0, 0))
    # stumble (0.6 s): S1 "stumble" pose -- surprised, wobble, orange rattles
    kf(root, sec(t_stumble), rot=R(0, 0, 0.15))
    kf(body, sec(t_stumble), loc=P(0, 0.42, 0), rot=R(0.5, 0, 0))
    kf(head, sec(t_stumble), rot=R(0.2, 0, 0))
    kf(legs["fl"], sec(t_stumble), rot=R(-1.3, 0, 0))
    kf(legs["fr"], sec(t_stumble), rot=R(-1.3, 0, 0))
    kf(legs["bl"], sec(t_stumble), rot=R(0.8, 0, 0))
    kf(legs["br"], sec(t_stumble), rot=R(1.3, 0, 0))
    kf(ears["l"], sec(t_stumble), rot=R(0.9, 0, -0.35))
    kf(ears["r"], sec(t_stumble), rot=R(0.9, 0, 0.35))
    kf(topper, sec(t_stumble), loc=P(0, 0.34 + 0.06, 0.16), rot=R(0, 0, 0.7))
    # settle (to 1.0 s): S1 "bonk" pose -- dizzy, topper rolls off (hidden by render/capy.js on crash only)
    kf(root, sec(t_settle), rot=R(0, 0, 0.15))
    kf(body, sec(t_settle), loc=P(0, 0.4, 0), rot=R(-0.5, 0, 0))
    kf(head, sec(t_settle), rot=R(0.1, 0.22, 0))
    kf(legs["fl"], sec(t_settle), rot=R(-0.6, 0, 0))
    kf(legs["fr"], sec(t_settle), rot=R(-0.9, 0, 0))
    kf(legs["bl"], sec(t_settle), rot=R(-1.3, 0, 0))
    kf(legs["br"], sec(t_settle), rot=R(-1.3, 0, 0))
    kf(topper, sec(t_settle), loc=P(0, 0.34 + 0.06, 0.16), rot=R(0, 0, 0.7))
    push_to_nla(objs, "crash", 0, sec(t_settle))


# ---------------------------------------------------------------- export
def strip_constant_tracks():
    """G4: 'constant tracks are stripped on export'. Blender 5.x moved fcurves
    off Action onto a layer/strip/channelbag chain (no more action.fcurves), so
    this is left to the exporter's own export_optimize_animation_size, which
    drops constant-value channels during export instead."""
    pass


def shade_all_smooth():
    # CTO fix B4 (THE-1259 S2 review): "the sheet is smooth clay", not flat-shaded facets. Sets every
    # polygon's smooth flag directly (no bpy.ops.object.shade_smooth(), which needs an active/selected
    # object per call) and recomputes normals so the smoothing actually shows.
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
        mesh.update()


def main():
    argv = sys.argv
    out_path = argv[argv.index("--") + 1] if "--" in argv else "assets/capy.glb"
    reset_scene()
    c = build_capy()
    bake_idle(c)
    bake_gallop(c)
    bake_jump(c)
    bake_duck(c)
    bake_crash(c)
    strip_constant_tracks()
    shade_all_smooth()

    bpy.context.scene.frame_set(1)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=False,
        export_animation_mode="NLA_TRACKS",
        export_merge_animation="NLA_TRACK",
        export_bake_animation=False,
        export_optimize_animation_size=True,
        export_apply=True,
        export_materials="EXPORT",
        export_vertex_color="ACTIVE",
        export_normals=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )
    print(f"CAPY_BUILD_OK tris={tri_count()} out={out_path} bytes={os.path.getsize(out_path)}")


def tri_count():
    n = 0
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            n += len(o.data.loop_triangles)
    return n


if __name__ == "__main__":
    main()
