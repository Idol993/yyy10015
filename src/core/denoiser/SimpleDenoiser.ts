import { TEXTURE_USAGE_STORAGE, BUFFER_USAGE_UNIFORM } from '@/types';

const COPY_SHADER = /* wgsl */ `
struct Uniforms {
    width: u32,
    height: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= u.width || y >= u.height) {
        return;
    }
    let color = textureLoad(inputTex, vec2<u32>(x, y), 0);
    textureStore(outputTex, vec2<u32>(x, y), color);
}
`;

const WORKGROUP_SIZE = 8;

export class SimpleDenoiser {
    private device: GPUDevice;
    private pipeline: GPUComputePipeline | null = null;
    private bindGroupLayout: GPUBindGroupLayout | null = null;
    private uniformBuffer: GPUBuffer | null = null;
    private width: number = 0;
    private height: number = 0;

    constructor(device: GPUDevice) {
        this.device = device;
    }

    private createPipeline(): void {
        if (this.pipeline) return;

        const device = this.device;

        this.bindGroupLayout = device.createBindGroupLayout({
            label: 'SimpleDenoiser-Copy-BGL',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
            ],
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [this.bindGroupLayout],
        });

        const shaderModule = device.createShaderModule({
            code: COPY_SHADER,
            label: 'SimpleDenoiser-Copy',
        });

        this.pipeline = device.createComputePipeline({
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: 'main' },
            label: 'SimpleDenoiser-Copy-Pipeline',
        });

        this.uniformBuffer = device.createBuffer({
            size: 16,
            usage: BUFFER_USAGE_UNIFORM,
            label: 'SimpleDenoiser-Uniform',
        });
    }

    public denoise(
        encoder: GPUCommandEncoder,
        colorView: GPUTextureView,
        outputView: GPUTextureView,
        _settings: { enableDenoiser?: boolean; normalView?: GPUTextureView; depthView?: GPUTextureView; motionView?: GPUTextureView },
    ): void {
        this.createPipeline();

        const device = this.device;

        const uniformData = new Uint32Array(4);
        uniformData[0] = this.width;
        uniformData[1] = this.height;
        device.queue.writeBuffer(this.uniformBuffer!, 0, uniformData);

        const bindGroup = device.createBindGroup({
            layout: this.bindGroupLayout!,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer! } },
                { binding: 1, resource: colorView },
                { binding: 2, resource: outputView },
            ],
            label: 'SimpleDenoiser-Copy-BG',
        });

        const pass = encoder.beginComputePass({ label: 'SimpleDenoiser-Copy' });
        pass.setPipeline(this.pipeline!);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.width / WORKGROUP_SIZE),
            Math.ceil(this.height / WORKGROUP_SIZE)
        );
        pass.end();
    }

    public resize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }

    public destroy(): void {
        if (this.uniformBuffer) this.uniformBuffer.destroy();
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.width = 0;
        this.height = 0;
    }
}
