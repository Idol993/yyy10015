struct TextureSamplingData {
    width: u32,
    height: u32,
    mipLevels: u32,
    arrayLayers: u32,
    format: u32,
}

var<private> texSampler: sampler;
var<private> texSamplerNearest: sampler;

fn init_samplers() {
    texSampler = sampler_create(&SamplerDescriptor(
        minFilter: FilterMode::linear,
        magFilter: FilterMode::linear,
        mipmapFilter: MipmapFilterMode::linear,
        addressModeU: AddressMode::repeat,
        addressModeV: AddressMode::repeat,
        addressModeW: AddressMode::repeat,
        lodMinClamp: 0.0,
        lodMaxClamp: 1000.0,
        maxAnisotropy: 1.0,
        compare: CompareFunction::undefined,
    ));
    
    texSamplerNearest = sampler_create(&SamplerDescriptor(
        minFilter: FilterMode::nearest,
        magFilter: FilterMode::nearest,
        mipmapFilter: MipmapFilterMode::nearest,
        addressModeU: AddressMode::repeat,
        addressModeV: AddressMode::repeat,
        addressModeW: AddressMode::repeat,
    ));
}

fn sample_texture_2d(texture: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    return textureSample(texture, texSampler, uv);
}

fn sample_texture_2d_bias(texture: texture_2d<f32>, uv: vec2<f32>, bias: f32) -> vec4<f32> {
    return textureSampleBias(texture, texSampler, uv, bias);
}

fn sample_texture_2d_lod(texture: texture_2d<f32>, uv: vec2<f32>, lod: f32) -> vec4<f32> {
    return textureSampleLevel(texture, texSampler, uv, lod);
}

fn sample_texture_2d_nearest(texture: texture_2d<f32>, uv: vec2<f32>) -> vec4<f32> {
    return textureSample(texture, texSamplerNearest, uv);
}

fn sample_texture_2d_grad(texture: texture_2d<f32>, uv: vec2<f32>, ddx: vec2<f32>, ddy: vec2<f32>) -> vec4<f32> {
    return textureSampleGrad(texture, texSampler, uv, ddx, ddy);
}

fn texture_load_2d(texture: texture_2d<f32>, coord: vec2<i32>, level: u32) -> vec4<f32> {
    return textureLoad(texture, coord, level);
}

fn sample_cubemap(texture: texture_cube<f32>, direction: vec3<f32>) -> vec4<f32> {
    return textureSample(texture, texSampler, direction);
}

fn sample_cubemap_lod(texture: texture_cube<f32>, direction: vec3<f32>, lod: f32) -> vec4<f32> {
    return textureSampleLevel(texture, texSampler, direction, lod);
}

fn sample_texture_array(texture: texture_2d_array<f32>, uv: vec2<f32>, arrayIndex: u32) -> vec4<f32> {
    return textureSample(texture, texSampler, uv, arrayIndex);
}

fn sample_shadow(texture: texture_depth_2d, uv: vec2<f32>, compare: f32) -> f32 {
    return textureSampleCompare(texture, texSampler, uv, compare);
}

fn bilinear_sample(data: array<vec4<f32>>, width: u32, height: u32, uv: vec2<f32>) -> vec4<f32> {
    let texelSize = vec2<f32>(1.0) / vec2<f32>(width, height);
    let f = fract(uv * vec2<f32>(width, height) - 0.5);
    
    let uv00 = clamp(uv - 0.5 * texelSize, vec2<f32>(0.0), vec2<f32>(1.0));
    let uv10 = clamp(uv + vec2<f32>(0.5, -0.5) * texelSize, vec2<f32>(0.0), vec2<f32>(1.0));
    let uv01 = clamp(uv + vec2<f32>(-0.5, 0.5) * texelSize, vec2<f32>(0.0), vec2<f32>(1.0));
    let uv11 = clamp(uv + 0.5 * texelSize, vec2<f32>(0.0), vec2<f32>(1.0));
    
    let idx00 = u32(uv00.y * f32(height)) * width + u32(uv00.x * f32(width));
    let idx10 = u32(uv10.y * f32(height)) * width + u32(uv10.x * f32(width));
    let idx01 = u32(uv01.y * f32(height)) * width + u32(uv01.x * f32(width));
    let idx11 = u32(uv11.y * f32(height)) * width + u32(uv11.x * f32(width));
    
    let t00 = data[idx00];
    let t10 = data[idx10];
    let t01 = data[idx01];
    let t11 = data[idx11];
    
    let tx0 = mix(t00, t10, f.x);
    let tx1 = mix(t01, t11, f.x);
    
    return mix(tx0, tx1, f.y);
}

fn trilinear_sample(
    mipmaps: array<array<vec4<f32>>>,
    mipSizes: array<vec2<u32>>,
    mipCount: u32,
    uv: vec2<f32>,
    lod: f32
) -> vec4<f32> {
    let lodClamped = clamp(lod, 0.0, f32(mipCount - 1u));
    let lod0 = u32(floor(lodClamped));
    let lod1 = min(lod0 + 1u, mipCount - 1u);
    let f = fract(lodClamped);
    
    let size0 = mipSizes[lod0];
    let size1 = mipSizes[lod1];
    
    let t0 = bilinear_sample(mipmaps[lod0], size0.x, size0.y, uv);
    let t1 = bilinear_sample(mipmaps[lod1], size1.x, size1.y, uv);
    
    return mix(t0, t1, f);
}

fn sample_mip_level(width: u32, height: u32, ddx: vec2<f32>, ddy: vec2<f32>) -> f32 {
    let px = vec2<f32>(f32(width), f32(height));
    let rx = length(ddx * px);
    let ry = length(ddy * px);
    let rho = max(rx, ry);
    return max(0.0, log2(max(rho, 1e-4)));
}

fn address_clamp(coord: vec2<f32>) -> vec2<f32> {
    return clamp(coord, 0.0, 1.0);
}

fn address_repeat(coord: vec2<f32>) -> vec2<f32> {
    return fract(coord);
}

fn address_mirror(coord: vec2<f32>) -> vec2<f32> {
    let f = fract(coord * 0.5);
    return select(f, 1.0 - f, f > 0.5);
}

fn decode_normal_map(normalSample: vec4<f32>) -> vec3<f32> {
    var n = normalSample.rgb * 2.0 - 1.0;
    return normalize(n);
}

fn unpack_float_rgba8(value: u32) -> vec4<f32> {
    let r = f32((value >> 0u) & 0xFFu) / 255.0;
    let g = f32((value >> 8u) & 0xFFu) / 255.0;
    let b = f32((value >> 16u) & 0xFFu) / 255.0;
    let a = f32((value >> 24u) & 0xFFu) / 255.0;
    return vec4<f32>(r, g, b, a);
}

fn pack_float_rgba8(color: vec4<f32>) -> u32 {
    let r = u32(clamp(color.r, 0.0, 1.0) * 255.0) & 0xFFu;
    let g = u32(clamp(color.g, 0.0, 1.0) * 255.0) & 0xFFu;
    let b = u32(clamp(color.b, 0.0, 1.0) * 255.0) & 0xFFu;
    let a = u32(clamp(color.a, 0.0, 1.0) * 255.0) & 0xFFu;
    return r | (g << 8u) | (b << 16u) | (a << 24u);
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
    var linear: vec3<f32>;
    
    if (c.r <= 0.04045) {
        linear.r = c.r / 12.92;
    } else {
        linear.r = pow((c.r + 0.055) / 1.055, 2.4);
    }
    
    if (c.g <= 0.04045) {
        linear.g = c.g / 12.92;
    } else {
        linear.g = pow((c.g + 0.055) / 1.055, 2.4);
    }
    
    if (c.b <= 0.04045) {
        linear.b = c.b / 12.92;
    } else {
        linear.b = pow((c.b + 0.055) / 1.055, 2.4);
    }
    
    return linear;
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
    var srgb: vec3<f32>;
    
    if (c.r <= 0.0031308) {
        srgb.r = c.r * 12.92;
    } else {
        srgb.r = 1.055 * pow(c.r, 1.0 / 2.4) - 0.055;
    }
    
    if (c.g <= 0.0031308) {
        srgb.g = c.g * 12.92;
    } else {
        srgb.g = 1.055 * pow(c.g, 1.0 / 2.4) - 0.055;
    }
    
    if (c.b <= 0.0031308) {
        srgb.b = c.b * 12.92;
    } else {
        srgb.b = 1.055 * pow(c.b, 1.0 / 2.4) - 0.055;
    }
    
    return srgb;
}

fn apply_gamma(c: vec3<f32>, gamma: f32) -> vec3<f32> {
    return pow(c, vec3<f32>(1.0 / gamma));
}

fn sample_environment_map(
    envMap: texture_cube<f32>,
    direction: vec3<f32>,
    roughness: f32
) -> vec3<f32> {
    let mipCount = 8.0;
    let lod = roughness * roughness * mipCount;
    return sample_cubemap_lod(envMap, normalize(direction), lod).rgb;
}

fn sample_environment_pdf(direction: vec3<f32>, envMapWidth: u32, envMapHeight: u32) -> f32 {
    let spherical = direction_to_spherical(direction);
    let theta = spherical.x;
    let phi = spherical.y;
    
    let sinTheta = sin(theta);
    
    if (sinTheta <= 0.0) {
        return 0.0;
    }
    
    let pdf = 1.0 / (2.0 * PI * PI * sinTheta + EPSILON);
    return pdf;
}

fn sample_environment_importance(
    envMap: texture_2d<f32>,
    marginalCDF: array<f32>,
    conditionalCDF: array<array<f32>>,
    envMapWidth: u32,
    envMapHeight: u32,
    u: vec2<f32>
) -> vec4<f32> {
    var v = u.y;
    var row = 0u;
    
    for (var y = 0u; y < envMapHeight; y++) {
        if (marginalCDF[y] >= v) {
            row = y;
            v = (v - (y > 0u ? marginalCDF[y - 1u] : 0.0)) / (marginalCDF[y] - (y > 0u ? marginalCDF[y - 1u] : 0.0) + EPSILON);
            break;
        }
    }
    
    var u2 = u.x;
    var col = 0u;
    
    for (var x = 0u; x < envMapWidth; x++) {
        if (conditionalCDF[row][x] >= u2) {
            col = x;
            u2 = (u2 - (x > 0u ? conditionalCDF[row][x - 1u] : 0.0)) / (conditionalCDF[row][x] - (x > 0u ? conditionalCDF[row][x - 1u] : 0.0) + EPSILON);
            break;
        }
    }
    
    let uv = vec2<f32>(f32(col) / f32(envMapWidth), f32(row) / f32(envMapHeight));
    let color = texture_load_2d(envMap, vec2<i32>(i32(col), i32(row)), 0u);
    
    let theta = uv.y * PI;
    let phi = uv.x * TWO_PI;
    let dir = spherical_to_direction(theta, phi);
    
    let sinTheta = sin(theta);
    let pdf = (color.r + color.g + color.b) / (3.0 * sinTheta + EPSILON);
    
    return vec4<f32>(dir, pdf);
}

struct MaterialTextureSet {
    baseColor: texture_2d<f32>,
    metallicRoughness: texture_2d<f32>,
    normal: texture_2d<f32>,
    occlusion: texture_2d<f32>,
    emissive: texture_2d<f32>,
    clearcoat: texture_2d<f32>,
    flags: u32,
}

fn sample_material_textures(
    textures: MaterialTextureSet,
    uv: vec2<f32>,
    ddx: vec2<f32>,
    ddy: vec2<f32>
) -> PBRMaterialData {
    var material = PBRMaterialData(
        vec4<f32>(1.0, 1.0, 1.0, 1.0),
        0.0,
        0.5,
        vec3<f32>(0.0),
        0.0,
        0.0,
        0.0,
        1.5,
        0.0,
        0.0,
        0.5,
        0u
    );
    
    if ((textures.flags & MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE) != 0u) {
        let baseColor = sample_texture_2d_grad(textures.baseColor, uv, ddx, ddy);
        material.baseColor = baseColor;
    }
    
    if ((textures.flags & MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE) != 0u) {
        let mr = sample_texture_2d_grad(textures.metallicRoughness, uv, ddx, ddy);
        material.metallic = mr.b;
        material.roughness = mr.g;
    }
    
    if ((textures.flags & MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE) != 0u) {
        let emissive = sample_texture_2d_grad(textures.emissive, uv, ddx, ddy);
        material.emissive = srgb_to_linear(emissive.rgb);
    }
    
    material.roughness = max(0.05, material.roughness);
    
    return material;
}

fn sample_normal_map(
    normalTex: texture_2d<f32>,
    uv: vec2<f32>,
    ddx: vec2<f32>,
    ddy: vec2<f32>,
    basis: mat3x3<f32>
) -> vec3<f32> {
    let normalSample = sample_texture_2d_grad(normalTex, uv, ddx, ddy);
    let localNormal = decode_normal_map(normalSample);
    return normalize(to_world(basis, localNormal));
}
