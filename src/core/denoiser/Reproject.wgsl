struct ReprojectParams {
    prevViewProj: mat4x4<f32>,
    invViewProj: mat4x4<f32>,
    width: u32,
    height: u32,
    depthThreshold: f32,
    normalThreshold: f32,
};

@group(0) @binding(0) var<uniform> params: ReprojectParams;
@group(0) @binding(1) var depthTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var historyColorTex: texture_2d<f32>;
@group(0) @binding(4) var outputColor: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var outputWeight: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var linearSampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= params.width || id.y >= params.height) {
        return;
    }

    let dims = vec2<f32>(f32(params.width), f32(params.height));
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / dims;
    let texCoord = vec2<i32>(id.xy);

    let depth = textureLoad(depthTex, texCoord, 0).r;
    let normal = textureLoad(normalTex, texCoord, 0).xyz;

    let ndc = vec4<f32>(uv * 2.0 - 1.0, depth, 1.0);
    let worldPosH = params.invViewProj * ndc;
    let worldPos = worldPosH.xyz / worldPosH.w;

    let prevClip = params.prevViewProj * vec4<f32>(worldPos, 1.0);
    let prevNDC = prevClip.xyz / prevClip.w;
    let prevUV = prevNDC.xy * 0.5 + 0.5;

    var validWeight: f32 = 1.0;

    if (prevUV.x < 0.0 || prevUV.x > 1.0 || prevUV.y < 0.0 || prevUV.y > 1.0) {
        validWeight = 0.0;
    }

    if (prevNDC.z < 0.0 || prevNDC.z > 1.0) {
        validWeight = 0.0;
    }

    var historyColor: vec4<f32> = vec4<f32>(0.0);

    if (validWeight > 0.0) {
        historyColor = textureSampleLevel(historyColorTex, linearSampler, prevUV, 0.0);

        let prevPixelCoord = clamp(
            vec2<i32>(prevUV * dims),
            vec2<i32>(0, 0),
            vec2<i32>(i32(params.width) - 1, i32(params.height) - 1)
        );
        let prevDepth = textureLoad(depthTex, prevPixelCoord, 0).r;
        let prevNormal = textureLoad(normalTex, prevPixelCoord, 0).xyz;

        let depthDiff = abs(depth - prevDepth) / max(abs(depth), 0.001);
        let normalDiff = 1.0 - dot(normal, prevNormal);

        if (depthDiff > params.depthThreshold) {
            validWeight = 0.0;
        }
        if (normalDiff > params.normalThreshold) {
            validWeight = 0.0;
        }
    }

    textureStore(outputColor, texCoord, historyColor);
    textureStore(outputWeight, texCoord, vec4<f32>(validWeight, 0.0, 0.0, 0.0));
}
