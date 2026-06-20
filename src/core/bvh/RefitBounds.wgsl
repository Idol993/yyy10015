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

struct BVHNodeData {
    boundsMin: vec3<f32>,
    leftChild: u32,
    boundsMax: vec3<f32>,
    rightChild: u32,
    triangleCount: u32,
    triangleStart: u32,
    padding: vec2<u32>,
}

struct BuildParams {
    triangleCount: u32,
    nodeCount: u32,
    padding0: u32,
    padding1: u32,
}

@group(0) @binding(0) var<storage, read> triangles: array<TriangleData>;
@group(0) @binding(1) var<storage, read_write> bvhNodes: array<BVHNodeData>;
@group(0) @binding(2) var<storage, read> triangleIndices: array<u32>;
@group(0) @binding(3) var<uniform> params: BuildParams;

@compute @workgroup_size(256)
fn compute_leaf_bounds(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let count = params.triangleCount;

    if (idx >= count) {
        return;
    }

    let nodeIdx = count - 1u + idx;
    let triIdx = triangleIndices[idx];
    let tri = triangles[triIdx];

    var bmin = min(tri.v0, min(tri.v1, tri.v2));
    var bmax = max(tri.v0, max(tri.v1, tri.v2));

    var node = bvhNodes[nodeIdx];
    node.boundsMin = bmin;
    node.boundsMax = bmax;
    bvhNodes[nodeIdx] = node;
}

@compute @workgroup_size(256)
fn refit_internal(@builtin(global_invocation_id) gid: vec3<u32>) {
    let count = params.triangleCount;
    let internalCount = count - 1u;

    if (internalCount == 0u) {
        return;
    }

    let idx = internalCount - 1u - gid.x;

    if (idx >= internalCount || idx < 0u) {
        return;
    }

    var node = bvhNodes[idx];
    if (node.triangleCount > 0u) {
        return;
    }

    let left = bvhNodes[node.leftChild];
    let right = bvhNodes[node.rightChild];

    node.boundsMin = min(left.boundsMin, right.boundsMin);
    node.boundsMax = max(left.boundsMax, right.boundsMax);
    bvhNodes[idx] = node;
}
