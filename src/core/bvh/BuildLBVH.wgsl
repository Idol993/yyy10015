struct BVHNodeData {
    boundsMin: vec3<f32>,
    leftChild: u32,
    boundsMax: vec3<f32>,
    rightChild: u32,
    triangleCount: u32,
    triangleStart: u32,
    padding: vec2<u32>,
}

struct MortonPair {
    code: u32,
    index: u32,
}

struct BuildParams {
    triangleCount: u32,
    nodeCount: u32,
    padding0: u32,
    padding1: u32,
}

@group(0) @binding(0) var<storage, read> mortonPairs: array<MortonPair>;
@group(0) @binding(1) var<storage, read_write> bvhNodes: array<BVHNodeData>;
@group(0) @binding(2) var<storage, read_write> triangleIndices: array<u32>;
@group(0) @binding(3) var<uniform> params: BuildParams;

fn clz(x: u32) -> u32 {
    if (x == 0u) {
        return 32u;
    }
    var n = 0u;
    var y = x;
    if ((y & 0xFFFF0000u) == 0u) { n = n + 16u; y = y << 16u; }
    if ((y & 0xFF000000u) == 0u) { n = n + 8u; y = y << 8u; }
    if ((y & 0xF0000000u) == 0u) { n = n + 4u; y = y << 4u; }
    if ((y & 0xC0000000u) == 0u) { n = n + 2u; y = y << 2u; }
    if ((y & 0x80000000u) == 0u) { n = n + 1u; }
    return n;
}

fn delta(i: u32, j: u32) -> i32 {
    let count = params.triangleCount;
    if (j < 0u || j >= count) {
        return -1;
    }
    let ci = mortonPairs[i].code;
    let cj = mortonPairs[j].code;
    if (ci == cj) {
        return i32(32u + clz(i ^ j));
    }
    return i32(clz(ci ^ cj));
}

fn find_split(first: u32, last: u32) -> u32 {
    let firstCode = mortonPairs[first].code;
    let lastCode = mortonPairs[last].code;

    if (firstCode == lastCode) {
        return (first + last) >> 1u;
    }

    let commonPrefix = clz(firstCode ^ lastCode);
    var split = first;
    var step = last - first;

    loop {
        step = (step + 1u) >> 1u;
        let newSplit = split + step;

        if (newSplit < last) {
            let splitCode = mortonPairs[newSplit].code;
            let splitPrefix = clz(firstCode ^ splitCode);

            if (splitPrefix > commonPrefix) {
                split = newSplit;
            }
        }

        if (step <= 1u) {
            break;
        }
    }

    return split;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let count = params.triangleCount;

    if (idx >= count) {
        return;
    }

    if (count == 1u) {
        let leafIdx = 0u;
        var node = BVHNodeData();
        node.boundsMin = vec3<f32>(-1e30);
        node.boundsMax = vec3<f32>(1e30);
        node.leftChild = 0xFFFFFFFFu;
        node.rightChild = 0xFFFFFFFFu;
        node.triangleCount = 1u;
        node.triangleStart = 0u;
        bvhNodes[leafIdx] = node;
        triangleIndices[0u] = mortonPairs[0u].index;
        return;
    }

    let d = delta(idx, idx + 1u) - delta(idx, idx - 1u);
    let dSign = select(1, -1, d > 0);
    let dMin = select(delta(idx, idx - 1u), delta(idx, idx + 1u), d > 0);

    var lMax = 2u;
    while (true) {
        let check = i32(idx) + dSign * i32(lMax);
        if (check < 0 || u32(check) >= count) {
            break;
        }
        if (delta(idx, u32(check)) <= i32(dMin)) {
            break;
        }
        lMax = lMax << 1u;
    }

    var l = 0u;
    var t = lMax >> 1u;
    while (t > 0u) {
        let check = i32(idx) + dSign * i32(l + t);
        if (check >= 0 && u32(check) < count) {
            if (delta(idx, u32(check)) > i32(dMin)) {
                l = l + t;
            }
        }
        t = t >> 1u;
    }

    let j = u32(i32(idx) + dSign * i32(l));

    let first = min(idx, j);
    let last = max(idx, j);

    let split = find_split(first, last);

    var leftChild: u32;
    var rightChild: u32;

    if (first == split) {
        leftChild = split + count - 1u;
    } else {
        leftChild = split;
    }

    if (split + 1u == last) {
        rightChild = split + count;
    } else {
        rightChild = split + 1u;
    }

    var node = BVHNodeData();
    node.boundsMin = vec3<f32>(-1e30);
    node.boundsMax = vec3<f32>(1e30);
    node.leftChild = leftChild;
    node.rightChild = rightChild;
    node.triangleCount = 0u;
    node.triangleStart = 0u;
    bvhNodes[idx] = node;

    if (idx == 0u) {
        for (var i = 0u; i < count; i++) {
            var leaf = BVHNodeData();
            leaf.boundsMin = vec3<f32>(-1e30);
            leaf.boundsMax = vec3<f32>(1e30);
            leaf.leftChild = 0xFFFFFFFFu;
            leaf.rightChild = 0xFFFFFFFFu;
            leaf.triangleCount = 1u;
            leaf.triangleStart = i;
            bvhNodes[count - 1u + i] = leaf;
            triangleIndices[i] = mortonPairs[i].index;
        }
    }
}
