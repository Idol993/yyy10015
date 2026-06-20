struct TriangleData {
    v0: vec3<f32>,
    pad0: u32,
    v1: vec3<f32>,
    pad1: u32,
    v2: vec3<f32>,
    pad2: u32,
    n0: vec3<f32>,
    pad3: u32,
    n1: vec3<f32>,
    pad4: u32,
    n2: vec3<f32>,
    pad5: u32,
    uv0: vec2<f32>,
    uv1: vec2<f32>,
    materialID: u32,
    pad6: u32,
}

struct MortonPair {
    code: u32,
    index: u32,
}

struct BuildParams {
    sceneMin: vec3<f32>,
    pad0: u32,
    sceneMax: vec3<f32>,
    triangleCount: u32,
}

@group(0) @binding(0) var<storage, read> triangles: array<TriangleData>;
@group(0) @binding(1) var<storage, read_write> mortonPairs: array<MortonPair>;
@group(0) @binding(2) var<uniform> params: BuildParams;

fn expand_morton_bits(v: u32) -> u32 {
    var x = v & 0x3FFu;
    x = (x | (x << 16u)) & 0x30000FFu;
    x = (x | (x << 8u)) & 0x300F00Fu;
    x = (x | (x << 4u)) & 0x30C30C3u;
    x = (x | (x << 2u)) & 0x9249249u;
    return x;
}

fn morton_code3(p: vec3<f32>) -> u32 {
    let px = u32(clamp(p.x * 1023.0, 0.0, 1023.0));
    let py = u32(clamp(p.y * 1023.0, 0.0, 1023.0));
    let pz = u32(clamp(p.z * 1023.0, 0.0, 1023.0));

    let xx = expand_morton_bits(px);
    let yy = expand_morton_bits(py);
    let zz = expand_morton_bits(pz);

    return (xx << 2u) | (yy << 1u) | zz;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= params.triangleCount) {
        return;
    }

    let tri = triangles[idx];
    let centroid = (tri.v0 + tri.v1 + tri.v2) / 3.0;
    let normalized = (centroid - params.sceneMin) / (params.sceneMax - params.sceneMin);

    mortonPairs[idx].code = morton_code3(normalized);
    mortonPairs[idx].index = idx;
}
