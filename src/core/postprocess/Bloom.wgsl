struct BloomDownsampleParams {
    threshold: f32,
    intensity: f32,
    srcWidth: u32,
    srcHeight: u32,
    dstWidth: u32,
    dstHeight: u32,
    isFirst: u32,
    padding1: f32,
};

struct BloomUpsampleParams {
    intensity: f32,
    srcWidth: u32,
    srcHeight: u32,
    dstWidth: u32,
    dstHeight: u32,
    padding1: f32,
    padding2: f32,
    padding3: f32,
};

struct BloomApplyParams {
    intensity: f32,
    width: u32,
    height: u32,
    padding1: f32,
};

@group(0) @binding(0) var<uniform> downParams: BloomDownsampleParams;
@group(0) @binding(1) var downSrcTex: texture_2d<f32>;
@group(0) @binding(2) var downDstTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var downSampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn bloomDownsample(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= downParams.dstWidth || id.y >= downParams.dstHeight) {
        return;
    }

    let dstCoord = vec2<i32>(id.xy);
    let dstDims = vec2<f32>(f32(downParams.dstWidth), f32(downParams.dstHeight));
    let srcDims = vec2<f32>(f32(downParams.srcWidth), f32(downParams.srcHeight));

    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / dstDims;

    let sample0 = textureSampleLevel(downSrcTex, downSampler, uv, 0.0);
    let sample1 = textureSampleLevel(downSrcTex, downSampler, uv + vec2<f32>(1.0, 0.0) / srcDims, 0.0);
    let sample2 = textureSampleLevel(downSrcTex, downSampler, uv + vec2<f32>(0.0, 1.0) / srcDims, 0.0);
    let sample3 = textureSampleLevel(downSrcTex, downSampler, uv + vec2<f32>(1.0, 1.0) / srcDims, 0.0);

    var avgColor = (sample0.rgb + sample1.rgb + sample2.rgb + sample3.rgb) * 0.25;

    if (downParams.isFirst != 0u) {
        let lum = 0.299 * avgColor.r + 0.587 * avgColor.g + 0.114 * avgColor.b;
        if (lum < downParams.threshold) {
            avgColor = vec3<f32>(0.0);
        }
    }

    textureStore(downDstTex, dstCoord, vec4<f32>(avgColor, 1.0));
}

@group(0) @binding(0) var<uniform> upParams: BloomUpsampleParams;
@group(0) @binding(1) var upSrcSmallMip: texture_2d<f32>;
@group(0) @binding(2) var upDownMip: texture_2d<f32>;
@group(0) @binding(3) var upDstMip: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var upSampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn bloomUpsample(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= upParams.dstWidth || id.y >= upParams.dstHeight) {
        return;
    }

    let dstCoord = vec2<i32>(id.xy);
    let dstDims = vec2<f32>(f32(upParams.dstWidth), f32(upParams.dstHeight));

    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / dstDims;

    let upsampled = textureSampleLevel(upSrcSmallMip, upSampler, uv, 0.0).rgb;
    let downsampled = textureLoad(upDownMip, dstCoord, 0).rgb;

    let result = upsampled * upParams.intensity + downsampled;

    textureStore(upDstMip, dstCoord, vec4<f32>(result, 1.0));
}

@group(0) @binding(0) var<uniform> applyParams: BloomApplyParams;
@group(0) @binding(1) var applyInputHDR: texture_2d<f32>;
@group(0) @binding(2) var applyBloomTex: texture_2d<f32>;
@group(0) @binding(3) var applyOutputHDR: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var applySampler: sampler;

@compute @workgroup_size(8, 8, 1)
fn bloomApply(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= applyParams.width || id.y >= applyParams.height) {
        return;
    }

    let texCoord = vec2<i32>(id.xy);
    let dims = vec2<f32>(f32(applyParams.width), f32(applyParams.height));
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / dims;

    let hdrColor = textureLoad(applyInputHDR, texCoord, 0).rgb;
    let bloomColor = textureSampleLevel(applyBloomTex, applySampler, uv, 0.0).rgb;

    let result = hdrColor + bloomColor * applyParams.intensity;

    textureStore(applyOutputHDR, texCoord, vec4<f32>(result, 1.0));
}
