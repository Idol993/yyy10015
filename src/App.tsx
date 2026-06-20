import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import RenderCanvas from '@/components/RenderCanvas';
import ControlPanel from '@/components/ControlPanel';
import PerformanceOverlay from '@/components/PerformanceOverlay';
import SceneLoader from '@/components/SceneLoader';
import { DeviceManager } from '@/core/webgpu/DeviceManager';
import { SceneManager } from '@/core/scene/SceneManager';
import { FreeCameraController } from '@/core/camera/FreeCameraController';
import { RenderScheduler } from '@/core/render/RenderScheduler';
import { PostProcessPipeline } from '@/core/postprocess/PostProcessPipeline';
import { useRendererStore } from '@/store/useRendererStore';
import { createCornellBox } from '@/store/createDefaultScenes';
import type { SceneData, CameraParams, RenderSettings } from '@/types';

interface PathTracerStub {
    render(encoder: GPUCommandEncoder, colorView: GPUTextureView, historyView: GPUTextureView, camera: CameraParams, settings: any, sceneData: SceneData): void;
    resetAccumulation(): void;
}

interface BVHBuilderStub {
    needsRebuild(): boolean;
    build(encoder: GPUCommandEncoder, sceneData: SceneData): void;
    markRebuilt(): void;
}

interface DenoiserAdapter {
    denoise(encoder: GPUCommandEncoder, colorView: GPUTextureView, outputView: GPUTextureView, settings: RenderSettings): void;
}

function createPathTracer(): PathTracerStub {
    return {
        render() {},
        resetAccumulation() {},
    };
}

function createBVHBuilder(sceneManager: SceneManager): BVHBuilderStub {
    let needsRebuildFlag = true;
    return {
        needsRebuild: () => needsRebuildFlag,
        build() {
            sceneManager.buildBVH();
            sceneManager.uploadToGPU();
            needsRebuildFlag = false;
        },
        markRebuilt: () => { needsRebuildFlag = true; },
    };
}

function createDenoiser(): DenoiserAdapter {
    return {
        denoise(encoder, colorView, outputView) {
        },
    };
}

export default function App() {
    const isLoading = useRendererStore((s) => s.isLoading);
    const error = useRendererStore((s) => s.error);
    const renderSettings = useRendererStore((s) => s.renderSettings);
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
    const animationRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);
    const webgpuSupportedRef = useRef(true);
    const [, forceUpdate] = useState(0);

    const handleCanvasReady = useCallback(async (canvas: HTMLCanvasElement) => {
        try {
            const device = DeviceManager.getInstance().getDevice();
            deviceRef.current = device;

            const camera = new FreeCameraController();
            cameraRef.current = camera;

            const sceneManager = new SceneManager(device);
            sceneManagerRef.current = sceneManager;

            const postProcessPipeline = new PostProcessPipeline(device);
            postProcessPipeline.resize(canvas.width, canvas.height);
            postProcessPipeline.createPipelines();

            const denoiser = createDenoiser();
            const pathTracer = createPathTracer();
            const bvhBuilder = createBVHBuilder(sceneManager);

            const scheduler = new RenderScheduler({
                device,
                pathTracer,
                bvhBuilder,
                denoiser,
                postProcessPipeline,
            });

            scheduler.initialize(canvas);
            schedulerRef.current = scheduler;

            const sceneData = createCornellBox();
            sceneManager.setSceneData(sceneData);
            sceneManager.uploadToGPU();
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
            }

            updateSceneInfo({
                triangleCount: sceneData.triangles.length,
                materialCount: sceneData.materials.length,
                instanceCount: sceneData.instances.length,
                lightCount: sceneData.lights.length,
            });
        }
    }, [updateCameraParams, updateSceneInfo]);

    const renderLoop = useCallback((time: number) => {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        lastTimeRef.current = time;

        const camera = cameraRef.current;
        const scheduler = schedulerRef.current;
        const device = deviceRef.current;

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
            metrics.bvhNodeCount = sceneManagerRef.current?.getBVHNodeCount() || 0;
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
                    <SceneLoader onSceneLoaded={handleSceneLoaded} />
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
