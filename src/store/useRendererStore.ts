import { create } from 'zustand';
import { RenderSettings, PerformanceMetrics } from '@/types';

interface CameraState {
    position: { x: number; y: number; z: number };
    fov: number;
    yaw: number;
    pitch: number;
    aperture: number;
    focalDistance: number;
}

interface SceneInfo {
    triangleCount: number;
    bvhNodeCount: number;
    materialCount: number;
    instanceCount: number;
    lightCount: number;
}

interface RendererState {
    renderSettings: RenderSettings;
    performanceMetrics: PerformanceMetrics;
    cameraParams: CameraState;
    sceneInfo: SceneInfo;
    isInitialized: boolean;
    isLoading: boolean;
    error: string | null;
}

interface RendererActions {
    updateSettings: (partial: Partial<RenderSettings>) => void;
    updateMetrics: (metrics: PerformanceMetrics) => void;
    updateCameraParams: (params: Partial<CameraState>) => void;
    updateSceneInfo: (info: Partial<SceneInfo>) => void;
    setInitialized: (value: boolean) => void;
    setLoading: (value: boolean) => void;
    setError: (error: string | null) => void;
}

const defaultRenderSettings: RenderSettings = {
    samplesPerFrame: 1,
    maxBounces: 8,
    minBouncesForRR: 3,
    enableNEE: true,
    enableMIS: true,
    enableRussianRoulette: true,
    enableDenoiser: true,
    enableBloom: true,
    enableDOF: false,
    exposure: 1.0,
    bloomThreshold: 1.5,
    bloomIntensity: 0.3,
    tonemapType: 1,
    frameCount: 0,
    sampleCount: 0,
};

const defaultMetrics: PerformanceMetrics = {
    fps: 0,
    frameTime: 0,
    passTimes: {},
    gpuMemoryUsed: 0,
    triangleCount: 0,
    bvhNodeCount: 0,
};

const defaultCamera: CameraState = {
    position: { x: 0, y: 1, z: 5 },
    fov: Math.PI / 3,
    yaw: -Math.PI / 2,
    pitch: 0,
    aperture: 0,
    focalDistance: 10,
};

const defaultSceneInfo: SceneInfo = {
    triangleCount: 0,
    bvhNodeCount: 0,
    materialCount: 0,
    instanceCount: 0,
    lightCount: 0,
};

export const useRendererStore = create<RendererState & RendererActions>()((set) => ({
    renderSettings: defaultRenderSettings,
    performanceMetrics: defaultMetrics,
    cameraParams: defaultCamera,
    sceneInfo: defaultSceneInfo,
    isInitialized: false,
    isLoading: false,
    error: null,

    updateSettings: (partial) =>
        set((state) => ({
            renderSettings: { ...state.renderSettings, ...partial },
        })),

    updateMetrics: (metrics) =>
        set({ performanceMetrics: metrics }),

    updateCameraParams: (params) =>
        set((state) => ({
            cameraParams: { ...state.cameraParams, ...params },
        })),

    updateSceneInfo: (info) =>
        set((state) => ({
            sceneInfo: { ...state.sceneInfo, ...info },
        })),

    setInitialized: (value) =>
        set({ isInitialized: value }),

    setLoading: (value) =>
        set({ isLoading: value }),

    setError: (error) =>
        set({ error }),
}));
