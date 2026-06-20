import { SceneData, TriangleData, BUFFER_USAGE_STORAGE, BUFFER_USAGE_UNIFORM, TRIANGLE_SIZE, BVH_NODE_SIZE } from '@/types';
import computeMortonShader from './ComputeMorton.wgsl';
import radixSortShader from './RadixSort.wgsl';
import buildLBVHShader from './BuildLBVH.wgsl';
import plocPlusPlusShader from './PLOCPlusPlus.wgsl';
import refitBoundsShader from './RefitBounds.wgsl';

const U32_SIZE = 4;
const F32_SIZE = 4;

interface BVHPipelines {
    computeMorton: GPUComputePipeline | null;
    radixSort: GPUComputePipeline | null;
    buildLBVH: GPUComputePipeline | null;
    plocPlusPlus: GPUComputePipeline | null;
    refitLeaf: GPUComputePipeline | null;
    refitInternal: GPUComputePipeline | null;
}

interface BVHBindGroupLayouts {
    computeMorton: GPUBindGroupLayout | null;
    radixSort: GPUBindGroupLayout | null;
    buildLBVH: GPUBindGroupLayout | null;
    plocPlusPlus: GPUBindGroupLayout | null;
    refit: GPUBindGroupLayout | null;
}

interface BVHBindGroups {
    computeMorton: GPUBindGroup | null;
    radixSort0: GPUBindGroup | null;
    radixSort1: GPUBindGroup | null;
    buildLBVH: GPUBindGroup | null;
    plocPlusPlus: GPUBindGroup | null;
    refit: GPUBindGroup | null;
}

export class BVHBuilder {
    private device: GPUDevice;
    private needsRebuildFlag: boolean = true;
    private isBuilt: boolean = false;

    private bvhBuffer: GPUBuffer | null = null;
    private mortonBuffer: GPUBuffer | null = null;
    private sortedIndexBuffer: GPUBuffer | null = null;
    private triangleIndexBuffer: GPUBuffer | null = null;
    private paramsBuffer: GPUBuffer | null = null;
    private histogramBuffer: GPUBuffer | null = null;
    private scratchMortonBuffer: GPUBuffer | null = null;

    private triangleDataBuffer: GPUBuffer | null = null;

    private pipelines: BVHPipelines = {
        computeMorton: null,
        radixSort: null,
        buildLBVH: null,
        plocPlusPlus: null,
        refitLeaf: null,
        refitInternal: null,
    };

    private bindGroupLayouts: BVHBindGroupLayouts = {
        computeMorton: null,
        radixSort: null,
        buildLBVH: null,
        plocPlusPlus: null,
        refit: null,
    };

    private bindGroups: BVHBindGroups = {
        computeMorton: null,
        radixSort0: null,
        radixSort1: null,
        buildLBVH: null,
        plocPlusPlus: null,
        refit: null,
    };

    private currentTriangleCount: number = 0;
    private currentNodeCount: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    private createPipelines(): void {
        if (this.pipelines.computeMorton) return;

        const device = this.device;

        this.bindGroupLayouts.computeMorton = device.createBindGroupLayout({
            label: 'BVH-ComputeMorton-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        this.bindGroupLayouts.radixSort = device.createBindGroupLayout({
            label: 'BVH-RadixSort-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        this.bindGroupLayouts.buildLBVH = device.createBindGroupLayout({
            label: 'BVH-BuildLBVH-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        this.bindGroupLayouts.plocPlusPlus = device.createBindGroupLayout({
            label: 'BVH-PLOCPlusPlus-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        this.bindGroupLayouts.refit = device.createBindGroupLayout({
            label: 'BVH-Refit-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            ],
        });

        const createPipeline = (layout: GPUBindGroupLayout, code: string, label: string, entry: string = 'main'): GPUComputePipeline => {
            const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
            const module = device.createShaderModule({ code, label });
            return device.createComputePipeline({
                layout: pl,
                compute: { module, entryPoint: entry },
                label,
            });
        };

        this.pipelines.computeMorton = createPipeline(
            this.bindGroupLayouts.computeMorton,
            computeMortonShader,
            'BVH-ComputeMorton'
        );

        this.pipelines.radixSort = createPipeline(
            this.bindGroupLayouts.radixSort,
            radixSortShader,
            'BVH-RadixSort',
            'sort_simple'
        );

        this.pipelines.buildLBVH = createPipeline(
            this.bindGroupLayouts.buildLBVH,
            buildLBVHShader,
            'BVH-BuildLBVH'
        );

        this.pipelines.plocPlusPlus = createPipeline(
            this.bindGroupLayouts.plocPlusPlus,
            plocPlusPlusShader,
            'BVH-PLOCPlusPlus'
        );

        const refitModule = device.createShaderModule({ code: refitBoundsShader, label: 'BVH-Refit' });

        this.pipelines.refitLeaf = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.refit] }),
            compute: { module: refitModule, entryPoint: 'compute_leaf_bounds' },
            label: 'BVH-RefitLeaf',
        });

        this.pipelines.refitInternal = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayouts.refit] }),
            compute: { module: refitModule, entryPoint: 'refit_internal' },
            label: 'BVH-RefitInternal',
        });
    }

    private createOrReuseBuffer(size: number, usage: number, label: string, existing: GPUBuffer | null): GPUBuffer {
        if (existing && existing.size >= size) {
            return existing;
        }
        if (existing) {
            existing.destroy();
        }
        return this.device.createBuffer({
            size,
            usage,
            label,
        });
    }

    private uploadTriangleData(sceneData: SceneData): void {
        const triangles = sceneData.triangles;
        const triCount = triangles.length;
        const bufferSize = triCount * TRIANGLE_SIZE;

        this.triangleDataBuffer = this.createOrReuseBuffer(
            bufferSize,
            BUFFER_USAGE_STORAGE,
            'BVH-TriangleData',
            this.triangleDataBuffer
        );

        const data = new Float32Array(bufferSize / F32_SIZE);
        for (let i = 0; i < triCount; i++) {
            const tri = triangles[i];
            const offset = i * TRIANGLE_SIZE / F32_SIZE;

            data[offset + 0] = tri.v0.x; data[offset + 1] = tri.v0.y; data[offset + 2] = tri.v0.z; data[offset + 3] = 0;
            data[offset + 4] = tri.v1.x; data[offset + 5] = tri.v1.y; data[offset + 6] = tri.v1.z; data[offset + 7] = 0;
            data[offset + 8] = tri.v2.x; data[offset + 9] = tri.v2.y; data[offset + 10] = tri.v2.z; data[offset + 11] = 0;

            data[offset + 12] = tri.n0.x; data[offset + 13] = tri.n0.y; data[offset + 14] = tri.n0.z; data[offset + 15] = 0;
            data[offset + 16] = tri.n1.x; data[offset + 17] = tri.n1.y; data[offset + 18] = tri.n1.z; data[offset + 19] = 0;
            data[offset + 20] = tri.n2.x; data[offset + 21] = tri.n2.y; data[offset + 22] = tri.n2.z; data[offset + 23] = 0;

            data[offset + 24] = tri.uv0.x; data[offset + 25] = tri.uv0.y;
            data[offset + 26] = tri.uv1.x; data[offset + 27] = tri.uv1.y;
            data[offset + 28] = tri.uv2.x; data[offset + 29] = tri.uv2.y;

            const dataU32 = data as unknown as Uint32Array;
            dataU32[offset + 30] = tri.materialID | 0;
            data[offset + 31] = 0;
        }

        this.device.queue.writeBuffer(this.triangleDataBuffer, 0, data);
    }

    private computeSceneBounds(sceneData: SceneData): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const tri of sceneData.triangles) {
            for (const v of [tri.v0, tri.v1, tri.v2]) {
                minX = Math.min(minX, v.x); minY = Math.min(minY, v.y); minZ = Math.min(minZ, v.z);
                maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y); maxZ = Math.max(maxZ, v.z);
            }
        }

        if (!isFinite(minX)) {
            minX = minY = minZ = -1;
            maxX = maxY = maxZ = 1;
        }

        const eps = 0.001;
        return {
            min: { x: minX - eps, y: minY - eps, z: minZ - eps },
            max: { x: maxX + eps, y: maxY + eps, z: maxZ + eps },
        };
    }

    public needsRebuild(): boolean {
        return this.needsRebuildFlag || !this.isBuilt;
    }

    public markRebuilt(): void {
        this.needsRebuildFlag = true;
    }

    public build(encoder: GPUCommandEncoder, sceneData: SceneData): void {
        if (this.isBuilt && !this.needsRebuildFlag) {
            return;
        }

        this.createPipelines();
        this.uploadTriangleData(sceneData);

        const triangleCount = sceneData.triangles.length;
        const nodeCount = Math.max(1, 4 * triangleCount);
        this.currentTriangleCount = triangleCount;
        this.currentNodeCount = nodeCount;

        const bounds = this.computeSceneBounds(sceneData);

        const mortonPairSize = 2 * U32_SIZE;
        this.mortonBuffer = this.createOrReuseBuffer(
            triangleCount * mortonPairSize,
            BUFFER_USAGE_STORAGE,
            'BVH-MortonCodes',
            this.mortonBuffer
        );
        this.scratchMortonBuffer = this.createOrReuseBuffer(
            triangleCount * mortonPairSize,
            BUFFER_USAGE_STORAGE,
            'BVH-ScratchMorton',
            this.scratchMortonBuffer
        );
        this.sortedIndexBuffer = this.createOrReuseBuffer(
            triangleCount * mortonPairSize,
            BUFFER_USAGE_STORAGE,
            'BVH-SortedIndices',
            this.sortedIndexBuffer
        );
        this.triangleIndexBuffer = this.createOrReuseBuffer(
            triangleCount * U32_SIZE,
            BUFFER_USAGE_STORAGE,
            'BVH-TriangleIndices',
            this.triangleIndexBuffer
        );
        this.bvhBuffer = this.createOrReuseBuffer(
            nodeCount * BVH_NODE_SIZE,
            BUFFER_USAGE_STORAGE,
            'BVH-Nodes',
            this.bvhBuffer
        );
        this.histogramBuffer = this.createOrReuseBuffer(
            64 * 256 * U32_SIZE,
            BUFFER_USAGE_STORAGE,
            'BVH-Histogram',
            this.histogramBuffer
        );
        this.paramsBuffer = this.createOrReuseBuffer(
            256,
            BUFFER_USAGE_UNIFORM,
            'BVH-Params',
            this.paramsBuffer
        );

        const paramsData = new Float32Array(8);
        paramsData[0] = bounds.min.x;
        paramsData[1] = bounds.min.y;
        paramsData[2] = bounds.min.z;
        paramsData[3] = 0;
        paramsData[4] = bounds.max.x;
        paramsData[5] = bounds.max.y;
        paramsData[6] = bounds.max.z;
        new Uint32Array(paramsData.buffer)[7] = triangleCount;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);

        this.bindGroups.computeMorton = this.device.createBindGroup({
            layout: this.bindGroupLayouts.computeMorton!,
            entries: [
                { binding: 0, resource: { buffer: this.triangleDataBuffer! } },
                { binding: 1, resource: { buffer: this.mortonBuffer! } },
                { binding: 2, resource: { buffer: this.paramsBuffer! } },
            ],
            label: 'BVH-ComputeMorton-BG',
        });

        const pass = encoder.beginComputePass({ label: 'BVH-Build' });

        pass.setPipeline(this.pipelines.computeMorton!);
        pass.setBindGroup(0, this.bindGroups.computeMorton!);
        pass.dispatchWorkgroups(Math.ceil(triangleCount / 256));

        const sortParams = new Uint32Array(4);
        sortParams[0] = triangleCount;

        for (let passIdx = 0; passIdx < 4; passIdx++) {
            sortParams[1] = passIdx * 8;
            sortParams[2] = passIdx;
            this.device.queue.writeBuffer(this.paramsBuffer, 32, sortParams);

            const inputBuf = passIdx % 2 === 0 ? this.mortonBuffer! : this.scratchMortonBuffer!;
            const outputBuf = passIdx % 2 === 0 ? this.scratchMortonBuffer! : this.mortonBuffer!;

            this.bindGroups.radixSort0 = this.device.createBindGroup({
                layout: this.bindGroupLayouts.radixSort!,
                entries: [
                    { binding: 0, resource: { buffer: inputBuf } },
                    { binding: 1, resource: { buffer: outputBuf } },
                    { binding: 2, resource: { buffer: this.histogramBuffer! } },
                    { binding: 3, resource: { buffer: this.paramsBuffer! } },
                ],
                label: `BVH-RadixSort-${passIdx}-BG`,
            });

            pass.setPipeline(this.pipelines.radixSort!);
            pass.setBindGroup(0, this.bindGroups.radixSort0!);
            pass.dispatchWorkgroups(Math.ceil(triangleCount / 256));
        }

        encoder.copyBufferToBuffer(
            (4 % 2 === 0 ? this.scratchMortonBuffer! : this.mortonBuffer!),
            0,
            this.sortedIndexBuffer!,
            0,
            triangleCount * mortonPairSize
        );

        const lbvhParams = new Uint32Array([triangleCount, nodeCount, 0, 0]);
        this.device.queue.writeBuffer(this.paramsBuffer, 32, lbvhParams);

        this.bindGroups.buildLBVH = this.device.createBindGroup({
            layout: this.bindGroupLayouts.buildLBVH!,
            entries: [
                { binding: 0, resource: { buffer: this.sortedIndexBuffer! } },
                { binding: 1, resource: { buffer: this.bvhBuffer! } },
                { binding: 2, resource: { buffer: this.triangleIndexBuffer! } },
                { binding: 3, resource: { buffer: this.paramsBuffer! } },
            ],
            label: 'BVH-BuildLBVH-BG',
        });

        pass.setPipeline(this.pipelines.buildLBVH!);
        pass.setBindGroup(0, this.bindGroups.buildLBVH!);
        pass.dispatchWorkgroups(Math.ceil(triangleCount / 256));

        this.bindGroups.plocPlusPlus = this.device.createBindGroup({
            layout: this.bindGroupLayouts.plocPlusPlus!,
            entries: [
                { binding: 0, resource: { buffer: this.bvhBuffer! } },
                { binding: 1, resource: { buffer: this.paramsBuffer! } },
            ],
            label: 'BVH-PLOCPlusPlus-BG',
        });

        pass.setPipeline(this.pipelines.plocPlusPlus!);
        pass.setBindGroup(0, this.bindGroups.plocPlusPlus!);
        for (let iter = 0; iter < 3; iter++) {
            pass.dispatchWorkgroups(Math.ceil(Math.max(1, triangleCount - 1) / 128));
        }

        this.bindGroups.refit = this.device.createBindGroup({
            layout: this.bindGroupLayouts.refit!,
            entries: [
                { binding: 0, resource: { buffer: this.triangleDataBuffer! } },
                { binding: 1, resource: { buffer: this.bvhBuffer! } },
                { binding: 2, resource: { buffer: this.triangleIndexBuffer! } },
                { binding: 3, resource: { buffer: this.paramsBuffer! } },
            ],
            label: 'BVH-Refit-BG',
        });

        pass.setPipeline(this.pipelines.refitLeaf!);
        pass.setBindGroup(0, this.bindGroups.refit!);
        pass.dispatchWorkgroups(Math.ceil(triangleCount / 256));

        pass.setPipeline(this.pipelines.refitInternal!);
        pass.setBindGroup(0, this.bindGroups.refit!);
        pass.dispatchWorkgroups(Math.ceil(Math.max(1, triangleCount - 1) / 256));

        pass.end();

        this.isBuilt = true;
        this.needsRebuildFlag = false;
    }

    public refit(encoder: GPUCommandEncoder, sceneData: SceneData): void {
        if (!this.isBuilt) {
            this.build(encoder, sceneData);
            return;
        }

        this.createPipelines();
        this.uploadTriangleData(sceneData);

        const triangleCount = sceneData.triangles.length;
        const nodeCount = Math.max(1, 4 * triangleCount);
        this.currentTriangleCount = triangleCount;
        this.currentNodeCount = nodeCount;

        const lbvhParams = new Uint32Array([triangleCount, nodeCount, 0, 0]);
        this.device.queue.writeBuffer(this.paramsBuffer!, 32, lbvhParams);

        this.bindGroups.refit = this.device.createBindGroup({
            layout: this.bindGroupLayouts.refit!,
            entries: [
                { binding: 0, resource: { buffer: this.triangleDataBuffer! } },
                { binding: 1, resource: { buffer: this.bvhBuffer! } },
                { binding: 2, resource: { buffer: this.triangleIndexBuffer! } },
                { binding: 3, resource: { buffer: this.paramsBuffer! } },
            ],
            label: 'BVH-Refit-BG',
        });

        const pass = encoder.beginComputePass({ label: 'BVH-Refit' });

        pass.setPipeline(this.pipelines.refitLeaf!);
        pass.setBindGroup(0, this.bindGroups.refit!);
        pass.dispatchWorkgroups(Math.ceil(triangleCount / 256));

        pass.setPipeline(this.pipelines.refitInternal!);
        pass.setBindGroup(0, this.bindGroups.refit!);
        pass.dispatchWorkgroups(Math.ceil(Math.max(1, triangleCount - 1) / 256));

        pass.end();
    }

    public getBVHBuffer(): GPUBuffer | null {
        return this.bvhBuffer;
    }

    public getRootNode(): number {
        return 0;
    }

    public getNodeCount(): number {
        return this.currentNodeCount;
    }

    public getTriangleDataBuffer(): GPUBuffer | null {
        return this.triangleDataBuffer;
    }

    public getTriangleIndexBuffer(): GPUBuffer | null {
        return this.triangleIndexBuffer;
    }

    public destroy(): void {
        const buffers = [
            this.bvhBuffer, this.mortonBuffer, this.sortedIndexBuffer,
            this.triangleIndexBuffer, this.paramsBuffer, this.histogramBuffer,
            this.scratchMortonBuffer, this.triangleDataBuffer,
        ];
        for (const buf of buffers) {
            if (buf) buf.destroy();
        }
        this.bvhBuffer = this.mortonBuffer = this.sortedIndexBuffer = null;
        this.triangleIndexBuffer = this.paramsBuffer = this.histogramBuffer = null;
        this.scratchMortonBuffer = this.triangleDataBuffer = null;

        this.pipelines = {
            computeMorton: null, radixSort: null, buildLBVH: null,
            plocPlusPlus: null, refitLeaf: null, refitInternal: null,
        };
        this.bindGroupLayouts = {
            computeMorton: null, radixSort: null, buildLBVH: null,
            plocPlusPlus: null, refit: null,
        };
        this.bindGroups = {
            computeMorton: null, radixSort0: null, radixSort1: null,
            buildLBVH: null, plocPlusPlus: null, refit: null,
        };

        this.isBuilt = false;
        this.currentTriangleCount = 0;
        this.currentNodeCount = 0;
    }
}
