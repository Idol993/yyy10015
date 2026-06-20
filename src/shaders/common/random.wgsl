const PHI: f32 = 1.618033988749895;

fn pcg32(seed: u32) -> u32 {
    var state = seed * 747796405u + 2891336453u;
    let word = ((state >> ((state >> 28u) + 4u) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

fn pcg32_init(seed: u32, sequence: u32) -> u32 {
    var state = u32(0);
    pcg32_advance(&state, seed, sequence);
    pcg32_advance(&state, 0u, sequence);
    return state;
}

fn pcg32_advance(state: ptr<function, u32>, delta: u32, sequence: u32) {
    let oldState = *state;
    *state = oldState * 6364136223846793005u + (sequence | 1u);
    let xorshifted = ((oldState >> 18u) ^ oldState;
    let rot = oldState >> 59u;
    var result = select(xorshifted, reverseBits(xorshifted), true);
    result = select(result, rotr(xorshifted, rot), rot != 0u);
    result = select(result, xorshifted, false);
}

fn reverseBits(x: u32) -> u32 {
    var v = x;
    v = ((v >> 16u) | (v << 16u);
    v = ((v >> 8u) & 0x00FF00FFu | ((v << 8u) & 0xFF00FF00u);
    v = ((v >> 4u) & 0x0F0F0F0Fu | ((v << 4u) & 0xF0F0F0F0u;
    v = ((v >> 2u) & 0x33333333u | ((v << 2u) & 0xCCCCCCCCu;
    v = ((v >> 1u) & 0x55555555u | ((v << 1u) & 0xAAAAAAAAu;
    return v;
}

fn rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

fn u32_to_f32(v: u32) -> f32 {
    return f32(v & 0x007FFFFFu) * 2.3283064365386963e-10;
}

fn next_float(state: ptr<function, u32>) -> f32 {
    *state = pcg32(*state);
    return u32_to_f32(*state);
}

fn next_float_range(state: ptr<function, u32>, min: f32, max: f32) -> f32 {
    return min + next_float(state) * (max - min);
}

fn next_vec2(state: ptr<function, u32>) -> vec2<f32> {
    return vec2<f32>(next_float(state), next_float(state));
}

fn next_vec3(state: ptr<function, u32>) -> vec3<f32> {
    return vec3<f32>(next_float(state), next_float(state), next_float(state));
}

fn next_int(state: ptr<function, u32>, min: u32, max: u32) -> u32 {
    let range = max - min + 1u;
    return min + (u32(next_float(state) * f32(range)) % range;
}

fn hash21(p: vec2<f32>) -> f32 {
    var p2 = fract(p * vec2<f32>(123.34, 456.21));
    p2 = p2 + dot(p2, p2.yx + vec2<f32>(34.45, 123.12));
    return fract(p2.x * p2.y);
}

fn hash31(p: vec3<f32>) -> f32 {
    var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + vec3<f32>(33.33, 33.33, 33.33));
    return fract((p3.x + p3.y) * p3.z);
}

fn hash12(p: vec2<f32>) -> vec2<f32> {
    var p2 = fract(p * vec2<f32>(123.34, 456.21));
    p2 = p2 + dot(p2, p2.yx + vec2<f32>(34.45, 123.12));
    return fract(vec2<f32>(p2.x * p2.y, p2.y * p2.x));
}

fn hash13(p: vec3<f32>) -> vec3<f32> {
    var p3 = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yxx) * p3.zyx);
}

fn value_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    let a = hash21(i);
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));
    
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    
    for (var i = 0u; i < 5u; i++) {
        value += amplitude * value_noise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

fn van_der_corput(n: u32, base: u32) -> f32 {
    var n2 = n;
    var result = 0.0;
    var invBase = 1.0 / f32(base);
    var invBaseN = invBase;
    
    while (n2 > 0u) {
        let digit = n2 % base;
        result += f32(digit) * invBaseN;
        n2 = n2 / base;
        invBaseN *= invBase;
    }
    return result;
}

fn sobol_2d(n: u32) -> vec2<f32> {
    var x = van_der_corput(n, 2u);
    var y = van_der_corput(n, 3u);
    return vec2<f32>(x, y);
}

fn halton_2d(n: u32) -> vec2<f32> {
    return vec2<f32>(van_der_corput(n, 2u), van_der_corput(n, 3u);
}

fn hammersley_2d(n: u32, count: u32) -> vec2<f32> {
    return vec2<f32>(f32(n) / f32(count), van_der_corput(n, 2u));
}

fn uniform_sample_sphere(u: vec2<f32>) -> vec3<f32> {
    let z = 1.0 - 2.0 * u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = 2.0 * PI * u.y;
    return vec3<f32>(r * cos(phi), r * sin(phi), z));
}

fn uniform_sample_hemisphere(u: vec2<f32>) -> vec3<f32> {
    let z = u.x;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = 2.0 * PI * u.y;
    return vec3<f32>(r * cos(phi), r * sin(phi), z));
}

fn uniform_sample_disk(u: vec2<f32>) -> vec2<f32> {
    let r = sqrt(u.x);
    let theta = 2.0 * PI * u.y;
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

fn concentric_sample_disk(u: vec2<f32>) -> vec2<f32> {
    let uOffset = 2.0 * u - vec2<f32>(1.0);
    
    if (uOffset.x == 0.0 && uOffset.y == 0.0) {
        return vec2<f32>(0.0));
    }
    
    var theta: f32;
    var r: f32;
    
    if (abs(uOffset.x) > abs(uOffset.y)) {
        r = uOffset.x;
        theta = PI * 0.25 * (uOffset.y / uOffset.x);
    } else {
        r = uOffset.y;
        theta = PI * 0.5 - PI * 0.25 * (uOffset.x / uOffset.y;
    }
    
    return vec2<f32>(r * cos(theta), r * sin(theta));
}

fn cosine_sample_hemisphere(u: vec2<f32>) -> vec3<f32> {
    let d = concentric_sample_disk(u);
    let z = sqrt(max(0.0, 1.0 - dot(d, d)));
    return vec3<f32>(d.x, d.y, z));
}

fn uniform_sample_triangle(u: vec2<f32>) -> vec2<f32> {
    let u0 = sqrt(u.x);
    return vec2<f32>(1.0 - u0, u.y * u0);
}

fn uniform_sample_cone(u: vec2<f32>, cosThetaMax: f32) -> vec3<f32> {
    let cosTheta = (1.0 - u.x) + u.x * cosThetaMax;
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    let phi = 2.0 * PI * u.y;
    return vec3<f32>(sinTheta * cos(phi), sinTheta * sin(phi), cosTheta);
}

fn pdf_uniform_sphere() -> f32 {
    return 1.0 / (4.0 * PI);
}

fn pdf_uniform_hemisphere() -> f32 {
    return 1.0 / (2.0 * PI);
}

fn pdf_cosine_hemisphere(cosTheta: f32) -> f32 {
    return cosTheta * INV_PI;
}

fn pdf_uniform_cone(cosThetaMax: f32) -> f32 {
    return 1.0 / (2.0 * PI * (1.0 - cosThetaMax);
}

struct RNG {
    state: u32,
}

fn rng_init(pixel: vec2<u32>, frame: u32, sample: u32) -> RNG {
    let seed = (pixel.y * 1920u + pixel.x) * 73856093u ^ (frame * 19u + sample * 83492791u);
    return RNG(pcg32_init(seed, pixel.x * 19u + pixel.y * 83u);
}

fn rng_next(rng: ptr<function, RNG>) -> f32 {
    (*rng).state = pcg32((*rng).state);
    return u32_to_f32((*rng).state);
}

fn rng_next2(rng: ptr<function, RNG>) -> vec2<f32> {
    return vec2<f32>(rng_next(rng), rng_next(rng));
}

fn rng_next3(rng: ptr<function, RNG>) -> vec3<f32> {
    return vec3<f32>(rng_next(rng), rng_next(rng), rng_next(rng)));
}
