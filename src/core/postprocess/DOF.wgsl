struct DOFParams {
    focalDistance: f32,
    aperture: f32,
    focalLength: f32,
    width: u32,
    height: u32,
    nearPlane: f32,
    farPlane: f32,
    maxBokehSize: f32,
};

@group(0) @binding(0) var<uniform> params: DOFParams;
@group(0) @binding(1) var inputColor: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var outputColor: texture_storage_2d<rgba16float, write>;

const GOLDEN_ANGLE: f32 = 2.39996323;

fn computeCircleOfConfusion(depth: f32) -> f32 {
    if (depth < 0.001) {
        return 0.0;
    }

    let coc = params.aperture * params.focalLength *
        abs(depth - params.focalDistance) / (depth * (params.focalDistance - params.focalLength) + 0.001);

    return min(coc, params.maxBokehSize);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let texCoord = vec2<i32>(id.xy);
    let dims = vec2<f32>(f32(params.width), f32(params.height));

    let centerDepth = textureLoad(depthTex, texCoord, 0).r;
    let centerColor = textureLoad(inputColor, texCoord, 0).rgb;

    let coc = computeCircleOfConfusion(centerDepth);

    if (coc < 0.5) {
        textureStore(outputColor, texCoord, vec4<f32>(centerColor, 1.0));
        return;
    }

    let cocPixels = coc;

    var totalColor = vec3<f32>(0.0);
    var totalWeight = 0.0;

    let sampleCount = 16u;

    for (var i = 0u; i < sampleCount; i++) {
        let angle = f32(i) * GOLDEN_ANGLE;
        let radius = sqrt(f32(i) / f32(sampleCount)) * cocPixels;

        let offset = vec2<f32>(cos(angle), sin(angle)) * radius;
        let sampleCoord = vec2<f32>(id.xy) + offset;

        let sampleUV = (sampleCoord + vec2<f32>(0.5)) / dims;

        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) {
            continue;
        }

        let sampleTexel = vec2<i32>(clamp(sampleCoord, vec2<f32>(0.0), dims - vec2<f32>(1.0)));
        let sampleDepth = textureLoad(depthTex, sampleTexel, 0).r;
        let sampleColor = textureLoad(inputColor, sampleTexel, 0).rgb;

        let sampleCoC = computeCircleOfConfusion(sampleDepth);

        let depthDiff = abs(centerDepth - sampleDepth);
        let depthWeight = exp(-depthDiff * depthDiff * 100.0);

        let sampleRadius = radius;
        let bokehWeight = select(1.0, 0.0, sampleRadius > sampleCoC);

        let weight = depthWeight * bokehWeight;

        totalColor += sampleColor * weight;
        totalWeight += weight;
    }

    var result: vec3<f32>;
    if (totalWeight > 0.0) {
        result = totalColor / totalWeight;
    } else {
        result = centerColor;
    }

    textureStore(outputColor, texCoord, vec4<f32>(result, 1.0));
}
