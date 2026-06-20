import { mat4, vec3, vec2, quat } from 'gl-matrix';
import { TriangleData, PBRMaterial, SceneData, LightData, TextureInfo, InstanceData, ALPHA_MODE_OPAQUE, ALPHA_MODE_MASK, ALPHA_MODE_BLEND, LIGHT_TYPE_DIRECTIONAL, LIGHT_TYPE_POINT, LIGHT_TYPE_SPOT, MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE, MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE, MATERIAL_FLAG_HAS_NORMAL_TEXTURE, MATERIAL_FLAG_HAS_OCCLUSION_TEXTURE, MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE, MATERIAL_FLAG_HAS_CLEARCOAT_TEXTURE, MATERIAL_FLAG_TRANSMISSION, MATERIAL_FLAG_DOUBLE_SIDED, TEXTURE_FORMAT_RGBA8, TEXTURE_USAGE_SAMPLED, vec3 as Vec3 } from '@/types';

interface GLTFProperty {
    extensions?: Record<string, unknown>;
    extras?: unknown;
}

interface GLTFBufferView extends GLTFProperty {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
}

interface GLTFAccessor extends GLTFProperty {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
    sparse?: {
        count: number;
        indices: { bufferView: number; byteOffset?: number; componentType: number };
        values: { bufferView: number; byteOffset?: number };
    };
}

interface GLTFNode extends GLTFProperty {
    name?: string;
    children?: number[];
    matrix?: number[];
    mesh?: number;
    skin?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    camera?: number;
    extensions?: {
        KHR_lights_punctual?: { light: number };
    };
}

interface GLTFMesh extends GLTFProperty {
    name?: string;
    primitives: GLTFPrimitive[];
    weights?: number[];
}

interface GLTFPrimitive {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
    targets?: Record<string, number>[];
    extensions?: Record<string, unknown>;
}

interface GLTFMaterial extends GLTFProperty {
    name?: string;
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: boolean;
    pbrMetallicRoughness?: GLTFPBRMetallicRoughness;
    normalTexture?: GLTFTextureInfo;
    occlusionTexture?: GLTFTextureInfo;
    emissiveTexture?: GLTFTextureInfo;
    emissiveFactor?: number[];
    extensions?: {
        KHR_materials_clearcoat?: GLTFClearcoat;
        KHR_materials_transmission?: GLTFTransmission;
    };
}

interface GLTFPBRMetallicRoughness {
    baseColorFactor?: number[];
    baseColorTexture?: GLTFTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GLTFTextureInfo;
}

interface GLTFTextureInfo {
    index: number;
    texCoord?: number;
    strength?: number;
    extensions?: {
        KHR_texture_transform?: GLTFTextureTransform;
    };
}

interface GLTFTextureTransform {
    offset?: number[];
    rotation?: number;
    scale?: number[];
    texCoord?: number;
}

interface GLTFClearcoat {
    clearcoatFactor?: number;
    clearcoatTexture?: GLTFTextureInfo;
    clearcoatRoughnessFactor?: number;
    clearcoatRoughnessTexture?: GLTFTextureInfo;
    clearcoatNormalTexture?: GLTFTextureInfo;
}

interface GLTFTransmission {
    transmissionFactor?: number;
    transmissionTexture?: GLTFTextureInfo;
}

interface GLTFTexture extends GLTFProperty {
    sampler?: number;
    source?: number;
    name?: string;
}

interface GLTFSampler extends GLTFProperty {
    magFilter?: number;
    minFilter?: number;
    wrapS?: number;
    wrapT?: number;
    name?: string;
}

interface GLTFImage extends GLTFProperty {
    uri?: string;
    mimeType?: string;
    bufferView?: number;
    name?: string;
}

interface GLTFSkin extends GLTFProperty {
    inverseBindMatrices?: number;
    skeleton?: number;
    joints: number[];
    name?: string;
}

interface GLTFAnimation extends GLTFProperty {
    name?: string;
    channels: GLTFAnimationChannel[];
    samplers: GLTFAnimationSampler[];
}

interface GLTFAnimationChannel {
    sampler: number;
    target: {
        node: number;
        path: 'translation' | 'rotation' | 'scale' | 'weights';
    };
}

interface GLTFAnimationSampler {
    input: number;
    interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    output: number;
}

interface GLTFCamera extends GLTFProperty {
    name?: string;
    type: 'perspective' | 'orthographic';
    perspective?: {
        aspectRatio?: number;
        yfov: number;
        znear: number;
        zfar?: number;
    };
    orthographic?: {
        xmag: number;
        ymag: number;
        znear: number;
        zfar: number;
    };
}

interface GLTFLight extends GLTFProperty {
    name?: string;
    type: 'directional' | 'point' | 'spot';
    color?: number[];
    intensity?: number;
    range?: number;
    spot?: {
        innerConeAngle?: number;
        outerConeAngle?: number;
    };
}

interface GLTF extends GLTFProperty {
    asset: {
        version: string;
        generator?: string;
    };
    scene?: number;
    scenes?: { name?: string; nodes?: number[] }[];
    nodes?: GLTFNode[];
    meshes?: GLTFMesh[];
    materials?: GLTFMaterial[];
    textures?: GLTFTexture[];
    samplers?: GLTFSampler[];
    images?: GLTFImage[];
    accessors?: GLTFAccessor[];
    bufferViews?: GLTFBufferView[];
    buffers?: { uri?: string; byteLength: number }[];
    skins?: GLTFSkin[];
    animations?: GLTFAnimation[];
    cameras?: GLTFCamera[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    extensions?: {
        KHR_lights_punctual?: { lights: GLTFLight[] };
    };
}

interface ParsedNode {
    index: number;
    name: string;
    parent: number;
    children: number[];
    localMatrix: mat4;
    worldMatrix: mat4;
    mesh?: number;
    skin?: number;
    camera?: number;
    light?: number;
}

interface ParsedMesh {
    index: number;
    name: string;
    primitives: ParsedPrimitive[];
    weights: number[];
}

interface ParsedPrimitive {
    attributes: Record<string, Float32Array>;
    indices: Uint32Array;
    material: number;
    mode: number;
    targets: Record<string, Float32Array>[];
}

export interface LoadedGLTF {
    sceneData: SceneData;
    nodes: ParsedNode[];
    meshes: ParsedMesh[];
    rootNodes: number[];
    animations: AnimationData[];
    skins: SkinData[];
    cameras: CameraData[];
}

export interface AnimationData {
    name: string;
    samplers: AnimationSampler[];
    channels: AnimationChannel[];
    duration: number;
}

export interface AnimationSampler {
    input: Float32Array;
    output: Float32Array;
    interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export interface AnimationChannel {
    samplerIndex: number;
    targetNode: number;
    targetPath: 'translation' | 'rotation' | 'scale' | 'weights';
}

export interface SkinData {
    joints: number[];
    inverseBindMatrices: mat4[];
    skeleton?: number;
}

export interface CameraData {
    type: 'perspective' | 'orthographic';
    position: Vec3;
    target: Vec3;
    up: Vec3;
    fov?: number;
    aspect?: number;
    near: number;
    far: number;
}

const ACCESSOR_TYPE_SIZES: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT2: 4,
    MAT3: 9,
    MAT4: 16,
};

const COMPONENT_TYPE_SIZES: Record<number, number> = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
};

export class GLTFLoader {
    private device: GPUDevice | null = null;
    private buffers: ArrayBuffer[] = [];
    private gltf: GLTF | null = null;
    private binaryData: ArrayBuffer | null = null;

    constructor(device?: GPUDevice) {
        this.device = device || null;
    }

    async load(url: string): Promise<LoadedGLTF> {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (this.isGLB(arrayBuffer)) {
            return this.parseGLB(arrayBuffer);
        } else {
            const jsonStr = new TextDecoder('utf-8').decode(arrayBuffer);
            this.gltf = JSON.parse(jsonStr);
            await this.loadBuffers(url);
            return this.parse();
        }
    }

    async loadFromData(json: GLTF, buffers: ArrayBuffer[]): Promise<LoadedGLTF> {
        this.gltf = json;
        this.buffers = buffers;
        return this.parse();
    }

    private isGLB(buffer: ArrayBuffer): boolean {
        const magic = new Uint32Array(buffer, 0, 1)[0];
        return magic === 0x46546C67;
    }

    private async parseGLB(buffer: ArrayBuffer): Promise<LoadedGLTF> {
        const header = new Uint32Array(buffer, 0, 3);
        const length = header[1];
        const version = header[2];

        if (version !== 2) {
            throw new Error(`Unsupported glTF version: ${version}`);
        }

        let offset = 12;
        let jsonStr = '';
        let binaryChunk: ArrayBuffer | null = null;

        while (offset < length) {
            const chunkHeader = new Uint32Array(buffer, offset, 2);
            const chunkLength = chunkHeader[0];
            const chunkType = chunkHeader[1];
            const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);

            if (chunkType === 0x4E4F534A) {
                jsonStr = new TextDecoder('utf-8').decode(chunkData);
            } else if (chunkType === 0x004E4942) {
                binaryChunk = chunkData;
            }

            offset += 8 + chunkLength;
        }

        this.gltf = JSON.parse(jsonStr);
        this.binaryData = binaryChunk;

        if (this.gltf.buffers && this.gltf.buffers.length > 0) {
            if (binaryChunk && !this.gltf.buffers[0].uri) {
                this.buffers[0] = binaryChunk;
            }
        }

        const baseUrl = '';
        await this.loadBuffers(baseUrl);

        return this.parse();
    }

    private async loadBuffers(baseUrl: string): Promise<void> {
        if (!this.gltf?.buffers) return;

        for (let i = 0; i < this.gltf.buffers.length; i++) {
            const buffer = this.gltf.buffers[i];
            if (buffer.uri && !this.buffers[i]) {
                if (buffer.uri.startsWith('data:')) {
                    const response = await fetch(buffer.uri);
                    this.buffers[i] = await response.arrayBuffer();
                } else {
                    const url = baseUrl ? new URL(buffer.uri, baseUrl).href : buffer.uri;
                    const response = await fetch(url);
                    this.buffers[i] = await response.arrayBuffer();
                }
            }
        }
    }

    private parse(): LoadedGLTF {
        if (!this.gltf) throw new Error('No glTF data loaded');

        const nodes = this.parseNodes();
        const meshes = this.parseMeshes();
        const materials = this.parseMaterials();
        const textures = this.parseTextures();
        const animations = this.parseAnimations();
        const skins = this.parseSkins();
        const cameras = this.parseCameras(nodes);
        const lights = this.parseLights(nodes);

        const triangles: TriangleData[] = [];
        const instances: InstanceData[] = [];

        this.buildSceneGraph(nodes, meshes, materials, triangles, instances);

        const sceneData: SceneData = {
            triangles,
            materials,
            instances,
            textures,
            lights,
            environmentMap: -1,
        };

        const sceneIndex = this.gltf.scene ?? 0;
        const rootNodes = this.gltf.scenes?.[sceneIndex]?.nodes ?? [];

        return {
            sceneData,
            nodes,
            meshes,
            rootNodes,
            animations,
            skins,
            cameras,
        };
    }

    private parseNodes(): ParsedNode[] {
        if (!this.gltf?.nodes) return [];

        const nodes: ParsedNode[] = [];
        const nodeMap = new Map<number, number>();

        for (let i = 0; i < this.gltf.nodes.length; i++) {
            const gltfNode = this.gltf.nodes[i];
            const localMatrix = this.computeLocalMatrix(gltfNode);
            const worldMatrix = mat4.create();

            nodes.push({
                index: i,
                name: gltfNode.name ?? `node_${i}`,
                parent: -1,
                children: gltfNode.children ?? [],
                localMatrix,
                worldMatrix,
                mesh: gltfNode.mesh,
                skin: gltfNode.skin,
                camera: gltfNode.camera,
                light: gltfNode.extensions?.KHR_lights_punctual?.light,
            });

            nodeMap.set(i, i);
        }

        for (let i = 0; i < nodes.length; i++) {
            for (const childIdx of nodes[i].children) {
                if (nodes[childIdx]) {
                    nodes[childIdx].parent = i;
                }
            }
        }

        this.computeWorldMatrices(nodes);

        return nodes;
    }

    private computeLocalMatrix(node: GLTFNode): mat4 {
        if (node.matrix) {
            return mat4.clone(new Float32Array(node.matrix) as mat4);
        }

        const matrix = mat4.create();
        const translation = node.translation ? new Float32Array(node.translation) : [0, 0, 0];
        const rotation = node.rotation ? new Float32Array(node.rotation) : [0, 0, 0, 1];
        const scale = node.scale ? new Float32Array(node.scale) : [1, 1, 1];

        mat4.fromRotationTranslationScale(
            matrix,
            rotation as quat,
            translation as vec3,
            scale as vec3
        );

        return matrix;
    }

    private computeWorldMatrices(nodes: ParsedNode[]): void {
        const visited = new Set<number>();

        const traverse = (index: number, parentMatrix: mat4) => {
            if (visited.has(index)) return;
            visited.add(index);

            const node = nodes[index];
            mat4.multiply(node.worldMatrix, parentMatrix, node.localMatrix);

            for (const childIdx of node.children) {
                traverse(childIdx, node.worldMatrix);
            }
        };

        const rootNodes = nodes.filter(n => n.parent === -1);
        for (const root of rootNodes) {
            const identity = mat4.create();
            traverse(root.index, identity);
        }
    }

    private parseMeshes(): ParsedMesh[] {
        if (!this.gltf?.meshes) return [];

        const meshes: ParsedMesh[] = [];

        for (let i = 0; i < this.gltf.meshes.length; i++) {
            const gltfMesh = this.gltf.meshes[i];
            const primitives: ParsedPrimitive[] = [];

            for (const primitive of gltfMesh.primitives) {
                const parsedPrimitive = this.parsePrimitive(primitive);
                if (parsedPrimitive) {
                    primitives.push(parsedPrimitive);
                }
            }

            meshes.push({
                index: i,
                name: gltfMesh.name ?? `mesh_${i}`,
                primitives,
                weights: gltfMesh.weights ?? [],
            });
        }

        return meshes;
    }

    private parsePrimitive(primitive: GLTFPrimitive): ParsedPrimitive | null {
        const attributes: Record<string, Float32Array> = {};
        const targets: Record<string, Float32Array>[] = [];

        for (const [name, accessorIdx] of Object.entries(primitive.attributes)) {
            const data = this.readAccessor(accessorIdx);
            if (data) {
                attributes[name] = data as Float32Array;
            }
        }

        if (!attributes.POSITION) {
            console.warn('Primitive without POSITION attribute, skipping');
            return null;
        }

        let indices: Uint32Array;
        if (primitive.indices !== undefined) {
            const indexData = this.readAccessor(primitive.indices);
            if (indexData) {
                if (indexData instanceof Uint16Array) {
                    indices = new Uint32Array(indexData);
                } else if (indexData instanceof Uint32Array) {
                    indices = indexData;
                } else {
                    const srcArray = new Uint32Array(indexData.buffer, indexData.byteOffset, indexData.byteLength / 4);
                    indices = new Uint32Array(srcArray);
                }
            } else {
                const vertexCount = attributes.POSITION.length / 3;
                indices = new Uint32Array(vertexCount);
                for (let i = 0; i < vertexCount; i++) indices[i] = i;
            }
        } else {
            const vertexCount = attributes.POSITION.length / 3;
            indices = new Uint32Array(vertexCount);
            for (let i = 0; i < vertexCount; i++) indices[i] = i;
        }

        if (primitive.targets) {
            for (const target of primitive.targets) {
                const targetAttrs: Record<string, Float32Array> = {};
                for (const [name, accessorIdx] of Object.entries(target)) {
                    const data = this.readAccessor(accessorIdx);
                    if (data) {
                        targetAttrs[name] = data as Float32Array;
                    }
                }
                targets.push(targetAttrs);
            }
        }

        return {
            attributes,
            indices,
            material: primitive.material ?? 0,
            mode: primitive.mode ?? 4,
            targets,
        };
    }

    private readAccessor(accessorIdx: number): ArrayBufferView | null {
        if (!this.gltf?.accessors) return null;

        const accessor = this.gltf.accessors[accessorIdx];
        if (!accessor) return null;

        const componentSize = COMPONENT_TYPE_SIZES[accessor.componentType];
        const typeSize = ACCESSOR_TYPE_SIZES[accessor.type];
        const elementSize = componentSize * typeSize;
        const count = accessor.count;
        const byteLength = count * elementSize;

        if (accessor.sparse) {
            return this.readSparseAccessor(accessor);
        }

        if (accessor.bufferView === undefined) {
            return this.createZeroBuffer(accessor.componentType, typeSize, count);
        }

        const bufferView = this.gltf.bufferViews?.[accessor.bufferView];
        if (!bufferView) return null;

        const buffer = this.buffers[bufferView.buffer];
        if (!buffer) return null;

        const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const view = new DataView(buffer, byteOffset, byteLength);

        return this.createTypedArray(view, accessor.componentType, typeSize, count, bufferView.byteStride);
    }

    private readSparseAccessor(accessor: GLTFAccessor): ArrayBufferView | null {
        if (!accessor.sparse || !this.gltf?.bufferViews) return null;

        const componentSize = COMPONENT_TYPE_SIZES[accessor.componentType];
        const typeSize = ACCESSOR_TYPE_SIZES[accessor.type];
        const elementSize = componentSize * typeSize;

        const result = new Float32Array(accessor.count * typeSize);

        const indicesView = this.gltf.bufferViews[accessor.sparse.indices.bufferView];
        const indicesBuffer = this.buffers[indicesView.buffer];
        const indicesByteOffset = (indicesView.byteOffset ?? 0) + (accessor.sparse.indices.byteOffset ?? 0);
        const indices = new Uint32Array(indicesBuffer, indicesByteOffset, accessor.sparse.count);

        const valuesView = this.gltf.bufferViews[accessor.sparse.values.bufferView];
        const valuesBuffer = this.buffers[valuesView.buffer];
        const valuesByteOffset = (valuesView.byteOffset ?? 0) + (accessor.sparse.values.byteOffset ?? 0);
        const values = new Float32Array(valuesBuffer, valuesByteOffset, accessor.sparse.count * typeSize);

        for (let i = 0; i < accessor.sparse.count; i++) {
            const idx = indices[i];
            for (let j = 0; j < typeSize; j++) {
                result[idx * typeSize + j] = values[i * typeSize + j];
            }
        }

        return result;
    }

    private createZeroBuffer(componentType: number, typeSize: number, count: number): ArrayBufferView {
        const totalElements = count * typeSize;

        switch (componentType) {
            case 5120: return new Int8Array(totalElements);
            case 5121: return new Uint8Array(totalElements);
            case 5122: return new Int16Array(totalElements);
            case 5123: return new Uint16Array(totalElements);
            case 5125: return new Uint32Array(totalElements);
            case 5126: return new Float32Array(totalElements);
            default: return new Float32Array(totalElements);
        }
    }

    private createTypedArray(
        view: DataView,
        componentType: number,
        typeSize: number,
        count: number,
        byteStride?: number
    ): ArrayBufferView {
        const totalElements = count * typeSize;
        const stride = byteStride ?? 0;
        const componentSize = COMPONENT_TYPE_SIZES[componentType];
        const elementSize = componentSize * typeSize;

        if (stride === 0 || stride === elementSize) {
            switch (componentType) {
                case 5120: return new Int8Array(view.buffer, view.byteOffset, totalElements);
                case 5121: return new Uint8Array(view.buffer, view.byteOffset, totalElements);
                case 5122: return new Int16Array(view.buffer, view.byteOffset, totalElements);
                case 5123: return new Uint16Array(view.buffer, view.byteOffset, totalElements);
                case 5125: return new Uint32Array(view.buffer, view.byteOffset, totalElements);
                case 5126: return new Float32Array(view.buffer, view.byteOffset, totalElements);
            }
        }

        const result = new Float32Array(totalElements);
        const littleEndian = true;

        for (let i = 0; i < count; i++) {
            const baseOffset = i * stride;
            for (let j = 0; j < typeSize; j++) {
                const offset = baseOffset + j * componentSize;
                let value: number;

                switch (componentType) {
                    case 5120: value = view.getInt8(offset); break;
                    case 5121: value = view.getUint8(offset); break;
                    case 5122: value = view.getInt16(offset, littleEndian); break;
                    case 5123: value = view.getUint16(offset, littleEndian); break;
                    case 5125: value = view.getUint32(offset, littleEndian); break;
                    case 5126: value = view.getFloat32(offset, littleEndian); break;
                    default: value = 0;
                }

                result[i * typeSize + j] = value;
            }
        }

        return result;
    }

    private parseMaterials(): PBRMaterial[] {
        if (!this.gltf?.materials) {
            return [this.createDefaultMaterial()];
        }

        const materials: PBRMaterial[] = [];

        for (const gltfMat of this.gltf.materials) {
            const pbr = gltfMat.pbrMetallicRoughness ?? {};
            const clearcoat = gltfMat.extensions?.KHR_materials_clearcoat;
            const transmission = gltfMat.extensions?.KHR_materials_transmission;

            const baseColorFactor = pbr.baseColorFactor ?? [1, 1, 1, 1];
            const emissiveFactor = gltfMat.emissiveFactor ?? [0, 0, 0];

            let alphaMode = ALPHA_MODE_OPAQUE;
            if (gltfMat.alphaMode === 'MASK') alphaMode = ALPHA_MODE_MASK;
            else if (gltfMat.alphaMode === 'BLEND') alphaMode = ALPHA_MODE_BLEND;

            let flags = 0;
            if (pbr.baseColorTexture) flags |= MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE;
            if (pbr.metallicRoughnessTexture) flags |= MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE;
            if (gltfMat.normalTexture) flags |= MATERIAL_FLAG_HAS_NORMAL_TEXTURE;
            if (gltfMat.occlusionTexture) flags |= MATERIAL_FLAG_HAS_OCCLUSION_TEXTURE;
            if (gltfMat.emissiveTexture) flags |= MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE;
            if (clearcoat?.clearcoatTexture) flags |= MATERIAL_FLAG_HAS_CLEARCOAT_TEXTURE;
            if (transmission) flags |= MATERIAL_FLAG_TRANSMISSION;
            if (gltfMat.doubleSided) flags |= MATERIAL_FLAG_DOUBLE_SIDED;

            const material: PBRMaterial = {
                baseColor: {
                    x: baseColorFactor[0],
                    y: baseColorFactor[1],
                    z: baseColorFactor[2],
                    w: baseColorFactor[3],
                },
                baseColorTexture: pbr.baseColorTexture?.index ?? -1,
                metallic: pbr.metallicFactor ?? 1,
                roughness: pbr.roughnessFactor ?? 1,
                metallicRoughnessTexture: pbr.metallicRoughnessTexture?.index ?? -1,
                normalTexture: gltfMat.normalTexture?.index ?? -1,
                occlusionTexture: gltfMat.occlusionTexture?.index ?? -1,
                emissive: {
                    x: emissiveFactor[0],
                    y: emissiveFactor[1],
                    z: emissiveFactor[2],
                },
                emissiveTexture: gltfMat.emissiveTexture?.index ?? -1,
                clearcoat: clearcoat?.clearcoatFactor ?? 0,
                clearcoatRoughness: clearcoat?.clearcoatRoughnessFactor ?? 0,
                clearcoatTexture: clearcoat?.clearcoatTexture?.index ?? -1,
                transmission: transmission?.transmissionFactor ?? 0,
                ior: 1.5,
                thickness: 0,
                subsurface: 0,
                alphaMode,
                alphaCutoff: gltfMat.alphaCutoff ?? 0.5,
                doubleSided: gltfMat.doubleSided ? 1 : 0,
            };

            materials.push(material);
        }

        if (materials.length === 0) {
            materials.push(this.createDefaultMaterial());
        }

        return materials;
    }

    private createDefaultMaterial(): PBRMaterial {
        return {
            baseColor: { x: 0.8, y: 0.8, z: 0.8, w: 1.0 },
            baseColorTexture: -1,
            metallic: 0.0,
            roughness: 0.5,
            metallicRoughnessTexture: -1,
            normalTexture: -1,
            occlusionTexture: -1,
            emissive: { x: 0, y: 0, z: 0 },
            emissiveTexture: -1,
            clearcoat: 0,
            clearcoatRoughness: 0,
            clearcoatTexture: -1,
            transmission: 0,
            ior: 1.5,
            thickness: 0,
            subsurface: 0,
            alphaMode: ALPHA_MODE_OPAQUE,
            alphaCutoff: 0.5,
            doubleSided: 0,
        };
    }

    private parseTextures(): TextureInfo[] {
        if (!this.gltf?.textures || !this.device) return [];

        const textures: TextureInfo[] = [];

        for (const gltfTexture of this.gltf.textures) {
            const textureInfo: TextureInfo = {
                width: 1,
                height: 1,
                format: TEXTURE_FORMAT_RGBA8,
                mipLevelCount: 1,
                texture: null,
                sampler: null,
            };

            if (gltfTexture.source !== undefined && this.gltf.images) {
                const image = this.gltf.images[gltfTexture.source];
                if (image) {
                    const gpuTexture = this.createGPUTexture(image);
                    if (gpuTexture) {
                        textureInfo.texture = gpuTexture;
                        textureInfo.width = gpuTexture.width;
                        textureInfo.height = gpuTexture.height;
                        textureInfo.mipLevelCount = gpuTexture.mipLevelCount;
                    }
                }
            }

            if (gltfTexture.sampler !== undefined && this.gltf.samplers) {
                const sampler = this.gltf.samplers[gltfTexture.sampler];
                if (sampler) {
                    textureInfo.sampler = this.createGPUSampler(sampler);
                }
            }

            if (!textureInfo.sampler) {
                textureInfo.sampler = this.device.createSampler({
                    magFilter: 'linear',
                    minFilter: 'linear',
                    mipmapFilter: 'linear',
                    addressModeU: 'repeat',
                    addressModeV: 'repeat',
                });
            }

            textures.push(textureInfo);
        }

        return textures;
    }

    private createGPUTexture(image: GLTFImage): GPUTexture | null {
        if (!this.device) return null;

        if (image.uri) {
            return null;
        }

        if (image.bufferView !== undefined && this.gltf?.bufferViews) {
            const bufferView = this.gltf.bufferViews[image.bufferView];
            if (!bufferView) return null;

            const buffer = this.buffers[bufferView.buffer];
            if (!buffer) return null;

            const byteOffset = bufferView.byteOffset ?? 0;
            const data = new Uint8Array(buffer, byteOffset, bufferView.byteLength);

            const img = document.createElement('img');
            const blob = new Blob([data], { type: image.mimeType ?? 'image/png' });
            const url = URL.createObjectURL(blob);

            return null;
        }

        return null;
    }

    private createGPUSampler(sampler: GLTFSampler): GPUSampler | null {
        if (!this.device) return null;

        const desc: GPUSamplerDescriptor = {
            addressModeU: this.getAddressMode(sampler.wrapS),
            addressModeV: this.getAddressMode(sampler.wrapT),
            addressModeW: 'repeat',
        };

        if (sampler.magFilter) {
            desc.magFilter = sampler.magFilter === 9729 ? 'linear' : 'nearest';
        }

        if (sampler.minFilter) {
            const minFilter = sampler.minFilter;
            if (minFilter === 9728 || minFilter === 9984 || minFilter === 9986) {
                desc.minFilter = 'nearest';
            } else {
                desc.minFilter = 'linear';
            }

            if (minFilter === 9984 || minFilter === 9985) {
                desc.mipmapFilter = 'nearest';
            } else if (minFilter === 9986 || minFilter === 9987) {
                desc.mipmapFilter = 'linear';
            }
        }

        return this.device.createSampler(desc);
    }

    private getAddressMode(mode?: number): GPUAddressMode {
        switch (mode) {
            case 33071: return 'clamp-to-edge';
            case 33648: return 'mirror-repeat';
            default: return 'repeat';
        }
    }

    private parseAnimations(): AnimationData[] {
        if (!this.gltf?.animations) return [];

        const animations: AnimationData[] = [];

        for (const gltfAnim of this.gltf.animations) {
            const samplers: AnimationSampler[] = [];
            const channels: AnimationChannel[] = [];
            let maxTime = 0;

            for (const sampler of gltfAnim.samplers) {
                const input = this.readAccessor(sampler.input) as Float32Array;
                const output = this.readAccessor(sampler.output) as Float32Array;

                if (input && input.length > 0) {
                    maxTime = Math.max(maxTime, input[input.length - 1]);
                }

                samplers.push({
                    input: input ?? new Float32Array(),
                    output: output ?? new Float32Array(),
                    interpolation: sampler.interpolation ?? 'LINEAR',
                });
            }

            for (const channel of gltfAnim.channels) {
                channels.push({
                    samplerIndex: channel.sampler,
                    targetNode: channel.target.node,
                    targetPath: channel.target.path,
                });
            }

            animations.push({
                name: gltfAnim.name ?? `animation_${animations.length}`,
                samplers,
                channels,
                duration: maxTime,
            });
        }

        return animations;
    }

    private parseSkins(): SkinData[] {
        if (!this.gltf?.skins) return [];

        const skins: SkinData[] = [];

        for (const gltfSkin of this.gltf.skins) {
            const inverseBindMatrices: mat4[] = [];

            if (gltfSkin.inverseBindMatrices !== undefined) {
                const data = this.readAccessor(gltfSkin.inverseBindMatrices) as Float32Array;
                if (data) {
                    for (let i = 0; i < data.length; i += 16) {
                        inverseBindMatrices.push(data.slice(i, i + 16) as mat4);
                    }
                }
            }

            while (inverseBindMatrices.length < gltfSkin.joints.length) {
                inverseBindMatrices.push(mat4.create());
            }

            skins.push({
                joints: [...gltfSkin.joints],
                inverseBindMatrices,
                skeleton: gltfSkin.skeleton,
            });
        }

        return skins;
    }

    private parseCameras(nodes: ParsedNode[]): CameraData[] {
        if (!this.gltf?.cameras) return [];

        const cameras: CameraData[] = [];

        for (let i = 0; i < this.gltf.cameras.length; i++) {
            const gltfCamera = this.gltf.cameras[i];
            const cameraNode = nodes.find(n => n.camera === i);

            if (!cameraNode) continue;

            const position: vec3 = [
                cameraNode.worldMatrix[12],
                cameraNode.worldMatrix[13],
                cameraNode.worldMatrix[14],
            ];

            const direction: vec3 = [
                -cameraNode.worldMatrix[8],
                -cameraNode.worldMatrix[9],
                -cameraNode.worldMatrix[10],
            ];

            const up: vec3 = [
                cameraNode.worldMatrix[4],
                cameraNode.worldMatrix[5],
                cameraNode.worldMatrix[6],
            ];

            const target: vec3 = [
                position[0] + direction[0],
                position[1] + direction[1],
                position[2] + direction[2],
            ];

            if (gltfCamera.type === 'perspective' && gltfCamera.perspective) {
                const camPos: Vec3 = { x: position[0], y: position[1], z: position[2] };
                const camTarget: Vec3 = { x: target[0], y: target[1], z: target[2] };
                const camUp: Vec3 = { x: up[0], y: up[1], z: up[2] };
                cameras.push({
                    type: 'perspective',
                    position: camPos,
                    target: camTarget,
                    up: camUp,
                    fov: gltfCamera.perspective.yfov,
                    aspect: gltfCamera.perspective.aspectRatio,
                    near: gltfCamera.perspective.znear,
                    far: gltfCamera.perspective.zfar ?? 100,
                });
            } else if (gltfCamera.type === 'orthographic' && gltfCamera.orthographic) {
                const camPos: Vec3 = { x: position[0], y: position[1], z: position[2] };
                const camTarget: Vec3 = { x: target[0], y: target[1], z: target[2] };
                const camUp: Vec3 = { x: up[0], y: up[1], z: up[2] };
                cameras.push({
                    type: 'orthographic',
                    position: camPos,
                    target: camTarget,
                    up: camUp,
                    near: gltfCamera.orthographic.znear,
                    far: gltfCamera.orthographic.zfar,
                });
            }
        }

        return cameras;
    }

    private parseLights(nodes: ParsedNode[]): LightData[] {
        const lights: LightData[] = [];
        const gltfLights = this.gltf?.extensions?.KHR_lights_punctual?.lights;

        if (!gltfLights) return lights;

        for (let i = 0; i < gltfLights.length; i++) {
            const gltfLight = gltfLights[i];
            const lightNode = nodes.find(n => n.light === i);

            if (!lightNode) continue;

            const position: vec3 = [
                lightNode.worldMatrix[12],
                lightNode.worldMatrix[13],
                lightNode.worldMatrix[14],
            ];

            const direction: vec3 = [
                -lightNode.worldMatrix[8],
                -lightNode.worldMatrix[9],
                -lightNode.worldMatrix[10],
            ];

            const color = gltfLight.color ?? [1, 1, 1];
            const intensity = gltfLight.intensity ?? 1;

            let type = LIGHT_TYPE_POINT;
            if (gltfLight.type === 'directional') type = LIGHT_TYPE_DIRECTIONAL;
            else if (gltfLight.type === 'spot') type = LIGHT_TYPE_SPOT;

            const light: LightData = {
                type,
                position: { x: position[0], y: position[1], z: position[2] },
                direction: { x: direction[0], y: direction[1], z: direction[2] },
                color: { x: color[0], y: color[1], z: color[2] },
                intensity,
                radius: gltfLight.range ?? 0,
                innerConeAngle: gltfLight.spot?.innerConeAngle ?? 0,
                outerConeAngle: gltfLight.spot?.outerConeAngle ?? Math.PI / 4,
            };

            lights.push(light);
        }

        return lights;
    }

    private buildSceneGraph(
        nodes: ParsedNode[],
        meshes: ParsedMesh[],
        materials: PBRMaterial[],
        triangles: TriangleData[],
        instances: InstanceData[]
    ): void {
        for (const node of nodes) {
            if (node.mesh === undefined) continue;

            const mesh = meshes[node.mesh];
            if (!mesh) continue;

            const invTransform = mat4.create();
            mat4.invert(invTransform, node.worldMatrix);

            const instance: InstanceData = {
                transform: new Float32Array(node.worldMatrix),
                inverseTransform: new Float32Array(invTransform),
                meshID: node.mesh,
                materialOffset: 0,
                flags: 0,
            };

            instances.push(instance);

            for (const primitive of mesh.primitives) {
                if (primitive.mode !== 4 && primitive.mode !== undefined) {
                    console.warn(`Unsupported primitive mode: ${primitive.mode}, skipping`);
                    continue;
                }

                const materialIdx = primitive.material;
                const material = materials[materialIdx] ?? materials[0];

                this.triangulatePrimitive(primitive, node.worldMatrix, material, materialIdx, triangles);
            }
        }
    }

    private triangulatePrimitive(
        primitive: ParsedPrimitive,
        transform: mat4,
        material: PBRMaterial,
        materialID: number,
        triangles: TriangleData[]
    ): void {
        const positions = primitive.attributes.POSITION;
        const normals = primitive.attributes.NORMAL;
        const tangents = primitive.attributes.TANGENT;
        const texCoords0 = primitive.attributes.TEXCOORD_0;
        const texCoords1 = primitive.attributes.TEXCOORD_1;
        const colors = primitive.attributes.COLOR_0;
        const indices = primitive.indices;

        const generateNormals = !normals;
        const computedNormals = generateNormals ? new Float32Array(positions.length) : null;

        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i];
            const i1 = indices[i + 1];
            const i2 = indices[i + 2];

            const v0 = this.transformPoint(positions, i0, transform);
            const v1 = this.transformPoint(positions, i1, transform);
            const v2 = this.transformPoint(positions, i2, transform);

            let n0, n1, n2;

            if (normals) {
                n0 = this.transformNormal(normals, i0, transform);
                n1 = this.transformNormal(normals, i1, transform);
                n2 = this.transformNormal(normals, i2, transform);
            } else if (computedNormals) {
                const faceNormal = this.computeFaceNormal(v0, v1, v2);
                n0 = faceNormal;
                n1 = faceNormal;
                n2 = faceNormal;

                for (let k = 0; k < 3; k++) {
                    computedNormals[i0 * 3 + k] += faceNormal[k];
                    computedNormals[i1 * 3 + k] += faceNormal[k];
                    computedNormals[i2 * 3 + k] += faceNormal[k];
                }
            } else {
                n0 = n1 = n2 = [0, 1, 0];
            }

            const uv0 = this.getUV(texCoords0, i0, i1, i2);
            const uv1 = this.getUV(texCoords1, i0, i1, i2);

            let triBaseColor = material.baseColor;
            if (colors) {
                const c0 = this.getColor(colors, i0);
                const c1 = this.getColor(colors, i1);
                const c2 = this.getColor(colors, i2);
                triBaseColor = {
                    x: (c0[0] + c1[0] + c2[0]) / 3,
                    y: (c0[1] + c1[1] + c2[1]) / 3,
                    z: (c0[2] + c1[2] + c2[2]) / 3,
                    w: c0.length > 3 ? (c0[3] + c1[3] + c2[3]) / 3 : 1,
                };
            }

            triangles.push({
                v0: { x: v0[0], y: v0[1], z: v0[2] },
                v1: { x: v1[0], y: v1[1], z: v1[2] },
                v2: { x: v2[0], y: v2[1], z: v2[2] },
                n0: { x: n0[0], y: n0[1], z: n0[2] },
                n1: { x: n1[0], y: n1[1], z: n1[2] },
                n2: { x: n2[0], y: n2[1], z: n2[2] },
                uv0: { x: uv0[0][0], y: uv0[0][1] },
                uv1: { x: uv0[1][0], y: uv0[1][1] },
                materialID,
                _baseColor: triBaseColor,
            } as TriangleData & { _baseColor?: typeof triBaseColor });
        }
    }

    private transformPoint(positions: Float32Array, index: number, transform: mat4): vec3 {
        const x = positions[index * 3];
        const y = positions[index * 3 + 1];
        const z = positions[index * 3 + 2];

        const result: vec3 = [0, 0, 0];
        vec3.transformMat4(result, [x, y, z], transform);

        return result;
    }

    private transformNormal(normals: Float32Array, index: number, transform: mat4): vec3 {
        const x = normals[index * 3];
        const y = normals[index * 3 + 1];
        const z = normals[index * 3 + 2];

        const normalMatrix = mat4.create();
        mat4.invert(normalMatrix, transform);
        mat4.transpose(normalMatrix, normalMatrix);

        const result: vec3 = [0, 0, 0];
        vec3.transformMat4(result, [x, y, z], normalMatrix);
        vec3.normalize(result, result);

        return result;
    }

    private computeFaceNormal(v0: vec3, v1: vec3, v2: vec3): vec3 {
        const edge1: vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        const edge2: vec3 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        const normal: vec3 = [0, 0, 0];
        vec3.cross(normal, edge1, edge2);
        vec3.normalize(normal, normal);

        return normal;
    }

    private getUV(texCoords: Float32Array | undefined, i0: number, i1: number, i2: number): [vec2, vec2, vec2] {
        if (!texCoords) {
            return [[0, 0], [0, 0], [0, 0]];
        }

        return [
            [texCoords[i0 * 2], texCoords[i0 * 2 + 1]],
            [texCoords[i1 * 2], texCoords[i1 * 2 + 1]],
            [texCoords[i2 * 2], texCoords[i2 * 2 + 1]],
        ] as [vec2, vec2, vec2];
    }

    private getColor(colors: Float32Array, index: number): number[] {
        const offset = index * 4;
        if (offset + 3 < colors.length) {
            return [
                colors[offset],
                colors[offset + 1],
                colors[offset + 2],
                colors[offset + 3] ?? 1,
            ];
        }
        return [1, 1, 1, 1];
    }

    setDevice(device: GPUDevice): void {
        this.device = device;
    }
}
