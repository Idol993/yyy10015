export type vec2 = { x: number; y: number };
export type vec3 = { x: number; y: number; z: number };
export type vec4 = { x: number; y: number; z: number; w: number };
export type mat4 = any;

export interface TriangleData {
    v0: vec3; v1: vec3; v2: vec3;
    n0: vec3; n1: vec3; n2: vec3;
    uv0: vec2; uv1: vec2;
    materialID: number;
}

export interface BVHNode {
    boundsMin: vec3;
    boundsMax: vec3;
    leftChild: number;
    rightChild: number;
    triangleCount: number;
    triangleStart: number;
}

export interface PBRMaterial {
    baseColor: vec4;
    baseColorTexture: number;
    metallic: number;
    roughness: number;
    metallicRoughnessTexture: number;
    normalTexture: number;
    occlusionTexture: number;
    emissive: vec3;
    emissiveTexture: number;
    clearcoat: number;
    clearcoatRoughness: number;
    clearcoatTexture: number;
    transmission: number;
    ior: number;
    thickness: number;
    subsurface: number;
    alphaMode: number;
    alphaCutoff: number;
    doubleSided: number;
}

export interface InstanceData {
    transform: mat4;
    inverseTransform: mat4;
    meshID: number;
    materialOffset: number;
    flags: number;
}

export interface CameraParams {
    position: vec3;
    direction: vec3;
    up: vec3;
    fov: number;
    aspect: number;
    near: number;
    far: number;
    focalDistance: number;
    aperture: number;
}

export interface RenderSettings {
    samplesPerFrame: number;
    maxBounces: number;
    minBouncesForRR: number;
    enableNEE: boolean;
    enableMIS: boolean;
    enableRussianRoulette: boolean;
    enableDenoiser: boolean;
    enableBloom: boolean;
    enableDOF: boolean;
    exposure: number;
    bloomThreshold: number;
    bloomIntensity: number;
    tonemapType: number;
    frameCount: number;
    sampleCount: number;
}

export interface PerformanceMetrics {
    fps: number;
    frameTime: number;
    passTimes: Record<string, number>;
    gpuMemoryUsed: number;
    triangleCount: number;
    bvhNodeCount: number;
}

export interface TextureInfo {
    width: number;
    height: number;
    format: GPUTextureFormat;
    mipLevelCount: number;
    texture: GPUTexture | null;
    sampler: GPUSampler | null;
}

export interface SceneData {
    triangles: TriangleData[];
    materials: PBRMaterial[];
    instances: InstanceData[];
    textures: TextureInfo[];
    lights: LightData[];
    environmentMap: number;
}

export interface LightData {
    type: number;
    position: vec3;
    direction: vec3;
    color: vec3;
    intensity: number;
    radius: number;
    innerConeAngle: number;
    outerConeAngle: number;
}

export const TRIANGLE_SIZE = 16 * 4;
export const BVH_NODE_SIZE = 8 * 4;
export const MATERIAL_SIZE = 16 * 4;
export const INSTANCE_SIZE = 16 * 4 * 2 + 8;
export const CAMERA_SIZE = 12 * 4;
export const RENDER_SETTINGS_SIZE = 16 * 4;
export const LIGHT_SIZE = 12 * 4;

export const TEXTURE_FORMAT_RGBA8 = 'rgba8unorm';
export const TEXTURE_FORMAT_RGBA16F = 'rgba16float';
export const TEXTURE_FORMAT_RGBA32F = 'rgba32float';
export const TEXTURE_FORMAT_R8 = 'r8unorm';
export const TEXTURE_FORMAT_RG8 = 'rg8unorm';

export const BUFFER_USAGE_STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
export const BUFFER_USAGE_UNIFORM = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;
export const BUFFER_USAGE_VERTEX = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
export const BUFFER_USAGE_INDEX = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
export const BUFFER_USAGE_INDIRECT = GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST;
export const BUFFER_USAGE_QUERY = GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;

export const TEXTURE_USAGE_SAMPLED = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT;
export const TEXTURE_USAGE_STORAGE = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC;

export const ALPHA_MODE_OPAQUE = 0;
export const ALPHA_MODE_MASK = 1;
export const ALPHA_MODE_BLEND = 2;

export const LIGHT_TYPE_DIRECTIONAL = 0;
export const LIGHT_TYPE_POINT = 1;
export const LIGHT_TYPE_SPOT = 2;
export const LIGHT_TYPE_AREA = 3;

export const TONEMAP_TYPE_NONE = 0;
export const TONEMAP_TYPE_ACES = 1;
export const TONEMAP_TYPE_REINHARD = 2;
export const TONEMAP_TYPE_FILMIC = 3;

export const BVH_FLAGS_LEAF = 0x1;
export const BVH_FLAGS_INTERNAL = 0x2;
export const BVH_FLAGS_UPDATED = 0x4;

export const RAY_FLAGS_NONE = 0x0;
export const RAY_FLAGS_OCCLUSION = 0x1;
export const RAY_FLAGS_SHADOW = 0x2;
export const RAY_FLAGS_DIFFUSE = 0x4;
export const RAY_FLAGS_GLOSSY = 0x8;
export const RAY_FLAGS_SPECULAR = 0x10;
export const RAY_FLAGS_TRANSMISSION = 0x20;

export const MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE = 0x1;
export const MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE = 0x2;
export const MATERIAL_FLAG_HAS_NORMAL_TEXTURE = 0x4;
export const MATERIAL_FLAG_HAS_OCCLUSION_TEXTURE = 0x8;
export const MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE = 0x10;
export const MATERIAL_FLAG_HAS_CLEARCOAT_TEXTURE = 0x20;
export const MATERIAL_FLAG_TRANSMISSION = 0x40;
export const MATERIAL_FLAG_DOUBLE_SIDED = 0x80;
