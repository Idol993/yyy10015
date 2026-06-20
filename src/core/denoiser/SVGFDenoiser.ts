import { TEXTURE_USAGE_STORAGE, BUFFER_USAGE_UNIFORM } from '@/types';
import reprojectShader from './Reproject.wgsl?raw';
import temporalShader from './TemporalAccumulate.wgsl?raw';
import bilateralShader from './BilateralFilter.wgsl?raw';

export interface DenoiserSettings {
    temporalAlpha: number;
    momentsAlpha: number;
    depthThreshold: number;
    normalThreshold: number;
    bilateralSigmaZ: number;
    bilateralSigmaN: number;
    bilateralStepSize: number;
    bilateralKernelRadius: number;
    fireflyThreshold: number;
}

export const DEFAULT_DENOISER_SETTINGS: DenoiserSettings = {
    temporalAlpha: 0.05,
    momentsAlpha: 0.2,
    depthThreshold: 0.01,
    normalThreshold: 0.1,
    bilateralSigmaZ: 1.0,
    bilateralSigmaN: 128.0,
    bilateralStepSize: 1,
    bilateralKernelRadius: 2,
    fireflyThreshold: 10.0,
};

export class SVGFDenoiser {
    private device: GPUDevice;
    private width: number = 0;
    private height: number = 0;

    private historyPing: GPUTexture | null = null;
    private historyPong: GPUTexture | null = null;
    private momentsPing: GPUTexture | null = null;
    private momentsPong: GPUTexture | null = null;
    private reprojectedColor: GPUTexture | null = null;
    private disocclusionWeight: GPUTexture | null = null;
    private outputTexture: GPUTexture | null = null;

    private historyPingView: GPUTextureView | null = null;
    private historyPongView: GPUTextureView | null = null;
    private momentsPingView: GPUTextureView | null = null;
    private momentsPongView: GPUTextureView | null = null;
    private reprojectedColorView: GPUTextureView | null = null;
    private disocclusionWeightView: GPUTextureView | null = null;
    private outputView: GPUTextureView | null = null;

    private reprojectPipeline: GPUComputePipeline | null = null;
    private temporalPipeline: GPUComputePipeline | null = null;
    private bilateralPipeline: GPUComputePipeline | null = null;

    private reprojectBGL: GPUBindGroupLayout | null = null;
    private temporalBGL: GPUBindGroupLayout | null = null;
    private bilateralBGL: GPUBindGroupLayout | null = null;

    private reprojectUB: GPUBuffer | null = null;
    private temporalUB: GPUBuffer | null = null;
    private bilateralUB: GPUBuffer | null = null;

    private linearSampler: GPUSampler | null = null;

    private historyReadIndex: number = 0;
    private frameCount: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    public createPipelines(): void {
        if (this.reprojectPipeline) return;

        const device = this.device;

        this.reprojectBGL = device.createBindGroupLayout({
            label: 'SVGFDenoiser-Reproject-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
            ],
        });

        this.temporalBGL = device.createBindGroupLayout({
            label: 'SVGFDenoiser-Temporal-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
            ],
        });

        this.bilateralBGL = device.createBindGroupLayout({
            label: 'SVGFDenoiser-Bilateral-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
            ],
        });

        const reprojectLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.reprojectBGL],
        });

        const temporalLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.temporalBGL],
        });

        const bilateralLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.bilateralBGL],
        });

        const reprojectModule = device.createShaderModule({ code: reprojectShader });
        const temporalModule = device.createShaderModule({ code: temporalShader });
        const bilateralModule = device.createShaderModule({ code: bilateralShader });

        this.reprojectPipeline = device.createComputePipeline({
            layout: reprojectLayout,
            compute: { module: reprojectModule, entryPoint: 'main' },
        });

        this.temporalPipeline = device.createComputePipeline({
            layout: temporalLayout,
            compute: { module: temporalModule, entryPoint: 'main' },
        });

        this.bilateralPipeline = device.createComputePipeline({
            layout: bilateralLayout,
            compute: { module: bilateralModule, entryPoint: 'main' },
        });

        this.linearSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        const ubSize = 256;
        this.reprojectUB = device.createBuffer({
            size: ubSize,
            usage: BUFFER_USAGE_UNIFORM,
        });
        this.temporalUB = device.createBuffer({
            size: ubSize,
            usage: BUFFER_USAGE_UNIFORM,
        });
        this.bilateralUB = device.createBuffer({
            size: ubSize,
            usage: BUFFER_USAGE_UNIFORM,
        });
    }

    public denoiseFull(
        commandEncoder: GPUCommandEncoder,
        radiance: GPUTextureView,
        normal: GPUTextureView,
        depth: GPUTextureView,
        motionVector: GPUTextureView,
        prevViewProjection: Float32Array,
        invViewProjection: Float32Array,
        settings: DenoiserSettings = DEFAULT_DENOISER_SETTINGS,
    ): GPUTextureView {
        this.createPipelines();

        const device = this.device;
        this.frameCount++;

        const reprojectData = new Float32Array(36);
        reprojectData.set(prevViewProjection, 0);
        reprojectData.set(invViewProjection, 16);
        reprojectData[32] = this.width;
        reprojectData[33] = this.height;
        reprojectData[34] = settings.depthThreshold;
        reprojectData[35] = settings.normalThreshold;
        device.queue.writeBuffer(this.reprojectUB!, 0, reprojectData);

        const temporalData = new Float32Array(8);
        temporalData[0] = settings.temporalAlpha;
        temporalData[1] = settings.momentsAlpha;
        temporalData[2] = this.width;
        temporalData[3] = this.height;
        temporalData[4] = settings.fireflyThreshold;
        temporalData[5] = this.frameCount;
        device.queue.writeBuffer(this.temporalUB!, 0, temporalData);

        const bilateralData = new Float32Array(8);
        bilateralData[0] = settings.bilateralSigmaZ;
        bilateralData[1] = settings.bilateralSigmaN;
        bilateralData[2] = this.width;
        bilateralData[3] = this.height;
        bilateralData[4] = settings.bilateralStepSize;
        bilateralData[5] = settings.bilateralKernelRadius;
        device.queue.writeBuffer(this.bilateralUB!, 0, bilateralData);

        const historyReadView = this.historyReadIndex === 0 ? this.historyPingView! : this.historyPongView!;
        const momentsReadView = this.historyReadIndex === 0 ? this.momentsPingView! : this.momentsPongView!;
        const historyWriteView = this.historyReadIndex === 0 ? this.historyPongView! : this.historyPingView!;
        const momentsWriteView = this.historyReadIndex === 0 ? this.momentsPongView! : this.momentsPingView!;

        const reprojectBG = device.createBindGroup({
            layout: this.reprojectBGL!,
            entries: [
                { binding: 0, resource: { buffer: this.reprojectUB! } },
                { binding: 1, resource: depth },
                { binding: 2, resource: normal },
                { binding: 3, resource: historyReadView },
                { binding: 4, resource: this.reprojectedColorView! },
                { binding: 5, resource: this.disocclusionWeightView! },
                { binding: 6, resource: this.linearSampler! },
            ],
        });

        const temporalBG = device.createBindGroup({
            layout: this.temporalBGL!,
            entries: [
                { binding: 0, resource: { buffer: this.temporalUB! } },
                { binding: 1, resource: radiance },
                { binding: 2, resource: this.reprojectedColorView! },
                { binding: 3, resource: this.disocclusionWeightView! },
                { binding: 4, resource: momentsReadView },
                { binding: 5, resource: historyWriteView },
                { binding: 6, resource: momentsWriteView },
            ],
        });

        const bilateralBG = device.createBindGroup({
            layout: this.bilateralBGL!,
            entries: [
                { binding: 0, resource: { buffer: this.bilateralUB! } },
                { binding: 1, resource: historyWriteView },
                { binding: 2, resource: depth },
                { binding: 3, resource: normal },
                { binding: 4, resource: momentsWriteView },
                { binding: 5, resource: this.outputView! },
            ],
        });

        const workgroupX = Math.ceil(this.width / 8);
        const workgroupY = Math.ceil(this.height / 8);

        const pass = commandEncoder.beginComputePass({ label: 'SVGF-Denoise' });

        pass.setPipeline(this.reprojectPipeline!);
        pass.setBindGroup(0, reprojectBG);
        pass.dispatchWorkgroups(workgroupX, workgroupY);

        pass.setPipeline(this.temporalPipeline!);
        pass.setBindGroup(0, temporalBG);
        pass.dispatchWorkgroups(workgroupX, workgroupY);

        pass.setPipeline(this.bilateralPipeline!);
        pass.setBindGroup(0, bilateralBG);
        pass.dispatchWorkgroups(workgroupX, workgroupY);

        pass.end();

        this.historyReadIndex = 1 - this.historyReadIndex;

        return this.outputView!;
    }

    public denoise(
        commandEncoder: GPUCommandEncoder,
        radiance: GPUTextureView,
        outputView: GPUTextureView,
        settings: { normalView?: GPUTextureView; depthView?: GPUTextureView; motionView?: GPUTextureView; prevViewProjection?: Float32Array; invViewProjection?: Float32Array } = {},
    ): void {
        this.denoiseToOutput(commandEncoder, radiance, outputView, {
            normal: settings.normalView,
            depth: settings.depthView,
            motion: settings.motionView,
            prevViewProjection: settings.prevViewProjection,
            invViewProjection: settings.invViewProjection,
        });
    }

    public denoiseToOutput(
        commandEncoder: GPUCommandEncoder,
        radiance: GPUTextureView,
        outputView: GPUTextureView,
        settings: { normal?: GPUTextureView; depth?: GPUTextureView; motion?: GPUTextureView; prevViewProjection?: Float32Array; invViewProjection?: Float32Array } = {},
    ): void {
        const defaultSettings = DEFAULT_DENOISER_SETTINGS;
        const identity = new Float32Array(16);
        identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;

        if (!this.normalFallbackTex || this.normalFallbackTex.width !== this.width || this.normalFallbackTex.height !== this.height) {
            this.normalFallbackTex?.destroy();
            this.depthFallbackTex?.destroy();
            this.motionFallbackTex?.destroy();
            this.normalFallbackTex = this.device.createTexture({
                size: [this.width, this.height], format: 'rgba32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.depthFallbackTex = this.device.createTexture({
                size: [this.width, this.height], format: 'rgba32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            this.motionFallbackTex = this.device.createTexture({
                size: [this.width, this.height], format: 'rgba32float',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
            });
            const zeros = new Float32Array(this.width * this.height * 4);
            this.device.queue.writeTexture({ texture: this.normalFallbackTex }, zeros,
                { bytesPerRow: this.width * 16, rowsPerImage: this.height }, { width: this.width, height: this.height });
            this.device.queue.writeTexture({ texture: this.depthFallbackTex }, zeros,
                { bytesPerRow: this.width * 16, rowsPerImage: this.height }, { width: this.width, height: this.height });
            this.device.queue.writeTexture({ texture: this.motionFallbackTex }, zeros,
                { bytesPerRow: this.width * 16, rowsPerImage: this.height }, { width: this.width, height: this.height });
        }

        const normalV = settings.normal ?? this.normalFallbackTex.createView();
        const depthV = settings.depth ?? this.depthFallbackTex.createView();
        const motionV = settings.motion ?? this.motionFallbackTex.createView();
        const prevVP = settings.prevViewProjection ?? identity;
        const invVP = settings.invViewProjection ?? identity;

        const denoised = this.denoiseFull(commandEncoder, radiance, normalV, depthV, motionV, prevVP, invVP, defaultSettings);

        if (denoised !== outputView) {
            const copyShader = /* wgsl */ `
@group(0) @binding(0) var inputTex: texture_2d<f32>;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let px = vec2<i32>(gid.xy);
    let dims = textureDimensions(inputTex);
    if (gid.x >= dims.x || gid.y >= dims.y) { return; }
    textureStore(outputTex, px, textureLoad(inputTex, px, 0));
}`;
            if (!this.copyPipeline) {
                const module = this.device.createShaderModule({ code: copyShader });
                const layout = this.device.createBindGroupLayout({ entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only' } },
                ]});
                this.copyPipeline = this.device.createComputePipeline({
                    layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
                    compute: { module, entryPoint: 'main' },
                });
                this.copyBGL = layout;
            }
            const bg = this.device.createBindGroup({
                layout: this.copyBGL!,
                entries: [{ binding: 0, resource: denoised }, { binding: 1, resource: outputView }],
            });
            const p = commandEncoder.beginComputePass({ label: 'SVGFCopyOutput' });
            p.setPipeline(this.copyPipeline!);
            p.setBindGroup(0, bg);
            p.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8));
            p.end();
        }
    }

    private normalFallbackTex: GPUTexture | null = null;
    private depthFallbackTex: GPUTexture | null = null;
    private motionFallbackTex: GPUTexture | null = null;
    private copyPipeline: GPUComputePipeline | null = null;
    private copyBGL: GPUBindGroupLayout | null = null;

    public getOutputView(): GPUTextureView | null {
        return this.outputView;
    }

    public resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;

        this.destroyTextures();

        this.width = width;
        this.height = height;

        const device = this.device;

        const createHDRTexture = (label: string): { texture: GPUTexture; view: GPUTextureView } => {
            const texture = device.createTexture({
                label,
                size: { width, height, depthOrArrayLayers: 1 },
                format: 'rgba16float',
                usage: TEXTURE_USAGE_STORAGE,
                mipLevelCount: 1,
            });
            const view = texture.createView();
            return { texture, view };
        };

        const ping = createHDRTexture('SVGF-HistoryPing');
        const pong = createHDRTexture('SVGF-HistoryPong');
        this.historyPing = ping.texture;
        this.historyPingView = ping.view;
        this.historyPong = pong.texture;
        this.historyPongView = pong.view;

        const mPing = createHDRTexture('SVGF-MomentsPing');
        const mPong = createHDRTexture('SVGF-MomentsPong');
        this.momentsPing = mPing.texture;
        this.momentsPingView = mPing.view;
        this.momentsPong = mPong.texture;
        this.momentsPongView = mPong.view;

        const reproj = createHDRTexture('SVGF-ReprojectedColor');
        this.reprojectedColor = reproj.texture;
        this.reprojectedColorView = reproj.view;

        const disocc = createHDRTexture('SVGF-DisocclusionWeight');
        this.disocclusionWeight = disocc.texture;
        this.disocclusionWeightView = disocc.view;

        const output = createHDRTexture('SVGF-Output');
        this.outputTexture = output.texture;
        this.outputView = output.view;

        this.resetHistory();
    }

    public resetHistory(): void {
        this.historyReadIndex = 0;
        this.frameCount = 0;
    }

    private destroyTextures(): void {
        const textures = [
            this.historyPing, this.historyPong,
            this.momentsPing, this.momentsPong,
            this.reprojectedColor, this.disocclusionWeight,
            this.outputTexture,
            this.normalFallbackTex, this.depthFallbackTex, this.motionFallbackTex,
        ];
        for (const tex of textures) {
            if (tex) tex.destroy();
        }
        this.historyPing = this.historyPong = null;
        this.historyPingView = this.historyPongView = null;
        this.momentsPing = this.momentsPong = null;
        this.momentsPingView = this.momentsPongView = null;
        this.reprojectedColor = null;
        this.reprojectedColorView = null;
        this.disocclusionWeight = null;
        this.disocclusionWeightView = null;
        this.outputTexture = null;
        this.outputView = null;
        this.normalFallbackTex = this.depthFallbackTex = this.motionFallbackTex = null;
    }

    public destroy(): void {
        this.destroyTextures();

        const buffers = [this.reprojectUB, this.temporalUB, this.bilateralUB];
        for (const buf of buffers) {
            if (buf) buf.destroy();
        }
        this.reprojectUB = this.temporalUB = this.bilateralUB = null;

        this.reprojectPipeline = this.temporalPipeline = this.bilateralPipeline = null;
        this.reprojectBGL = this.temporalBGL = this.bilateralBGL = null;
        this.copyPipeline = null;
        this.copyBGL = null;
        this.linearSampler = null;
    }
}
