import { mat4, vec3 } from 'gl-matrix';
import { TriangleData, PBRMaterial, SceneData, LightData, TextureInfo, InstanceData, BVHNode, CameraParams, vec3 as Vec3, TRIANGLE_SIZE, BVH_NODE_SIZE, MATERIAL_SIZE, INSTANCE_SIZE, BUFFER_USAGE_STORAGE, BUFFER_USAGE_UNIFORM, LIGHT_SIZE } from '@/types';
import { MaterialSystem } from './MaterialSystem';
import { AnimationSystem } from './AnimationSystem';
import { GLTFLoader, LoadedGLTF } from './GLTFLoader';

export interface SceneBounds {
    min: Vec3;
    max: Vec3;
    center: Vec3;
    size: Vec3;
    radius: number;
}

export interface BVHBuildOptions {
    maxTrianglesPerLeaf?: number;
    sahBins?: number;
    enableSpatialSplits?: boolean;
}

export interface GPUResources {
    triangleBuffer: GPUBuffer | null;
    bvhBuffer: GPUBuffer | null;
    materialBuffer: GPUBuffer | null;
    instanceBuffer: GPUBuffer | null;
    lightBuffer: GPUBuffer | null;
    triangleCount: number;
    bvhNodeCount: number;
    materialCount: number;
    instanceCount: number;
    lightCount: number;
}

export interface DynamicObject {
    id: number;
    meshIndex: number;
    transform: mat4;
    inverseTransform: mat4;
    bounds: SceneBounds;
    isDeformable: boolean;
}

export class SceneManager {
    private device: GPUDevice | null = null;

    private triangles: TriangleData[] = [];
    private materials: PBRMaterial[] = [];
    private instances: InstanceData[] = [];
    private textures: TextureInfo[] = [];
    private lights: LightData[] = [];
    private bvhNodes: BVHNode[] = [];
    private dynamicObjects: DynamicObject[] = [];

    private materialSystem: MaterialSystem;
    private animationSystem: AnimationSystem | null = null;
    private gltfLoader: GLTFLoader;

    private bounds: SceneBounds | null = null;
    private environmentMap: number = -1;
    private gpuResources: GPUResources = {
        triangleBuffer: null,
        bvhBuffer: null,
        materialBuffer: null,
        instanceBuffer: null,
        lightBuffer: null,
        triangleCount: 0,
        bvhNodeCount: 0,
        materialCount: 0,
        instanceCount: 0,
        lightCount: 0,
    };

    private dirtyFlags = {
        triangles: false,
        materials: false,
        instances: false,
        lights: false,
        bvh: false,
    };

    constructor(device?: GPUDevice) {
        this.device = device || null;
        this.materialSystem = new MaterialSystem();
        this.gltfLoader = new GLTFLoader(device);
    }

    async loadGLTF(url: string): Promise<LoadedGLTF> {
        const loaded = await this.gltfLoader.load(url);
        return this.processLoadedGLTF(loaded);
    }

    async loadGLTFFromFiles(files: FileList | File[]): Promise<LoadedGLTF> {
        const loaded = await this.gltfLoader.loadFromFiles(files);
        return this.processLoadedGLTF(loaded);
    }

    private async processLoadedGLTF(loaded: LoadedGLTF): Promise<LoadedGLTF> {
        this.triangles = loaded.sceneData.triangles;
        this.materials = loaded.sceneData.materials;
        this.instances = loaded.sceneData.instances;
        this.textures = loaded.sceneData.textures;
        this.lights = loaded.sceneData.lights;
        this.environmentMap = loaded.sceneData.environmentMap;

        this.materialSystem.setMaterials(this.materials);

        const meshes = loaded.meshes.map(m => ({
            primitives: m.primitives.map(p => ({
                attributes: p.attributes,
                indices: p.indices,
                targets: p.targets,
            })),
            weights: m.weights,
        }));

        const nodes = loaded.nodes.map(n => ({
            localMatrix: n.localMatrix,
            worldMatrix: n.worldMatrix,
            children: n.children,
            parent: n.parent,
            mesh: n.mesh,
            skin: n.skin,
        }));

        this.animationSystem = new AnimationSystem(
            loaded.animations,
            loaded.skins,
            nodes as any,
            meshes as any
        );

        this.computeBounds();
        this.buildBVH();
        this.markAllDirty();
        this.uploadToGPU();

        return loaded;
    }

    setSceneData(sceneData: SceneData): void {
        this.triangles = sceneData.triangles;
        this.materials = sceneData.materials;
        this.instances = sceneData.instances;
        this.textures = sceneData.textures;
        this.lights = sceneData.lights;
        this.environmentMap = sceneData.environmentMap;

        this.materialSystem.setMaterials(this.materials);
        this.computeBounds();
        this.buildBVH();
        this.markAllDirty();
    }

    getSceneData(): SceneData {
        return {
            triangles: this.triangles,
            materials: this.materials,
            instances: this.instances,
            textures: this.textures,
            lights: this.lights,
            environmentMap: this.environmentMap,
        };
    }

    addTriangle(triangle: TriangleData): number {
        const index = this.triangles.length;
        this.triangles.push(triangle);
        this.dirtyFlags.triangles = true;
        this.dirtyFlags.bvh = true;
        this.computeBounds();
        return index;
    }

    addTriangles(triangles: TriangleData[]): number {
        const startIndex = this.triangles.length;
        this.triangles.push(...triangles);
        this.dirtyFlags.triangles = true;
        this.dirtyFlags.bvh = true;
        this.computeBounds();
        return startIndex;
    }

    removeTriangle(index: number): boolean {
        if (index < 0 || index >= this.triangles.length) return false;
        this.triangles.splice(index, 1);
        this.dirtyFlags.triangles = true;
        this.dirtyFlags.bvh = true;
        this.computeBounds();
        return true;
    }

    getTriangle(index: number): TriangleData | null {
        return this.triangles[index] ?? null;
    }

    getTriangleCount(): number {
        return this.triangles.length;
    }

    addMaterial(material: PBRMaterial): number {
        const index = this.materialSystem.addMaterial(material);
        this.materials = this.materialSystem.getMaterials();
        this.dirtyFlags.materials = true;
        return index;
    }

    updateMaterial(index: number, material: Partial<PBRMaterial>): boolean {
        const success = this.materialSystem.updateMaterial(index, material);
        if (success) {
            this.materials = this.materialSystem.getMaterials();
            this.dirtyFlags.materials = true;
        }
        return success;
    }

    getMaterial(index: number): PBRMaterial | null {
        return this.materialSystem.getMaterial(index);
    }

    getMaterialCount(): number {
        return this.materialSystem.getMaterialCount();
    }

    getMaterialSystem(): MaterialSystem {
        return this.materialSystem;
    }

    addInstance(transform: mat4, meshID: number, materialOffset: number = 0): number {
        const inverseTransform = mat4.create();
        mat4.invert(inverseTransform, transform);

        const instance: InstanceData = {
            transform,
            inverseTransform,
            meshID,
            materialOffset,
            flags: 0,
        };

        const index = this.instances.length;
        this.instances.push(instance);
        this.dirtyFlags.instances = true;
        return index;
    }

    updateInstanceTransform(index: number, transform: mat4): boolean {
        if (index < 0 || index >= this.instances.length) return false;

        const instance = this.instances[index];
        instance.transform = transform;
        mat4.invert(instance.inverseTransform, transform);

        this.dirtyFlags.instances = true;
        return true;
    }

    getInstance(index: number): InstanceData | null {
        return this.instances[index] ?? null;
    }

    getInstanceCount(): number {
        return this.instances.length;
    }

    addLight(light: LightData): number {
        const index = this.lights.length;
        this.lights.push(light);
        this.dirtyFlags.lights = true;
        return index;
    }

    updateLight(index: number, light: Partial<LightData>): boolean {
        if (index < 0 || index >= this.lights.length) return false;
        this.lights[index] = { ...this.lights[index], ...light };
        this.dirtyFlags.lights = true;
        return true;
    }

    removeLight(index: number): boolean {
        if (index < 0 || index >= this.lights.length) return false;
        this.lights.splice(index, 1);
        this.dirtyFlags.lights = true;
        return true;
    }

    getLight(index: number): LightData | null {
        return this.lights[index] ?? null;
    }

    getLightCount(): number {
        return this.lights.length;
    }

    collectLights(): LightData[] {
        return [...this.lights];
    }

    setEnvironmentMap(textureIndex: number): void {
        this.environmentMap = textureIndex;
    }

    getEnvironmentMap(): number {
        return this.environmentMap;
    }

    addTexture(texture: TextureInfo): number {
        const index = this.textures.length;
        this.textures.push(texture);
        return index;
    }

    getTexture(index: number): TextureInfo | null {
        return this.textures[index] ?? null;
    }

    getTextureCount(): number {
        return this.textures.length;
    }

    addDynamicObject(
        meshIndex: number,
        transform: mat4,
        isDeformable: boolean = false
    ): DynamicObject {
        const id = this.dynamicObjects.length;

        const bounds = this.computeMeshBounds(meshIndex, transform);
        const inverseTransform = mat4.create();
        mat4.invert(inverseTransform, transform);

        const obj: DynamicObject = {
            id,
            meshIndex,
            transform: mat4.clone(transform),
            inverseTransform,
            bounds,
            isDeformable,
        };

        this.dynamicObjects.push(obj);
        return obj;
    }

    updateDynamicObject(id: number, transform: mat4): boolean {
        const obj = this.dynamicObjects.find(o => o.id === id);
        if (!obj) return false;

        mat4.copy(obj.transform, transform);
        mat4.invert(obj.inverseTransform, transform);
        obj.bounds = this.computeMeshBounds(obj.meshIndex, transform);

        this.dirtyFlags.bvh = true;
        return true;
    }

    getDynamicObjects(): DynamicObject[] {
        return this.dynamicObjects;
    }

    updateDynamicScene(deltaTime: number): void {
        if (this.animationSystem) {
            this.animationSystem.update(deltaTime);
        }

        for (const obj of this.dynamicObjects) {
            if (obj.isDeformable && this.animationSystem) {
                this.updateDeformableObject(obj);
            }
        }

        if (this.dirtyFlags.bvh) {
            this.rebuildBVHForDynamicObjects();
        }

        this.uploadToGPU();
    }

    private updateDeformableObject(obj: DynamicObject): void {
        const mesh = this.animationSystem?.['meshes']?.[obj.meshIndex];
        if (!mesh) return;

        for (const primitive of mesh.primitives) {
            let positions = primitive.attributes.POSITION;
            if (!positions) continue;

            positions = this.animationSystem.applyMorphTargets(obj.meshIndex, positions);

            const joints = primitive.attributes.JOINTS_0;
            const weights = primitive.attributes.WEIGHTS_0;
            const skinIndex = this.findMeshSkin(obj.meshIndex);

            if (joints && weights && skinIndex >= 0 && this.animationSystem) {
                const jointIndices = new Uint8Array(joints.buffer, joints.byteOffset, joints.length);
                const skinWeights = new Float32Array(weights.buffer, weights.byteOffset, weights.length);
                positions = this.animationSystem.computeSkinning(
                    obj.meshIndex,
                    skinIndex,
                    positions,
                    jointIndices,
                    skinWeights
                );
            }

            obj.bounds = this.computeVertexBounds(positions, obj.transform);
        }
    }

    private findMeshSkin(meshIndex: number): number {
        const nodes = this.animationSystem?.['nodes'] ?? [];
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.mesh === meshIndex && node.skin !== undefined) {
                return node.skin;
            }
        }
        return -1;
    }

    private computeMeshBounds(meshIndex: number, transform: mat4): SceneBounds {
        const min: vec3 = [Infinity, Infinity, Infinity];
        const max: vec3 = [-Infinity, -Infinity, -Infinity];

        const mesh = this.animationSystem?.['meshes']?.[meshIndex];
        if (mesh) {
            for (const primitive of mesh.primitives) {
                const positions = primitive.attributes.POSITION;
                if (positions) {
                    for (let i = 0; i < positions.length; i += 3) {
                        const pos: vec3 = [positions[i], positions[i + 1], positions[i + 2]];
                        vec3.transformMat4(pos, pos, transform);

                        min[0] = Math.min(min[0], pos[0]);
                        min[1] = Math.min(min[1], pos[1]);
                        min[2] = Math.min(min[2], pos[2]);

                        max[0] = Math.max(max[0], pos[0]);
                        max[1] = Math.max(max[1], pos[1]);
                        max[2] = Math.max(max[2], pos[2]);
                    }
                }
            }
        }

        if (!isFinite(min[0])) {
            min[0] = min[1] = min[2] = -1;
            max[0] = max[1] = max[2] = 1;
        }

        const center: vec3 = [
            (min[0] + max[0]) * 0.5,
            (min[1] + max[1]) * 0.5,
            (min[2] + max[2]) * 0.5,
        ];

        const size: vec3 = [
            max[0] - min[0],
            max[1] - min[1],
            max[2] - min[2],
        ];

        const radius = Math.max(size[0], size[1], size[2]) * 0.5;

        return {
            min: { x: min[0], y: min[1], z: min[2] },
            max: { x: max[0], y: max[1], z: max[2] },
            center: { x: center[0], y: center[1], z: center[2] },
            size: { x: size[0], y: size[1], z: size[2] },
            radius,
        };
    }

    private computeVertexBounds(positions: Float32Array, transform: mat4): SceneBounds {
        const min: vec3 = [Infinity, Infinity, Infinity];
        const max: vec3 = [-Infinity, -Infinity, -Infinity];

        for (let i = 0; i < positions.length; i += 3) {
            const pos: vec3 = [positions[i], positions[i + 1], positions[i + 2]];
            vec3.transformMat4(pos, pos, transform);

            min[0] = Math.min(min[0], pos[0]);
            min[1] = Math.min(min[1], pos[1]);
            min[2] = Math.min(min[2], pos[2]);

            max[0] = Math.max(max[0], pos[0]);
            max[1] = Math.max(max[1], pos[1]);
            max[2] = Math.max(max[2], pos[2]);
        }

        const center: vec3 = [
            (min[0] + max[0]) * 0.5,
            (min[1] + max[1]) * 0.5,
            (min[2] + max[2]) * 0.5,
        ];

        const size: vec3 = [
            max[0] - min[0],
            max[1] - min[1],
            max[2] - min[2],
        ];

        const radius = Math.max(size[0], size[1], size[2]) * 0.5;

        return {
            min: { x: min[0], y: min[1], z: min[2] },
            max: { x: max[0], y: max[1], z: max[2] },
            center: { x: center[0], y: center[1], z: center[2] },
            size: { x: size[0], y: size[1], z: size[2] },
            radius,
        };
    }

    computeBounds(): SceneBounds {
        const min: vec3 = [Infinity, Infinity, Infinity];
        const max: vec3 = [-Infinity, -Infinity, -Infinity];

        for (const tri of this.triangles) {
            this.expandBounds(min, max, tri.v0);
            this.expandBounds(min, max, tri.v1);
            this.expandBounds(min, max, tri.v2);
        }

        for (const obj of this.dynamicObjects) {
            this.expandBounds(min, max, obj.bounds.min);
            this.expandBounds(min, max, obj.bounds.max);
        }

        if (!isFinite(min[0])) {
            min[0] = min[1] = min[2] = -10;
            max[0] = max[1] = max[2] = 10;
        }

        const center: vec3 = [
            (min[0] + max[0]) * 0.5,
            (min[1] + max[1]) * 0.5,
            (min[2] + max[2]) * 0.5,
        ];

        const size: vec3 = [
            max[0] - min[0],
            max[1] - min[1],
            max[2] - min[2],
        ];

        const radius = Math.max(size[0], size[1], size[2]) * 0.5;

        this.bounds = {
            min: { x: min[0], y: min[1], z: min[2] },
            max: { x: max[0], y: max[1], z: max[2] },
            center: { x: center[0], y: center[1], z: center[2] },
            size: { x: size[0], y: size[1], z: size[2] },
            radius,
        };

        return this.bounds;
    }

    private expandBounds(min: vec3, max: vec3, point: Vec3): void {
        min[0] = Math.min(min[0], point.x);
        min[1] = Math.min(min[1], point.y);
        min[2] = Math.min(min[2], point.z);

        max[0] = Math.max(max[0], point.x);
        max[1] = Math.max(max[1], point.y);
        max[2] = Math.max(max[2], point.z);
    }

    getBounds(): SceneBounds {
        return this.bounds ?? this.computeBounds();
    }

    buildBVH(options: BVHBuildOptions = {}): void {
        const { maxTrianglesPerLeaf = 4, sahBins = 8 } = options;

        this.bvhNodes = [];

        if (this.triangles.length === 0) {
            this.bvhNodes.push(this.createEmptyNode());
            return;
        }

        const triangleIndices = new Uint32Array(this.triangles.length);
        for (let i = 0; i < this.triangles.length; i++) {
            triangleIndices[i] = i;
        }

        const triangleCentroids = new Float32Array(this.triangles.length * 3);
        for (let i = 0; i < this.triangles.length; i++) {
            const tri = this.triangles[i];
            triangleCentroids[i * 3] = (tri.v0.x + tri.v1.x + tri.v2.x) / 3;
            triangleCentroids[i * 3 + 1] = (tri.v0.y + tri.v1.y + tri.v2.y) / 3;
            triangleCentroids[i * 3 + 2] = (tri.v0.z + tri.v1.z + tri.v2.z) / 3;
        }

        this.buildBVHRecursive(
            triangleIndices,
            triangleCentroids,
            0,
            this.triangles.length,
            0,
            maxTrianglesPerLeaf,
            sahBins
        );

        this.dirtyFlags.bvh = true;
    }

    private buildBVHRecursive(
        indices: Uint32Array,
        centroids: Float32Array,
        start: number,
        end: number,
        depth: number,
        maxTrianglesPerLeaf: number,
        sahBins: number
    ): number {
        const nodeIndex = this.bvhNodes.length;
        this.bvhNodes.push(this.createEmptyNode());

        const bounds = this.computeTriangleBounds(indices, start, end);
        this.bvhNodes[nodeIndex].boundsMin = bounds.min;
        this.bvhNodes[nodeIndex].boundsMax = bounds.max;

        const triangleCount = end - start;

        if (triangleCount <= maxTrianglesPerLeaf || depth > 32) {
            this.bvhNodes[nodeIndex].leftChild = 0;
            this.bvhNodes[nodeIndex].rightChild = 0;
            this.bvhNodes[nodeIndex].triangleCount = triangleCount;
            this.bvhNodes[nodeIndex].triangleStart = start;
            return nodeIndex;
        }

        const axis = this.selectSplitAxis(centroids, indices, start, end);
        const split = this.sahSplit(indices, centroids, start, end, axis, sahBins);

        if (split === start || split === end) {
            this.bvhNodes[nodeIndex].leftChild = 0;
            this.bvhNodes[nodeIndex].rightChild = 0;
            this.bvhNodes[nodeIndex].triangleCount = triangleCount;
            this.bvhNodes[nodeIndex].triangleStart = start;
            return nodeIndex;
        }

        const leftChild = this.buildBVHRecursive(
            indices, centroids, start, split, depth + 1, maxTrianglesPerLeaf, sahBins
        );
        const rightChild = this.buildBVHRecursive(
            indices, centroids, split, end, depth + 1, maxTrianglesPerLeaf, sahBins
        );

        this.bvhNodes[nodeIndex].leftChild = leftChild;
        this.bvhNodes[nodeIndex].rightChild = rightChild;
        this.bvhNodes[nodeIndex].triangleCount = 0;
        this.bvhNodes[nodeIndex].triangleStart = 0;

        return nodeIndex;
    }

    private createEmptyNode(): BVHNode {
        return {
            boundsMin: { x: 0, y: 0, z: 0 },
            boundsMax: { x: 0, y: 0, z: 0 },
            leftChild: 0,
            rightChild: 0,
            triangleCount: 0,
            triangleStart: 0,
        };
    }

    private computeTriangleBounds(indices: Uint32Array, start: number, end: number): { min: Vec3; max: Vec3 } {
        const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
        const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };

        for (let i = start; i < end; i++) {
            const tri = this.triangles[indices[i]];
            min.x = Math.min(min.x, tri.v0.x, tri.v1.x, tri.v2.x);
            min.y = Math.min(min.y, tri.v0.y, tri.v1.y, tri.v2.y);
            min.z = Math.min(min.z, tri.v0.z, tri.v1.z, tri.v2.z);
            max.x = Math.max(max.x, tri.v0.x, tri.v1.x, tri.v2.x);
            max.y = Math.max(max.y, tri.v0.y, tri.v1.y, tri.v2.y);
            max.z = Math.max(max.z, tri.v0.z, tri.v1.z, tri.v2.z);
        }

        return { min, max };
    }

    private selectSplitAxis(centroids: Float32Array, indices: Uint32Array, start: number, end: number): number {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (let i = start; i < end; i++) {
            const idx = indices[i] * 3;
            minX = Math.min(minX, centroids[idx]);
            maxX = Math.max(maxX, centroids[idx]);
            minY = Math.min(minY, centroids[idx + 1]);
            maxY = Math.max(maxY, centroids[idx + 1]);
            minZ = Math.min(minZ, centroids[idx + 2]);
            maxZ = Math.max(maxZ, centroids[idx + 2]);
        }

        const extentX = maxX - minX;
        const extentY = maxY - minY;
        const extentZ = maxZ - minZ;

        if (extentX >= extentY && extentX >= extentZ) return 0;
        if (extentY >= extentX && extentY >= extentZ) return 1;
        return 2;
    }

    private sahSplit(
        indices: Uint32Array,
        centroids: Float32Array,
        start: number,
        end: number,
        axis: number,
        bins: number
    ): number {
        const count = end - start;
        if (count < 4) return start + Math.floor(count / 2);

        let minVal = Infinity, maxVal = -Infinity;
        for (let i = start; i < end; i++) {
            const val = centroids[indices[i] * 3 + axis];
            minVal = Math.min(minVal, val);
            maxVal = Math.max(maxVal, val);
        }

        const range = maxVal - minVal;
        if (range < 1e-6) return start + Math.floor(count / 2);

        const binBounds = new Array(bins).fill(null).map(() => ({
            min: { x: Infinity, y: Infinity, z: Infinity } as Vec3,
            max: { x: -Infinity, y: -Infinity, z: -Infinity } as Vec3,
            count: 0,
        }));

        for (let i = start; i < end; i++) {
            const idx = indices[i];
            const val = centroids[idx * 3 + axis];
            const binIdx = Math.min(bins - 1, Math.floor((val - minVal) / range * bins));

            const tri = this.triangles[idx];
            const bin = binBounds[binIdx];

            bin.min.x = Math.min(bin.min.x, tri.v0.x, tri.v1.x, tri.v2.x);
            bin.min.y = Math.min(bin.min.y, tri.v0.y, tri.v1.y, tri.v2.y);
            bin.min.z = Math.min(bin.min.z, tri.v0.z, tri.v1.z, tri.v2.z);
            bin.max.x = Math.max(bin.max.x, tri.v0.x, tri.v1.x, tri.v2.x);
            bin.max.y = Math.max(bin.max.y, tri.v0.y, tri.v1.y, tri.v2.y);
            bin.max.z = Math.max(bin.max.z, tri.v0.z, tri.v1.z, tri.v2.z);
            bin.count++;
        }

        const leftSweep = binBounds.map(() => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, count: 0, area: 0 }));
        const rightSweep = binBounds.map(() => ({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, count: 0, area: 0 }));

        let leftMin = { x: Infinity, y: Infinity, z: Infinity };
        let leftMax = { x: -Infinity, y: -Infinity, z: -Infinity };
        let leftCount = 0;

        for (let i = 0; i < bins; i++) {
            leftMin.x = Math.min(leftMin.x, binBounds[i].min.x);
            leftMin.y = Math.min(leftMin.y, binBounds[i].min.y);
            leftMin.z = Math.min(leftMin.z, binBounds[i].min.z);
            leftMax.x = Math.max(leftMax.x, binBounds[i].max.x);
            leftMax.y = Math.max(leftMax.y, binBounds[i].max.y);
            leftMax.z = Math.max(leftMax.z, binBounds[i].max.z);
            leftCount += binBounds[i].count;

            leftSweep[i] = {
                min: { ...leftMin },
                max: { ...leftMax },
                count: leftCount,
                area: this.surfaceArea(leftMin, leftMax),
            };
        }

        let rightMin = { x: Infinity, y: Infinity, z: Infinity };
        let rightMax = { x: -Infinity, y: -Infinity, z: -Infinity };
        let rightCount = 0;

        for (let i = bins - 1; i >= 0; i--) {
            rightMin.x = Math.min(rightMin.x, binBounds[i].min.x);
            rightMin.y = Math.min(rightMin.y, binBounds[i].min.y);
            rightMin.z = Math.min(rightMin.z, binBounds[i].min.z);
            rightMax.x = Math.max(rightMax.x, binBounds[i].max.x);
            rightMax.y = Math.max(rightMax.y, binBounds[i].max.y);
            rightMax.z = Math.max(rightMax.z, binBounds[i].max.z);
            rightCount += binBounds[i].count;

            rightSweep[i] = {
                min: { ...rightMin },
                max: { ...rightMax },
                count: rightCount,
                area: this.surfaceArea(rightMin, rightMax),
            };
        }

        let bestCost = Infinity;
        let bestSplit = start;
        let leftSum = 0;

        for (let i = 0; i < bins - 1; i++) {
            leftSum += binBounds[i].count;
            const left = leftSweep[i];
            const right = rightSweep[i + 1];

            const cost = left.count * left.area + right.count * right.area;

            if (cost < bestCost && left.count > 0 && right.count > 0) {
                bestCost = cost;
                bestSplit = start + leftSum;
            }
        }

        return bestSplit;
    }

    private surfaceArea(min: Vec3, max: Vec3): number {
        const dx = max.x - min.x;
        const dy = max.y - min.y;
        const dz = max.z - min.z;
        return 2 * (dx * dy + dy * dz + dz * dx);
    }

    private rebuildBVHForDynamicObjects(): void {
        this.dirtyFlags.bvh = false;
    }

    getBVHNodes(): BVHNode[] {
        return this.bvhNodes;
    }

    getBVHNodeCount(): number {
        return this.bvhNodes.length;
    }

    uploadToGPU(): void {
        if (!this.device) return;

        if (this.dirtyFlags.triangles) {
            this.uploadTriangleBuffer();
            this.dirtyFlags.triangles = false;
        }

        if (this.dirtyFlags.materials) {
            this.uploadMaterialBuffer();
            this.dirtyFlags.materials = false;
        }

        if (this.dirtyFlags.instances) {
            this.uploadInstanceBuffer();
            this.dirtyFlags.instances = false;
        }

        if (this.dirtyFlags.lights) {
            this.uploadLightBuffer();
            this.dirtyFlags.lights = false;
        }

        if (this.dirtyFlags.bvh) {
            this.uploadBVHBuffer();
            this.dirtyFlags.bvh = false;
        }
    }

    private uploadTriangleBuffer(): void {
        if (!this.device) return;

        if (this.gpuResources.triangleBuffer) {
            this.gpuResources.triangleBuffer.destroy();
        }

        const size = this.triangles.length * TRIANGLE_SIZE;
        const buffer = this.device.createBuffer({
            size,
            usage: BUFFER_USAGE_STORAGE,
            mappedAtCreation: true,
        });

        const data = new Float32Array(buffer.getMappedRange());
        for (let i = 0; i < this.triangles.length; i++) {
            const tri = this.triangles[i];
            const offset = i * (TRIANGLE_SIZE / 4);

            data[offset + 0] = tri.v0.x;
            data[offset + 1] = tri.v0.y;
            data[offset + 2] = tri.v0.z;
            data[offset + 3] = 0;

            data[offset + 4] = tri.v1.x;
            data[offset + 5] = tri.v1.y;
            data[offset + 6] = tri.v1.z;
            data[offset + 7] = 0;

            data[offset + 8] = tri.v2.x;
            data[offset + 9] = tri.v2.y;
            data[offset + 10] = tri.v2.z;
            data[offset + 11] = 0;

            data[offset + 12] = tri.n0.x;
            data[offset + 13] = tri.n0.y;
            data[offset + 14] = tri.n0.z;
            data[offset + 15] = 0;

            data[offset + 16] = tri.n1.x;
            data[offset + 17] = tri.n1.y;
            data[offset + 18] = tri.n1.z;
            data[offset + 19] = 0;

            data[offset + 20] = tri.n2.x;
            data[offset + 21] = tri.n2.y;
            data[offset + 22] = tri.n2.z;
            data[offset + 23] = 0;

            data[offset + 24] = tri.uv0.x;
            data[offset + 25] = tri.uv0.y;
            data[offset + 26] = tri.uv1.x;
            data[offset + 27] = tri.uv1.y;
            data[offset + 28] = tri.uv2.x;
            data[offset + 29] = tri.uv2.y;

            const dataU32 = data as unknown as Uint32Array;
            dataU32[offset + 30] = tri.materialID | 0;
            data[offset + 31] = 0;
        }

        buffer.unmap();

        this.gpuResources.triangleBuffer = buffer;
        this.gpuResources.triangleCount = this.triangles.length;
    }

    private uploadMaterialBuffer(): void {
        if (!this.device) return;

        if (this.gpuResources.materialBuffer) {
            this.gpuResources.materialBuffer.destroy();
        }

        const data = this.materialSystem.getAllGPUData();
        const size = data.byteLength;

        const buffer = this.device.createBuffer({
            size,
            usage: BUFFER_USAGE_STORAGE,
            mappedAtCreation: true,
        });

        new Float32Array(buffer.getMappedRange()).set(data);
        buffer.unmap();

        this.gpuResources.materialBuffer = buffer;
        this.gpuResources.materialCount = this.materials.length;
    }

    private uploadInstanceBuffer(): void {
        if (!this.device) return;

        if (this.gpuResources.instanceBuffer) {
            this.gpuResources.instanceBuffer.destroy();
        }

        const size = this.instances.length * INSTANCE_SIZE;
        const buffer = this.device.createBuffer({
            size,
            usage: BUFFER_USAGE_STORAGE,
            mappedAtCreation: true,
        });

        const data = new Float32Array(buffer.getMappedRange());
        for (let i = 0; i < this.instances.length; i++) {
            const instance = this.instances[i];
            const offset = i * 40;

            for (let j = 0; j < 16; j++) {
                data[offset + j] = instance.transform[j];
            }
            for (let j = 0; j < 16; j++) {
                data[offset + 16 + j] = instance.inverseTransform[j];
            }

            data[offset + 32] = instance.meshID;
            data[offset + 33] = instance.materialOffset;
            data[offset + 34] = instance.flags;
        }

        buffer.unmap();

        this.gpuResources.instanceBuffer = buffer;
        this.gpuResources.instanceCount = this.instances.length;
    }

    private uploadLightBuffer(): void {
        if (!this.device) return;

        if (this.gpuResources.lightBuffer) {
            this.gpuResources.lightBuffer.destroy();
        }

        const lightCount = Math.max(1, this.lights.length);
        const size = lightCount * LIGHT_SIZE;
        const buffer = this.device.createBuffer({
            size,
            usage: BUFFER_USAGE_STORAGE,
            mappedAtCreation: true,
        });

        const data = new Float32Array(buffer.getMappedRange());
        const dataU32 = data as unknown as Uint32Array;
        for (let i = 0; i < this.lights.length; i++) {
            const light = this.lights[i];
            const offset = i * (LIGHT_SIZE / 4);

            dataU32[offset + 0] = light.type;
            dataU32[offset + 1] = 0;
            dataU32[offset + 2] = 0;
            dataU32[offset + 3] = 0;

            data[offset + 4] = light.position.x;
            data[offset + 5] = light.position.y;
            data[offset + 6] = light.position.z;
            data[offset + 7] = 0;

            data[offset + 8] = light.direction.x;
            data[offset + 9] = light.direction.y;
            data[offset + 10] = light.direction.z;
            data[offset + 11] = 0;

            data[offset + 12] = light.color.x;
            data[offset + 13] = light.color.y;
            data[offset + 14] = light.color.z;
            data[offset + 15] = light.intensity;

            data[offset + 16] = light.radius;
            data[offset + 17] = light.innerConeAngle;
            data[offset + 18] = light.outerConeAngle;
            data[offset + 19] = 0;
        }

        buffer.unmap();

        this.gpuResources.lightBuffer = buffer;
        this.gpuResources.lightCount = this.lights.length;
    }

    private uploadBVHBuffer(): void {
        if (!this.device || this.bvhNodes.length === 0) return;

        if (this.gpuResources.bvhBuffer) {
            this.gpuResources.bvhBuffer.destroy();
        }

        const size = this.bvhNodes.length * BVH_NODE_SIZE;
        const buffer = this.device.createBuffer({
            size,
            usage: BUFFER_USAGE_STORAGE,
            mappedAtCreation: true,
        });

        const data = new Float32Array(buffer.getMappedRange());
        const dataU32 = data as unknown as Uint32Array;
        for (let i = 0; i < this.bvhNodes.length; i++) {
            const node = this.bvhNodes[i];
            const offset = i * (BVH_NODE_SIZE / 4);

            data[offset + 0] = node.boundsMin.x;
            data[offset + 1] = node.boundsMin.y;
            data[offset + 2] = node.boundsMin.z;
            dataU32[offset + 3] = node.leftChild;

            data[offset + 4] = node.boundsMax.x;
            data[offset + 5] = node.boundsMax.y;
            data[offset + 6] = node.boundsMax.z;
            dataU32[offset + 7] = node.rightChild;

            dataU32[offset + 8] = node.triangleCount;
            dataU32[offset + 9] = node.triangleStart;
            dataU32[offset + 10] = 0;
            dataU32[offset + 11] = 0;
            dataU32[offset + 12] = 0;
            dataU32[offset + 13] = 0;
            dataU32[offset + 14] = 0;
            dataU32[offset + 15] = 0;
        }

        buffer.unmap();

        this.gpuResources.bvhBuffer = buffer;
        this.gpuResources.bvhNodeCount = this.bvhNodes.length;
    }

    getGPUResources(): GPUResources {
        return { ...this.gpuResources };
    }

    private markAllDirty(): void {
        this.dirtyFlags.triangles = true;
        this.dirtyFlags.materials = true;
        this.dirtyFlags.instances = true;
        this.dirtyFlags.lights = true;
        this.dirtyFlags.bvh = true;
    }

    getAnimationSystem(): AnimationSystem | null {
        return this.animationSystem;
    }

    setDevice(device: GPUDevice): void {
        this.device = device;
        this.gltfLoader.setDevice(device);
    }

    clear(): void {
        this.triangles = [];
        this.materials = [];
        this.instances = [];
        this.textures = [];
        this.lights = [];
        this.bvhNodes = [];
        this.dynamicObjects = [];
        this.bounds = null;
        this.environmentMap = -1;
        this.animationSystem = null;

        this.destroyGPUBuffers();
        this.materialSystem = new MaterialSystem();
    }

    private destroyGPUBuffers(): void {
        if (this.gpuResources.triangleBuffer) this.gpuResources.triangleBuffer.destroy();
        if (this.gpuResources.bvhBuffer) this.gpuResources.bvhBuffer.destroy();
        if (this.gpuResources.materialBuffer) this.gpuResources.materialBuffer.destroy();
        if (this.gpuResources.instanceBuffer) this.gpuResources.instanceBuffer.destroy();
        if (this.gpuResources.lightBuffer) this.gpuResources.lightBuffer.destroy();

        this.gpuResources = {
            triangleBuffer: null,
            bvhBuffer: null,
            materialBuffer: null,
            instanceBuffer: null,
            lightBuffer: null,
            triangleCount: 0,
            bvhNodeCount: 0,
            materialCount: 0,
            instanceCount: 0,
            lightCount: 0,
        };
    }

    getDefaultCamera(aspect: number): CameraParams {
        const bounds = this.getBounds();
        const distance = bounds.radius * 3;

        const position: Vec3 = {
            x: bounds.center.x,
            y: bounds.center.y,
            z: bounds.center.z + distance,
        };

        return {
            position,
            direction: { x: 0, y: 0, z: -1 },
            up: { x: 0, y: 1, z: 0 },
            fov: Math.PI / 3,
            aspect,
            near: 0.01,
            far: bounds.radius * 100,
            focalDistance: distance,
            aperture: 0,
        };
    }
}
