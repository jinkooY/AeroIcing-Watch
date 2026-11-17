"""Cloud Dive cloud shots in Blender (Cycles volume): the clouds of the case flown at the planned altitude (task 23, video).

The cloud tops and bases come from maps made by prepare_cloud_maps.py (satellite cloud top, the case's base estimate, five lanes).
The shape inside is procedural (noise), so this is an illustration of the data, not a photograph. The same volume idea as the earlier
cut tool (noise-shaped density with a vertical profile) is used; the heights are read from the maps instead of being set by hand.
Sky: Blender's physical sky with the sun at an assumed afternoon height; ground: flat; haze: a thin volume in the world.

Run (Blender 4.5, no window):
  blender --background --factory-startup --python-exit-code 1 --python cloud_dive_clouds.py -- --maps <dir> --out <dir> \
      [--mode still|anim] [--s <km>] [--s-from <km> --s-to <km>] [--alt-ft 12000] [--frames 120] [--fps 30] \
      [--res 1920x1080] [--samples 48] [--sun-elev 28] [--only 1,60] [--name approach]
Output: <out>/<name>.png (still) or <out>/<name>/f_0001.png ... (anim).
"""
import json
import math
import os
import sys

import bpy

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None, cast=str):
    flag = f"--{name}"
    if flag in ARGV:
        return cast(ARGV[ARGV.index(flag) + 1])
    return default


MAPS = opt("maps")
OUT = opt("out")
MODE = opt("mode", "still")
S_STILL = opt("s", 480.0, float)
S_FROM = opt("s-from", 440.0, float)
S_TO = opt("s-to", 520.0, float)
ALT_FT = opt("alt-ft", 12000.0, float)
FRAMES = opt("frames", 120, int)
FPS = opt("fps", 30, int)
RES = [int(v) for v in opt("res", "1280x720").split("x")]
SAMPLES = opt("samples", 48, int)
SUN_ELEV = opt("sun-elev", 15.0, float)
SUN_ROT = opt("sun-rot", 150.0, float)   # degrees; an assumed afternoon sun to the left of the heading, so the cloud tops show relief
NAME = opt("name", "cloud_dive")
ONLY = [int(v) for v in opt("only", "").split(",") if v] or None
CAM_PITCH = opt("pitch", -12.0, float)
DENSITY = opt("density", 0.12, float)
TOWER_M = opt("towers", 1400.0, float)    # how far the highest lumps stand above the satellite cloud top, metres
VALLEY_M = opt("valleys", 900.0, float)  # how deep the dips between them go   # extinction per metre inside the cloud body
TOP_SHIFT_M = opt("top-shift", -900.0, float)  # metres added to the lumpy top (negative lowers it below the satellite top)
AMBIENT = opt("ambient", 0.0, float)  # in-cloud fill light, radiance about this value deep inside the cloud (0 turns it off)
# "km:factor,km:factor" along the route; the fill is AMBIENT times the factor, linear between keys (empty: factor 1 everywhere)
AMBIENT_KEYS = [tuple(float(p) for p in kv.split(":")) for kv in opt("ambient-keys", "").split(",") if kv]
AMB_SOCKET = []  # the socket that carries the fill level, kept so the camera code can keyframe it
AMBIENT_DEPTH_M = opt("ambient-depth", 400.0, float)  # depth below the lumpy top where the fill reaches full strength
FT = 0.3048
HAZE = opt("haze", 0.7e-6, float)         # world haze density per metre
SKY_ALT_M = opt("sky-alt", 0.0, float)      # altitude given to the sky model (0 keeps the sky bright and blue)

meta = json.load(open(os.path.join(MAPS, "meta.json"), encoding="utf-8"))
S0, S1 = meta["s0Km"], meta["s1Km"]
LEN_M = (S1 - S0) * 1000.0
HALF_M = meta["halfWidthKm"] * 1000.0
Z_MIN = max(150.0, (meta["baseMinM"] or 1000.0) - 150.0)
Z_MAX = (meta["topMaxM"] or 7000.0) + 450.0
os.makedirs(OUT, exist_ok=True)


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = opt("look", "AgX - High Contrast")
    sc.view_settings.exposure = opt("exposure", -4.6, float)
    sc.cycles.max_bounces = max(6, opt("vol-bounces", 3, int))
    for prop, val in (("volume_bounces", opt("vol-bounces", 3, int)), ("volume_max_steps", 2048), ("volume_step_rate", opt("step-rate", 0.1, float)), ("transparent_max_bounces", 8)):
        try:
            setattr(sc.cycles, prop, val)
        except Exception as e:  # property names differ between versions
            print("skip", prop, e)
    try:
        pr = bpy.context.preferences.addons["cycles"].preferences
        for t in ("OPTIX", "CUDA"):
            try:
                pr.compute_device_type = t
                pr.get_devices()
                if any(d.type == t for d in pr.devices):
                    for d in pr.devices:
                        d.use = d.type == t
                    sc.cycles.device = "GPU"
                    print("device:", t)
                    break
            except TypeError:
                continue
    except Exception as e:
        print("GPU setup failed:", e)
    return sc


def build_world():
    w = bpy.data.worlds.new("W")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"  # Blender 4.5 name (newer versions rename it)
    sky.sun_elevation = math.radians(SUN_ELEV)
    sky.sun_rotation = math.radians(SUN_ROT)
    sky.altitude = SKY_ALT_M
    sky.air_density = 1.0
    sky.dust_density = 1.2
    sky.ozone_density = 1.0
    sky.sun_disc = True
    sky.sun_size = math.radians(0.6)
    sky.sun_intensity = opt("sun-intensity", 4.5, float)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    # No volume in the world itself: a world volume has no end, so a ray to the sky would cross infinite haze and the sky turns black.


def build_haze():
    """A finite box of thin haze around the flight path: about 0.5 optical depth over 100 km at the default density."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(LEN_M / 2, 0, 4500))
    h = bpy.context.object
    h.name = "haze"
    h.scale = (LEN_M + 400000.0, 2 * HALF_M + 200000.0, 9000)
    m = bpy.data.materials.new("haze")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.78, 0.86, 1.0, 1)
    vol.inputs["Density"].default_value = HAZE
    vol.inputs["Anisotropy"].default_value = 0.3
    nt.links.new(vol.outputs["Volume"], nt.nodes["Material Output"].inputs["Volume"])
    h.data.materials.append(m)


def build_ground():
    bpy.ops.mesh.primitive_plane_add(size=1, location=(LEN_M / 2, 0, 0))
    g = bpy.context.object
    g.scale = (LEN_M * 4, HALF_M * 6, 1)
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = 0.95
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0 / 9000.0
    nz.inputs["Detail"].default_value = 6
    pos = nt.nodes.new("ShaderNodeNewGeometry")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.05, 0.075, 0.04, 1)
    ramp.color_ramp.elements[1].color = (0.16, 0.15, 0.09, 1)
    nt.links.new(pos.outputs["Position"], nz.inputs["Vector"])
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    g.data.materials.append(m)


def load_map(name, colour_space="Non-Color"):
    img = bpy.data.images.load(os.path.join(MAPS, name))
    img.colorspace_settings.name = colour_space
    return img


def build_clouds():
    bpy.ops.mesh.primitive_cube_add(size=1, location=(LEN_M / 2, 0, (Z_MIN + Z_MAX) / 2))
    o = bpy.context.object
    o.name = "cloud_volume"
    o.scale = (LEN_M, 2 * HALF_M, Z_MAX - Z_MIN)
    m = bpy.data.materials.new("cloud")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    out = nt.nodes["Material Output"]
    N = nt.nodes.new
    L = nt.links.new

    def math_node(op, a=None, b=None, clamp=False):
        n = N("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        if a is not None and not isinstance(a, (int, float)):
            L(a, n.inputs[0])
        elif a is not None:
            n.inputs[0].default_value = a
        if b is not None and not isinstance(b, (int, float)):
            L(b, n.inputs[1])
        elif b is not None:
            n.inputs[1].default_value = b
        return n

    def map_range(value, f0, f1, t0=0.0, t1=1.0, clamp=True):
        n = N("ShaderNodeMapRange")
        n.clamp = clamp
        for sock, v in (("From Min", f0), ("From Max", f1), ("To Min", t0), ("To Max", t1)):
            if isinstance(v, (int, float)):
                n.inputs[sock].default_value = v
            else:
                L(v, n.inputs[sock])
        L(value, n.inputs["Value"])
        return n

    gen = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(gen.outputs["Generated"], sep.inputs[0])
    uv = N("ShaderNodeCombineXYZ")
    L(sep.outputs["X"], uv.inputs["X"])
    L(sep.outputs["Y"], uv.inputs["Y"])

    def image(name):
        t = N("ShaderNodeTexImage")
        t.image = load_map(name)
        t.interpolation = "Linear"
        t.extension = "EXTEND"
        L(uv.outputs[0], t.inputs["Vector"])
        return t

    def channels(name):
        """Image texture followed by a colour split, so that single channels can feed the maths nodes."""
        s = N("ShaderNodeSeparateColor")
        L(image(name).outputs["Color"], s.inputs["Color"])
        return s

    top_sep, base_sep, mask_sep = channels("top16.png"), channels("base16.png"), channels("mask8.png")
    top_m = math_node("MULTIPLY", top_sep.outputs["Red"], meta["scaleM"])
    base_m = math_node("MULTIPLY", base_sep.outputs["Red"], meta["scaleM"])
    mask = mask_sep.outputs["Red"]
    faded = mask_sep.outputs["Green"]

    # world position and altitude of the sample point (metres)
    pos = N("ShaderNodeNewGeometry")
    psep = N("ShaderNodeSeparateXYZ")
    L(pos.outputs["Position"], psep.inputs[0])
    z = psep.outputs["Z"]

    def noise(scale_m, detail, rough, lac=2.1, seed=0.0):
        mp = N("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1.0 / scale_m, 1.0 / scale_m, 1.0 / (scale_m * 0.7))
        mp.inputs["Location"].default_value = (seed, seed * 0.7, seed * 0.3)
        L(pos.outputs["Position"], mp.inputs["Vector"])
        n = N("ShaderNodeTexNoise")
        n.noise_dimensions = "3D"
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Lacunarity"].default_value = lac
        L(mp.outputs[0], n.inputs["Vector"])
        return n.outputs["Fac"]

    big = noise(9000.0, 3, 0.5, seed=11.0)        # large swells of the top and base
    lump = noise(2200.0, 5, 0.5, seed=19.0)       # cauliflower lumps of the top
    mid = noise(2500.0, 6, 0.55, seed=3.0)        # breaks in the deck
    fine = noise(650.0, 9, 0.6, 2.2, seed=7.0)    # edge detail
    micro = noise(260.0, 7, 0.6, 2.3, seed=29.0)  # near-field billows

    def offset(height, noise_out, amp_m):
        centred = math_node("SUBTRACT", noise_out, 0.5)
        scaled = math_node("MULTIPLY", centred.outputs[0], amp_m)
        return math_node("ADD", height.outputs[0], scaled.outputs[0])

    # Blender noise values sit close to 0.5 (a spread of about 0.1), so the amplitudes below are about ten times the height change wanted
    top_eff = offset(offset(offset(offset(top_m, big, 5000.0), lump, 2400.0), fine, 900.0), micro, 1700.0)
    # towers: only the highest lumps stand up; dips where the "mid" noise is low give valleys between them
    towers = map_range(lump, 0.52, 0.66, 0.0, TOWER_M)
    valleys = map_range(mid, 0.5, 0.4, 0.0, VALLEY_M)
    top_eff = math_node("SUBTRACT", math_node("ADD", top_eff.outputs[0], towers.outputs[0]).outputs[0], valleys.outputs[0])
    # shift the lumpy top down so the satellite cloud top is near the upper edge of the lumps, not their mean;
    # otherwise towers poke through the flight level where the data says the aircraft is above the tops
    top_eff = math_node("ADD", top_eff.outputs[0], TOP_SHIFT_M)
    base_eff = offset(base_m, big, 3000.0)
    # vertical profile: rises over 450 m above the base, fades over 400 m below the top; the top is lumpier than the base
    up = map_range(z, base_eff.outputs[0], math_node("ADD", base_eff.outputs[0], 450.0).outputs[0])
    down = map_range(z, top_eff.outputs[0], math_node("SUBTRACT", top_eff.outputs[0], 130.0).outputs[0])
    profile = math_node("MULTIPLY", up.outputs[0], down.outputs[0])
    # cover: the noise must beat a threshold that gets lower where the satellite says there is cloud
    detail_mix = math_node("ADD", math_node("MULTIPLY", mid, 0.6).outputs[0], math_node("MULTIPLY", fine, 0.4).outputs[0])
    lift = math_node("MULTIPLY", math_node("SUBTRACT", mask, 0.5).outputs[0], 0.34)
    shaped = map_range(math_node("ADD", detail_mix.outputs[0], lift.outputs[0]).outputs[0], 0.44, 0.56)
    fade = math_node("SUBTRACT", 1.0, math_node("MULTIPLY", faded, 0.65).outputs[0])   # an unknown base is drawn fainter
    dens = math_node("MULTIPLY", math_node("MULTIPLY", profile.outputs[0], shaped.outputs[0]).outputs[0], fade.outputs[0])
    dens = math_node("MULTIPLY", dens.outputs[0], math_node("SUBTRACT", mask, 0.0, clamp=True).outputs[0])
    dens = math_node("MULTIPLY", dens.outputs[0], DENSITY)
    vol = N("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.96, 0.97, 1.0, 1)
    vol.inputs["Anisotropy"].default_value = 0.45
    L(dens.outputs[0], vol.inputs["Density"])
    if AMBIENT > 0:  # stands in for the many scattering bounces Cycles cuts off, so the inside of a deep cloud is grey-white, not black
        vol.inputs["Emission Color"].default_value = (0.94, 0.95, 0.97, 1)  # near white, as the inside of a sunlit deck looks
        # only the deep inside gets the fill: it ramps from 0 at the lumpy top to 1 at AMBIENT_DEPTH_M below it,
        # so the sunlit surface seen from above keeps its shadows
        deep = map_range(z, top_eff.outputs[0], math_node("SUBTRACT", top_eff.outputs[0], AMBIENT_DEPTH_M).outputs[0])
        level = math_node("MULTIPLY", dens.outputs[0], AMBIENT)
        AMB_SOCKET.append(level.inputs[1])
        fill = math_node("MULTIPLY", level.outputs[0], deep.outputs[0])
        L(fill.outputs[0], vol.inputs["Emission Strength"])
    L(vol.outputs["Volume"], out.inputs["Volume"])
    o.data.materials.append(m)
    return o


def ambient_factor(s, ks, vs):
    """Linear interpolation of the fill factor at route distance s (km), held flat outside the keys."""
    if s <= ks[0]:
        return vs[0]
    for k0, k1, v0, v1 in zip(ks, ks[1:], vs, vs[1:]):
        if s <= k1:
            return v0 + (v1 - v0) * (s - k0) / (k1 - k0)
    return vs[-1]


def build_camera(sc):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 24
    cam_data.sensor_width = 36
    cam_data.clip_start = 5
    cam_data.clip_end = 400000
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(90 + CAM_PITCH), 0, math.radians(-90))  # looks along +x, up is +z
    sc.camera = cam
    alt = ALT_FT * FT
    if MODE == "still":
        cam.location = ((S_STILL - S0) * 1000.0, 0, alt)
    else:
        for fr, s in ((1, S_FROM), (FRAMES, S_TO)):
            cam.location = ((s - S0) * 1000.0, 0, alt)
            cam.keyframe_insert("location", frame=fr)
        for fc in cam.animation_data.action.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
        sc.frame_start, sc.frame_end = 1, FRAMES
    if AMB_SOCKET and AMBIENT_KEYS:
        sock = AMB_SOCKET[0]
        if MODE == "still":
            ks, vs = zip(*sorted(AMBIENT_KEYS))
            sock.default_value = AMBIENT * ambient_factor(S_STILL, ks, vs)
        else:
            for km, factor in sorted(AMBIENT_KEYS):
                sock.default_value = AMBIENT * factor
                fr = 1 + (km - S_FROM) / (S_TO - S_FROM) * (FRAMES - 1)
                sock.keyframe_insert("default_value", frame=fr)
            ad = sock.id_data.animation_data
            if ad and ad.action:
                for fc in ad.action.fcurves:
                    for kp in fc.keyframe_points:
                        kp.interpolation = "LINEAR"
        sc.render.fps = FPS
    return cam


def main():
    sc = setup_scene()
    build_world()
    build_haze()
    build_ground()
    build_clouds()
    build_camera(sc)
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "8"
    if MODE == "still":
        sc.render.filepath = os.path.join(OUT, f"{NAME}.png")
        bpy.ops.render.render(write_still=True)
        print("saved", sc.render.filepath)
    else:
        d = os.path.join(OUT, NAME)
        os.makedirs(d, exist_ok=True)
        if ONLY:
            for fr in ONLY:
                sc.frame_set(fr)
                sc.render.filepath = os.path.join(d, f"f_{fr:04d}.png")
                bpy.ops.render.render(write_still=True)
        else:
            sc.render.filepath = os.path.join(d, "f_")
            sc.render.use_overwrite = False  # a restart renders only the missing frames
            bpy.ops.render.render(animation=True)
        print("saved", d)


main()
