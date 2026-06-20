import { SceneData, CameraParams, RenderSettings, BUFFER_USAGE_STORAGE, BUFFER_USAGE_UNIFORM, TRIANGLE_SIZE, MATERIAL_SIZE, LIGHT_SIZE, TEXTURE_USAGE_STORAGE, TEXTURE_FORMAT_RGBA32F } from '@/types';
import pathTracerKernel from './PathTracerKernel.wgsl';

const U32_SIZE = 4;
const F32_SIZE = 4;

const UNIFORM_SIZE = 256;

const WORKGROUP_SIZE_X = 8;
const WORKGROUP_SIZE_Y = 8;

export class PathTracer {
    private device: GPUDevice;
    private width: number = 0;
    private height: number = 0;
    private frameCount: number = 0;
    private accumulationCount: number = 0;

    private pipeline: GPUComputePipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private uniformBuffer: GPUBuffer | null = null;

    private bvhBuffer: GPUBuffer | null = null;
    private triangleDataBuffer: GPUBuffer | null = null;
    private materialDataBuffer: GPUBuffer | null = null;
    private lightDataBuffer: GPUBuffer | null = null;

    private normalTexture: GPUTexture | null = null;
    private depthTexture: GPUTexture | null = null;
    private motionVectorTexture: GPUTexture | null = null;
    private materialSampler: GPUSampler | null = null;

    private bindGroup: GPUBindGroup | null = null;

    private currentTriangleCount: number = 0;
    private currentMaterialCount: number = 0;
    private currentLightCount: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    private createPipelines(): void {
        if (this.pipeline) return;

        const device = this.device;

        const MAX_TEXTURES = 8;
        const textureEntries: GPUBindGroupLayoutEntry[] = [];
        for (let i = 0; i < MAX_TEXTURES; i++) {
            textureEntries.push({
                binding: 10 + i,
                visibility: GPUShaderStage.COMPUTE,
                texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
            });
        }

        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'PathTracer-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'read-write', format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat } },
                ...textureEntries,
                {
                    binding: 18,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: { type: 'filtering' },
                },
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

        const shaderModule = device.createShaderModule({
            code: pathTracerKernel,
            label: 'PathTracer-Kernel',
        });

        this.pipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: {
                module: shaderModule,
                entryPoint: 'main',
            },
            label: 'PathTracer-Pipeline',
        });

        this.uniformBuffer = device.createBuffer({
            size: UNIFORM_SIZE,
            usage: BUFFER_USAGE_UNIFORM,
            label: 'PathTracer-Uniform',
        });

        this.materialSampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
        });
    }

    public createOutputTextures(width: number, height: number): void {
        this.destroyTextures();

        this.width = width;
        this.height = height;

        const device = this.device;

        this.normalTexture = device.createTexture({
            label: 'PathTracer-Normal',
            size: { width, height },
            format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });

        this.depthTexture = device.createTexture({
            label: 'PathTracer-Depth',
            size: { width, height },
            format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
        });

        this.motionVectorTexture = device.createTexture({
            label: 'PathTracer-MotionVector',
            size: { width, height },
            format: TEXTURE_FORMAT_RGBA32F as GPUTextureFormat,
            usage: TEXTURE_USAGE_STORAGE,
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

    private uploadSceneData(sceneData: SceneData): void {
        const device = this.device;
        const triangles = sceneData.triangles;
        const materials = sceneData.materials;
        const lights = sceneData.lights;

        this.currentTriangleCount = triangles.length;
        this.currentMaterialCount = materials.length;
        this.currentLightCount = lights.length;

        if (triangles.length > 0) {
            const triBufferSize = triangles.length * TRIANGLE_SIZE;
            this.triangleDataBuffer = this.createOrReuseBuffer(
                triBufferSize,
                BUFFER_USAGE_STORAGE,
                'PathTracer-Triangles',
                this.triangleDataBuffer
            );

            const triData = new Float32Array(triBufferSize / F32_SIZE);
            for (let i = 0; i < triangles.length; i++) {
                const tri = triangles[i];
                const offset = i * TRIANGLE_SIZE / F32_SIZE;

                triData[offset + 0] = tri.v0.x; triData[offset + 1] = tri.v0.y; triData[offset + 2] = tri.v0.z; triData[offset + 3] = 0;
                triData[offset + 4] = tri.v1.x; triData[offset + 5] = tri.v1.y; triData[offset + 6] = tri.v1.z; triData[offset + 7] = 0;
                triData[offset + 8] = tri.v2.x; triData[offset + 9] = tri.v2.y; triData[offset + 10] = tri.v2.z; triData[offset + 11] = 0;

                triData[offset + 12] = tri.n0.x; triData[offset + 13] = tri.n0.y; triData[offset + 14] = tri.n0.z; triData[offset + 15] = 0;
                triData[offset + 16] = tri.n1.x; triData[offset + 17] = tri.n1.y; triData[offset + 18] = tri.n1.z; triData[offset + 19] = 0;
                triData[offset + 20] = tri.n2.x; triData[offset + 21] = tri.n2.y; triData[offset + 22] = tri.n2.z; triData[offset + 23] = 0;

                triData[offset + 24] = tri.uv0.x; triData[offset + 25] = tri.uv0.y;
                triData[offset + 26] = tri.uv1.x; triData[offset + 27] = tri.uv1.y;

                triData[offset + 28] = tri.materialID;
                triData[offset + 29] = 0;
                triData[offset + 30] = 0;
                triData[offset + 31] = 0;
            }
            device.queue.writeBuffer(this.triangleDataBuffer, 0, triData);
        }

        if (materials.length > 0) {
            const matBufferSize = materials.length * MATERIAL_SIZE;
            this.materialDataBuffer = this.createOrReuseBuffer(
                matBufferSize,
                BUFFER_USAGE_STORAGE,
                'PathTracer-Materials',
                this.materialDataBuffer
            );

            const matData = new Float32Array(matBufferSize / F32_SIZE);
            const matDataU32 = matData as unknown as Uint32Array;
            for (let i = 0; i < materials.length; i++) {
                const mat = materials[i];
                const offset = i * MATERIAL_SIZE / F32_SIZE;

                matData[offset + 0] = mat.baseColor.x;
                matData[offset + 1] = mat.baseColor.y;
                matData[offset + 2] = mat.baseColor.z;
                matData[offset + 3] = mat.baseColor.w;

                matData[offset + 4] = mat.metallic;
                matData[offset + 5] = mat.roughness;

                matData[offset + 6] = mat.emissive.x;
                matData[offset + 7] = mat.emissive.y;
                matData[offset + 8] = mat.emissive.z;

                matData[offset + 9] = mat.clearcoat;
                matData[offset + 10] = mat.clearcoatRoughness;
                matData[offset + 11] = mat.transmission;
                matData[offset + 12] = mat.ior;
                matData[offset + 13] = mat.thickness;
                matData[offset + 14] = mat.subsurface;
                matData[offset + 15] = mat.alphaCutoff;

                var flags = 0;
                if (mat.baseColorTexture >= 0) flags |= 0x1;
                if (mat.metallicRoughnessTexture >= 0) flags |= 0x2;
                if (mat.normalTexture >= 0) flags |= 0x4;
                if (mat.occlusionTexture >= 0) flags |= 0x8;
                if (mat.emissiveTexture >= 0) flags |= 0x10;
                if (mat.clearcoatTexture >= 0) flags |= 0x20;
                if (mat.transmission > 0) flags |= 0x40;
                if (mat.doubleSided > 0) flags |= 0x80;
                matDataU32[offset + 16] = flags;

                matData[offset + 17] = 0;
                matData[offset + 18] = 0;
                matData[offset + 19] = 0;
            }
            device.queue.writeBuffer(this.materialDataBuffer, 0, matData);
        }

        if (lights.length > 0) {
            const lightBufferSize = lights.length * LIGHT_SIZE;
            this.lightDataBuffer = this.createOrReuseBuffer(
                lightBufferSize,
                BUFFER_USAGE_STORAGE,
                'PathTracer-Lights',
                this.lightDataBuffer
            );

            const lightData = new Float32Array(lightBufferSize / F32_SIZE);
            const lightDataU32 = lightData as unknown as Uint32Array;
            for (let i = 0; i < lights.length; i++) {
                const light = lights[i];
                const offset = i * LIGHT_SIZE / F32_SIZE;

                lightDataU32[offset + 0] = light.type;
                lightDataU32[offset + 1] = 0;
                lightDataU32[offset + 2] = 0;
                lightDataU32[offset + 3] = 0;

                lightData[offset + 4] = light.position.x;
                lightData[offset + 5] = light.position.y;
                lightData[offset + 6] = light.position.z;
                lightData[offset + 7] = 0;

                lightData[offset + 8] = light.direction.x;
                lightData[offset + 9] = light.direction.y;
                lightData[offset + 10] = light.direction.z;
                lightData[offset + 11] = 0;

                lightData[offset + 12] = light.color.x;
                lightData[offset + 13] = light.color.y;
                lightData[offset + 14] = light.color.z;
                lightData[offset + 15] = light.intensity;

                lightData[offset + 16] = light.radius;
                lightData[offset + 17] = light.innerConeAngle;
                lightData[offset + 18] = light.outerConeAngle;
                lightData[offset + 19] = 0;
            }
            device.queue.writeBuffer(this.lightDataBuffer, 0, lightData);
        }
    }

    private updateUniformBuffer(
        camera: CameraParams,
        settings: RenderSettings,
        sceneData: SceneData
    ): void {
        const device = this.device;
        const data = new Float32Array(UNIFORM_SIZE / F32_SIZE);
        const dataU32 = data as unknown as Uint32Array;

        data[0] = camera.position.x;
        data[1] = camera.position.y;
        data[2] = camera.position.z;
        data[3] = 0;

        data[4] = camera.direction.x;
        data[5] = camera.direction.y;
        data[6] = camera.direction.z;
        data[7] = 0;

        data[8] = camera.up.x;
        data[9] = camera.up.y;
        data[10] = camera.up.z;
        data[11] = camera.fov;

        data[12] = camera.near;
        data[13] = camera.far;
        data[14] = camera.focalDistance;
        data[15] = camera.aperture;

        dataU32[16] = this.frameCount;
        dataU32[17] = settings.maxBounces;
        dataU32[18] = settings.minBouncesForRR;
        dataU32[19] = settings.samplesPerFrame;

        dataU32[20] = settings.enableNEE ? 1 : 0;
        dataU32[21] = settings.enableMIS ? 1 : 0;
        dataU32[22] = settings.enableRussianRoulette ? 1 : 0;
        dataU32[23] = 1;

        dataU32[24] = this.width;
        dataU32[25] = this.height;
        dataU32[26] = sceneData.triangles.length;
        dataU32[27] = sceneData.lights.length;

        device.queue.writeBuffer(this.uniformBuffer!, 0, data);
    }

    public render(
        encoder: GPUCommandEncoder,
        colorView: GPUTextureView,
        historyView: GPUTextureView,
        camera: CameraParams,
        settings: RenderSettings,
        sceneData: SceneData
    ): void {
        this.createPipelines();
        this.uploadSceneData(sceneData);
        this.updateUniformBuffer(camera, settings, sceneData);

        const device = this.device;

        const triBuffer = this.triangleDataBuffer ?? device.createBuffer({
            size: TRIANGLE_SIZE,
            usage: BUFFER_USAGE_STORAGE,
            label: 'PathTracer-DummyTriangles',
        });
        const matBuffer = this.materialDataBuffer ?? device.createBuffer({
            size: MATERIAL_SIZE,
            usage: BUFFER_USAGE_STORAGE,
            label: 'PathTracer-DummyMaterials',
        });
        const lightBuffer = this.lightDataBuffer ?? device.createBuffer({
            size: LIGHT_SIZE,
            usage: BUFFER_USAGE_STORAGE,
            label: 'PathTracer-DummyLights',
        });

        this.bindGroup = device.createBindGroup({
            layout: this.bindGroupLayout!,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer! } },
                { binding: 1, resource: { buffer: triBuffer } },
                { binding: 2, resource: { buffer: this.getBVHBuffer() ?? triBuffer } },
                { binding: 3, resource: { buffer: matBuffer } },
                { binding: 4, resource: { buffer: lightBuffer } },
                { binding: 5, resource: colorView },
                { binding: 6, resource: historyView },
                { binding: 7, resource: this.normalTexture?.createView() ?? colorView },
                { binding: 8, resource: this.depthTexture?.createView() ?? colorView },
                { binding: 9, resource: this.motionVectorTexture?.createView() ?? colorView },
                ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
                    binding: 10 + i,
                    resource: (sceneData.textures[i]?.texture && sceneData.textures[i].texture!)
                        ? sceneData.textures[i].texture!.createView()
                        : (this.normalTexture?.createView() ?? colorView),
                })),
                { binding: 18, resource: this.materialSampler! },
            ],
            label: 'PathTracer-BG',
        });

        const pass = encoder.beginComputePass({ label: 'PathTracer-Render' });

        pass.setPipeline(this.pipeline!);
        pass.setBindGroup(0, this.bindGroup!);

        const workgroupsX = Math.ceil(this.width / WORKGROUP_SIZE_X);
        const workgroupsY = Math.ceil(this.height / WORKGROUP_SIZE_Y);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY);

        pass.end();

        this.frameCount++;
        this.accumulationCount++;
    }

    private getBVHBuffer(): GPUBuffer | null {
        return this.bvhBuffer;
    }

    public setBVHBuffer(buffer: GPUBuffer | null): void {
        this.bvhBuffer = buffer;
    }

    public resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;
        this.createOutputTextures(width, height);
        this.resetAccumulation();
    }

    public resetAccumulation(): void {
        this.frameCount = 0;
        this.accumulationCount = 0;
    }

    private destroyTextures(): void {
        if (this.normalTexture) { this.normalTexture.destroy(); this.normalTexture = null; }
        if (this.depthTexture) { this.depthTexture.destroy(); this.depthTexture = null; }
        if (this.motionVectorTexture) { this.motionVectorTexture.destroy(); this.motionVectorTexture = null; }
    }

    public getNormalTexture(): GPUTexture | null {
        return this.normalTexture;
    }

    public getDepthTexture(): GPUTexture | null {
        return this.depthTexture;
    }

    public getMotionVectorTexture(): GPUTexture | null {
        return this.motionVectorTexture;
    }

    public destroy(): void {
        this.destroyTextures();

        const buffers = [
            this.uniformBuffer, this.bvhBuffer, this.triangleDataBuffer, this.materialDataBuffer,
            this.lightDataBuffer,
        ];
        for (const buf of buffers) {
            if (buf) buf.destroy();
        }
        this.uniformBuffer = this.bvhBuffer = this.triangleDataBuffer = this.materialDataBuffer = null;
        this.lightDataBuffer = null;

        this.pipeline = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;

        this.width = 0;
        this.height = 0;
        this.frameCount = 0;
        this.accumulationCount = 0;
        this.currentTriangleCount = 0;
        this.currentMaterialCount = 0;
        this.currentLightCount = 0;
    }
}
