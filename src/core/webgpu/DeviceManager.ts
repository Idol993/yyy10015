export interface DeviceFeatures {
    timestampQuery: boolean;
    storageBufferBinding: boolean;
    float32Filterable: boolean;
    bgra8unormStorage: boolean;
    depth24unormStencil8: boolean;
    depth32floatStencil8: boolean;
    indirectFirstInstance: boolean;
    maxBindGroups: number;
    maxComputeWorkgroupSize: [number, number, number];
    maxStorageBufferBindingSize: number;
}

export type DeviceLostCallback = (info: GPUDeviceLostInfo) => void;
export type ErrorCallback = (event: GPUUncapturedErrorEvent) => void;

export class DeviceManager {
    private static instance: DeviceManager | null = null;
    private device: GPUDevice | null = null;
    private adapter: GPUAdapter | null = null;
    private features: DeviceFeatures | null = null;
    private deviceLostCallbacks: Set<DeviceLostCallback> = new Set();
    private errorCallbacks: Set<ErrorCallback> = new Set();
    private initializationPromise: Promise<GPUDevice> | null = null;
    private isDestroyed = false;

    private constructor() {}

    public static getInstance(): DeviceManager {
        if (!DeviceManager.instance) {
            DeviceManager.instance = new DeviceManager();
        }
        return DeviceManager.instance;
    }

    public async initialize(
        canvas?: HTMLCanvasElement,
        preferredFormat?: GPUTextureFormat
    ): Promise<GPUDevice> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.initInternal(canvas, preferredFormat);
        return this.initializationPromise;
    }

    private async initInternal(
        canvas?: HTMLCanvasElement,
        preferredFormat?: GPUTextureFormat
    ): Promise<GPUDevice> {
        if (!navigator.gpu) {
            throw new Error('WebGPU is not supported in this browser');
        }

        this.adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance',
            ...(canvas ? { canvas } : {})
        });

        if (!this.adapter) {
            throw new Error('No suitable GPU adapter found');
        }

        const optionalFeatures: GPUFeatureName[] = [
            'timestamp-query',
            'float32-filterable',
            'bgra8unorm-storage',
            'depth32float-stencil8',
            'indirect-first-instance'
        ];

        const availableFeatures: GPUFeatureName[] = [];
        for (const feature of optionalFeatures) {
            if (this.adapter.features.has(feature)) {
                availableFeatures.push(feature);
            }
        }

        const limits = this.adapter.limits;
        this.device = await this.adapter.requestDevice({
            label: 'PathTracerDevice',
            requiredFeatures: availableFeatures,
            requiredLimits: {
                maxBindGroups: Math.min(8, limits.maxBindGroups),
                maxComputeWorkgroupSizeX: Math.min(1024, limits.maxComputeWorkgroupSizeX),
                maxComputeWorkgroupSizeY: Math.min(1024, limits.maxComputeWorkgroupSizeY),
                maxComputeWorkgroupSizeZ: Math.min(64, limits.maxComputeWorkgroupSizeZ),
                maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
                maxBufferSize: limits.maxBufferSize,
                maxComputeInvocationsPerWorkgroup: Math.min(1024, limits.maxComputeInvocationsPerWorkgroup),
                maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension
            }
        });

        this.detectFeatures();
        this.setupDeviceLostHandler();
        this.setupErrorHandler();

        if (canvas && preferredFormat) {
            const context = canvas.getContext('webgpu');
            if (context) {
                context.configure({
                    device: this.device,
                    format: preferredFormat,
                    alphaMode: 'premultiplied'
                });
            }
        }

        return this.device;
    }

    private detectFeatures(): void {
        if (!this.device || !this.adapter) return;

        const limits = this.adapter.limits;

        this.features = {
            timestampQuery: this.device.features.has('timestamp-query'),
            storageBufferBinding: limits.maxStorageBufferBindingSize > 0,
            float32Filterable: this.device.features.has('float32-filterable'),
            bgra8unormStorage: this.device.features.has('bgra8unorm-storage'),
            depth24unormStencil8: false,
            depth32floatStencil8: this.device.features.has('depth32float-stencil8'),
            indirectFirstInstance: this.device.features.has('indirect-first-instance'),
            maxBindGroups: limits.maxBindGroups,
            maxComputeWorkgroupSize: [
                limits.maxComputeWorkgroupSizeX,
                limits.maxComputeWorkgroupSizeY,
                limits.maxComputeWorkgroupSizeZ
            ],
            maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize
        };
    }

    private setupDeviceLostHandler(): void {
        if (!this.device) return;

        this.device.lost.then((info) => {
            console.error(`Device lost: ${info.message}`);
            this.deviceLostCallbacks.forEach((cb) => cb(info));

            if (!this.isDestroyed && info.reason !== 'destroyed') {
                console.log('Attempting to recover device...');
                this.attemptRecovery();
            }
        });
    }

    private setupErrorHandler(): void {
        if (!this.device) return;

        this.device.addEventListener('uncapturederror', (event) => {
            console.error(`WebGPU error: ${event.error.message}`);
            this.errorCallbacks.forEach((cb) => cb(event));
        });

        this.device.pushErrorScope('validation');
        this.device.pushErrorScope('out-of-memory');
        this.device.pushErrorScope('internal');
    }

    private async attemptRecovery(): Promise<void> {
        this.device = null;
        this.adapter = null;
        this.features = null;
        this.initializationPromise = null;

        try {
            await this.initialize();
            console.log('Device recovered successfully');
        } catch (e) {
            console.error('Failed to recover device:', e);
        }
    }

    public getDevice(): GPUDevice {
        if (!this.device) {
            throw new Error('Device not initialized. Call initialize() first.');
        }
        return this.device;
    }

    public getAdapter(): GPUAdapter {
        if (!this.adapter) {
            throw new Error('Adapter not initialized. Call initialize() first.');
        }
        return this.adapter;
    }

    public getFeatures(): DeviceFeatures {
        if (!this.features) {
            throw new Error('Features not detected. Call initialize() first.');
        }
        return this.features;
    }

    public isInitialized(): boolean {
        return this.device !== null;
    }

    public addDeviceLostCallback(callback: DeviceLostCallback): void {
        this.deviceLostCallbacks.add(callback);
    }

    public removeDeviceLostCallback(callback: DeviceLostCallback): void {
        this.deviceLostCallbacks.delete(callback);
    }

    public addErrorCallback(callback: ErrorCallback): void {
        this.errorCallbacks.add(callback);
    }

    public removeErrorCallback(callback: ErrorCallback): void {
        this.errorCallbacks.delete(callback);
    }

    public async checkAsyncErrors(): Promise<GPUError | null> {
        if (!this.device) return null;

        const errors: GPUError[] = [];
        for (let i = 0; i < 3; i++) {
            const error = await this.device.popErrorScope();
            if (error) {
                errors.push(error);
            }
        }

        this.device.pushErrorScope('validation');
        this.device.pushErrorScope('out-of-memory');
        this.device.pushErrorScope('internal');

        return errors.length > 0 ? errors[0] : null;
    }

    public createCommandEncoder(label?: string): GPUCommandEncoder {
        return this.getDevice().createCommandEncoder({ label });
    }

    public createQuerySet(count: number, label?: string): GPUQuerySet {
        return this.getDevice().createQuerySet({
            label,
            type: 'timestamp',
            count
        });
    }

    public destroy(): void {
        this.isDestroyed = true;
        this.deviceLostCallbacks.clear();
        this.errorCallbacks.clear();
        if (this.device) {
            this.device.destroy();
            this.device = null;
        }
        this.adapter = null;
        this.features = null;
        this.initializationPromise = null;
        DeviceManager.instance = null;
    }
}
