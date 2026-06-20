struct TemporalAccumulateParams {
    alpha: f32,
    momentsAlpha: f32,
    width: u32,
    height: u32,
    fireflyThreshold: f32,
    frameCount: u32,
    padding1: f32,
    padding2: f32,
};

@group(0) @binding(0) var<uniform> params: TemporalAccumulateParams;
@group(0) @binding(1) var currentRadiance: texture_2d<f32>;
@group(0) @binding(2) var reprojectedColor: texture_2d<f32>;
@group(0) @binding(3) var disocclusionWeight: texture_2d<f32>;
@group(0) @binding(4) var prevMoments: texture_2d<f32>;
@group(0) @binding(5) var outputColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var outputMoments: texture_storage_2d<rgba16float, write>;

fn rgbToYCoCg(c: vec3<f32>) -> vec3<f32> {
    let Y = 0.25 * c.r + 0.5 * c.g + 0.25 * c.b;
    let Co = c.r - c.b;
    let Cg = c.g - 0.5 * (c.r + c.b);
    return vec3<f32>(Y, Co, Cg);
}

fn yCoCgToRgb(c: vec3<f32>) -> vec3<f32> {
    let t = c.x - c.z * 0.5;
    let r = t + c.y * 0.5;
    let b = t - c.y * 0.5;
    let g = c.z + t;
    return vec3<f32>(r, g, b);
}

fn computeNeighborhoodAABB(tex: texture_2d<f32>, center: vec2<i32>, dims: vec2<u32>) -> vec2<vec3<f32>> {
    var minColor = vec3<f32>(1e30);
    var maxColor = vec3<f32>(-1e30);

    for (var dy: i32 = -1; dy <= 1; dy++) {
        for (var dx: i32 = -1; dx <= 1; dx++) {
            let nx = clamp(center.x + dx, 0, i32(dims.x) - 1);
            let ny = clamp(center.y + dy, 0, i32(dims.y) - 1);
            let neighborColor = textureLoad(tex, vec2<i32>(nx, ny), 0).rgb;
            let ycocg = rgbToYCoCg(neighborColor);
            minColor = min(minColor, ycocg);
            maxColor = max(maxColor, ycocg);
        }
    }

    return vec2<vec3<f32>>(minColor, maxColor);
}

fn clampToAABB(color: vec3<f32>, aabbMin: vec3<f32>, aabbMax: vec3<f32>) -> vec3<f32> {
    let ycocg = rgbToYCoCg(color);
    let center = (aabbMin + aabbMax) * 0.5;
    let extent = (aabbMax - aabbMin) * 0.5;

    let offset = ycocg - center;
    let scaledOffset = offset / max(extent, vec3<f32>(1e-6));
    let maxAbs = max(max(abs(scaledOffset.x), abs(scaledOffset.y)), abs(scaledOffset.z));

    var clampedYCoCg: vec3<f32>;
    if (maxAbs > 1.0) {
        clampedYCoCg = center + offset / maxAbs;
    } else {
        clampedYCoCg = ycocg;
    }

    return yCoCgToRgb(clampedYCoCg);
}

fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let texCoord = vec2<i32>(id.xy);
    let dims = vec2<u32>(params.width, params.height);

    let currentColor = textureLoad(currentRadiance, texCoord, 0).rgb;
    let reprojectedHistColor = textureLoad(reprojectedColor, texCoord, 0).rgb;
    let weight = textureLoad(disocclusionWeight, texCoord, 0).r;
    let prevMom = textureLoad(prevMoments, texCoord, 0);

    var alpha = params.alpha;

    if (params.frameCount <= 1u) {
        textureStore(outputColor, texCoord, vec4<f32>(currentColor, 1.0));
        let lum = luminance(currentColor);
        textureStore(outputMoments, texCoord, vec4<f32>(lum, lum * lum, 0.0, 0.0));
        return;
    }

    if (weight < 0.5) {
        alpha = 1.0;
    }

    let currentLum = luminance(currentColor);
    if (currentLum > params.fireflyThreshold && params.fireflyThreshold > 0.0) {
        alpha = max(alpha, 0.8);
    }

    let aabb = computeNeighborhoodAABB(currentRadiance, texCoord, dims);
    let clampedHistory = clampToAABB(reprojectedHistColor, aabb[0], aabb[1]);

    var accumulatedColor = mix(clampedHistory, currentColor, alpha);

    accumulatedColor = max(accumulatedColor, vec3<f32>(0.0));

    let momentsAlpha = select(params.momentsAlpha, 1.0, weight < 0.5);
    let lum = luminance(accumulatedColor);
    let newMoment1 = mix(prevMom.r, lum, momentsAlpha);
    let newMoment2 = mix(prevMom.g, lum * lum, momentsAlpha);

    textureStore(outputColor, texCoord, vec4<f32>(accumulatedColor, 1.0));
    textureStore(outputMoments, texCoord, vec4<f32>(newMoment1, newMoment2, 0.0, 0.0));
}
