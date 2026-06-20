import { DeviceManager } from './DeviceManager';

interface BufferEntry {
    buffer: GPUBuffer;
    size: number;
    usage: GPUBufferUsageFlags;
    isUsed: boolean;
    lastUsedFrame: number;
}

export interface BufferPoolStats {
    totalAllocated: number;
    totalUsed: number;
    poolCount: number;
    usedCount: number;
}

export interface AllocateOptions {
    mappedAtCreation?: boolean;
    label?: string;
}

export class BufferPool {
    private static instance: BufferPool | null = null;
    private deviceManager: DeviceManager;
    private pools: Map<string, BufferEntry[]> = new Map();
    private allocatedBuffers: Map<GPUBuffer, BufferEntry> = new Map();
    private totalAllocatedBytes = 0;
    private totalUsedBytes = 0;
    private currentFrame = 0;
    private maxIdleFrames = 300;

    private constructor() {
        this.deviceManager = DeviceManager.getInstance();
    }

    public static getInstance(): BufferPool {
        if (!BufferPool.instance) {
            BufferPool.instance = new BufferPool();
        }
        return BufferPool.instance;
    }

    private getPoolKey(size: number, usage: GPUBufferUsageFlags): string {
        const bucketSize = this.getBucketSize(size);
        return `${bucketSize}_${usage}`;
    }

    private getBucketSize(size: number): number {
        if (size <= 256) return 256;
        if (size <= 1024) return 1024;
        if (size <= 4096) return 4096;
        if (size <= 16384) return 16384;
        if (size <= 65536) return 65536;
        if (size <= 262144) return 262144;
        if (size <= 1048576) return 1048576;
        if (size <= 4194304) return 4194304;
        if (size <= 16777216) return 16777216;
        return Math.ceil(size / 16777216) * 16777216;
    }

    private alignSize(size: number): number {
        const alignment = 256;
        return Math.ceil(size / alignment) * alignment;
    }

    public allocateBuffer(
        size: number,
        usage: GPUBufferUsageFlags,
        options: AllocateOptions = {}
    ): GPUBuffer {
        const device = this.deviceManager.getDevice();
        const alignedSize = this.alignSize(size);
        const bucketSize = this.getBucketSize(alignedSize);
        const poolKey = this.getPoolKey(alignedSize, usage);

        if (options.mappedAtCreation) {
            const buffer = device.createBuffer({
                size: alignedSize,
                usage,
                mappedAtCreation: true,
                label: options.label
            });

            const entry: BufferEntry = {
                buffer,
                size: alignedSize,
                usage,
                isUsed: true,
                lastUsedFrame: this.currentFrame
            };

            this.allocatedBuffers.set(buffer, entry);
            this.totalAllocatedBytes += alignedSize;
            this.totalUsedBytes += alignedSize;

            return buffer;
        }

        const pool = this.pools.get(poolKey);
        if (pool && pool.length > 0) {
            for (let i = pool.length - 1; i >= 0; i--) {
                const entry = pool[i];
                if (!entry.isUsed && entry.size >= alignedSize) {
                    entry.isUsed = true;
                    entry.lastUsedFrame = this.currentFrame;
                    this.totalUsedBytes += entry.size;
                    pool.splice(i, 1);
                    return entry.buffer;
                }
            }
        }

        const createSize = Math.max(alignedSize, bucketSize);
        const buffer = device.createBuffer({
            size: createSize,
            usage,
            mappedAtCreation: false,
            label: options.label
        });

        const entry: BufferEntry = {
            buffer,
            size: createSize,
            usage,
            isUsed: true,
            lastUsedFrame: this.currentFrame
        };

        this.allocatedBuffers.set(buffer, entry);
        this.totalAllocatedBytes += createSize;
        this.totalUsedBytes += createSize;

        return buffer;
    }

    public releaseBuffer(buffer: GPUBuffer): void {
        const entry = this.allocatedBuffers.get(buffer);
        if (!entry) {
            console.warn('Attempting to release unknown buffer');
            return;
        }

        if (!entry.isUsed) {
            console.warn('Buffer already released');
            return;
        }

        entry.isUsed = false;
        entry.lastUsedFrame = this.currentFrame;
        this.totalUsedBytes -= entry.size;

        const poolKey = this.getPoolKey(entry.size, entry.usage);
        if (!this.pools.has(poolKey)) {
            this.pools.set(poolKey, []);
        }
        this.pools.get(poolKey)!.push(entry);
    }

    public writeBuffer(
        buffer: GPUBuffer,
        data: BufferSource | ArrayBuffer,
        offset = 0,
        bufferOffset = 0
    ): void {
        const device = this.deviceManager.getDevice();
        const entry = this.allocatedBuffers.get(buffer);

        if (!entry) {
            throw new Error('Unknown buffer, cannot write');
        }

        const srcData = 'buffer' in data ? data : new Uint8Array(data);
        const byteLength = 'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength;

        if (bufferOffset + byteLength > entry.size) {
            throw new Error(
                `Write would overflow buffer. Buffer size: ${entry.size}, ` +
                `write offset: ${bufferOffset}, write size: ${byteLength}`
            );
        }

        device.queue.writeBuffer(buffer, bufferOffset, srcData, offset, byteLength);
    }

    public createBufferWithData(
        data: BufferSource | ArrayBuffer,
        usage: GPUBufferUsageFlags,
        label?: string
    ): GPUBuffer {
        const byteLength = 'byteLength' in data ? data.byteLength : (data as ArrayBuffer).byteLength;
        const buffer = this.allocateBuffer(byteLength, usage, {
            mappedAtCreation: true,
            label
        });

        const arrayBuffer = buffer.getMappedRange();
        const srcData = 'buffer' in data
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data as ArrayBuffer);
        const dstData = new Uint8Array(arrayBuffer);
        dstData.set(srcData);
        buffer.unmap();

        return buffer;
    }

    public copyBuffer(
        encoder: GPUCommandEncoder,
        source: GPUBuffer,
        destination: GPUBuffer,
        size: number,
        sourceOffset = 0,
        destinationOffset = 0
    ): void {
        encoder.copyBufferToBuffer(
            source,
            sourceOffset,
            destination,
            destinationOffset,
            size
        );
    }

    public getStats(): BufferPoolStats {
        let poolCount = 0;
        let usedCount = 0;

        for (const entry of this.allocatedBuffers.values()) {
            poolCount++;
            if (entry.isUsed) {
                usedCount++;
            }
        }

        return {
            totalAllocated: this.totalAllocatedBytes,
            totalUsed: this.totalUsedBytes,
            poolCount,
            usedCount
        };
    }

    public beginFrame(): void {
        this.currentFrame++;
    }

    public cleanup(): void {
        const entriesToRemove: GPUBuffer[] = [];

        for (const [buffer, entry] of this.allocatedBuffers) {
            if (!entry.isUsed &&
                (this.currentFrame - entry.lastUsedFrame) > this.maxIdleFrames) {
                entriesToRemove.push(buffer);
            }
        }

        for (const buffer of entriesToRemove) {
            const entry = this.allocatedBuffers.get(buffer)!;
            const poolKey = this.getPoolKey(entry.size, entry.usage);
            const pool = this.pools.get(poolKey);

            if (pool) {
                const idx = pool.indexOf(entry);
                if (idx !== -1) {
                    pool.splice(idx, 1);
                }
            }

            this.totalAllocatedBytes -= entry.size;
            this.allocatedBuffers.delete(buffer);
            buffer.destroy();
        }
    }

    public forceCleanupAll(): void {
        for (const [buffer] of this.allocatedBuffers) {
            buffer.destroy();
        }

        this.pools.clear();
        this.allocatedBuffers.clear();
        this.totalAllocatedBytes = 0;
        this.totalUsedBytes = 0;
    }

    public destroy(): void {
        this.forceCleanupAll();
        BufferPool.instance = null;
    }
}
