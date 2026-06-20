import { CameraParams, RenderSettings, TEXTURE_FORMAT_RGBA16F, TEXTURE_USAGE_STORAGE, BUFFER_USAGE_UNIFORM } from '@/types';

import bloomShader from './Bloom.wgsl?raw';
import dofShader from './DOF.wgsl?raw';
import tonemapShader from './Tonemap.wgsl?raw';

const BLOOM_MIP_LEVELS = 6;
const WORKGROUP_SIZE = 8;

interface ComputePipeline {
    pipeline: GPUComputePipeline;
    bindGroupLayout: GPUBindGroupLayout;
}

interface BloomMip {
    texture: GPUTexture;
    view: GPUTextureView;
    width: number;
    height: number;
}

export class PostProcessPipeline {
    device: GPUDevice;
    width = 0;
    height = 0;
    bloomMipTextures: BloomMip[] = [];
    bloomMipViews: GPUTextureView[] = [];

    pipelines: {
        tonemap: ComputePipeline | null;
        bloomDownsample: ComputePipeline | null;
        bloomUpsample: ComputePipeline | null;
        bloomApply: ComputePipeline | null;
        dof: ComputePipeline | null;
    } = {
        tonemap: null,
        bloomDownsample: null,
        bloomUpsample: null,
        bloomApply: null,
        dof: null,
    };

    bindGroupLayouts: {
        tonemap: GPUBindGroupLayout | null;
        bloom: GPUBindGroupLayout | null;
        dof: GPUBindGroupLayout | null;
    } = {
        tonemap: null,
        bloom: null,
        dof: null,
    };

    uniformBuffer: GPUBuffer | null = null;

    private sampler: GPUSampler | null = null;
    private pipelinesCreated = false;
    private currentSettings: RenderSettings | null = null;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    createPipelines(): void {
        if (this.pipelinesCreated) return;

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
        });

        this.uniformBuffer = this.device.createBuffer({
            size: 16 * 4,
            usage: BUFFER_USAGE_UNIFORM,
            label: 'PostProcessUniformBuffer',
        });

        this.createTonemapPipeline();
        this.createBloomPipelines();
        this.createDOFPipeline();

        this.pipelinesCreated = true;
    }

    private createTonemapPipeline(): void {
        const layout = this.device.createBindGroupLayout({
            label: 'TonemapBindGroupLayout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: 'rgba8unorm', access: 'write-only' },
                },
            ],
        });

        this.bindGroupLayouts.tonemap = layout;

        const pipelineLayout = this.device.createPipelineLayout({
            label: 'TonemapPipelineLayout',
            bindGroupLayouts: [layout],
        });

        const shaderModule = this.device.createShaderModule({
            label: 'TonemapShader',
            code: tonemapShader,
        });

        this.pipelines.tonemap = {
            pipeline: this.device.createComputePipeline({
                label: 'TonemapPipeline',
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: 'main',
                },
            }),
            bindGroupLayout: layout,
        };
    }

    private createBloomPipelines(): void {
        const layout = this.device.createBindGroupLayout({
            label: 'BloomBindGroupLayout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat, access: 'write-only' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    sampler: { type: 'filtering' },
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' },
                },
            ],
        });

        this.bindGroupLayouts.bloom = layout;

        const pipelineLayout = this.device.createPipelineLayout({
            label: 'BloomPipelineLayout',
            bindGroupLayouts: [layout],
        });

        const shaderModule = this.device.createShaderModule({
            label: 'BloomShader',
            code: bloomShader,
        });

        this.pipelines.bloomDownsample = {
            pipeline: this.device.createComputePipeline({
                label: 'BloomDownsamplePipeline',
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: 'bloomDownsample',
                },
            }),
            bindGroupLayout: layout,
        };

        this.pipelines.bloomUpsample = {
            pipeline: this.device.createComputePipeline({
                label: 'BloomUpsamplePipeline',
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: 'bloomUpsample',
                },
            }),
            bindGroupLayout: layout,
        };

        this.pipelines.bloomApply = {
            pipeline: this.device.createComputePipeline({
                label: 'BloomApplyPipeline',
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: 'bloomApply',
                },
            }),
            bindGroupLayout: layout,
        };
    }

    private createDOFPipeline(): void {
        const layout = this.device.createBindGroupLayout({
            label: 'DOFBindGroupLayout',
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: 'uniform' },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'float' },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: 'unfilterable-float' },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    storageTexture: { format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat, access: 'write-only' },
                },
            ],
        });

        this.bindGroupLayouts.dof = layout;

        const pipelineLayout = this.device.createPipelineLayout({
            label: 'DOFPipelineLayout',
            bindGroupLayouts: [layout],
        });

        const shaderModule = this.device.createShaderModule({
            label: 'DOFShader',
            code: dofShader,
        });

        this.pipelines.dof = {
            pipeline: this.device.createComputePipeline({
                label: 'DOFPipeline',
                layout: pipelineLayout,
                compute: {
                    module: shaderModule,
                    entryPoint: 'main',
                },
            }),
            bindGroupLayout: layout,
        };
    }

    createBloomMips(width: number, height: number): void {
        this.destroyBloomMips();

        let currentWidth = Math.max(1, Math.floor(width / 2));
        let currentHeight = Math.max(1, Math.floor(height / 2));

        for (let i = 0; i < BLOOM_MIP_LEVELS; i++) {
            const texture = this.device.createTexture({
                label: `BloomMip_${i}`,
                size: [currentWidth, currentHeight],
                format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
                usage: TEXTURE_USAGE_STORAGE,
            });

            const view = texture.createView();
            this.bloomMipTextures.push({
                texture,
                view,
                width: currentWidth,
                height: currentHeight,
            });
            this.bloomMipViews.push(view);

            currentWidth = Math.max(1, Math.floor(currentWidth / 2));
            currentHeight = Math.max(1, Math.floor(currentHeight / 2));
        }
    }

    private destroyBloomMips(): void {
        for (const mip of this.bloomMipTextures) {
            mip.texture.destroy();
        }
        this.bloomMipTextures = [];
        this.bloomMipViews = [];
    }

    process(
        encoder: GPUCommandEncoder,
        inputView: GPUTextureView,
        outputView: GPUTextureView,
        camera: CameraParams,
        settings: RenderSettings
    ): void {
        if (!this.pipelinesCreated) {
            this.createPipelines();
        }

        this.currentSettings = settings;
        this.updateUniformBuffer(camera, settings);

        let currentHDRView = inputView;
        let dofTempTexture: GPUTexture | null = null;
        let dofTempView: GPUTextureView | null = null;

        if (settings.enableDOF && this.pipelines.dof) {
            dofTempTexture = this.device.createTexture({
                label: 'DOFTempTexture',
                size: [this.width, this.height],
                format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
                usage: TEXTURE_USAGE_STORAGE,
            });
            dofTempView = dofTempTexture.createView();

            this.dispatchDOF(encoder, currentHDRView, dofTempView);
            currentHDRView = dofTempView;
        }

        if (settings.enableBloom && this.pipelines.bloomDownsample && this.pipelines.bloomUpsample && this.pipelines.bloomApply) {
            const bloomCombined = this.device.createTexture({
                label: 'BloomCombined',
                size: [this.width, this.height],
                format: TEXTURE_FORMAT_RGBA16F as GPUTextureFormat,
                usage: TEXTURE_USAGE_STORAGE,
            });
            const bloomCombinedView = bloomCombined.createView();

            this.dispatchBloomDownsample(encoder, currentHDRView, settings);
            this.dispatchBloomUpsample(encoder);
            this.dispatchBloomApply(encoder, currentHDRView, bloomCombinedView, settings);

            this.dispatchTonemap(encoder, bloomCombinedView, outputView);

            bloomCombined.destroy();
        } else {
            this.dispatchTonemap(encoder, currentHDRView, outputView);
        }

        if (dofTempTexture) {
            dofTempTexture.destroy();
        }
    }

    private updateUniformBuffer(camera: CameraParams, settings: RenderSettings): void {
        if (!this.uniformBuffer) return;

        const data = new Float32Array(16);
        data[0] = settings.exposure;
        data[1] = settings.tonemapType;
        data[2] = settings.bloomThreshold;
        data[3] = settings.bloomIntensity;
        data[4] = camera.focalDistance;
        data[5] = camera.aperture;
        data[6] = camera.fov;
        data[7] = 16.0;
        data[8] = this.width;
        data[9] = this.height;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }

    private createUniformBuffer(values: Float32Array): GPUBuffer {
        const buffer = this.device.createBuffer({
            size: values.byteLength,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(buffer.getMappedRange()).set(values);
        buffer.unmap();
        return buffer;
    }

    private dispatchBloomDownsample(
        encoder: GPUCommandEncoder,
        inputView: GPUTextureView,
        settings: RenderSettings
    ): void {
        if (!this.pipelines.bloomDownsample || !this.bindGroupLayouts.bloom || !this.sampler) return;

        for (let i = 0; i < BLOOM_MIP_LEVELS; i++) {
            const srcView = i === 0 ? inputView : this.bloomMipViews[i - 1];
            const dstMip = this.bloomMipTextures[i];
            const srcWidth = i === 0 ? this.width : this.bloomMipTextures[i - 1].width;
            const srcHeight = i === 0 ? this.height : this.bloomMipTextures[i - 1].height;

            const downParams = new Float32Array(8);
            downParams[0] = settings.bloomThreshold;
            downParams[1] = settings.bloomIntensity;
            downParams[2] = srcWidth;
            downParams[3] = srcHeight;
            downParams[4] = dstMip.width;
            downParams[5] = dstMip.height;
            downParams[6] = i === 0 ? 1 : 0;

            const paramBuffer = this.createUniformBuffer(downParams);

            const bindGroup = this.device.createBindGroup({
                layout: this.bindGroupLayouts.bloom,
                entries: [
                    { binding: 0, resource: { buffer: paramBuffer } },
                    { binding: 1, resource: srcView },
                    { binding: 2, resource: this.bloomMipViews[i] },
                    { binding: 3, resource: this.sampler },
                    { binding: 4, resource: this.bloomMipViews[0] },
                ],
            });

            const pass = encoder.beginComputePass({ label: `BloomDownsample_${i}` });
            pass.setPipeline(this.pipelines.bloomDownsample.pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(dstMip.width / WORKGROUP_SIZE),
                Math.ceil(dstMip.height / WORKGROUP_SIZE)
            );
            pass.end();
        }
    }

    private dispatchBloomUpsample(encoder: GPUCommandEncoder): void {
        if (!this.pipelines.bloomUpsample || !this.bindGroupLayouts.bloom || !this.sampler) return;

        for (let i = BLOOM_MIP_LEVELS - 2; i >= 0; i--) {
            const srcSmall = this.bloomMipViews[i + 1];
            const dstMip = this.bloomMipTextures[i];
            const srcWidth = this.bloomMipTextures[i + 1].width;
            const srcHeight = this.bloomMipTextures[i + 1].height;

            const upParams = new Float32Array(8);
            upParams[0] = 0.5;
            upParams[1] = srcWidth;
            upParams[2] = srcHeight;
            upParams[3] = dstMip.width;
            upParams[4] = dstMip.height;

            const paramBuffer = this.createUniformBuffer(upParams);

            const bindGroup = this.device.createBindGroup({
                layout: this.bindGroupLayouts.bloom,
                entries: [
                    { binding: 0, resource: { buffer: paramBuffer } },
                    { binding: 1, resource: srcSmall },
                    { binding: 2, resource: this.bloomMipViews[i] },
                    { binding: 3, resource: this.sampler },
                    { binding: 4, resource: this.bloomMipViews[0] },
                ],
            });

            const pass = encoder.beginComputePass({ label: `BloomUpsample_${i}` });
            pass.setPipeline(this.pipelines.bloomUpsample.pipeline);
            pass.setBindGroup(0, bindGroup);
            pass.dispatchWorkgroups(
                Math.ceil(dstMip.width / WORKGROUP_SIZE),
                Math.ceil(dstMip.height / WORKGROUP_SIZE)
            );
            pass.end();
        }
    }

    private dispatchBloomApply(
        encoder: GPUCommandEncoder,
        inputView: GPUTextureView,
        outputView: GPUTextureView,
        settings: RenderSettings
    ): void {
        if (!this.pipelines.bloomApply || !this.bindGroupLayouts.bloom || !this.sampler) return;

        const applyParams = new Float32Array(4);
        applyParams[0] = settings.bloomIntensity;
        applyParams[1] = this.width;
        applyParams[2] = this.height;

        const paramBuffer = this.createUniformBuffer(applyParams);

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayouts.bloom,
            entries: [
                { binding: 0, resource: { buffer: paramBuffer } },
                { binding: 1, resource: inputView },
                { binding: 2, resource: outputView },
                { binding: 3, resource: this.sampler },
                { binding: 4, resource: this.bloomMipViews[0] },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'BloomApply' });
        pass.setPipeline(this.pipelines.bloomApply.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / WORKGROUP_SIZE),
            Math.ceil(this.height / WORKGROUP_SIZE)
        );
        pass.end();
    }

    private dispatchDOF(
        encoder: GPUCommandEncoder,
        inputView: GPUTextureView,
        outputView: GPUTextureView
    ): void {
        if (!this.pipelines.dof || !this.bindGroupLayouts.dof || !this.uniformBuffer) return;

        const depthTexture = this.device.createTexture({
            label: 'DOFPlaceholderDepth',
            size: [this.width, this.height],
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        const depthView = depthTexture.createView();

        const zeros = new Float32Array(this.width * this.height);
        this.device.queue.writeTexture(
            { texture: depthTexture },
            zeros,
            { bytesPerRow: this.width * 4, rowsPerImage: this.height },
            { width: this.width, height: this.height, depthOrArrayLayers: 1 }
        );

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayouts.dof,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: inputView },
                { binding: 2, resource: depthView },
                { binding: 3, resource: outputView },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'DOFPass' });
        pass.setPipeline(this.pipelines.dof.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / WORKGROUP_SIZE),
            Math.ceil(this.height / WORKGROUP_SIZE)
        );
        pass.end();

        depthTexture.destroy();
    }

    private dispatchTonemap(
        encoder: GPUCommandEncoder,
        inputView: GPUTextureView,
        outputView: GPUTextureView
    ): void {
        if (!this.pipelines.tonemap || !this.bindGroupLayouts.tonemap || !this.uniformBuffer) return;

        const bindGroup = this.device.createBindGroup({
            layout: this.bindGroupLayouts.tonemap,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: inputView },
                { binding: 2, resource: outputView },
            ],
        });

        const pass = encoder.beginComputePass({ label: 'TonemapPass' });
        pass.setPipeline(this.pipelines.tonemap.pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / WORKGROUP_SIZE),
            Math.ceil(this.height / WORKGROUP_SIZE)
        );
        pass.end();
    }

    resize(width: number, height: number): void {
        if (this.width === width && this.height === height) return;

        this.width = width;
        this.height = height;

        if (width > 0 && height > 0) {
            this.createBloomMips(width, height);
        }
    }

    destroy(): void {
        this.destroyBloomMips();

        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
            this.uniformBuffer = null;
        }

        this.sampler = null;

        this.pipelines = {
            tonemap: null,
            bloomDownsample: null,
            bloomUpsample: null,
            bloomApply: null,
            dof: null,
        };

        this.bindGroupLayouts = {
            tonemap: null,
            bloom: null,
            dof: null,
        };

        this.pipelinesCreated = false;
        this.width = 0;
        this.height = 0;
    }
}
