const PI: f32 = 3.141592653589793;
const INV_PI: f32 = 0.3183098861837907;
const TWO_PI: f32 = 6.283185307179586;
const EPSILON: f32 = 0.0001;
const INF: f32 = 1e30;

struct CameraAndSettings {
    camPos: vec3<f32>, pad0: f32,
    camDir: vec3<f32>, pad1: f32,
    camUp: vec3<f32>, fov: f32,
    nearFar: vec2<f32>, focalDist: f32, aperture: f32,
    frameCount: u32, maxBounces: u32, minBouncesRR: u32, sampleCount: u32,
    enableNEE: u32, enableMIS: u32, enableRR: u32, enableAccumulation: u32,
    screenWidth: u32, screenHeight: u32, triangleCount: u32, lightCount: u32,
}

struct TriangleData {
    v0: vec3<f32>, pad0: u32,
    v1: vec3<f32>, pad1: u32,
    v2: vec3<f32>, pad2: u32,
    n0: vec3<f32>, pad3: u32,
    n1: vec3<f32>, pad4: u32,
    n2: vec3<f32>, pad5: u32,
    uv0: vec2<f32>, uv1: vec2<f32>,
    uv2: vec2<f32>, materialID: u32,
}

struct BVHNodeData {
    boundsMin: vec3<f32>, leftChild: u32,
    boundsMax: vec3<f32>, rightChild: u32,
    triangleCount: u32, triangleStart: u32,
    padding: vec2<u32>,
}

struct PBRMaterialData {
    baseColor: vec4<f32>,
    metallic: f32,
    roughness: f32,
    emissive: vec3<f32>,
    clearcoat: f32,
    clearcoatRoughness: f32,
    transmission: f32,
    ior: f32,
    thickness: f32,
    subsurface: f32,
    alphaCutoff: f32,
    flags: u32,
    baseColorTexIdx: i32,
    metallicRoughnessTexIdx: i32,
    emissiveTexIdx: i32,
}

struct LightData {
    type: u32, pad0: u32, pad1: u32, pad2: u32,
    position: vec3<f32>, pad3: f32,
    direction: vec3<f32>, pad4: f32,
    color: vec3<f32>, intensity: f32,
    radius: f32, innerConeAngle: f32, outerConeAngle: f32, pad5: f32,
}

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
    tMin: f32,
    tMax: f32,
}

fn sample_mat_tex(idx: i32, uv: vec2<f32>) -> vec4<f32> {
    switch (idx) {
        case 0 { return textureSample(mat_tex0, mat_sampler, uv); }
        case 1 { return textureSample(mat_tex1, mat_sampler, uv); }
        case 2 { return textureSample(mat_tex2, mat_sampler, uv); }
        case 3 { return textureSample(mat_tex3, mat_sampler, uv); }
        case 4 { return textureSample(mat_tex4, mat_sampler, uv); }
        case 5 { return textureSample(mat_tex5, mat_sampler, uv); }
        case 6 { return textureSample(mat_tex6, mat_sampler, uv); }
        default { return textureSample(mat_tex7, mat_sampler, uv); }
    }
}

struct ResolvedMaterial {
    baseColor: vec4<f32>,
    metallic: f32,
    roughness: f32,
    emissive: vec3<f32>,
    alphaCutoff: f32,
}

fn resolve_material(material: PBRMaterialData, uv: vec2<f32>) -> ResolvedMaterial {
    var r: ResolvedMaterial;
    r.baseColor = material.baseColor;
    r.metallic = material.metallic;
    r.roughness = material.roughness;
    r.emissive = material.emissive;
    r.alphaCutoff = material.alphaCutoff;

    if ((material.flags & 0x1u) != 0u && material.baseColorTexIdx >= 0) {
        let sampled = sample_mat_tex(material.baseColorTexIdx, uv);
        r.baseColor = r.baseColor * sampled;
    }

    if ((material.flags & 0x2u) != 0u && material.metallicRoughnessTexIdx >= 0) {
        let mr = sample_mat_tex(material.metallicRoughnessTexIdx, uv);
        r.metallic = r.metallic * mr.b;
        r.roughness = r.roughness * mr.g;
    }

    if ((material.flags & 0x10u) != 0u && material.emissiveTexIdx >= 0) {
        let em = sample_mat_tex(material.emissiveTexIdx, uv);
        r.emissive = r.emissive * em.rgb;
    }

    r.roughness = clamp(r.roughness, 0.001, 1.0);
    r.metallic = clamp(r.metallic, 0.0, 1.0);

    return r;
}

struct RayHit {
    t: f32, u: f32, v: f32,
    triangleID: u32,
}

@group(0) @binding(0) var<uniform> camera: CameraAndSettings;
@group(0) @binding(1) var<storage, read> triangles: array<TriangleData>;
@group(0) @binding(2) var<storage, read> bvhNodes: array<BVHNodeData>;
@group(0) @binding(3) var<storage, read> materials: array<PBRMaterialData>;
@group(0) @binding(4) var<storage, read> lights: array<LightData>;
@group(0) @binding(5) var texture_color: texture_storage_2d<rgba32float, read_write>;
@group(0) @binding(6) var texture_history: texture_storage_2d<rgba32float, read_write>;
@group(0) @binding(7) var texture_normal: texture_storage_2d<rgba32float, write>;
@group(0) @binding(8) var texture_depth: texture_storage_2d<rgba32float, write>;
@group(0) @binding(9) var texture_motion: texture_storage_2d<rgba32float, write>;
@group(0) @binding(10) var mat_tex0: texture_2d<f32>;
@group(0) @binding(11) var mat_tex1: texture_2d<f32>;
@group(0) @binding(12) var mat_tex2: texture_2d<f32>;
@group(0) @binding(13) var mat_tex3: texture_2d<f32>;
@group(0) @binding(14) var mat_tex4: texture_2d<f32>;
@group(0) @binding(15) var mat_tex5: texture_2d<f32>;
@group(0) @binding(16) var mat_tex6: texture_2d<f32>;
@group(0) @binding(17) var mat_tex7: texture_2d<f32>;
@group(0) @binding(18) var mat_sampler: sampler;

fn pcg32(seed: u32) -> u32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn u32_to_f32(v: u32) -> f32 {
    return f32(v & 0x007FFFFFu) * 2.3283064365386963e-10;
}

struct RNG {
    state: u32,
}

fn rng_init(pixel: vec2<u32>, frame: u32, sample: u32) -> RNG {
    let seed = (pixel.y * 4096u + pixel.x) * 73856093u ^ (frame * 19u + sample * 83492791u);
    return RNG(pcg32(seed));
}

fn rng_next(rng: ptr<function, RNG>) -> f32 {
    (*rng).state = pcg32((*rng).state);
    return u32_to_f32((*rng).state);
}

fn rng_next2(rng: ptr<function, RNG>) -> vec2<f32> {
    return vec2<f32>(rng_next(rng), rng_next(rng));
}

fn safe_normalize(v: vec3<f32>) -> vec3<f32> {
    let len = length(v);
    return select(vec3<f32>(0.0, 0.0, 1.0), v / len, len > EPSILON);
}

fn faceforward(n: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
    return select(n, -n, dot(v, n) > 0.0);
}

fn reflect(v: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    return v - 2.0 * dot(v, n) * n;
}

fn fresnel_schlick(cosTheta: f32, f0: vec3<f32>) -> vec3<f32> {
    let t = pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0);
    return f0 + (vec3<f32>(1.0) - f0) * t;
}

fn distribution_ggx(normal: vec3<f32>, h: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NoH = max(dot(normal, h), 0.0);
    let NoH2 = NoH * NoH;
    let denom = NoH2 * (a2 - 1.0) + 1.0;
    return a2 * INV_PI / (denom * denom + EPSILON);
}

fn geometry_smith(wo: vec3<f32>, wi: vec3<f32>, n: vec3<f32>, roughness: f32) -> f32 {
    let NoV = max(dot(n, wo), 0.0);
    let NoL = max(dot(n, wi), 0.0);
    let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
    let g1 = NoV / (NoV * (1.0 - k) + k + EPSILON);
    let g2 = NoL / (NoL * (1.0 - k) + k + EPSILON);
    return g1 * g2;
}

fn concentric_sample_disk(u: vec2<f32>) -> vec2<f32> {
    let uOffset = 2.0 * u - vec2<f32>(1.0);
    if (uOffset.x == 0.0 && uOffset.y == 0.0) {
        return vec2<f32>(0.0);
    }
    var theta: f32;
    var r: f32;
    if (abs(uOffset.x) > abs(uOffset.y)) {
        r = uOffset.x;
        theta = PI * 0.25 * (uOffset.y / uOffset.x);
    } else {
        r = uOffset.y;
        theta = PI * 0.5 - PI * 0.25 * (uOffset.x / uOffset.y);
    }
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

fn cosine_sample_hemisphere(u: vec2<f32>) -> vec3<f32> {
    let d = concentric_sample_disk(u);
    let z = sqrt(max(0.0, 1.0 - dot(d, d)));
    return vec3<f32>(d.x, d.y, z);
}

fn orthonormal_basis(n: vec3<f32>) -> mat3x3<f32> {
    let s = normalize(select(
        vec3<f32>(-n.y, n.x, 0.0),
        vec3<f32>(0.0, -n.z, n.y),
        abs(n.x) < abs(n.y)
    ));
    let t = cross(n, s);
    return mat3x3<f32>(s, t, n);
}

fn to_world(basis: mat3x3<f32>, v: vec3<f32>) -> vec3<f32> {
    return v.x * basis[0] + v.y * basis[1] + v.z * basis[2];
}

fn power_heuristic(nf: f32, fPdf: f32, ng: f32, gPdf: f32) -> f32 {
    let f = nf * fPdf;
    let g = ng * gPdf;
    return (f * f) / (f * f + g * g + EPSILON);
}

fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

fn intersect_triangle(ray: Ray, v0: vec3<f32>, v1: vec3<f32>, v2: vec3<f32>) -> vec3<f32> {
    let edge1 = v1 - v0;
    let edge2 = v2 - v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    if (abs(a) < EPSILON) {
        return vec3<f32>(-1.0, 0.0, 0.0);
    }
    let f = 1.0 / a;
    let s = ray.origin - v0;
    let u = f * dot(s, h);
    if (u < 0.0 || u > 1.0) {
        return vec3<f32>(-1.0, 0.0, 0.0);
    }
    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    if (v < 0.0 || u + v > 1.0) {
        return vec3<f32>(-1.0, 0.0, 0.0);
    }
    let t = f * dot(edge2, q);
    if (t < ray.tMin || t > ray.tMax) {
        return vec3<f32>(-1.0, 0.0, 0.0);
    }
    return vec3<f32>(t, u, v);
}

fn intersect_aabb(ray: Ray, pmin: vec3<f32>, pmax: vec3<f32>) -> bool {
    var tmin = (pmin.x - ray.origin.x) / ray.direction.x;
    var tmax = (pmax.x - ray.origin.x) / ray.direction.x;
    if (tmin > tmax) { let temp = tmin; tmin = tmax; tmax = temp; }
    var tymin = (pmin.y - ray.origin.y) / ray.direction.y;
    var tymax = (pmax.y - ray.origin.y) / ray.direction.y;
    if (tymin > tymax) { let temp = tymin; tymin = tymax; tymax = temp; }
    if ((tmin > tymax) || (tymin > tmax)) { return false; }
    if (tymin > tmin) { tmin = tymin; }
    if (tymax < tmax) { tmax = tymax; }
    var tzmin = (pmin.z - ray.origin.z) / ray.direction.z;
    var tzmax = (pmax.z - ray.origin.z) / ray.direction.z;
    if (tzmin > tzmax) { let temp = tzmin; tzmin = tzmax; tzmax = temp; }
    if ((tmin > tzmax) || (tzmin > tmax)) { return false; }
    return tmin < ray.tMax && tmax > ray.tMin;
}

fn traverse_bvh(ray: Ray, triangleCount: u32) -> RayHit {
    var hit = RayHit(INF, 0.0, 0.0, u32(0xFFFFFFFF));

    var stack: array<u32, 64>;
    var stackPtr = 0u;
    stack[stackPtr] = 0u;
    stackPtr++;

    while (stackPtr > 0u) {
        stackPtr--;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];

        if (!intersect_aabb(ray, node.boundsMin, node.boundsMax)) {
            continue;
        }

        if (node.triangleCount > 0u) {
            for (var i = 0u; i < node.triangleCount; i++) {
                let triIdx = node.triangleStart + i;
                let tri = triangles[triIdx];
                let result = intersect_triangle(ray, tri.v0, tri.v1, tri.v2);
                if (result.x > 0.0 && result.x < hit.t) {
                    hit.t = result.x;
                    hit.u = result.y;
                    hit.v = result.z;
                    hit.triangleID = triIdx;
                }
            }
        } else {
            stack[stackPtr] = node.leftChild;
            stackPtr++;
            stack[stackPtr] = node.rightChild;
            stackPtr++;
        }
    }

    return hit;
}

fn traverse_bvh_occlusion(ray: Ray, triangleCount: u32) -> bool {
    var stack: array<u32, 32>;
    var stackPtr = 0u;
    stack[stackPtr] = 0u;
    stackPtr++;

    while (stackPtr > 0u) {
        stackPtr--;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];

        if (!intersect_aabb(ray, node.boundsMin, node.boundsMax)) {
            continue;
        }

        if (node.triangleCount > 0u) {
            for (var i = 0u; i < node.triangleCount; i++) {
                let triIdx = node.triangleStart + i;
                let tri = triangles[triIdx];
                let result = intersect_triangle(ray, tri.v0, tri.v1, tri.v2);
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

fn generate_camera_ray(pixel: vec2<f32>, rng: ptr<function, RNG>) -> Ray {
    let aspect = f32(camera.screenWidth) / f32(camera.screenHeight);
    let tanFov = tan(camera.fov * 0.5);

    var ndc = (pixel + rng_next2(rng)) / vec2<f32>(f32(camera.screenWidth), f32(camera.screenHeight));
    ndc = ndc * 2.0 - vec2<f32>(1.0);
    ndc.y = -ndc.y;

    let dirX = ndc.x * tanFov * aspect;
    let dirY = ndc.y * tanFov;
    let dirZ = -1.0;

    let camRight = normalize(cross(camera.camDir, camera.camUp));
    let camUpFinal = cross(camRight, camera.camDir);

    var rayDir = normalize(camera.camDir * dirZ + camRight * dirX + camUpFinal * dirY);
    var rayOrigin = camera.camPos;

    if (camera.aperture > 0.0) {
        let lensUV = concentric_sample_disk(rng_next2(rng)) * camera.aperture * 0.5;
        let focusPoint = camera.camPos + rayDir * camera.focalDist;
        rayOrigin = camera.camPos + camRight * lensUV.x + camUpFinal * lensUV.y;
        rayDir = normalize(focusPoint - rayOrigin);
    }

    return Ray(rayOrigin, rayDir, camera.nearFar.x, camera.nearFar.y);
}

fn sample_environment(ray: Ray) -> vec3<f32> {
    let t = 0.5 * (ray.direction.y + 1.0);
    let skyColor = mix(vec3<f32>(1.0), vec3<f32>(0.5, 0.7, 1.0), t);
    let sunDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
    let sun = pow(max(dot(ray.direction, sunDir), 0.0), 256.0) * vec3<f32>(5.0);
    return skyColor + sun;
}

struct SurfaceInteraction {
    position: vec3<f32>,
    normal: vec3<f32>,
    shadingNormal: vec3<f32>,
    uv: vec2<f32>,
    materialID: u32,
}

fn get_surface_interaction(hit: RayHit, ray: Ray) -> SurfaceInteraction {
    let tri = triangles[hit.triangleID];
    let w = 1.0 - hit.u - hit.v;
    let position = w * tri.v0 + hit.u * tri.v1 + hit.v * tri.v2;
    let normal = normalize(w * tri.n0 + hit.u * tri.n1 + hit.v * tri.n2);
    let uv = w * tri.uv0 + hit.u * tri.uv1 + hit.v * tri.uv2;

    var si: SurfaceInteraction;
    si.position = position;
    si.normal = normal;
    si.shadingNormal = faceforward(normal, -ray.direction);
    si.uv = uv;
    si.materialID = tri.materialID;
    return si;
}

fn offset_ray_origin(p: vec3<f32>, n: vec3<f32>, w: vec3<f32>) -> vec3<f32> {
    let d = dot(abs(n), vec3<f32>(65536.0)) * EPSILON;
    let offset = n * d;
    return select(p + offset, p - offset, dot(n, w) < 0.0);
}

fn sample_point_light(light: LightData, si: SurfaceInteraction, rng: ptr<function, RNG>) -> vec3<f32> {
    let toLight = light.position - si.position;
    let dist = length(toLight);
    let lightDir = toLight / max(dist, EPSILON);

    if (dot(lightDir, si.shadingNormal) <= 0.0) {
        return vec3<f32>(0.0);
    }

    let shadowRay = Ray(
        offset_ray_origin(si.position, si.shadingNormal, lightDir),
        lightDir,
        EPSILON,
        dist - EPSILON
    );

    if (traverse_bvh_occlusion(shadowRay, camera.triangleCount)) {
        return vec3<f32>(0.0);
    }

    let attenuation = 1.0 / (dist * dist + EPSILON);
    let NoL = max(dot(si.shadingNormal, lightDir), 0.0);
    return light.color * light.intensity * attenuation * NoL;
}

fn sample_directional_light(light: LightData, si: SurfaceInteraction) -> vec3<f32> {
    let lightDir = -light.direction;
    if (dot(lightDir, si.shadingNormal) <= 0.0) {
        return vec3<f32>(0.0);
    }

    let shadowRay = Ray(
        offset_ray_origin(si.position, si.shadingNormal, lightDir),
        lightDir,
        EPSILON,
        INF
    );

    if (traverse_bvh_occlusion(shadowRay, camera.triangleCount)) {
        return vec3<f32>(0.0);
    }

    let NoL = max(dot(si.shadingNormal, lightDir), 0.0);
    return light.color * light.intensity * NoL;
}

fn compute_direct_lighting(si: SurfaceInteraction, wo: vec3<f32>, material: ResolvedMaterial, rng: ptr<function, RNG>) -> vec3<f32> {
    var directLight = vec3<f32>(0.0);

    if (camera.enableNEE == 0u || camera.lightCount == 0u) {
        return directLight;
    }

    let lightIdx = u32(rng_next(rng) * f32(camera.lightCount)) % camera.lightCount;
    let light = lights[lightIdx];
    let lightPdf = 1.0 / f32(camera.lightCount);

    var Li = vec3<f32>(0.0);
    var wi = vec3<f32>(0.0);
    var pdfLight = 0.0;

    switch (light.type) {
        case 0u: {
            wi = -light.direction;
            Li = sample_directional_light(light, si);
            pdfLight = 1.0;
            break;
        }
        case 1u: {
            let toLight = light.position - si.position;
            let dist = length(toLight);
            wi = toLight / max(dist, EPSILON);
            Li = sample_point_light(light, si, rng);
            pdfLight = 1.0 / (4.0 * PI);
            break;
        }
        default: {
            break;
        }
    }

    if (all(Li == vec3<f32>(0.0))) {
        return directLight;
    }

    let cosThetaI = max(dot(si.shadingNormal, wi), 0.0);
    if (cosThetaI <= 0.0) {
        return directLight;
    }

    let diffuseWeight = 1.0 - material.metallic;
    let f0 = mix(vec3<f32>(0.04), material.baseColor.rgb, material.metallic);
    let h = normalize(wi + wo);
    let cosThetaH = max(dot(si.shadingNormal, h), 0.0);
    let f = fresnel_schlick(cosThetaH, f0);
    let d = distribution_ggx(si.shadingNormal, h, material.roughness);
    let g = geometry_smith(wo, wi, si.shadingNormal, material.roughness);
    let denom = 4.0 * max(dot(si.shadingNormal, wo), 0.0) * cosThetaI + EPSILON;
    let specular = f * d * g / denom;

    let bsdfVal = material.baseColor.rgb * diffuseWeight * INV_PI + specular;
    let pdfBsdf = cosThetaI * INV_PI;

    var weight = 1.0;
    if (camera.enableMIS != 0u) {
        weight = power_heuristic(1.0, pdfLight * lightPdf, 1.0, pdfBsdf);
    }

    directLight = Li * bsdfVal * weight / (lightPdf + EPSILON);

    return directLight;
}

fn sample_bsdf(si: SurfaceInteraction, wo: vec3<f32>, material: ResolvedMaterial, rng: ptr<function, RNG>) -> vec4<f32> {
    let u = rng_next2(rng);
    let diffuseWeight = 1.0 - material.metallic;
    let specularWeight = material.metallic + 0.04 * (1.0 - material.metallic);
    let totalWeight = diffuseWeight + specularWeight;

    var wiLocal: vec3<f32>;
    var bsdf: vec3<f32>;
    var pdf: f32;

    if (u.x < diffuseWeight / totalWeight) {
        let u2 = vec2<f32>(u.x * totalWeight / diffuseWeight, u.y);
        wiLocal = cosine_sample_hemisphere(u2);
        let cosThetaI = wiLocal.z;
        let f0 = mix(vec3<f32>(0.04), material.baseColor.rgb, material.metallic);
        let h = normalize(wiLocal + vec3<f32>(0.0, 0.0, 1.0));
        let cosThetaH = h.z;
        let f = fresnel_schlick(cosThetaH, f0);
        let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, material.roughness);
        let g = geometry_smith(vec3<f32>(0.0, 0.0, 1.0), wiLocal, vec3<f32>(0.0, 0.0, 1.0), material.roughness);
        let denom = 4.0 * cosThetaI + EPSILON;
        let specular = f * d * g / denom;
        bsdf = material.baseColor.rgb * diffuseWeight * INV_PI + specular;
        pdf = cosThetaI * INV_PI * (diffuseWeight / totalWeight) + (d * cosThetaH / (4.0 * abs(dot(vec3<f32>(0.0, 0.0, 1.0), h)) + EPSILON)) * (specularWeight / totalWeight);
    } else {
        let u2 = vec2<f32>((u.x - diffuseWeight / totalWeight) * totalWeight / specularWeight, u.y);
        let alpha = max(0.0001, material.roughness * material.roughness);
        let alpha2 = alpha * alpha;
        let tanTheta2 = alpha2 * u2.x / (1.0 - u2.x);
        let cosTheta = 1.0 / sqrt(1.0 + tanTheta2);
        let sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
        let phi = 2.0 * PI * u2.y;
        var h = vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
        h = normalize(h);
        wiLocal = normalize(reflect(-vec3<f32>(0.0, 0.0, 1.0), h));
        if (wiLocal.z <= 0.0) {
            return vec4<f32>(0.0);
        }
        let cosThetaI = wiLocal.z;
        let f0 = mix(vec3<f32>(0.04), material.baseColor.rgb, material.metallic);
        let cosThetaH = h.z;
        let f = fresnel_schlick(cosThetaH, f0);
        let d = distribution_ggx(vec3<f32>(0.0, 0.0, 1.0), h, material.roughness);
        let g = geometry_smith(vec3<f32>(0.0, 0.0, 1.0), wiLocal, vec3<f32>(0.0, 0.0, 1.0), material.roughness);
        let denom = 4.0 * cosThetaI + EPSILON;
        bsdf = material.baseColor.rgb * diffuseWeight * INV_PI + f * d * g / denom;
        pdf = cosThetaI * INV_PI * (diffuseWeight / totalWeight) + (d * cosThetaH / (4.0 * abs(dot(vec3<f32>(0.0, 0.0, 1.0), h)) + EPSILON)) * (specularWeight / totalWeight);
    }

    if (pdf <= 0.0) {
        return vec4<f32>(0.0);
    }

    let basis = orthonormal_basis(si.shadingNormal);
    let wiWorld = to_world(basis, wiLocal);
    return vec4<f32>(wiWorld, pdf);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let pixel = vec2<u32>(gid.x, gid.y);
    if (pixel.x >= camera.screenWidth || pixel.y >= camera.screenHeight) {
        return;
    }

    var rng = rng_init(pixel, camera.frameCount, camera.sampleCount);

    var radiance = vec3<f32>(0.0);
    var firstHitDepth = 1e30f;
    var firstHitNormal = vec3<f32>(0.0);
    var firstHitValid = false;

    let numSamples = max(1u, camera.sampleCount);
    for (var s = 0u; s < numSamples; s++) {
        var ray = generate_camera_ray(vec2<f32>(f32(pixel.x), f32(pixel.y)), &rng);
        var pathRadiance = vec3<f32>(0.0);
        var throughput = vec3<f32>(1.0);

        for (var depth = 0u; depth < camera.maxBounces; depth++) {
            let hit = traverse_bvh(ray, camera.triangleCount);

            if (hit.triangleID == 0xFFFFFFFFu) {
                pathRadiance = pathRadiance + throughput * sample_environment(ray);
                break;
            }

            if (s == 0u && depth == 0u) {
                firstHitDepth = hit.t;
                let si = get_surface_interaction(hit, ray);
                firstHitNormal = si.shadingNormal;
                firstHitValid = true;
            }

            let si = get_surface_interaction(hit, ray);
            let matData = materials[si.materialID];
            let material = resolve_material(matData, si.uv);
            let wo = -ray.direction;

            pathRadiance = pathRadiance + throughput * material.emissive;

            let direct = compute_direct_lighting(si, wo, material, &rng);
            pathRadiance = pathRadiance + throughput * direct;

            let bsdfResult = sample_bsdf(si, wo, material, &rng);
            let wi = bsdfResult.xyz;
            let pdf = bsdfResult.w;

            if (pdf <= 0.0 || all(bsdfResult.xyz == vec3<f32>(0.0))) {
                break;
            }

            let cosTheta = max(dot(si.shadingNormal, wi), 0.0);
            if (cosTheta <= 0.0) {
                break;
            }

            let diffuseWeight = 1.0 - material.metallic;
            let f0 = mix(vec3<f32>(0.04), material.baseColor.rgb, material.metallic);
            let h = normalize(wi + wo);
            let cosThetaH = max(dot(si.shadingNormal, h), 0.0);
            let f = fresnel_schlick(cosThetaH, f0);
            let d = distribution_ggx(si.shadingNormal, h, material.roughness);
            let g = geometry_smith(wo, wi, si.shadingNormal, material.roughness);
            let denom = 4.0 * max(dot(si.shadingNormal, wo), 0.0) * cosTheta + EPSILON;
            let specular = f * d * g / denom;
            let bsdfVal = material.baseColor.rgb * diffuseWeight * INV_PI + specular;

            throughput = throughput * bsdfVal * cosTheta / pdf;

            if (all(throughput < vec3<f32>(EPSILON))) {
                break;
            }

            if (camera.enableRR != 0u && depth >= camera.minBouncesRR) {
                let q = max(0.05, 1.0 - luminance(throughput));
                if (rng_next(&rng) < q) {
                    break;
                }
                throughput = throughput / (1.0 - q);
            }

            ray.origin = offset_ray_origin(si.position, si.shadingNormal, wi);
            ray.direction = wi;
            ray.tMin = EPSILON;
            ray.tMax = INF;
        }

        radiance = radiance + pathRadiance;
    }

    radiance = radiance / f32(numSamples);

    let pixelF = vec2<f32>(f32(pixel.x), f32(pixel.y));
    if (camera.enableAccumulation != 0u && camera.frameCount > 0u) {
        let history = textureLoad(texture_history, pixel, 0).rgb;
        let n = f32(camera.frameCount);
        radiance = (history * n + radiance) / (n + 1.0);
    }

    textureStore(texture_color, pixel, vec4<f32>(radiance, 1.0));
    textureStore(texture_history, pixel, vec4<f32>(radiance, 1.0));

    var depthVal = 1e30f;
    var normalVal = vec3<f32>(0.0);
    if (firstHitValid) {
        depthVal = firstHitDepth;
        normalVal = firstHitNormal;
    }
    textureStore(texture_depth, pixel, vec4<f32>(depthVal, 0.0, 0.0, 0.0));
    textureStore(texture_normal, pixel, vec4<f32>(normalVal, 0.0));
    textureStore(texture_motion, pixel, vec4<f32>(0.0, 0.0, 0.0, 0.0));
}
