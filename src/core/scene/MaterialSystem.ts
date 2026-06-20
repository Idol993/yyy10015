import { PBRMaterial, ALPHA_MODE_OPAQUE, ALPHA_MODE_MASK, ALPHA_MODE_BLEND, MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE, MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE, MATERIAL_FLAG_HAS_NORMAL_TEXTURE, MATERIAL_FLAG_HAS_OCCLUSION_TEXTURE, MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE, MATERIAL_FLAG_HAS_CLEARCOAT_TEXTURE, MATERIAL_FLAG_TRANSMISSION, MATERIAL_FLAG_DOUBLE_SIDED, MATERIAL_SIZE } from '@/types';

export interface MaterialTextureSet {
    baseColorTexture: number;
    metallicRoughnessTexture: number;
    normalTexture: number;
    occlusionTexture: number;
    emissiveTexture: number;
    clearcoatTexture: number;
}

export interface MaterialEvalResult {
    baseColor: { r: number; g: number; b: number; a: number };
    metallic: number;
    roughness: number;
    normal: { x: number; y: number; z: number };
    emissive: { r: number; g: number; b: number };
    clearcoat: number;
    clearcoatRoughness: number;
    transmission: number;
    ior: number;
    alpha: number;
    alphaMode: number;
    doubleSided: boolean;
}

export interface TextureSample {
    (textureIndex: number, uv: { x: number; y: number }): { r: number; g: number; b: number; a: number };
}

export class MaterialSystem {
    private materials: PBRMaterial[] = [];
    private textureIndices: Map<number, MaterialTextureSet> = new Map();

    constructor(materials?: PBRMaterial[]) {
        if (materials) {
            this.setMaterials(materials);
        }
    }

    setMaterials(materials: PBRMaterial[]): void {
        this.materials = materials;
        this.textureIndices.clear();

        for (let i = 0; i < materials.length; i++) {
            const mat = materials[i];
            this.textureIndices.set(i, {
                baseColorTexture: mat.baseColorTexture,
                metallicRoughnessTexture: mat.metallicRoughnessTexture,
                normalTexture: mat.normalTexture,
                occlusionTexture: mat.occlusionTexture,
                emissiveTexture: mat.emissiveTexture,
                clearcoatTexture: mat.clearcoatTexture,
            });
        }
    }

    getMaterials(): PBRMaterial[] {
        return this.materials;
    }

    getMaterial(index: number): PBRMaterial | null {
        if (index < 0 || index >= this.materials.length) {
            return null;
        }
        return this.materials[index];
    }

    getMaterialCount(): number {
        return this.materials.length;
    }

    addMaterial(material: PBRMaterial): number {
        const index = this.materials.length;
        this.materials.push(material);
        this.textureIndices.set(index, {
            baseColorTexture: material.baseColorTexture,
            metallicRoughnessTexture: material.metallicRoughnessTexture,
            normalTexture: material.normalTexture,
            occlusionTexture: material.occlusionTexture,
            emissiveTexture: material.emissiveTexture,
            clearcoatTexture: material.clearcoatTexture,
        });
        return index;
    }

    updateMaterial(index: number, material: Partial<PBRMaterial>): boolean {
        if (index < 0 || index >= this.materials.length) {
            return false;
        }

        this.materials[index] = { ...this.materials[index], ...material };

        const textureSet = this.textureIndices.get(index);
        if (textureSet) {
            if (material.baseColorTexture !== undefined) textureSet.baseColorTexture = material.baseColorTexture;
            if (material.metallicRoughnessTexture !== undefined) textureSet.metallicRoughnessTexture = material.metallicRoughnessTexture;
            if (material.normalTexture !== undefined) textureSet.normalTexture = material.normalTexture;
            if (material.occlusionTexture !== undefined) textureSet.occlusionTexture = material.occlusionTexture;
            if (material.emissiveTexture !== undefined) textureSet.emissiveTexture = material.emissiveTexture;
            if (material.clearcoatTexture !== undefined) textureSet.clearcoatTexture = material.clearcoatTexture;
        }

        return true;
    }

    getTextureSet(materialIndex: number): MaterialTextureSet | null {
        return this.textureIndices.get(materialIndex) ?? null;
    }

    hasBaseColorTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.baseColorTexture >= 0;
    }

    hasMetallicRoughnessTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.metallicRoughnessTexture >= 0;
    }

    hasNormalTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.normalTexture >= 0;
    }

    hasOcclusionTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.occlusionTexture >= 0;
    }

    hasEmissiveTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.emissiveTexture >= 0;
    }

    hasClearcoatTexture(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.clearcoatTexture >= 0;
    }

    isTransparent(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        if (!mat) return false;
        return mat.alphaMode === ALPHA_MODE_BLEND ||
            (mat.alphaMode === ALPHA_MODE_MASK && mat.alphaCutoff > 0) ||
            mat.baseColor.w < 1.0 ||
            mat.transmission > 0;
    }

    isDoubleSided(materialIndex: number): boolean {
        const mat = this.getMaterial(materialIndex);
        return mat !== null && mat.doubleSided > 0;
    }

    evaluateMaterial(
        materialIndex: number,
        uv: { x: number; y: number },
        sampleTexture: TextureSample
    ): MaterialEvalResult | null {
        const mat = this.getMaterial(materialIndex);
        if (!mat) return null;

        let baseColorR = mat.baseColor.x;
        let baseColorG = mat.baseColor.y;
        let baseColorB = mat.baseColor.z;
        let baseColorA = mat.baseColor.w;

        if (mat.baseColorTexture >= 0) {
            const texColor = sampleTexture(mat.baseColorTexture, uv);
            baseColorR *= texColor.r;
            baseColorG *= texColor.g;
            baseColorB *= texColor.b;
            baseColorA *= texColor.a;
        }

        let metallic = mat.metallic;
        let roughness = mat.roughness;

        if (mat.metallicRoughnessTexture >= 0) {
            const texColor = sampleTexture(mat.metallicRoughnessTexture, uv);
            roughness *= texColor.g;
            metallic *= texColor.b;
        }

        roughness = Math.max(0.001, roughness);

        let emissiveR = mat.emissive.x;
        let emissiveG = mat.emissive.y;
        let emissiveB = mat.emissive.z;

        if (mat.emissiveTexture >= 0) {
            const texColor = sampleTexture(mat.emissiveTexture, uv);
            emissiveR *= texColor.r;
            emissiveG *= texColor.g;
            emissiveB *= texColor.b;
        }

        let clearcoat = mat.clearcoat;
        let clearcoatRoughness = mat.clearcoatRoughness;

        if (mat.clearcoatTexture >= 0) {
            const texColor = sampleTexture(mat.clearcoatTexture, uv);
            clearcoat *= texColor.r;
        }

        if (mat.occlusionTexture >= 0) {
            const texColor = sampleTexture(mat.occlusionTexture, uv);
            const occlusion = texColor.r;
            baseColorR *= occlusion;
            baseColorG *= occlusion;
            baseColorB *= occlusion;
        }

        return {
            baseColor: { r: baseColorR, g: baseColorG, b: baseColorB, a: baseColorA },
            metallic,
            roughness,
            normal: { x: 0, y: 1, z: 0 },
            emissive: { r: emissiveR, g: emissiveG, b: emissiveB },
            clearcoat,
            clearcoatRoughness,
            transmission: mat.transmission,
            ior: mat.ior,
            alpha: baseColorA,
            alphaMode: mat.alphaMode,
            doubleSided: mat.doubleSided > 0,
        };
    }

    getMaterialFlags(materialIndex: number): number {
        const mat = this.getMaterial(materialIndex);
        if (!mat) return 0;

        let flags = 0;

        if (mat.baseColorTexture >= 0) flags |= MATERIAL_FLAG_HAS_BASE_COLOR_TEXTURE;
        if (mat.metallicRoughnessTexture >= 0) flags |= MATERIAL_FLAG_HAS_METALLIC_ROUGHNESS_TEXTURE;
        if (mat.normalTexture >= 0) flags |= MATERIAL_FLAG_HAS_NORMAL_TEXTURE;
        if (mat.occlusionTexture >= 0) flags |= MATERIAL_FLAG_HAS_OCCLUSION_TEXTURE;
        if (mat.emissiveTexture >= 0) flags |= MATERIAL_FLAG_HAS_EMISSIVE_TEXTURE;
        if (mat.clearcoatTexture >= 0) flags |= MATERIAL_FLAG_HAS_CLEARCOAT_TEXTURE;
        if (mat.transmission > 0) flags |= MATERIAL_FLAG_TRANSMISSION;
        if (mat.doubleSided > 0) flags |= MATERIAL_FLAG_DOUBLE_SIDED;

        return flags;
    }

    mergeMaterials(baseIndex: number, overrideIndex: number): PBRMaterial | null {
        const base = this.getMaterial(baseIndex);
        const override = this.getMaterial(overrideIndex);

        if (!base || !override) return null;

        return {
            baseColor: {
                x: base.baseColor.x * override.baseColor.x,
                y: base.baseColor.y * override.baseColor.y,
                z: base.baseColor.z * override.baseColor.z,
                w: base.baseColor.w * override.baseColor.w,
            },
            baseColorTexture: override.baseColorTexture >= 0 ? override.baseColorTexture : base.baseColorTexture,
            metallic: base.metallic * override.metallic,
            roughness: Math.max(0.001, base.roughness * override.roughness),
            metallicRoughnessTexture: override.metallicRoughnessTexture >= 0 ? override.metallicRoughnessTexture : base.metallicRoughnessTexture,
            normalTexture: override.normalTexture >= 0 ? override.normalTexture : base.normalTexture,
            occlusionTexture: override.occlusionTexture >= 0 ? override.occlusionTexture : base.occlusionTexture,
            emissive: {
                x: base.emissive.x + override.emissive.x,
                y: base.emissive.y + override.emissive.y,
                z: base.emissive.z + override.emissive.z,
            },
            emissiveTexture: override.emissiveTexture >= 0 ? override.emissiveTexture : base.emissiveTexture,
            clearcoat: Math.max(base.clearcoat, override.clearcoat),
            clearcoatRoughness: Math.max(base.clearcoatRoughness, override.clearcoatRoughness),
            clearcoatTexture: override.clearcoatTexture >= 0 ? override.clearcoatTexture : base.clearcoatTexture,
            transmission: Math.max(base.transmission, override.transmission),
            ior: override.ior !== 1.5 ? override.ior : base.ior,
            thickness: Math.max(base.thickness, override.thickness),
            subsurface: Math.max(base.subsurface, override.subsurface),
            alphaMode: override.alphaMode !== ALPHA_MODE_OPAQUE ? override.alphaMode : base.alphaMode,
            alphaCutoff: Math.max(base.alphaCutoff, override.alphaCutoff),
            doubleSided: base.doubleSided || override.doubleSided ? 1 : 0,
        };
    }

    toGPUData(materialIndex: number): Float32Array | null {
        const mat = this.getMaterial(materialIndex);
        if (!mat) return null;

        const data = new Float32Array(MATERIAL_SIZE / 4);
        const dataU32 = data as unknown as Uint32Array;

        data[0] = mat.baseColor.x;
        data[1] = mat.baseColor.y;
        data[2] = mat.baseColor.z;
        data[3] = mat.baseColor.w;

        data[4] = mat.metallic;
        data[5] = mat.roughness;

        data[6] = mat.emissive.x;
        data[7] = mat.emissive.y;
        data[8] = mat.emissive.z;

        data[9] = mat.clearcoat;
        data[10] = mat.clearcoatRoughness;
        data[11] = mat.transmission;
        data[12] = mat.ior;
        data[13] = mat.thickness;
        data[14] = mat.subsurface;
        data[15] = mat.alphaCutoff;

        dataU32[16] = this.getMaterialFlags(materialIndex);
        dataU32[17] = mat.baseColorTexture | 0;
        dataU32[18] = mat.metallicRoughnessTexture | 0;
        dataU32[19] = mat.emissiveTexture | 0;

        return data;
    }

    toGPUDataExtended(materialIndex: number): Float32Array | null {
        const mat = this.getMaterial(materialIndex);
        if (!mat) return null;

        const data = new Float32Array(32);

        data[0] = mat.baseColor.x;
        data[1] = mat.baseColor.y;
        data[2] = mat.baseColor.z;
        data[3] = mat.baseColor.w;

        data[4] = mat.metallic;
        data[5] = mat.roughness;
        data[6] = mat.clearcoat;
        data[7] = mat.clearcoatRoughness;

        data[8] = mat.emissive.x;
        data[9] = mat.emissive.y;
        data[10] = mat.emissive.z;
        data[11] = mat.transmission;

        data[12] = mat.ior;
        data[13] = mat.thickness;
        data[14] = mat.subsurface;
        data[15] = mat.alphaCutoff;

        data[16] = mat.baseColorTexture;
        data[17] = mat.metallicRoughnessTexture;
        data[18] = mat.normalTexture;
        data[19] = mat.occlusionTexture;

        data[20] = mat.emissiveTexture;
        data[21] = mat.clearcoatTexture;
        data[22] = mat.alphaMode;
        data[23] = mat.doubleSided;

        data[24] = this.getMaterialFlags(materialIndex);
        data[25] = 0;
        data[26] = 0;
        data[27] = 0;

        data[28] = 0;
        data[29] = 0;
        data[30] = 0;
        data[31] = 0;

        return data;
    }

    getAllGPUData(): Float32Array {
        const count = this.materials.length;
        const floatsPerMat = MATERIAL_SIZE / 4;
        const data = new Float32Array(count * floatsPerMat);

        for (let i = 0; i < count; i++) {
            const matData = this.toGPUData(i);
            if (matData) {
                data.set(matData, i * floatsPerMat);
            }
        }

        return data;
    }

    getAllGPUDataExtended(): Float32Array {
        const count = this.materials.length;
        const floatsPerMat = MATERIAL_SIZE / 4;
        const data = new Float32Array(count * floatsPerMat);

        for (let i = 0; i < count; i++) {
            const matData = this.toGPUData(i);
            if (matData) {
                data.set(matData, i * floatsPerMat);
            }
        }

        return data;
    }

    clone(): MaterialSystem {
        const clonedMaterials = this.materials.map(m => ({
            ...m,
            baseColor: { ...m.baseColor },
            emissive: { ...m.emissive },
        }));
        return new MaterialSystem(clonedMaterials);
    }

    static createDefaultMaterial(): PBRMaterial {
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

    static createEmissiveMaterial(color: { r: number; g: number; b: number }, intensity: number = 1.0): PBRMaterial {
        return {
            baseColor: { x: 0, y: 0, z: 0, w: 1.0 },
            baseColorTexture: -1,
            metallic: 0.0,
            roughness: 1.0,
            metallicRoughnessTexture: -1,
            normalTexture: -1,
            occlusionTexture: -1,
            emissive: { x: color.r * intensity, y: color.g * intensity, z: color.b * intensity },
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

    static createGlassMaterial(ior: number = 1.5, transmission: number = 1.0): PBRMaterial {
        return {
            baseColor: { x: 1, y: 1, z: 1, w: 1.0 },
            baseColorTexture: -1,
            metallic: 0.0,
            roughness: 0.0,
            metallicRoughnessTexture: -1,
            normalTexture: -1,
            occlusionTexture: -1,
            emissive: { x: 0, y: 0, z: 0 },
            emissiveTexture: -1,
            clearcoat: 0,
            clearcoatRoughness: 0,
            clearcoatTexture: -1,
            transmission,
            ior,
            thickness: 0.1,
            subsurface: 0,
            alphaMode: ALPHA_MODE_BLEND,
            alphaCutoff: 0.5,
            doubleSided: 1,
        };
    }

    static createMetalMaterial(baseColor: { r: number; g: number; b: number }, roughness: number = 0.25): PBRMaterial {
        return {
            baseColor: { x: baseColor.r, y: baseColor.g, z: baseColor.b, w: 1.0 },
            baseColorTexture: -1,
            metallic: 1.0,
            roughness,
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
}
