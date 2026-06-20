import { SceneData, RenderSettings, CameraParams, TEXTURE_USAGE_STORAGE, TEXTURE_FORMAT_RGBA16F, TEXTURE_FORMAT_RGBA32F, TEXTURE_FORMAT_RGBA8 } from '@/types';
import { PerformanceProfiler, PassName } from './PerformanceProfiler';

export interface RenderPassResources {
    colorTexture: GPUTexture | null;
    colorView: GPUTextureView | null;
    depthTexture: GPUTexture | null;
    depthView: GPUTextureView | null;
    historyTexture: GPUTexture | null;
    historyView: GPUTextureView | null;
    outputTexture: GPUTexture | null;
    outputView: GPUTextureView | null;
    hdrIntermediateTexture: GPUTexture | null;
    hdrIntermediateView: GPUTextureView | null;
}

export interface RenderSchedulerDeps {
    device: GPUDevice;
    pathTracer: {
        render(encoder: GPUCommandEncoder, colorView: GPUTextureView, historyView: GPUTextureView, camera: CameraParams, settings: RenderSettings, sceneData: SceneData): void;
        resetAccumulation(): void;
    };
    bvhBuilder: {
        needsRebuild(): boolean;
        build(encoder: GPUCommandEncoder, sceneData: SceneData): void;
        markRebuilt(): void;
    };
    denoiser: {
        denoise(encoder: GPUCommandEncoder, colorView: GPUTextureView, outputView: GPUTextureView, settings: RenderSettings): void;
    };
    postProcessPipeline: {
        process(encoder: GPUCommandEncoder, inputView: GPUTextureView, outputView: GPUTextureView, camera: CameraParams, settings: RenderSettings): void;
        finalizeToSwapChain(encoder: GPUCommandEncoder, hdrView: GPUTextureView, swapChainView: GPUTextureView, camera: CameraParams, settings: RenderSettings): void;
    };
}

export class RenderScheduler {
    private device: GPUDevice;
    private pathTracer: RenderSchedulerDeps['pathTracer'];
    private bvhBuilder: RenderSchedulerDeps['bvhBuilder'];
    private denoiser: RenderSchedulerDeps['denoiser'];
    private postProcessPipeline: RenderSchedulerDeps['postProcessPipeline'];
    private profiler: PerformanceProfiler;

    private context: GPUCanvasContext | null = null;
    private format: GPUTextureFormat = TEXTURE_FORMAT_RGBA8 as GPUTextureFormat;
    private width = 0;
    private height = 0;

    private resources: RenderPassResources = {
        colorTexture: null,
        colorView: null,
        depthTexture: null,
        depthView: null,
        historyTexture: null,
        historyView: null,
        outputTexture: null,
        outputView: null,
        hdrIntermediateTexture: null,
        hdrIntermediateView: null,
    };

    private sceneData: SceneData | null = null;
    private sceneVersion = 0;
    private lastSceneVersion = -1;
    private settingsVersion = 0;
    private lastSettingsVersion = -1;
    private inFlightFrames = 0;
    private maxInFlightFrames = 2;

    constructor(deps: RenderSchedulerDeps) {
        this.device = deps.device;
        this.pathTracer = deps.pathTracer;
        this.bvhBuilder = deps.bvhBuilder;
        this.denoiser = deps.denoiser;
        this.postProcessPipeline = deps.postProcessPipeline;
        this.profiler = new PerformanceProfiler(deps.device);
    }

    initialize(canvas: HTMLCanvasElement): void {
        this.context = canvas.getContext('webgpu') as GPUCanvasContext;
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied',
        });

        this.width = canvas.width;
        this.height = canvas.height;
        this.createRenderTargets();
    }

    private createRenderTargets(): void {
        this.destroyResources();

        const w = this.width;
        const h = this.height;

        if (w === 0 || h === 0) return;

        this.resources.colorTexture = this.device.createTexture({
            label: 'ColorTarget',
            size: [w, h],
            format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });
        this.resources.colorView = this.resources.colorTexture.createView();

        this.resources.depthTexture = this.device.createTexture({
            label: 'DepthTarget',
            size: [w, h],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        this.resources.depthView = this.resources.depthTexture.createView();

        this.resources.historyTexture = this.device.createTexture({
            label: 'HistoryTarget',
            size: [w, h],
            format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });
        this.resources.historyView = this.resources.historyTexture.createView();

        this.resources.outputTexture = this.device.createTexture({
            label: 'OutputTarget',
            size: [w, h],
            format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });
        this.resources.outputView = this.resources.outputTexture.createView();

        this.resources.hdrIntermediateTexture = this.device.createTexture({
            label: 'HDRIntermediateTarget',
            size: [w, h],
            format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });
        this.resources.hdrIntermediateView = this.resources.hdrIntermediateTexture.createView();
    }

    private destroyResources(): void {
        const r = this.resources;
        r.colorTexture?.destroy();
        r.depthTexture?.destroy();
        r.historyTexture?.destroy();
        r.outputTexture?.destroy();
        r.hdrIntermediateTexture?.destroy();
        r.colorTexture = r.depthTexture = r.historyTexture = r.outputTexture = r.hdrIntermediateTexture = null;
        r.colorView = r.depthView = r.historyView = r.outputView = r.hdrIntermediateView = null;
    }

    render(camera: CameraParams, settings: RenderSettings): void {
        if (!this.context || !this.sceneData) return;

        if (this.sceneVersion !== this.lastSceneVersion || this.settingsVersion !== this.lastSettingsVersion) {
            this.bvhBuilder.markRebuilt();
            this.pathTracer.resetAccumulation();
            this.lastSceneVersion = this.sceneVersion;
            this.lastSettingsVersion = this.settingsVersion;
        }

        const encoder = this.device.createCommandEncoder({ label: 'RenderFrame' });

        this.profiler.beginFrame(encoder);

        if (this.bvhBuilder.needsRebuild()) {
            this.profiler.beginPass(encoder, PassName.BVH_BUILD);
            this.bvhBuilder.build(encoder, this.sceneData);
            this.profiler.endPass(encoder, PassName.BVH_BUILD);
        }

        this.profiler.beginPass(encoder, PassName.PATH_TRACE);
        this.pathTracer.render(
            encoder,
            this.resources.colorView!,
            this.resources.historyView!,
            camera,
            settings,
            this.sceneData
        );
        this.profiler.endPass(encoder, PassName.PATH_TRACE);

        if (settings.enableDenoiser) {
            this.profiler.beginPass(encoder, PassName.BILATERAL_FILTER);
            this.denoiser.denoise(
                encoder,
                this.resources.colorView!,
                this.resources.outputView!,
                settings
            );
            this.profiler.endPass(encoder, PassName.BILATERAL_FILTER);
        }

        this.profiler.beginPass(encoder, PassName.TONEMAP);
        const postInput = settings.enableDenoiser ? this.resources.outputView! : this.resources.colorView!;
        this.postProcessPipeline.process(encoder, postInput, this.resources.hdrIntermediateView!, camera, settings);
        this.profiler.endPass(encoder, PassName.TONEMAP);

        const swapChainTexture = this.context.getCurrentTexture();
        const swapChainView = swapChainTexture.createView();
        this.postProcessPipeline.finalizeToSwapChain(
            encoder,
            this.resources.hdrIntermediateView!,
            swapChainView,
            camera,
            settings
        );

        this.profiler.endFrame(encoder);

        this.device.queue.submit([encoder.finish()]);

        this.inFlightFrames++;
        if (this.inFlightFrames >= this.maxInFlightFrames) {
            this.inFlightFrames = 0;
        }
    }

    resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;

        this.width = width;
        this.height = height;
        this.createRenderTargets();
        this.pathTracer.resetAccumulation();
    }

    setScene(sceneData: SceneData): void {
        this.sceneData = sceneData;
        this.sceneVersion++;
        this.pathTracer.resetAccumulation();
    }

    notifySettingsChanged(): void {
        this.settingsVersion++;
    }

    getProfiler(): PerformanceProfiler {
        return this.profiler;
    }

    getFormat(): GPUTextureFormat {
        return this.format;
    }

    getSize(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    destroy(): void {
        this.destroyResources();
        this.profiler.destroy();
    }
}
