export type ResourceAccess =
    | 'read'
    | 'write'
    | 'read-write';

export type ResourceStage =
    | 'vertex'
    | 'fragment'
    | 'compute'
    | 'copy'
    | 'transfer'
    | 'none';

export interface BufferState {
    buffer: GPUBuffer;
    currentStage: ResourceStage;
    currentAccess: ResourceAccess;
    lastUsage: number;
}

export interface TextureState {
    texture: GPUTexture;
    currentStage: ResourceStage;
    currentAccess: ResourceAccess;
    lastUsage: number;
    aspect?: GPUTextureAspect;
}

export interface BarrierOptions {
    srcStage?: GPUShaderStageFlags;
    dstStage?: GPUShaderStageFlags;
    offset?: number;
    size?: number;
}

export interface MemoryBarrier {
    srcAccess: GPUMapModeFlags | number;
    dstAccess: GPUMapModeFlags | number;
}

const STAGE_MAP: Record<ResourceStage, GPUShaderStageFlags> = {
    vertex: GPUShaderStage.VERTEX,
    fragment: GPUShaderStage.FRAGMENT,
    compute: GPUShaderStage.COMPUTE,
    copy: 0,
    transfer: 0,
    none: 0
};

export class ResourceBarrier {
    private static instance: ResourceBarrier | null = null;
    private bufferStates: Map<GPUBuffer, BufferState> = new Map();
    private textureStates: Map<GPUTexture, TextureState> = new Map();
    private frameCounter = 0;

    private constructor() {}

    public static getInstance(): ResourceBarrier {
        if (!ResourceBarrier.instance) {
            ResourceBarrier.instance = new ResourceBarrier();
        }
        return ResourceBarrier.instance;
    }

    private getShaderStageFlags(stage: ResourceStage): GPUShaderStageFlags {
        return STAGE_MAP[stage] || 0;
    }

    private getAccessFlags(access: ResourceAccess, isWrite: boolean): number {
        if (isWrite) {
            return 0x8;
        }
        switch (access) {
            case 'read':
                return 0x2;
            case 'write':
                return 0x8;
            case 'read-write':
                return 0x2 | 0x8;
            default:
                return 0;
        }
    }

    public registerBuffer(buffer: GPUBuffer): void {
        if (!this.bufferStates.has(buffer)) {
            this.bufferStates.set(buffer, {
                buffer,
                currentStage: 'none',
                currentAccess: 'read',
                lastUsage: this.frameCounter
            });
        }
    }

    public registerTexture(texture: GPUTexture): void {
        if (!this.textureStates.has(texture)) {
            this.textureStates.set(texture, {
                texture,
                currentStage: 'none',
                currentAccess: 'read',
                lastUsage: this.frameCounter
            });
        }
    }

    public unregisterBuffer(buffer: GPUBuffer): void {
        this.bufferStates.delete(buffer);
    }

    public unregisterTexture(texture: GPUTexture): void {
        this.textureStates.delete(texture);
    }

    public transitionBuffer(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer,
        targetStage: ResourceStage,
        targetAccess: ResourceAccess,
        options: BarrierOptions = {}
    ): void {
        this.registerBuffer(buffer);
        const state = this.bufferStates.get(buffer)!;

        if (state.currentStage === targetStage &&
            state.currentAccess === targetAccess) {
            state.lastUsage = this.frameCounter;
            return;
        }

        const srcStage = options.srcStage || this.getShaderStageFlags(state.currentStage);
        const dstStage = options.dstStage || this.getShaderStageFlags(targetStage);

        const needsBarrier = this.needsBarrier(
            state.currentStage,
            state.currentAccess,
            targetStage,
            targetAccess
        );

        if (needsBarrier) {
            this.insertBufferMemoryBarrier(
                encoder,
                buffer,
                srcStage,
                dstStage,
                state.currentAccess,
                targetAccess,
                options
            );
        }

        state.currentStage = targetStage;
        state.currentAccess = targetAccess;
        state.lastUsage = this.frameCounter;
    }

    public transitionTexture(
        encoder: GPUCommandEncoder,
        texture: GPUTexture,
        targetStage: ResourceStage,
        targetAccess: ResourceAccess,
        options: BarrierOptions & { aspect?: GPUTextureAspect } = {}
    ): void {
        this.registerTexture(texture);
        const state = this.textureStates.get(texture)!;

        if (state.currentStage === targetStage &&
            state.currentAccess === targetAccess) {
            state.lastUsage = this.frameCounter;
            return;
        }

        const srcStage = options.srcStage || this.getShaderStageFlags(state.currentStage);
        const dstStage = options.dstStage || this.getShaderStageFlags(targetStage);

        const needsBarrier = this.needsBarrier(
            state.currentStage,
            state.currentAccess,
            targetStage,
            targetAccess
        );

        if (needsBarrier) {
            this.insertTextureMemoryBarrier(
                encoder,
                texture,
                srcStage,
                dstStage,
                state.currentAccess,
                targetAccess,
                options
            );
        }

        state.currentStage = targetStage;
        state.currentAccess = targetAccess;
        state.lastUsage = this.frameCounter;
        if (options.aspect) {
            state.aspect = options.aspect;
        }
    }

    private needsBarrier(
        srcStage: ResourceStage,
        srcAccess: ResourceAccess,
        dstStage: ResourceStage,
        dstAccess: ResourceAccess
    ): boolean {
        if (srcStage === 'none' || dstStage === 'none') {
            return false;
        }

        if (srcAccess === 'read' && dstAccess === 'read') {
            return false;
        }

        return true;
    }

    private insertBufferMemoryBarrier(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer,
        srcStage: GPUShaderStageFlags,
        dstStage: GPUShaderStageFlags,
        srcAccess: ResourceAccess,
        dstAccess: ResourceAccess,
        options: BarrierOptions
    ): void {
        const srcAccessFlags = this.getAccessFlags(srcAccess, false);
        const dstAccessFlags = this.getAccessFlags(dstAccess, true);

        if (srcStage === 0 && dstStage === 0) {
            return;
        }
    }

    private insertTextureMemoryBarrier(
        encoder: GPUCommandEncoder,
        texture: GPUTexture,
        srcStage: GPUShaderStageFlags,
        dstStage: GPUShaderStageFlags,
        srcAccess: ResourceAccess,
        dstAccess: ResourceAccess,
        options: BarrierOptions & { aspect?: GPUTextureAspect }
    ): void {
        if (srcStage === 0 && dstStage === 0) {
            return;
        }
    }

    public memoryBarrier(
        encoder: GPUCommandEncoder,
        srcStage: GPUShaderStageFlags,
        dstStage: GPUShaderStageFlags,
        barrier: MemoryBarrier
    ): void {
        if (srcStage === 0 && dstStage === 0) {
            return;
        }
    }

    public bufferMemoryBarrier(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer,
        srcStage: GPUShaderStageFlags,
        dstStage: GPUShaderStageFlags,
        srcAccess: number,
        dstAccess: number,
        offset = 0,
        size?: number
    ): void {
        this.registerBuffer(buffer);
    }

    public textureMemoryBarrier(
        encoder: GPUCommandEncoder,
        texture: GPUTexture,
        srcStage: GPUShaderStageFlags,
        dstStage: GPUShaderStageFlags,
        srcAccess: number,
        dstAccess: number,
        baseMipLevel = 0,
        mipLevelCount?: number,
        baseArrayLayer = 0,
        arrayLayerCount?: number,
        aspect: GPUTextureAspect = 'all'
    ): void {
        this.registerTexture(texture);
    }

    public transitionBufferForComputeRead(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer
    ): void {
        this.transitionBuffer(encoder, buffer, 'compute', 'read');
    }

    public transitionBufferForComputeWrite(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer
    ): void {
        this.transitionBuffer(encoder, buffer, 'compute', 'write');
    }

    public transitionBufferForCopySrc(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer
    ): void {
        this.transitionBuffer(encoder, buffer, 'transfer', 'read');
    }

    public transitionBufferForCopyDst(
        encoder: GPUCommandEncoder,
        buffer: GPUBuffer
    ): void {
        this.transitionBuffer(encoder, buffer, 'transfer', 'write');
    }

    public transitionTextureForShaderRead(
        encoder: GPUCommandEncoder,
        texture: GPUTexture,
        stage: ResourceStage = 'fragment'
    ): void {
        this.transitionTexture(encoder, texture, stage, 'read');
    }

    public transitionTextureForStorageWrite(
        encoder: GPUCommandEncoder,
        texture: GPUTexture,
        stage: ResourceStage = 'compute'
    ): void {
        this.transitionTexture(encoder, texture, stage, 'write');
    }

    public transitionTextureForCopySrc(
        encoder: GPUCommandEncoder,
        texture: GPUTexture
    ): void {
        this.transitionTexture(encoder, texture, 'transfer', 'read');
    }

    public transitionTextureForCopyDst(
        encoder: GPUCommandEncoder,
        texture: GPUTexture
    ): void {
        this.transitionTexture(encoder, texture, 'transfer', 'write');
    }

    public getBufferState(buffer: GPUBuffer): BufferState | undefined {
        return this.bufferStates.get(buffer);
    }

    public getTextureState(texture: GPUTexture): TextureState | undefined {
        return this.textureStates.get(texture);
    }

    public beginFrame(): void {
        this.frameCounter++;
    }

    public cleanupStaleResources(maxAgeFrames = 100): void {
        const staleBuffers: GPUBuffer[] = [];
        for (const [buffer, state] of this.bufferStates) {
            if (this.frameCounter - state.lastUsage > maxAgeFrames) {
                staleBuffers.push(buffer);
            }
        }
        for (const buffer of staleBuffers) {
            this.bufferStates.delete(buffer);
        }

        const staleTextures: GPUTexture[] = [];
        for (const [texture, state] of this.textureStates) {
            if (this.frameCounter - state.lastUsage > maxAgeFrames) {
                staleTextures.push(texture);
            }
        }
        for (const texture of staleTextures) {
            this.textureStates.delete(texture);
        }
    }

    public clearAll(): void {
        this.bufferStates.clear();
        this.textureStates.clear();
    }

    public resetResourceState(buffer: GPUBuffer): void;
    public resetResourceState(texture: GPUTexture): void;
    public resetResourceState(resource: GPUBuffer | GPUTexture): void {
        if ('mapState' in resource) {
            this.bufferStates.delete(resource as GPUBuffer);
        } else {
            this.textureStates.delete(resource as GPUTexture);
        }
    }

    public getStats(): {
        trackedBuffers: number;
        trackedTextures: number;
        currentFrame: number;
    } {
        return {
            trackedBuffers: this.bufferStates.size,
            trackedTextures: this.textureStates.size,
            currentFrame: this.frameCounter
        };
    }

    public destroy(): void {
        this.clearAll();
        ResourceBarrier.instance = null;
    }
}
