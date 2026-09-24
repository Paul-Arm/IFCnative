// IFCnative scene shader.
// PASS: 0 = opaque, 1 = transparent, 2 = ghost (x-ray), used for the color passes.

struct Globals {
    view_proj: mat4x4<f32>,
    cam_pos: vec4<f32>,
    light_dir: vec4<f32>,
    clip_planes: array<vec4<f32>, 6>,
    // x: clip plane count, y: selection color (packed), z: flags (1 = x-ray active), w: highlight id+1
    params: vec4<u32>,
    ghost_color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> g: Globals;
@group(0) @binding(1) var<storage, read> obj_state: array<u32>;

struct Layer {
    offset: vec4<f32>,
    // x: layer id (high byte of pick ids), y: 1 = dimmed (federated context model)
    id: vec4<u32>,
};
@group(0) @binding(2) var<uniform> layer: Layer;

fn pick_id(obj: u32) -> u32 {
    return ((obj + 1u) & 0x00ffffffu) | (layer.id.x << 24u);
}

override PASS: u32 = 0u;

struct VIn {
    @location(0) pos: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) obj: u32,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) obj: u32,
};

const HIDDEN: u32 = 1u;
const SELECTED: u32 = 2u;
const GHOST: u32 = 4u;
const HOVER: u32 = 8u;
const OVERRIDE: u32 = 16u;

@vertex
fn vs_edge(v: VIn) -> VOut {
    var o = transform(v);
    // pull edges slightly towards the camera (reversed Z: larger = closer)
    o.clip.z = o.clip.z * 1.0006;
    return o;
}

@vertex
fn vs(v: VIn) -> VOut {
    return transform(v);
}

fn transform(v: VIn) -> VOut {
    var o: VOut;
    let st = obj_state[v.obj * 2u];
    let p = v.pos + layer.offset.xyz;
    o.world = p;
    o.color = v.color;
    o.obj = v.obj;
    if ((st & HIDDEN) != 0u) {
        o.clip = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    } else {
        o.clip = g.view_proj * vec4<f32>(p, 1.0);
    }
    return o;
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    return pow(max(c, vec3<f32>(0.0)), vec3<f32>(2.2));
}

fn clipped(p: vec3<f32>) -> bool {
    let n = g.params.x;
    for (var k = 0u; k < 6u; k = k + 1u) {
        if (k < n) {
            let pl = g.clip_planes[k];
            if (dot(pl.xyz, p) + pl.w > 0.0) {
                return true;
            }
        }
    }
    return false;
}

fn shade(base: vec3<f32>, n_in: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    let view = normalize(g.cam_pos.xyz - world);
    var n = n_in;
    if (dot(n, view) < 0.0) {
        n = -n;
    }
    let l = normalize(g.light_dir.xyz);
    let diff = max(dot(n, l), 0.0);
    let head = max(dot(n, view), 0.0);
    let sky = 0.5 + 0.5 * n.z;
    let amb = mix(0.28, 0.42, sky);
    return base * (amb + 0.45 * diff + 0.25 * head);
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
    let dn = cross(dpdx(i.world), dpdy(i.world));
    let n = normalize(dn + vec3<f32>(0.0, 0.0, 1e-12));
    if (clipped(i.world)) {
        discard;
    }
    let st = obj_state[i.obj * 2u];
    var base = i.color;
    if ((st & OVERRIDE) != 0u) {
        base = unpack4x8unorm(obj_state[i.obj * 2u + 1u]);
    }
    let ghost = (st & GHOST) != 0u;
    if (PASS == 0u) {
        if (ghost || base.a < 0.98) {
            discard;
        }
    } else if (PASS == 1u) {
        if (ghost || base.a >= 0.98) {
            discard;
        }
    } else {
        if (!ghost) {
            discard;
        }
        base = g.ghost_color;
    }
    var rgb = shade(srgb_to_linear(base.rgb), n, i.world);
    var a = base.a;
    if ((st & SELECTED) != 0u) {
        let sel = srgb_to_linear(unpack4x8unorm(g.params.y).rgb);
        rgb = mix(rgb, sel, 0.55);
        a = max(a, 0.85);
    }
    if ((st & HOVER) != 0u || g.params.w == pick_id(i.obj)) {
        rgb = rgb * 1.25 + vec3<f32>(0.04);
    }
    if (layer.id.y == 1u) {
        // federated context model: muted
        let l = dot(rgb, vec3<f32>(0.3, 0.5, 0.2));
        rgb = mix(rgb, vec3<f32>(l), 0.65) * 0.9;
    }
    return vec4<f32>(rgb, a);
}

struct IdOut {
    @location(0) id: u32,
    @location(1) pos: vec4<f32>,
    @location(2) normal: vec4<f32>,
};

@fragment
fn fs_id(i: VOut) -> IdOut {
    let dn = cross(dpdx(i.world), dpdy(i.world));
    let n = normalize(dn + vec3<f32>(0.0, 0.0, 1e-12));
    if (clipped(i.world)) {
        discard;
    }
    var o: IdOut;
    o.id = pick_id(i.obj);
    o.pos = vec4<f32>(i.world, 1.0);
    o.normal = vec4<f32>(n, 0.0);
    return o;
}

@fragment
fn fs_edge(i: VOut) -> @location(0) vec4<f32> {
    if (clipped(i.world)) {
        discard;
    }
    let st = obj_state[i.obj * 2u];
    if ((st & GHOST) != 0u) {
        return vec4<f32>(0.5, 0.55, 0.62, 0.10);
    }
    if ((st & SELECTED) != 0u) {
        let sel = srgb_to_linear(unpack4x8unorm(g.params.y).rgb);
        return vec4<f32>(sel * 0.6, 1.0);
    }
    return vec4<f32>(0.02, 0.022, 0.026, 0.55);
}

@vertex
fn vs_grid(v: VIn) -> VOut {
    var o: VOut;
    o.world = v.pos;
    o.color = v.color;
    o.obj = 0u;
    o.clip = g.view_proj * vec4<f32>(v.pos, 1.0);
    return o;
}

@fragment
fn fs_grid(i: VOut) -> @location(0) vec4<f32> {
    // fade with distance to the camera
    let d = distance(g.cam_pos.xyz, i.world);
    let fade = clamp(1.0 - d / (g.cam_pos.w * 1.0 + 1.0), 0.0, 1.0);
    return vec4<f32>(srgb_to_linear(i.color.rgb), i.color.a * fade);
}
