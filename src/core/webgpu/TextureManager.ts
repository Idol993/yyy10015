import { DeviceManager } from './DeviceManager';
import { BufferPool } from './BufferPool';

export type TextureFormat = 'rgba8' | 'rgba16f' | 'rgba32f' | 'bgra8' | 'depth24' | 'depth32f';

export interface TextureCreateOptions {
    format?: TextureFormat;
    usage?: GPUTextureUsageFlags;
    mipmaps?: boolean;
    label?: string;
    dimension?: GPUTextureDimension;
    sampleCount?: number;
}

export interface TextureData {
    data: ArrayBufferView;
    width: number;
    height: number;
    depthOrArrayLayers?: number;
    bytesPerRow?: number;
    rowsPerImage?: number;
}

export interface CubemapData {
    px: ImageBitmap | HTMLImageElement | ArrayBufferView;
    nx: ImageBitmap | HTMLImageElement | ArrayBufferView;
    py: ImageBitmap | HTMLImageElement | ArrayBufferView;
    ny: ImageBitmap | HTMLImageElement | ArrayBufferView;
    pz: ImageBitmap | HTMLImageElement | ArrayBufferView;
    nz: ImageBitmap | HTMLImageElement | ArrayBufferView;
}

export interface TextureInfo {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
    depthOrArrayLayers: number;
    format: GPUTextureFormat;
    mipLevelCount: number;
    dimension: GPUTextureDimension;
}

const FORMAT_MAP: Record<TextureFormat, GPUTextureFormat> = {
    rgba8: 'rgba8unorm',
    rgba16f: 'rgba16float',
    rgba32f: 'rgba32float',
    bgra8: 'bgra8unorm',
    depth24: 'depth24plus',
    depth32f: 'depth32float'
};

export class TextureManager {
    private static instance: TextureManager | null = null;
    private deviceManager: DeviceManager;
    private bufferPool: BufferPool;
    private textures: Map<GPUTexture, TextureInfo> = new Map();
    private mipmapPipeline: GPUComputePipeline | null = null;
    private mipmapBindGroupLayout: GPUBindGroupLayout | null = null;

    private constructor() {
        this.deviceManager = DeviceManager.getInstance();
        this.bufferPool = BufferPool.getInstance();
    }

    public static getInstance(): TextureManager {
        if (!TextureManager.instance) {
            TextureManager.instance = new TextureManager();
        }
        return TextureManager.instance;
    }

    private getGPUFormat(format: TextureFormat): GPUTextureFormat {
        return FORMAT_MAP[format] || 'rgba8unorm';
    }

    private calculateMipLevels(width: number, height: number, depth = 1): number {
        let levels = 1;
        let w = width;
        let h = height;
        let d = depth;

        while (w > 1 || h > 1 || d > 1) {
            w = Math.max(1, Math.floor(w / 2));
            h = Math.max(1, Math.floor(h / 2));
            d = Math.max(1, Math.floor(d / 2));
            levels++;
        }

        return levels;
    }

    public createTexture(
        width: number,
        height: number,
        options: TextureCreateOptions = {}
    ): TextureInfo {
        const device = this.deviceManager.getDevice();
        const format = this.getGPUFormat(options.format || 'rgba8');
        const dimension: GPUTextureDimension = options.dimension || '2d';
        const mipLevelCount = options.mipmaps
            ? this.calculateMipLevels(width, height)
            : 1;
        const sampleCount = options.sampleCount || 1;

        const defaultUsage =
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.RENDER_ATTACHMENT;

        const usage = options.usage || defaultUsage;

        const texture = device.createTexture({
            label: options.label,
            size: { width, height, depthOrArrayLayers: 1 },
            mipLevelCount,
            sampleCount,
            dimension,
            format,
            usage
        });

        const view = texture.createView({
            format,
            dimension: dimension === '2d' ? '2d' : dimension,
            mipLevelCount
        });

        const info: TextureInfo = {
            texture,
            view,
            width,
            height,
            depthOrArrayLayers: 1,
            format,
            mipLevelCount,
            dimension
        };

        this.textures.set(texture, info);
        return info;
    }

    public createTexture2DFromImage(
        image: ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
        options: TextureCreateOptions = {}
    ): TextureInfo {
        const device = this.deviceManager.getDevice();
        const width = image.width;
        const height = image.height;
        const generateMipmaps = options.mipmaps !== false;

        const textureInfo = this.createTexture(width, height, {
            ...options,
            mipmaps: generateMipmaps,
            usage: (options.usage || 0) | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING
        });

        device.queue.copyExternalImageToTexture(
            { source: image },
            { texture: textureInfo.texture, mipLevel: 0 },
            { width, height, depthOrArrayLayers: 1 }
        );

        if (generateMipmaps && textureInfo.mipLevelCount > 1) {
            this.generateMipmaps(textureInfo);
        }

        return textureInfo;
    }

    public createTextureFromData(
        textureData: TextureData,
        options: TextureCreateOptions = {}
    ): TextureInfo {
        const device = this.deviceManager.getDevice();
        const { data, width, height, depthOrArrayLayers = 1 } = textureData;
        const generateMipmaps = options.mipmaps !== false;

        const textureInfo = this.createTexture(width, height, {
            ...options,
            mipmaps: generateMipmaps
        });

        const bytesPerRow = textureData.bytesPerRow ||
            Math.ceil((width * (data as Uint8Array).BYTES_PER_ELEMENT * 4) / 256) * 256;
        const rowsPerImage = textureData.rowsPerImage || height;

        device.queue.writeTexture(
            { texture: textureInfo.texture, mipLevel: 0 },
            data,
            { bytesPerRow, rowsPerImage },
            { width, height, depthOrArrayLayers }
        );

        if (generateMipmaps && textureInfo.mipLevelCount > 1) {
            this.generateMipmaps(textureInfo);
        }

        return textureInfo;
    }

    public createCubemap(
        size: number,
        faceData: CubemapData,
        options: TextureCreateOptions = {}
    ): TextureInfo {
        const device = this.deviceManager.getDevice();
        const generateMipmaps = options.mipmaps !== false;
        const mipLevelCount = generateMipmaps ? this.calculateMipLevels(size, size) : 1;
        const format = this.getGPUFormat(options.format || 'rgba8');

        const usage = (options.usage || 0) |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC |
            GPUTextureUsage.RENDER_ATTACHMENT;

        const texture = device.createTexture({
            label: options.label || 'cubemap',
            size: { width: size, height: size, depthOrArrayLayers: 6 },
            mipLevelCount,
            dimension: '2d',
            format,
            usage
        });

        const faces = [faceData.px, faceData.nx, faceData.py, faceData.ny, faceData.pz, faceData.nz];

        for (let i = 0; i < 6; i++) {
            const face = faces[i];
            if ('width' in face && 'height' in face) {
                device.queue.copyExternalImageToTexture(
                    { source: face },
                    { texture, mipLevel: 0, origin: { x: 0, y: 0, z: i } },
                    { width: size, height: size, depthOrArrayLayers: 1 }
                );
            } else {
                const data = face as ArrayBufferView;
                const bytesPerRow = Math.ceil((size * (data as Uint8Array).BYTES_PER_ELEMENT * 4) / 256) * 256;
                device.queue.writeTexture(
                    { texture, mipLevel: 0, origin: { x: 0, y: 0, z: i } },
                    data,
                    { bytesPerRow, rowsPerImage: size },
                    { width: size, height: size, depthOrArrayLayers: 1 }
                );
            }
        }

        const view = texture.createView({
            format,
            dimension: 'cube',
            mipLevelCount,
            arrayLayerCount: 6
        });

        const info: TextureInfo = {
            texture,
            view,
            width: size,
            height: size,
            depthOrArrayLayers: 6,
            format,
            mipLevelCount,
            dimension: '2d'
        };

        this.textures.set(texture, info);

        if (generateMipmaps && mipLevelCount > 1) {
            this.generateCubemapMipmaps(info);
        }

        return info;
    }

    public async loadImageBitmap(
        src: string,
        options?: ImageBitmapOptions
    ): Promise<ImageBitmap> {
        const response = await fetch(src);
        const blob = await response.blob();
        return createImageBitmap(blob, options);
    }

    public async loadImageElement(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    private ensureMipmapPipeline(): void {
        if (this.mipmapPipeline) return;

        const device = this.deviceManager.getDevice();

        this.mipmapBindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: 'rgba8unorm', access: 'write-only' }
                }
            ]
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.mipmapBindGroupLayout]
        });

        const shaderModule = device.createShaderModule({
            code: `
                @group(0) @binding(0) var inputTex: texture_2d<f32>;
                @group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, write>;

                var inputSampler: sampler = sampler(
                    mag: linear,
                    min: linear,
                    mipmap: nearest,
                    address_u: clamp_to_edge,
                    address_v: clamp_to_edge,
                    address_w: clamp_to_edge
                );

                @compute @workgroup_size(8, 8)
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
                    let texSize = textureDimensions(inputTex);
                    let dstSize = textureDimensions(outputTex);

                    if (id.x >= dstSize.x || id.y >= dstSize.y) {
                        return;
                    }

                    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(dstSize);

                    var sum = vec4<f32>(0.0);
                    for (var y: i32 = 0; y < 2; y++) {
                        for (var x: i32 = 0; x < 2; x++) {
                            let sampleUV = uv + vec2<f32>(f32(x) - 0.5, f32(y) - 0.5) / vec2<f32>(texSize);
                            sum += textureSampleLevel(inputTex, inputSampler, sampleUV, 0.0);
                        }
                    }

                    textureStore(outputTex, vec2<i32>(id.xy), sum / 4.0);
                }
            `
        });

        this.mipmapPipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: shaderModule,
                entryPoint: 'main'
            }
        });
    }

    public generateMipmaps(textureInfo: TextureInfo): void {
        const device = this.deviceManager.getDevice();
        const { texture, width, height, mipLevelCount, format } = textureInfo;

        if (mipLevelCount <= 1) return;

        this.ensureMipmapPipeline();

        const encoder = device.createCommandEncoder({ label: 'mipmap-generator' });

        let srcWidth = width;
        let srcHeight = height;

        for (let mip = 1; mip < mipLevelCount; mip++) {
            const dstWidth = Math.max(1, srcWidth >> 1);
            const dstHeight = Math.max(1, srcHeight >> 1);

            const srcView = texture.createView({
                format,
                baseMipLevel: mip - 1,
                mipLevelCount: 1,
                dimension: '2d'
            });

            const dstView = texture.createView({
                format,
                baseMipLevel: mip,
                mipLevelCount: 1,
                dimension: '2d'
            });

            const bindGroup = device.createBindGroup({
                layout: this.mipmapBindGroupLayout!,
                entries: [
                    { binding: 0, resource: srcView },
                    { binding: 1, resource: dstView }
                ]
            });

            const pass = encoder.beginComputePass();
            pass.setPipeline(this.mipmapPipeline!);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(dstWidth / 8),
                Math.ceil(dstHeight / 8),
                1
            );
            pass.end();

            srcWidth = dstWidth;
            srcHeight = dstHeight;
        }

        device.queue.submit([encoder.finish()]);
    }

    private generateCubemapMipmaps(textureInfo: TextureInfo): void {
        const device = this.deviceManager.getDevice();
        const { texture, width, mipLevelCount, format } = textureInfo;

        if (mipLevelCount <= 1) return;

        this.ensureMipmapPipeline();

        const encoder = device.createCommandEncoder({ label: 'cubemap-mipmap-generator' });

        let srcSize = width;

        for (let mip = 1; mip < mipLevelCount; mip++) {
            const dstSize = Math.max(1, srcSize >> 1);

            for (let face = 0; face < 6; face++) {
                const srcView = texture.createView({
                    format,
                    baseMipLevel: mip - 1,
                    mipLevelCount: 1,
                    baseArrayLayer: face,
                    arrayLayerCount: 1,
                    dimension: '2d'
                });

                const dstView = texture.createView({
                    format,
                    baseMipLevel: mip,
                    mipLevelCount: 1,
                    baseArrayLayer: face,
                    arrayLayerCount: 1,
                    dimension: '2d'
                });

                const bindGroup = device.createBindGroup({
                    layout: this.mipmapBindGroupLayout!,
                    entries: [
                        { binding: 0, resource: srcView },
                        { binding: 1, resource: dstView }
                    ]
                });

                const pass = encoder.beginComputePass();
                pass.setPipeline(this.mipmapPipeline!);
                pass.setBindGroup(0, bindGroup);
                pass.dispatchWorkgroups(
                    Math.ceil(dstSize / 8),
                    Math.ceil(dstSize / 8),
                    1
                );
                pass.end();
            }

            srcSize = dstSize;
        }

        device.queue.submit([encoder.finish()]);
    }

    public createDepthTexture(
        width: number,
        height: number,
        format: TextureFormat = 'depth24'
    ): TextureInfo {
        return this.createTexture(width, height, {
            format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            mipmaps: false
        });
    }

    public updateTexture(
        textureInfo: TextureInfo,
        data: ArrayBufferView,
        x = 0,
        y = 0,
        width?: number,
        height?: number,
        mipLevel = 0
    ): void {
        const device = this.deviceManager.getDevice();
        const w = width || textureInfo.width;
        const h = height || textureInfo.height;

        const bytesPerRow = Math.ceil((w * (data as Uint8Array).BYTES_PER_ELEMENT * 4) / 256) * 256;

        device.queue.writeTexture(
            { texture: textureInfo.texture, mipLevel, origin: { x, y, z: 0 } },
            data,
            { bytesPerRow, rowsPerImage: h },
            { width: w, height: h, depthOrArrayLayers: 1 }
        );
    }

    public copyTexture(
        encoder: GPUCommandEncoder,
        source: GPUTexture,
        destination: GPUTexture,
        width: number,
        height: number,
        srcMipLevel = 0,
        dstMipLevel = 0,
        srcOrigin?: GPUOrigin3D,
        dstOrigin?: GPUOrigin3D
    ): void {
        encoder.copyTextureToTexture(
            { texture: source, mipLevel: srcMipLevel, origin: srcOrigin || [0, 0, 0] },
            { texture: destination, mipLevel: dstMipLevel, origin: dstOrigin || [0, 0, 0] },
            { width, height, depthOrArrayLayers: 1 }
        );
    }

    public getTextureInfo(texture: GPUTexture): TextureInfo | undefined {
        return this.textures.get(texture);
    }

    public destroyTexture(texture: GPUTexture): void {
        const info = this.textures.get(texture);
        if (info) {
            this.textures.delete(texture);
            texture.destroy();
        }
    }

    public destroyAll(): void {
        for (const texture of this.textures.keys()) {
            texture.destroy();
        }
        this.textures.clear();
        this.mipmapPipeline = null;
        this.mipmapBindGroupLayout = null;
    }

    public destroy(): void {
        this.destroyAll();
        TextureManager.instance = null;
    }
}
