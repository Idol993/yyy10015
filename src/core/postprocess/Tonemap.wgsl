struct TonemapParams {
    exposure: f32,
    tonemapType: u32,
    width: u32,
    height: u32,
};

@group(0) @binding(0) var<uniform> params: TonemapParams;
@group(0) @binding(1) var inputHDR: texture_2d<f32>;

fn acesRRT(x: f32) -> f32 {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

fn acesTonemap(color: vec3<f32>) -> vec3<f32> {
    let inputMat = mat3x3<f32>(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
    );
    let outputMat = mat3x3<f32>(
        1.60475, -0.10208, -0.00327,
        -0.53108, 1.10813, -0.07276,
        -0.07367, -0.00605, 1.07602
    );

    var v = inputMat * color;
    v.r = acesRRT(v.r);
    v.g = acesRRT(v.g);
    v.b = acesRRT(v.b);
    return outputMat * v;
}

fn reinhardTonemap(color: vec3<f32>) -> vec3<f32> {
    return color / (color + vec3<f32>(1.0));
}

fn filmicTonemap(color: vec3<f32>) -> vec3<f32> {
    let x = max(vec3<f32>(0.0), color - 0.004);
    return (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
}

fn linearToSRGB(c: vec3<f32>) -> vec3<f32> {
    var srgb: vec3<f32>;
    srgb.r = select(c.r * 12.92, 1.055 * pow(c.r, 1.0 / 2.4) - 0.055, c.r > 0.0031308);
    srgb.g = select(c.g * 12.92, 1.055 * pow(c.g, 1.0 / 2.4) - 0.055, c.g > 0.0031308);
    srgb.b = select(c.b * 12.92, 1.055 * pow(c.b, 1.0 / 2.4) - 0.055, c.b > 0.0031308);
    return srgb;
}
