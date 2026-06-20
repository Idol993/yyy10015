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
        getNormalTexture?(): GPUTexture | null;
        getDepthTexture?(): GPUTexture | null;
        getMotionVectorTexture?(): GPUTexture | null;
    };
    bvhBuilder: {
        needsRebuild(): boolean;
        build(encoder: GPUCommandEncoder, sceneData: SceneData): void;
        markRebuilt(): void;
        getNodeCount(): number;
    };
    denoiser: {
        denoise(
            encoder: GPUCommandEncoder,
            colorView: GPUTextureView,
            outputView: GPUTextureView,
            settings: RenderSettings & {
                normalView?: GPUTextureView;
                depthView?: GPUTextureView;
                motionView?: GPUTextureView;
                prevViewProjection?: Float32Array;
                invViewProjection?: Float32Array;
            },
        ): void;
        resetHistory?(): void;
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
    private lastCamera: CameraParams | null = null;
    private prevViewProjection: Float32Array | null = null;
    private dofTempTexture: GPUTexture | null = null;
    private dofTempView: GPUTextureView | null = null;
    private bloomCombinedTexture: GPUTexture | null = null;
    private bloomCombinedView: GPUTextureView | null = null;

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

        const resetAccum =
            this.sceneVersion !== this.lastSceneVersion ||
            this.settingsVersion !== this.lastSettingsVersion ||
            this.hasCameraChanged(camera);

        if (resetAccum) {
            this.pathTracer.resetAccumulation();
            this.denoiser.resetHistory?.();
            this.lastSceneVersion = this.sceneVersion;
            this.lastSettingsVersion = this.settingsVersion;
        }

        const encoder = this.device.createCommandEncoder({ label: 'RenderFrame' });

        this.profiler.beginFrame(encoder);

        if (this.bvhBuilder.needsRebuild()) {
            this.profiler.beginPass(encoder, PassName.BVH_BUILD);
            this.bvhBuilder.build(encoder, this.sceneData);
            this.profiler.endPass(encoder, PassName.BVH_BUILD);
            this.profiler.setSceneStats(this.sceneData.triangles.length, this.bvhBuilder.getNodeCount());
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
            this.profiler.beginPass(encoder, PassName.TEMPORAL_ACCUMULATION);
            this.profiler.endPass(encoder, PassName.TEMPORAL_ACCUMULATION);
            this.profiler.beginPass(encoder, PassName.BILATERAL_FILTER);

            const { prevVP, invVP } = this.computeViewProjectionMatrices(camera);

            this.denoiser.denoise(
                encoder,
                this.resources.colorView!,
                this.resources.outputView!,
                {
                    ...settings,
                    normalView: this.pathTracer.getNormalTexture?.()?.createView() ?? undefined,
                    depthView: this.pathTracer.getDepthTexture?.()?.createView() ?? undefined,
                    motionView: this.pathTracer.getMotionVectorTexture?.()?.createView() ?? undefined,
                    prevViewProjection: this.prevViewProjection ?? prevVP,
                    invViewProjection: invVP,
                }
            );
            this.profiler.endPass(encoder, PassName.BILATERAL_FILTER);

            this.prevViewProjection = prevVP;
        }

        this.lastCamera = { ...camera };

        this.profiler.beginPass(encoder, PassName.TONEMAP);
        const postInput = settings.enableDenoiser ? this.resources.outputView! : this.resources.colorView!;
        let postHdrOutput = this.resources.hdrIntermediateView!;

        if (settings.enableDOF && !settings.enableBloom) {
            if (!this.dofTempTexture || this.dofTempTexture.width !== this.width || this.dofTempTexture.height !== this.height) {
                this.dofTempTexture?.destroy();
                this.dofTempTexture = this.device.createTexture({
                    label: 'DOFTempTexture',
                    size: [this.width, this.height],
                    format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
                    usage: TEXTURE_USAGE_STORAGE,
                });
                this.dofTempView = this.dofTempTexture.createView();
            }
            this.profiler.endPass(encoder, PassName.TONEMAP);
            this.profiler.beginPass(encoder, PassName.DOF);
            this.postProcessPipeline.process(encoder, postInput, this.dofTempView!, camera, settings);
            this.profiler.endPass(encoder, PassName.DOF);
            this.profiler.beginPass(encoder, PassName.TONEMAP);
            postHdrOutput = this.dofTempView!;
        } else if (settings.enableBloom) {
            if (!this.bloomCombinedTexture || this.bloomCombinedTexture.width !== this.width || this.bloomCombinedTexture.height !== this.height) {
                this.bloomCombinedTexture?.destroy();
                this.bloomCombinedTexture = this.device.createTexture({
                    label: 'BloomCombined',
                    size: [this.width, this.height],
                    format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
                    usage: TEXTURE_USAGE_STORAGE,
                });
                this.bloomCombinedView = this.bloomCombinedTexture.createView();
            }
            this.profiler.endPass(encoder, PassName.TONEMAP);
            this.profiler.beginPass(encoder, PassName.BLOOM);
            this.postProcessPipeline.process(encoder, postInput, this.bloomCombinedView!, camera, settings);
            this.profiler.endPass(encoder, PassName.BLOOM);
            this.profiler.beginPass(encoder, PassName.TONEMAP);
            postHdrOutput = this.bloomCombinedView!;
        } else {
            this.postProcessPipeline.process(encoder, postInput, this.resources.hdrIntermediateView!, camera, settings);
        }
        this.profiler.endPass(encoder, PassName.TONEMAP);

        const swapChainTexture = this.context.getCurrentTexture();
        const swapChainView = swapChainTexture.createView();
        this.postProcessPipeline.finalizeToSwapChain(
            encoder,
            postHdrOutput,
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

    private hasCameraChanged(cam: CameraParams): boolean {
        if (!this.lastCamera) return true;
        const prev = this.lastCamera;
        const eps = 1e-5;
        const eps4 = 1e-4;
        return (
            Math.abs(prev.position.x - cam.position.x) > eps ||
            Math.abs(prev.position.y - cam.position.y) > eps ||
            Math.abs(prev.position.z - cam.position.z) > eps ||
            Math.abs(prev.direction.x - cam.direction.x) > eps ||
            Math.abs(prev.direction.y - cam.direction.y) > eps ||
            Math.abs(prev.direction.z - cam.direction.z) > eps ||
            Math.abs(prev.up.x - cam.up.x) > eps ||
            Math.abs(prev.up.y - cam.up.y) > eps ||
            Math.abs(prev.up.z - cam.up.z) > eps ||
            Math.abs(prev.fov - cam.fov) > eps ||
            Math.abs((prev.focalDistance ?? 10) - (cam.focalDistance ?? 10)) > eps4 ||
            Math.abs((prev.aperture ?? 0) - (cam.aperture ?? 0)) > eps
        );
    }

    private computeViewProjectionMatrices(cam: CameraParams): { prevVP: Float32Array; invVP: Float32Array } {
        const aspect = this.width / this.height;
        const fovY = cam.fov;
        const near = cam.near;
        const far = cam.far;

        const tanFovHalf = Math.tan(fovY * 0.5);

        const proj = new Float32Array(16);
        proj[0] = 1 / (aspect * tanFovHalf);
        proj[5] = 1 / tanFovHalf;
        proj[10] = far / (near - far);
        proj[11] = -1;
        proj[14] = (near * far) / (near - far);
        proj[15] = 0;

        const right = this.normalize(this.cross(cam.direction, cam.up));
        const up = this.normalize(this.cross(right, cam.direction));
        const dir = this.normalize(cam.direction);
        const px = cam.position.x;
        const py = cam.position.y;
        const pz = cam.position.z;

        const view = new Float32Array(16);
        view[0] = right.x;   view[1] = up.x;   view[2] = -dir.x;   view[3] = 0;
        view[4] = right.y;   view[5] = up.y;   view[6] = -dir.y;   view[7] = 0;
        view[8] = right.z;   view[9] = up.z;   view[10] = -dir.z;  view[11] = 0;
        view[12] = -(right.x * px + right.y * py + right.z * pz);
        view[13] = -(up.x * px + up.y * py + up.z * pz);
        view[14] = (dir.x * px + dir.y * py + dir.z * pz);
        view[15] = 1;

        const VP = this.multMat(proj, view);

        const identity = new Float32Array(16);
        identity[0] = 1; identity[5] = 1; identity[10] = 1; identity[15] = 1;

        return { prevVP: VP, invVP: identity };
    }

    private multMat(a: Float32Array, b: Float32Array): Float32Array {
        const r = new Float32Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                let s = 0;
                for (let k = 0; k < 4; k++) {
                    s += a[i * 4 + k] * b[k * 4 + j];
                }
                r[i * 4 + j] = s;
            }
        }
        return r;
    }

    private cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
        return {
            x: a.y * b.z - a.z * b.y,
            y: a.z * b.x - a.x * b.z,
            z: a.x * b.y - a.y * b.x,
        };
    }

    private normalize(v: { x: number; y: number; z: number }) {
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
    }

    resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;

        this.width = width;
        this.height = height;
        this.createRenderTargets();
        this.pathTracer.resetAccumulation();
        this.denoiser.resetHistory?.();
        if (this.dofTempTexture) { this.dofTempTexture.destroy(); this.dofTempTexture = null; this.dofTempView = null; }
        if (this.bloomCombinedTexture) { this.bloomCombinedTexture.destroy(); this.bloomCombinedTexture = null; this.bloomCombinedView = null; }
    }

    setScene(sceneData: SceneData): void {
        this.sceneData = sceneData;
        this.sceneVersion++;
        this.pathTracer.resetAccumulation();
        this.denoiser.resetHistory?.();
        this.prevViewProjection = null;
        this.lastCamera = null;
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
