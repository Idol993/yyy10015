struct BilateralFilterParams {
    sigmaZ: f32,
    sigmaN: f32,
    width: u32,
    height: u32,
    stepSize: u32,
    kernelRadius: u32,
    padding1: f32,
    padding2: f32,
};

@group(0) @binding(0) var<uniform> params: BilateralFilterParams;
@group(0) @binding(1) var inputColor: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var momentsTex: texture_2d<f32>;
@group(0) @binding(5) var outputColor: texture_storage_2d<rgba16float, write>;

fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let texCoord = vec2<i32>(id.xy);
    let dims = vec2<i32>(i32(params.width), i32(params.height));

    let centerColor = textureLoad(inputColor, texCoord, 0).rgb;
    let centerDepth = textureLoad(depthTex, texCoord, 0).r;
    let centerNormal = textureLoad(normalTex, texCoord, 0).xyz;

    let moments = textureLoad(momentsTex, texCoord, 0);
    let variance = max(moments.g - moments.r * moments.r, 0.0);

    let stdDev = sqrt(variance);
    let colorWeightFactor = 1.0 / (stdDev * 10.0 + 0.01);

    var sumColor = vec3<f32>(0.0);
    var sumWeight = 0.0;

    let step = i32(params.stepSize);
    let radius = i32(params.kernelRadius);

    for (var dy: i32 = -radius; dy <= radius; dy++) {
        for (var dx: i32 = -radius; dx <= radius; dx++) {
            let nx = clamp(texCoord.x + dx * step, 0, dims.x - 1);
            let ny = clamp(texCoord.y + dy * step, 0, dims.y - 1);
            let neighborCoord = vec2<i32>(nx, ny);

            let neighborColor = textureLoad(inputColor, neighborCoord, 0).rgb;
            let neighborDepth = textureLoad(depthTex, neighborCoord, 0).r;
            let neighborNormal = textureLoad(normalTex, neighborCoord, 0).xyz;

            let spatialDist = f32(dx * dx + dy * dy);
            let spatialWeight = exp(-spatialDist / (2.0 * f32(radius * radius)));

            let depthDiff = abs(centerDepth - neighborDepth);
            let depthGrad = max(abs(centerDepth - neighborDepth), 0.001);
            let depthWeight = exp(-(depthDiff * depthDiff) / (params.sigmaZ * depthGrad + 1e-6));

            let normalDot = max(dot(centerNormal, neighborNormal), 0.0);
            let normalWeight = pow(normalDot, params.sigmaN);

            let colorDist = luminance(abs(centerColor - neighborColor));
            let colorWeight = exp(-colorDist * colorWeightFactor);

            let weight = spatialWeight * depthWeight * normalWeight * colorWeight;

            sumColor += neighborColor * weight;
            sumWeight += weight;
        }
    }

    var filteredColor: vec3<f32>;
    if (sumWeight > 0.0) {
        filteredColor = sumColor / sumWeight;
    } else {
        filteredColor = centerColor;
    }

    textureStore(outputColor, texCoord, vec4<f32>(filteredColor, 1.0));
}
