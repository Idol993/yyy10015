import { PerformanceMetrics } from '@/types';
import { BUFFER_USAGE_QUERY } from '@/types';

type EncoderWithTimestamp = GPUCommandEncoder & {
    writeTimestamp?: (querySet: GPUQuerySet, queryIndex: number) => void;
};

export enum PassName {
    BVH_BUILD = 'BVH构建',
    PATH_TRACE = '路径追踪',
    TEMPORAL_ACCUMULATION = '时间累积',
    BILATERAL_FILTER = '双边滤波',
    TONEMAP = '色调映射',
    BLOOM = 'Bloom',
    DOF = '景深',
    TOTAL = '总计',
}

const PASS_COUNT = Object.keys(PassName).length / 2;

export class PerformanceProfiler {
    private device: GPUDevice;
    private querySet: GPUQuerySet | null = null;
    private resolveBuffer: GPUBuffer | null = null;
    private readBuffer: GPUBuffer | null = null;
    private timestamps: BigUint64Array | null = null;
    private currentQueryIndex = 0;
    private passIndices: Map<string, { begin: number; end: number }> = new Map();
    private frameStartTime = 0;
    private lastFrameTime = 0;
    private fpsAccumulator = 0;
    private fpsFrameCount = 0;
    private currentFps = 0;
    private lastFpsUpdate = 0;
    private metrics: PerformanceMetrics;
    private available = false;
    private hasWriteTimestamp = false;
    private readPending = false;

    constructor(device: GPUDevice) {
        this.device = device;
        this.available = device.features.has('timestamp-query');
        this.metrics = this.createEmptyMetrics();

        if (this.available) {
            try {
                this.hasWriteTimestamp = typeof (GPUCommandEncoder.prototype as EncoderWithTimestamp).writeTimestamp === 'function';
                if (this.hasWriteTimestamp) {
                    this.createQuerySet();
                } else {
                    this.available = false;
                }
            } catch {
                this.available = false;
            }
        }
    }

    private createQuerySet(): void {
        const queryCount = PASS_COUNT * 2 + 2;

        this.querySet = this.device.createQuerySet({
            label: 'ProfilerQuerySet',
            type: 'timestamp',
            count: queryCount,
        });

        this.resolveBuffer = this.device.createBuffer({
            label: 'ProfilerResolveBuffer',
            size: queryCount * 8,
            usage: BUFFER_USAGE_QUERY,
        });

        this.readBuffer = this.device.createBuffer({
            label: 'ProfilerReadBuffer',
            size: queryCount * 8,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });

        this.timestamps = new BigUint64Array(queryCount);
    }

    private writeTimestamp(encoder: GPUCommandEncoder, queryIndex: number): void {
        if (!this.hasWriteTimestamp || !this.querySet) return;
        try {
            (encoder as EncoderWithTimestamp).writeTimestamp?.(this.querySet, queryIndex);
        } catch {
            // silently fail if timestamp writing is not supported
        }
    }

    beginFrame(encoder: GPUCommandEncoder): void {
        if (!this.available || !this.querySet) {
            this.frameStartTime = performance.now();
            return;
        }

        this.currentQueryIndex = 0;
        this.passIndices.clear();
        this.frameStartTime = performance.now();

        this.writeTimestamp(encoder, this.currentQueryIndex);
        this.currentQueryIndex++;
    }

    beginPass(encoder: GPUCommandEncoder, passName: PassName): void {
        if (!this.available || !this.querySet) return;

        const beginIdx = this.currentQueryIndex;
        this.writeTimestamp(encoder, this.currentQueryIndex);
        this.currentQueryIndex++;

        this.passIndices.set(passName, { begin: beginIdx, end: -1 });
    }

    endPass(encoder: GPUCommandEncoder, passName: PassName): void {
        if (!this.available || !this.querySet) return;

        this.writeTimestamp(encoder, this.currentQueryIndex);

        const entry = this.passIndices.get(passName);
        if (entry) {
            entry.end = this.currentQueryIndex;
        }

        this.currentQueryIndex++;
    }

    endFrame(encoder: GPUCommandEncoder): void {
        this.lastFrameTime = performance.now() - this.frameStartTime;
        this.updateFps();

        if (!this.available || !this.querySet || !this.resolveBuffer || !this.readBuffer) {
            return;
        }

        const totalIdx = this.currentQueryIndex;
        this.writeTimestamp(encoder, this.currentQueryIndex);
        this.currentQueryIndex++;

        this.passIndices.set(PassName.TOTAL, { begin: 0, end: totalIdx });

        try {
            encoder.resolveQuerySet(this.querySet, 0, this.currentQueryIndex, this.resolveBuffer, 0);
            encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readBuffer, 0, this.currentQueryIndex * 8);
            if (!this.readPending) {
                this.readPending = true;
                this.readResults();
            }
        } catch {
            // query resolve may fail if not properly supported
        }
    }

    private async readResults(): Promise<void> {
        if (!this.readBuffer || !this.timestamps) {
            this.readPending = false;
            return;
        }

        try {
            await this.readBuffer.mapAsync(GPUMapMode.READ);
            const data = new BigUint64Array(this.readBuffer.getMappedRange());
            this.timestamps.set(data);
            this.readBuffer.unmap();

            this.computeMetrics();
        } catch {
            // buffer may already be mapped or destroyed
        }
        this.readPending = false;
    }

    private computeMetrics(): void {
        if (!this.timestamps) return;

        const passTimes: Record<string, number> = {};

        for (const [name, indices] of this.passIndices) {
            if (indices.end < 0) continue;

            const beginTime = this.timestamps[indices.begin];
            const endTime = this.timestamps[indices.end];

            if (beginTime !== undefined && endTime !== undefined) {
                const deltaNs = Number(endTime - beginTime);
                passTimes[name] = deltaNs / 1_000_000;
            }
        }

        this.metrics.passTimes = passTimes;
    }

    private updateFps(): void {
        this.fpsAccumulator += this.lastFrameTime;
        this.fpsFrameCount++;
        const now = performance.now();

        if (now - this.lastFpsUpdate >= 500) {
            this.currentFps = this.fpsFrameCount / (this.fpsAccumulator / 1000);
            this.metrics.fps = Math.round(this.currentFps);
            this.metrics.frameTime = this.fpsAccumulator / this.fpsFrameCount;
            this.fpsAccumulator = 0;
            this.fpsFrameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    private createEmptyMetrics(): PerformanceMetrics {
        return {
            fps: 0,
            frameTime: 0,
            passTimes: {},
            gpuMemoryUsed: 0,
            triangleCount: 0,
            bvhNodeCount: 0,
        };
    }

    setSceneStats(triangleCount: number, bvhNodeCount: number): void {
        this.metrics.triangleCount = triangleCount;
        this.metrics.bvhNodeCount = bvhNodeCount;
    }

    setGPUMemoryUsed(bytes: number): void {
        this.metrics.gpuMemoryUsed = bytes;
    }

    isAvailable(): boolean {
        return this.available;
    }

    destroy(): void {
        this.querySet?.destroy();
        this.resolveBuffer?.destroy();
        this.readBuffer?.destroy();
        this.querySet = null;
        this.resolveBuffer = null;
        this.readBuffer = null;
        this.timestamps = null;
    }
}
