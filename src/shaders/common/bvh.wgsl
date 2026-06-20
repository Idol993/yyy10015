struct BVHNodeData {
    boundsMin: vec3<f32>,
    leftChild: u32,
    boundsMax: vec3<f32>,
    rightChild: u32,
    triangleCount: u32,
    triangleStart: u32,
    padding: vec2<u32>,
}

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

struct InstanceInfo {
    transform: mat4x4<f32>,
    inverseTransform: mat4x4<f32>,
    bvhRoot: u32,
    materialOffset: u32,
    flags: u32,
    padding: vec3<u32>,
}

struct AABB {
    min: vec3<f32>,
    max: vec3<f32>,
}

fn aabb_centroid(aabb: AABB) -> vec3<f32> {
    return (aabb.min + aabb.max) * 0.5;
}

fn aabb_surface_area(aabb: AABB) -> f32 {
    let d = aabb.max - aabb.min;
    return 2.0 * (d.x * d.y + d.x * d.z + d.y * d.z);
}

fn aabb_intersect(ray: Ray, aabb: AABB) -> f32 {
    var tMin = (aabb.min - ray.origin) / ray.direction;
    var tMax = (aabb.max - ray.origin) / ray.direction;
    
    let t1 = min(tMin, tMax);
    let t2 = max(tMin, tMax);
    
    let tNear = max(max(t1.x, t1.y), max(t1.z, ray.tMin));
    let tFar = min(min(t2.x, t2.y), min(t2.z, ray.tMax));
    
    return select(-1.0, tNear, tFar >= tNear && tFar > 0.0);
}

fn intersect_aabb(ray: Ray, pmin: vec3<f32>, pmax: vec3<f32>) -> bool {
    var tmin = (pmin.x - ray.origin.x) / ray.direction.x;
    var tmax = (pmax.x - ray.origin.x) / ray.direction.x;
    
    if (tmin > tmax) {
        let temp = tmin;
        tmin = tmax;
        tmax = temp;
    }
    
    var tymin = (pmin.y - ray.origin.y) / ray.direction.y;
    var tymax = (pmax.y - ray.origin.y) / ray.direction.y;
    
    if (tymin > tymax) {
        let temp = tymin;
        tymin = tymax;
        tymax = temp;
    }
    
    if ((tmin > tymax) || (tymin > tmax)) {
        return false;
    }
    
    if (tymin > tmin) {
        tmin = tymin;
    }
    if (tymax < tmax) {
        tmax = tymax;
    }
    
    var tzmin = (pmin.z - ray.origin.z) / ray.direction.z;
    var tzmax = (pmax.z - ray.origin.z) / ray.direction.z;
    
    if (tzmin > tzmax) {
        let temp = tzmin;
        tzmin = tzmax;
        tzmax = temp;
    }
    
    if ((tmin > tzmax) || (tzmin > tmax)) {
        return false;
    }
    
    if (tzmin > tmin) {
        tmin = tzmin;
    }
    if (tzmax < tmax) {
        tmax = tzmax;
    }
    
    return tmin < ray.tMax && tmax > ray.tMin;
}

@group(0) @binding(0) var<storage, read> bvhNodes: array<BVHNodeData>;
@group(0) @binding(1) var<storage, read> triangles: array<TriangleData>;
@group(0) @binding(2) var<storage, read> instances: array<InstanceInfo>;

fn traverse_bvh(
    ray: Ray,
    bvhRoot: u32,
    transform: mat4x4<f32>,
    invTransform: mat4x4<f32>,
    materialOffset: u32
) -> RayHit {
    var hit = RayHit(INF, 0.0, 0.0, u32(0xFFFFFFFF), u32(0xFFFFFFFF), 0u);
    
    var localRay = ray;
    localRay.origin = transform_point(invTransform, ray.origin);
    localRay.direction = transform_vector(invTransform, ray.direction);
    
    var stack: array<u32, 64>;
    var stackPtr = 0u;
    stack[stackPtr] = bvhRoot;
    stackPtr++;
    
    while (stackPtr > 0u) {
        stackPtr--;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        if (!intersect_aabb(localRay, node.boundsMin, node.boundsMax)) {
            continue;
        }
        
        if (node.triangleCount > 0u) {
            for (var i = 0u; i < node.triangleCount; i++) {
                let triIdx = node.triangleStart + i;
                let tri = triangles[triIdx];
                
                let result = intersect_triangle(localRay, tri.v0, tri.v1, tri.v2);
                
                if (result.x > 0.0 && result.x < hit.t) {
                    hit.t = result.x;
                    hit.u = result.y;
                    hit.v = result.z;
                    hit.triangleID = triIdx;
                    hit.flags = 1u;
                }
            }
        } else {
            let nearFirst = dot(localRay.direction, aabb_centroid(AABB(bvhNodes[node.leftChild].boundsMin, bvhNodes[node.leftChild].boundsMax)) - localRay.origin) > 0.0;
            
            if (nearFirst) {
                stack[stackPtr] = node.leftChild;
                stackPtr++;
                stack[stackPtr] = node.rightChild;
                stackPtr++;
            } else {
                stack[stackPtr] = node.rightChild;
                stackPtr++;
                stack[stackPtr] = node.leftChild;
                stackPtr++;
            }
        }
    }
    
    if (hit.triangleID != 0xFFFFFFFFu) {
        hit.triangleID += materialOffset;
    }
    
    return hit;
}

fn traverse_bvh_occlusion(
    ray: Ray,
    bvhRoot: u32,
    transform: mat4x4<f32>,
    invTransform: mat4x4<f32>
) -> bool {
    var localRay = ray;
    localRay.origin = transform_point(invTransform, ray.origin);
    localRay.direction = transform_vector(invTransform, ray.direction);
    
    var stack: array<u32, 32>;
    var stackPtr = 0u;
    stack[stackPtr] = bvhRoot;
    stackPtr++;
    
    while (stackPtr > 0u) {
        stackPtr--;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        if (!intersect_aabb(localRay, node.boundsMin, node.boundsMax)) {
            continue;
        }
        
        if (node.triangleCount > 0u) {
            for (var i = 0u; i < node.triangleCount; i++) {
                let triIdx = node.triangleStart + i;
                let tri = triangles[triIdx];
                
                let result = intersect_triangle(localRay, tri.v0, tri.v1, tri.v2);
                
                if (result.x > 0.0) {
                    return true;
                }
            }
        } else {
            stack[stackPtr] = node.leftChild;
            stackPtr++;
            stack[stackPtr] = node.rightChild;
            stackPtr++;
        }
    }
    
    return false;
}

fn traverse_scene(ray: Ray, instanceCount: u32) -> RayHit {
    var closestHit = RayHit(INF, 0.0, 0.0, u32(0xFFFFFFFF), u32(0xFFFFFFFF), 0u);
    
    for (var instIdx = 0u; instIdx < instanceCount; instIdx++) {
        let inst = instances[instIdx];
        
        let hit = traverse_bvh(ray, inst.bvhRoot, inst.transform, inst.inverseTransform, 0u);
        
        if (hit.t < closestHit.t) {
            closestHit = hit;
            closestHit.instanceID = instIdx;
        }
    }
    
    return closestHit;
}

fn traverse_scene_occlusion(ray: Ray, instanceCount: u32, excludeInstance: u32) -> bool {
    for (var instIdx = 0u; instIdx < instanceCount; instIdx++) {
        if (instIdx == excludeInstance) {
            continue;
        }
        
        let inst = instances[instIdx];
        
        if (traverse_bvh_occlusion(ray, inst.bvhRoot, inst.transform, inst.inverseTransform)) {
            return true;
        }
    }
    
    return false;
}

fn get_surface_interaction(
    hit: RayHit,
    ray: Ray,
    materialOffset: u32
) -> SurfaceInteraction {
    let tri = triangles[hit.triangleID];
    
    let w = 1.0 - hit.u - hit.v;
    let position = w * tri.v0 + hit.u * tri.v1 + hit.v * tri.v2;
    let normal = normalize(w * tri.n0 + hit.u * tri.n1 + hit.v * tri.n2);
    let uv = w * tri.uv0 + hit.u * tri.uv1 + hit.v * vec2<f32>(0.0);
    
    let edge1 = tri.v1 - tri.v0;
    let edge2 = tri.v2 - tri.v0;
    let duv1 = tri.uv1 - tri.uv0;
    let duv2 = vec2<f32>(0.0) - tri.uv0;
    
    let denom = duv1.x * duv2.y - duv2.x * duv1.y;
    let invDet = select(1.0 / denom, 0.0, abs(denom) < EPSILON);
    
    let dpdu = normalize(edge1 * duv2.y - edge2 * duv1.y) * invDet;
    let dpdv = normalize(-edge1 * duv2.x + edge2 * duv1.x) * invDet;
    
    let tangent = normalize(dpdu);
    let bitangent = normalize(cross(normal, tangent));
    
    var faceNormal = faceforward(normal, -ray.direction);
    var shadingNormal = faceNormal;
    
    return SurfaceInteraction(
        position,
        normal,
        shadingNormal,
        tangent,
        bitangent,
        uv,
        dpdu,
        dpdv,
        faceNormal,
        tri.materialID + materialOffset,
        hit.instanceID
    );
}

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
    
    return xx * 4u + yy * 2u + zz;
}

fn find_split(mortonCodes: ptr<storage, array<u32>, read>, first: u32, last: u32) -> u32 {
    let firstCode = (*mortonCodes)[first];
    let lastCode = (*mortonCodes)[last];
    
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
            let splitCode = (*mortonCodes)[newSplit];
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

fn compute_sah_cost(bvhNodes: ptr<storage, array<BVHNodeData>, read>, nodeIdx: u32) -> f32 {
    let node = (*bvhNodes)[nodeIdx];
    
    if (node.triangleCount > 0u) {
        return aabb_surface_area(AABB(node.boundsMin, node.boundsMax)) * f32(node.triangleCount);
    }
    
    return aabb_surface_area(AABB(node.boundsMin, node.boundsMax)) + 
           compute_sah_cost(bvhNodes, node.leftChild) + 
           compute_sah_cost(bvhNodes, node.rightChild);
}
