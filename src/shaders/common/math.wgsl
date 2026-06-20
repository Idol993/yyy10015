const PI: f32 = 3.141592653589793;
const INV_PI: f32 = 0.3183098861837907;
const TWO_PI: f32 = 6.283185307179586;
const HALF_PI: f32 = 1.5707963267948966;
const EPSILON: f32 = 0.0001;
const INF: f32 = 1e30;

fn deg2rad(deg: f32) -> f32 {
    return deg * PI / 180.0;
}

fn rad2deg(rad: f32) -> f32 {
    return rad * 180.0 / PI;
}

fn clamp01(x: f32) -> f32 {
    return clamp(x, 0.0, 1.0);
}

fn saturate(v: vec3<f32>) -> vec3<f32> {
    return clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    return a + t * (b - a);
}

fn mix3(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
    return a + t * (b - a);
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn length2(v: vec2<f32>) -> f32 {
    return dot(v, v);
}

fn length3(v: vec3<f32>) -> f32 {
    return dot(v, v);
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

fn refract(wi: vec3<f32>, n: vec3<f32>, eta: f32) -> vec3<f32> {
    let cosThetaI = dot(wi, n);
    let sin2ThetaI = max(0.0, 1.0 - cosThetaI * cosThetaI);
    let sin2ThetaT = eta * eta * sin2ThetaI;
    
    if (sin2ThetaT >= 1.0) {
        return vec3<f32>(0.0);
    }
    
    let cosThetaT = sqrt(1.0 - sin2ThetaT);
    return eta * wi - (eta * cosThetaI + cosThetaT) * n;
}

fn fresnel_dielectric(cosThetaI: f32, etaI: f32, etaT: f32) -> f32 {
    var cosI = clamp(cosThetaI, -1.0, 1.0);
    var etaI2 = etaI;
    var etaT2 = etaT;
    
    if (cosI < 0.0) {
        let temp = etaI2;
        etaI2 = etaT2;
        etaT2 = temp;
        cosI = abs(cosI);
    }
    
    let sinT = etaI2 / etaT2 * sqrt(max(0.0, 1.0 - cosI * cosI));
    
    if (sinT >= 1.0) {
        return 1.0;
    }
    
    let cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
    let Rs = ((etaT2 * cosI) - (etaI2 * cosT)) / ((etaT2 * cosI) + (etaI2 * cosT));
    let Rp = ((etaI2 * cosI) - (etaT2 * cosT)) / ((etaI2 * cosI) + (etaT2 * cosT));
    
    return (Rs * Rs + Rp * Rp) * 0.5;
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

fn geometry_schlick_ggx(NoV: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
    let denom = NoV * (1.0 - k) + k + EPSILON;
    return NoV / denom;
}

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
    tMin: f32,
    tMax: f32,
    flags: u32,
}

struct RayHit {
    t: f32,
    u: f32,
    v: f32,
    triangleID: u32,
    instanceID: u32,
    flags: u32,
}

struct SurfaceInteraction {
    position: vec3<f32>,
    normal: vec3<f32>,
    shadingNormal: vec3<f32>,
    tangent: vec3<f32>,
    bitangent: vec3<f32>,
    uv: vec2<f32>,
    dpdu: vec3<f32>,
    dpdv: vec3<f32>,
    faceNormal: vec3<f32>,
    materialID: u32,
    instanceID: u32,
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

fn create_ray(origin: vec3<f32>, direction: vec3<f32>, tMin: f32, tMax: f32) -> Ray {
    return Ray(origin, normalize(direction), tMin, tMax, 0u);
}

fn offset_ray_origin(p: vec3<f32>, n: vec3<f32>, w: vec3<f32>) -> vec3<f32> {
    let d = dot(abs(n), vec3<f32>(65536.0)) * EPSILON;
    let offset = n * d;
    return select(p + offset, p - offset, dot(n, w) < 0.0);
}

fn spherical_to_direction(theta: f32, phi: f32) -> vec3<f32> {
    let sinTheta = sin(theta);
    let cosTheta = cos(theta);
    let sinPhi = sin(phi);
    let cosPhi = cos(phi);
    return vec3<f32>(sinTheta * cosPhi, cosTheta, sinTheta * sinPhi);
}

fn direction_to_spherical(v: vec3<f32>) -> vec2<f32> {
    let theta = acos(clamp(v.y, -1.0, 1.0));
    let phi = atan2(v.z, v.x);
    return vec2<f32>(theta, select(phi, phi + TWO_PI, phi < 0.0));
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

fn to_local(basis: mat3x3<f32>, v: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(dot(basis[0], v), dot(basis[1], v), dot(basis[2], v));
}

fn to_world(basis: mat3x3<f32>, v: vec3<f32>) -> vec3<f32> {
    return v.x * basis[0] + v.y * basis[1] + v.z * basis[2];
}

fn power_heuristic(nf: f32, fPdf: f32, ng: f32, gPdf: f32) -> f32 {
    let f = nf * fPdf;
    let g = ng * gPdf;
    return (f * f) / (f * f + g * g + EPSILON);
}

fn balance_heuristic(nf: f32, fPdf: f32, ng: f32, gPdf: f32) -> f32 {
    return (nf * fPdf) / (nf * fPdf + ng * gPdf + EPSILON);
}

fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

fn max_component(v: vec3<f32>) -> f32 {
    return max(v.r, max(v.g, v.b));
}

fn is_black(v: vec3<f32>) -> bool {
    return all(v < vec3<f32>(EPSILON));
}

fn transform_point(m: mat4x4<f32>, p: vec3<f32>) -> vec3<f32> {
    let v = m * vec4<f32>(p, 1.0);
    return v.xyz / v.w;
}

fn transform_vector(m: mat4x4<f32>, v: vec3<f32>) -> vec3<f32> {
    return (m * vec4<f32>(v, 0.0)).xyz;
}

fn transform_normal(m: mat4x4<f32>, n: vec3<f32>) -> vec3<f32> {
    let invTranspose = transpose(inverse(m));
    return normalize((invTranspose * vec4<f32>(n, 0.0)).xyz);
}
