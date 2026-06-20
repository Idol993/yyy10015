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

@group(0) @binding(0) var<storage, read_write> bvhNodes: array<BVHNodeData>;
@group(0) @binding(1) var<uniform> params: BuildParams;

fn aabb_surface_area(aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> f32 {
    let d = aabbMax - aabbMin;
    return 2.0 * (d.x * d.y + d.x * d.z + d.y * d.z);
}

fn aabb_union(aMin: vec3<f32>, aMax: vec3<f32>, bMin: vec3<f32>, bMax: vec3<f32>) -> vec2<vec3<f32>> {
    return vec2<vec3<f32>>(min(aMin, bMin), max(aMax, bMax));
}

fn node_sah_cost(nodeIdx: u32) -> f32 {
    let node = bvhNodes[nodeIdx];
    if (node.triangleCount > 0u) {
        return aabb_surface_area(node.boundsMin, node.boundsMax) * f32(node.triangleCount);
    }
    let leftArea = aabb_surface_area(bvhNodes[node.leftChild].boundsMin, bvhNodes[node.leftChild].boundsMax);
    let rightArea = aabb_surface_area(bvhNodes[node.rightChild].boundsMin, bvhNodes[node.rightChild].boundsMax);
    let leftCount = select(f32(bvhNodes[node.leftChild].triangleCount), 1.0, bvhNodes[node.leftChild].triangleCount == 0u);
    let rightCount = select(f32(bvhNodes[node.rightChild].triangleCount), 1.0, bvhNodes[node.rightChild].triangleCount == 0u);
    return aabb_surface_area(node.boundsMin, node.boundsMax) + leftArea * leftCount + rightArea * rightCount;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    let count = params.triangleCount;
    let internalNodeCount = count - 1u;

    if (idx >= internalNodeCount) {
        return;
    }

    let node = bvhNodes[idx];
    if (node.triangleCount > 0u) {
        return;
    }

    let currentSAH = node_sah_cost(idx);

    let left = node.leftChild;
    let right = node.rightChild;

    var bestSAH = currentSAH;
    var bestConfig = 0u;

    if (bvhNodes[left].triangleCount == 0u) {
        let ll = bvhNodes[left].leftChild;
        let lr = bvhNodes[left].rightChild;

        var testMin = min(bvhNodes[ll].boundsMin, bvhNodes[right].boundsMin);
        var testMax = max(bvhNodes[ll].boundsMax, bvhNodes[right].boundsMax);
        var testArea = aabb_surface_area(testMin, testMax);
        var llArea = aabb_surface_area(bvhNodes[ll].boundsMin, bvhNodes[ll].boundsMax);
        var lrArea = aabb_surface_area(bvhNodes[lr].boundsMin, bvhNodes[lr].boundsMax);
        var rArea = aabb_surface_area(bvhNodes[right].boundsMin, bvhNodes[right].boundsMax);
        var llCount = select(f32(bvhNodes[ll].triangleCount), 1.0, bvhNodes[ll].triangleCount == 0u);
        var lrCount = select(f32(bvhNodes[lr].triangleCount), 1.0, bvhNodes[lr].triangleCount == 0u);
        var rCount = select(f32(bvhNodes[right].triangleCount), 1.0, bvhNodes[right].triangleCount == 0u);

        var newSAH = testArea + llArea * llCount + (testArea + lrArea * lrCount + rArea * rCount);
        if (newSAH < bestSAH) {
            bestSAH = newSAH;
            bestConfig = 1u;
        }

        testMin = min(bvhNodes[lr].boundsMin, bvhNodes[right].boundsMin);
        testMax = max(bvhNodes[lr].boundsMax, bvhNodes[right].boundsMax);
        testArea = aabb_surface_area(testMin, testMax);
        newSAH = testArea + lrArea * lrCount + (testArea + llArea * llCount + rArea * rCount);
        if (newSAH < bestSAH) {
            bestSAH = newSAH;
            bestConfig = 2u;
        }
    }

    if (bvhNodes[right].triangleCount == 0u) {
        let rl = bvhNodes[right].leftChild;
        let rr = bvhNodes[right].rightChild;

        var testMin = min(bvhNodes[left].boundsMin, bvhNodes[rl].boundsMin);
        var testMax = max(bvhNodes[left].boundsMax, bvhNodes[rl].boundsMax);
        var testArea = aabb_surface_area(testMin, testMax);
        var lArea = aabb_surface_area(bvhNodes[left].boundsMin, bvhNodes[left].boundsMax);
        var rlArea = aabb_surface_area(bvhNodes[rl].boundsMin, bvhNodes[rl].boundsMax);
        var rrArea = aabb_surface_area(bvhNodes[rr].boundsMin, bvhNodes[rr].boundsMax);
        var lCount = select(f32(bvhNodes[left].triangleCount), 1.0, bvhNodes[left].triangleCount == 0u);
        var rlCount = select(f32(bvhNodes[rl].triangleCount), 1.0, bvhNodes[rl].triangleCount == 0u);
        var rrCount = select(f32(bvhNodes[rr].triangleCount), 1.0, bvhNodes[rr].triangleCount == 0u);

        var newSAH = testArea + rlArea * rlCount + (testArea + lArea * lCount + rrArea * rrCount);
        if (newSAH < bestSAH) {
            bestSAH = newSAH;
            bestConfig = 3u;
        }

        testMin = min(bvhNodes[left].boundsMin, bvhNodes[rr].boundsMin);
        testMax = max(bvhNodes[left].boundsMax, bvhNodes[rr].boundsMax);
        testArea = aabb_surface_area(testMin, testMax);
        newSAH = testArea + rrArea * rrCount + (testArea + lArea * lCount + rlArea * rlCount);
        if (newSAH < bestSAH) {
            bestSAH = newSAH;
            bestConfig = 4u;
        }
    }

    if (bestConfig > 0u) {
        switch (bestConfig) {
            case 1u: {
                let ll = bvhNodes[left].leftChild;
                let lr = bvhNodes[left].rightChild;
                bvhNodes[left].leftChild = right;
                bvhNodes[left].rightChild = lr;
                bvhNodes[idx].rightChild = ll;
                break;
            }
            case 2u: {
                let ll = bvhNodes[left].leftChild;
                let lr = bvhNodes[left].rightChild;
                bvhNodes[left].leftChild = ll;
                bvhNodes[left].rightChild = right;
                bvhNodes[idx].rightChild = lr;
                break;
            }
            case 3u: {
                let rl = bvhNodes[right].leftChild;
                let rr = bvhNodes[right].rightChild;
                bvhNodes[right].leftChild = left;
                bvhNodes[right].rightChild = rr;
                bvhNodes[idx].leftChild = rl;
                break;
            }
            case 4u: {
                let rl = bvhNodes[right].leftChild;
                let rr = bvhNodes[right].rightChild;
                bvhNodes[right].leftChild = rl;
                bvhNodes[right].rightChild = left;
                bvhNodes[idx].leftChild = rr;
                break;
            }
            default: {
                break;
            }
        }

        var modified = bvhNodes[idx];
        let unionAABB = aabb_union(
            bvhNodes[modified.leftChild].boundsMin, bvhNodes[modified.leftChild].boundsMax,
            bvhNodes[modified.rightChild].boundsMin, bvhNodes[modified.rightChild].boundsMax
        );
        modified.boundsMin = unionAABB[0];
        modified.boundsMax = unionAABB[1];
        bvhNodes[idx] = modified;

        if (bvhNodes[left].triangleCount == 0u) {
            var lNode = bvhNodes[left];
            let lUnion = aabb_union(
                bvhNodes[lNode.leftChild].boundsMin, bvhNodes[lNode.leftChild].boundsMax,
                bvhNodes[lNode.rightChild].boundsMin, bvhNodes[lNode.rightChild].boundsMax
            );
            lNode.boundsMin = lUnion[0];
            lNode.boundsMax = lUnion[1];
            bvhNodes[left] = lNode;
        }

        if (bvhNodes[right].triangleCount == 0u) {
            var rNode = bvhNodes[right];
            let rUnion = aabb_union(
                bvhNodes[rNode.leftChild].boundsMin, bvhNodes[rNode.leftChild].boundsMax,
                bvhNodes[rNode.rightChild].boundsMin, bvhNodes[rNode.rightChild].boundsMax
            );
            rNode.boundsMin = rUnion[0];
            rNode.boundsMax = rUnion[1];
            bvhNodes[right] = rNode;
        }
    }
}
