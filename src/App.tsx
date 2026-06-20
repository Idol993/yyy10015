import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import RenderCanvas from '@/components/RenderCanvas';
import ControlPanel from '@/components/ControlPanel';
import PerformanceOverlay from '@/components/PerformanceOverlay';
import SceneLoader from '@/components/SceneLoader';
import { DeviceManager } from '@/core/webgpu/DeviceManager';
import { SceneManager } from '@/core/scene/SceneManager';
import { FreeCameraController } from '@/core/camera/FreeCameraController';
import { RenderScheduler, RenderSchedulerDeps } from '@/core/render/RenderScheduler';
import { PostProcessPipeline } from '@/core/postprocess/PostProcessPipeline';
import { PathTracer } from '@/core/pathtracer/PathTracer';
import { BVHBuilder } from '@/core/bvh/BVHBuilder';
import { SimpleDenoiser } from '@/core/denoiser/SimpleDenoiser';
import { SVGFDenoiser } from '@/core/denoiser/SVGFDenoiser';
import { useRendererStore } from '@/store/useRendererStore';
import { createCornellBox } from '@/store/createDefaultScenes';
import type { SceneData, CameraParams, RenderSettings, vec3 } from '@/types';

interface PathTracerAdapter {
    render(encoder: GPUCommandEncoder, colorView: GPUTextureView, historyView: GPUTextureView, camera: CameraParams, settings: RenderSettings, sceneData: SceneData): void;
    resetAccumulation(): void;
    setBVHBuffer(buffer: GPUBuffer | null): void;
    getNormalTexture?(): GPUTexture | null;
    getDepthTexture?(): GPUTexture | null;
    getMotionVectorTexture?(): GPUTexture | null;
}

interface CameraState {
    posX: number;
    posY: number;
    posZ: number;
    dirX: number;
    dirY: number;
    dirZ: number;
    fov: number;
    focalDistance: number;
    aperture: number;
}

const EPSILON = 1e-6;

function approxEqual(a: number, b: number, eps: number = EPSILON): boolean {
    return Math.abs(a - b) < eps;
}

function cameraChanged(prev: CameraState | null, current: CameraState): boolean {
    if (!prev) return true;
    return (
        !approxEqual(prev.posX, current.posX) ||
        !approxEqual(prev.posY, current.posY) ||
        !approxEqual(prev.posZ, current.posZ) ||
        !approxEqual(prev.dirX, current.dirX) ||
        !approxEqual(prev.dirY, current.dirY) ||
        !approxEqual(prev.dirZ, current.dirZ) ||
        !approxEqual(prev.fov, current.fov, 1e-5) ||
        !approxEqual(prev.focalDistance, current.focalDistance, 1e-4) ||
        !approxEqual(prev.aperture, current.aperture, 1e-6)
    );
}

export default function App() {
    const isLoading = useRendererStore((s) => s.isLoading);
    const error = useRendererStore((s) => s.error);
    const renderSettings = useRendererStore((s) => s.renderSettings);
    const cameraParamsFromStore = useRendererStore((s) => s.cameraParams);
    const setInitialized = useRendererStore((s) => s.setInitialized);
    const setLoading = useRendererStore((s) => s.setLoading);
    const setError = useRendererStore((s) => s.setError);
    const updateMetrics = useRendererStore((s) => s.updateMetrics);
    const updateCameraParams = useRendererStore((s) => s.updateCameraParams);
    const updateSceneInfo = useRendererStore((s) => s.updateSceneInfo);

    const deviceRef = useRef<GPUDevice | null>(null);
    const schedulerRef = useRef<RenderScheduler | null>(null);
    const sceneManagerRef = useRef<SceneManager | null>(null);
    const cameraRef = useRef<FreeCameraController | null>(null);
    const pathTracerRef = useRef<PathTracer | null>(null);
    const bvhBuilderRef = useRef<BVHBuilder | null>(null);
    const denoiserRef = useRef<SVGFDenoiser | null>(null);
    const animationRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const webgpuSupportedRef = useRef(true);
    const prevCameraStateRef = useRef<CameraState | null>(null);
    const lastStoreCamStateRef = useRef<{ fov: number; focalDistance: number; aperture: number } | null>(null);
    const [, forceUpdate] = useState(0);

    const handleCanvasReady = useCallback(async (canvas: HTMLCanvasElement) => {
        try {
            const deviceManager = DeviceManager.getInstance();
            await deviceManager.initialize();
            const device = deviceManager.getDevice();
            deviceRef.current = device;

            const camera = new FreeCameraController();
            cameraRef.current = camera;

            const sceneManager = new SceneManager(device);
            sceneManagerRef.current = sceneManager;

            const sceneData = createCornellBox();
            sceneManager.setSceneData(sceneData);
            sceneManager.uploadToGPU();

            const pathTracer = new PathTracer(device);
            pathTracer.resize(canvas.width, canvas.height);
            pathTracerRef.current = pathTracer;

            const bvhBuilder = new BVHBuilder(device);
            bvhBuilderRef.current = bvhBuilder;

            const postProcessPipeline = new PostProcessPipeline(device);
            postProcessPipeline.resize(canvas.width, canvas.height);
            postProcessPipeline.createPipelines();

            const denoiser = new SVGFDenoiser(device);
            denoiser.resize(canvas.width, canvas.height);
            denoiserRef.current = denoiser;

            const pathTracerAdapter: PathTracerAdapter = {
                render(
                    encoder: GPUCommandEncoder,
                    colorView: GPUTextureView,
                    historyView: GPUTextureView,
                    camParams: CameraParams,
                    settings: RenderSettings,
                    sData: SceneData,
                ): void {
                    pathTracer.render(encoder, colorView, historyView, camParams, settings, sData);
                },
                resetAccumulation(): void {
                    pathTracer.resetAccumulation();
                },
                setBVHBuffer(buffer: GPUBuffer | null): void {
                    pathTracer.setBVHBuffer(buffer);
                },
                getNormalTexture(): GPUTexture | null {
                    return pathTracer.getNormalTexture?.() ?? null;
                },
                getDepthTexture(): GPUTexture | null {
                    return pathTracer.getDepthTexture?.() ?? null;
                },
                getMotionVectorTexture(): GPUTexture | null {
                    return pathTracer.getMotionVectorTexture?.() ?? null;
                },
            };

            const bvhBuilderAdapter: RenderSchedulerDeps['bvhBuilder'] = {
                needsRebuild(): boolean {
                    return bvhBuilder.needsRebuild();
                },
                build(encoder: GPUCommandEncoder, sData: SceneData): void {
                    bvhBuilder.build(encoder, sData);
                    const bvhBuffer = bvhBuilder.getBVHBuffer();
                    pathTracerAdapter.setBVHBuffer(bvhBuffer);
                },
                markRebuilt(): void {
                    bvhBuilder.markRebuilt();
                },
            };

            const denoiserAdapter: RenderSchedulerDeps['denoiser'] = {
                denoise(
                    encoder: GPUCommandEncoder,
                    colorView: GPUTextureView,
                    outputView: GPUTextureView,
                    settings: any,
                ): void {
                    denoiser.denoise(encoder, colorView, outputView, settings);
                },
                resetHistory(): void {
                    denoiser.resetHistory();
                },
            };

            const scheduler = new RenderScheduler({
                device,
                pathTracer: pathTracerAdapter,
                bvhBuilder: bvhBuilderAdapter,
                denoiser: denoiserAdapter,
                postProcessPipeline,
            });

            scheduler.initialize(canvas);
            schedulerRef.current = scheduler;

            scheduler.setScene(sceneManager.getSceneData());

            updateSceneInfo({
                triangleCount: sceneData.triangles.length,
                materialCount: sceneData.materials.length,
                instanceCount: sceneData.instances.length,
                lightCount: sceneData.lights.length,
            });

            const defaultCam = sceneManager.getDefaultCamera(canvas.width / canvas.height);
            camera.setPosition(defaultCam.position.x, defaultCam.position.y, defaultCam.position.z);
            camera.fov = defaultCam.fov;
            camera.focalDistance = defaultCam.focalDistance;
            camera.aperture = defaultCam.aperture;

            updateCameraParams({
                position: { x: defaultCam.position.x, y: defaultCam.position.y, z: defaultCam.position.z },
                fov: defaultCam.fov,
                focalDistance: defaultCam.focalDistance,
                aperture: defaultCam.aperture,
            });

            setInitialized(true);
            setLoading(false);

            lastTimeRef.current = performance.now();
            animationRef.current = requestAnimationFrame(renderLoop);
        } catch (err) {
            setError(err instanceof Error ? err.message : '初始化失败');
            setLoading(false);
            webgpuSupportedRef.current = false;
            forceUpdate((n) => n + 1);
        }
    }, [setInitialized, setLoading, setError, updateCameraParams, updateSceneInfo]);

    const handleSceneLoaded = useCallback((sceneData: SceneData) => {
        if (sceneManagerRef.current && schedulerRef.current) {
            sceneManagerRef.current.setSceneData(sceneData);
            sceneManagerRef.current.uploadToGPU();
            schedulerRef.current.setScene(sceneManagerRef.current.getSceneData());

            const camera = cameraRef.current;
            if (camera) {
                const defaultCam = sceneManagerRef.current.getDefaultCamera(
                    schedulerRef.current.getSize().width / schedulerRef.current.getSize().height
                );
                camera.setPosition(defaultCam.position.x, defaultCam.position.y, defaultCam.position.z);
                camera.fov = defaultCam.fov;
                camera.focalDistance = defaultCam.focalDistance;
                camera.aperture = defaultCam.aperture;

                updateCameraParams({
                    position: { x: defaultCam.position.x, y: defaultCam.position.y, z: defaultCam.position.z },
                    fov: defaultCam.fov,
                    focalDistance: defaultCam.focalDistance,
                    aperture: defaultCam.aperture,
                });

                prevCameraStateRef.current = null;
            }

            updateSceneInfo({
                triangleCount: sceneData.triangles.length,
                materialCount: sceneData.materials.length,
                instanceCount: sceneData.instances.length,
                lightCount: sceneData.lights.length,
            });
        }
    }, [updateCameraParams, updateSceneInfo]);

    const handleGLTFFileSelected = useCallback(async (file: File) => {
        const sceneManager = sceneManagerRef.current;
        const scheduler = schedulerRef.current;
        const setLoading = useRendererStore.getState().setLoading;
        const setError = useRendererStore.getState().setError;
        const updateInfo = useRendererStore.getState().updateSceneInfo;

        if (!sceneManager || !scheduler) return;

        setLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const blob = new Blob([arrayBuffer], {
                type: file.name.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json',
            });
            const url = URL.createObjectURL(blob);

            const loaded = await sceneManager.loadGLTF(url);
            URL.revokeObjectURL(url);

            sceneManager.uploadToGPU();
            scheduler.setScene(sceneManager.getSceneData());

            const camera = cameraRef.current;
            if (camera) {
                const defaultCam = sceneManager.getDefaultCamera(
                    scheduler.getSize().width / scheduler.getSize().height
                );
                camera.setPosition(defaultCam.position.x, defaultCam.position.y, defaultCam.position.z);
                camera.fov = defaultCam.fov;
                camera.focalDistance = defaultCam.focalDistance;
                camera.aperture = defaultCam.aperture;

                updateCameraParams({
                    position: { x: defaultCam.position.x, y: defaultCam.position.y, z: defaultCam.position.z },
                    fov: defaultCam.fov,
                    focalDistance: defaultCam.focalDistance,
                    aperture: defaultCam.aperture,
                });

                prevCameraStateRef.current = null;
            }

            updateInfo({
                triangleCount: loaded.sceneData.triangles.length,
                materialCount: loaded.sceneData.materials.length,
                instanceCount: loaded.sceneData.instances.length,
                lightCount: loaded.sceneData.lights.length,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : '加载 GLTF 文件失败');
        } finally {
            setLoading(false);
        }
    }, [updateCameraParams]);

    const renderLoop = useCallback((time: number) => {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const camera = cameraRef.current;
        const scheduler = schedulerRef.current;
        const device = deviceRef.current;
        const pathTracer = pathTracerRef.current;

        if (camera && scheduler && device) {
            const input = (window as any).__renderInput;
            if (input) {
                camera.update(
                    dt,
                    input.keys,
                    input.mouseDelta,
                    input.scrollDelta
                );
                input.mouseDelta.dx = 0;
                input.mouseDelta.dy = 0;
                input.scrollDelta = 0;
            }

            const size = scheduler.getSize();
            const aspect = size.width / size.height;

            const camPos = camera.getPosition();
            const camDir = camera.getDirection();
            const camUp = camera.getUp();

            const currentCameraState: CameraState = {
                posX: camPos[0],
                posY: camPos[1],
                posZ: camPos[2],
                dirX: camDir[0],
                dirY: camDir[1],
                dirZ: camDir[2],
                fov: camera.fov,
                focalDistance: camera.focalDistance,
                aperture: camera.aperture,
            };

            if (cameraChanged(prevCameraStateRef.current, currentCameraState)) {
                if (pathTracer) {
                    pathTracer.resetAccumulation();
                }
                scheduler.notifySettingsChanged();
                prevCameraStateRef.current = currentCameraState;
            }

            const cameraData: CameraParams = {
                position: { x: camPos[0], y: camPos[1], z: camPos[2] },
                direction: { x: camDir[0], y: camDir[1], z: camDir[2] },
                up: { x: camUp[0], y: camUp[1], z: camUp[2] },
                fov: camera.fov,
                aspect,
                near: camera.near,
                far: camera.far,
                focalDistance: camera.focalDistance,
                aperture: camera.aperture,
            };

            scheduler.render(cameraData, renderSettings);

            const profiler = scheduler.getProfiler();
            const metrics = profiler.getMetrics();
            metrics.triangleCount = sceneManagerRef.current?.getTriangleCount() || 0;
            metrics.bvhNodeCount = bvhBuilderRef.current?.getNodeCount() || 0;
            updateMetrics(metrics);

            updateCameraParams({
                position: { x: camPos[0], y: camPos[1], z: camPos[2] },
                yaw: camera.yaw,
                pitch: camera.pitch,
                fov: camera.fov,
            });
        }

        animationRef.current = requestAnimationFrame(renderLoop);
    }, [renderSettings, updateMetrics, updateCameraParams]);

    useEffect(() => {
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (typeof navigator !== 'undefined' && !navigator.gpu) {
            webgpuSupportedRef.current = false;
            setError('当前浏览器不支持 WebGPU');
            forceUpdate((n) => n + 1);
        }
    }, [setError]);

    useEffect(() => {
        const cam = cameraRef.current;
        if (!cam) {
            lastStoreCamStateRef.current = {
                fov: cameraParamsFromStore.fov,
                focalDistance: cameraParamsFromStore.focalDistance ?? 10,
                aperture: cameraParamsFromStore.aperture ?? 0,
            };
            return;
        }
        const last = lastStoreCamStateRef.current;
        const cur = {
            fov: cameraParamsFromStore.fov,
            focalDistance: cameraParamsFromStore.focalDistance ?? 10,
            aperture: cameraParamsFromStore.aperture ?? 0,
        };
        let changed = false;
        if (!last || !approxEqual(last.fov, cur.fov, 1e-5)) {
            cam.fov = cur.fov;
            changed = true;
        }
        if (!last || !approxEqual(last.focalDistance, cur.focalDistance, 1e-4)) {
            cam.focalDistance = cur.focalDistance;
            changed = true;
        }
        if (!last || !approxEqual(last.aperture, cur.aperture, 1e-6)) {
            cam.aperture = cur.aperture;
            changed = true;
        }
        if (changed) {
            pathTracerRef.current?.resetAccumulation();
            schedulerRef.current?.notifySettingsChanged();
            prevCameraStateRef.current = null;
        }
        lastStoreCamStateRef.current = cur;
    }, [cameraParamsFromStore.fov, cameraParamsFromStore.focalDistance, cameraParamsFromStore.aperture]);

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 720;

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-[#0a0a0f]">
            {webgpuSupportedRef.current && (
                <RenderCanvas
                    width={viewportWidth}
                    height={viewportHeight}
                    onReady={handleCanvasReady}
                />
            )}

            {webgpuSupportedRef.current && (
                <>
                    <PerformanceOverlay />
                    <ControlPanel />
                    <SceneLoader onSceneLoaded={handleSceneLoaded} onGLTFFileSelected={handleGLTFFileSelected} />
                </>
            )}

            {isLoading && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 p-8 rounded-2xl glass-panel">
                        <Loader2 size={40} className="animate-spin text-cyan-400" />
                        <span className="text-gray-200 font-medium">初始化中...</span>
                    </div>
                </div>
            )}

            {error && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="flex flex-col items-center gap-4 p-8 max-w-md rounded-2xl glass-panel text-center">
                        <AlertTriangle size={48} className="text-red-400" />
                        <h2 className="text-xl font-semibold text-white">初始化失败</h2>
                        <p className="text-gray-400 text-sm">{error}</p>
                        <p className="text-gray-500 text-xs mt-2">
                            请使用支持 WebGPU 的浏览器 (Chrome 113+ 或 Edge 113+)
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
