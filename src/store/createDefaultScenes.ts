import { mat4 } from 'gl-matrix';
import {
    TriangleData,
    PBRMaterial,
    SceneData,
    LightData,
    TextureInfo,
    InstanceData,
    vec3,
    vec2,
    LIGHT_TYPE_AREA,
    ALPHA_MODE_OPAQUE,
} from '@/types';

function createPBRMaterial(
    baseColor: { x: number; y: number; z: number; w: number },
    metallic: number = 0,
    roughness: number = 1,
    emissive?: { x: number; y: number; z: number },
    transmission: number = 0,
    ior: number = 1.5,
    subsurface: number = 0
): PBRMaterial {
    return {
        baseColor,
        baseColorTexture: -1,
        metallic,
        roughness,
        metallicRoughnessTexture: -1,
        normalTexture: -1,
        occlusionTexture: -1,
        emissive: emissive ?? { x: 0, y: 0, z: 0 },
        emissiveTexture: -1,
        clearcoat: 0,
        clearcoatRoughness: 0,
        clearcoatTexture: -1,
        transmission,
        ior,
        thickness: 0,
        subsurface,
        alphaMode: ALPHA_MODE_OPAQUE,
        alphaCutoff: 0.5,
        doubleSided: 0,
    };
}

function createTriangle(
    v0: vec3,
    v1: vec3,
    v2: vec3,
    normal: vec3,
    materialID: number,
    uv0?: vec2,
    uv1?: vec2
): TriangleData {
    const u0 = uv0 ?? { x: 0, y: 0 };
    const u1 = uv1 ?? { x: 1, y: 0 };
    return {
        v0,
        v1,
        v2,
        n0: normal,
        n1: normal,
        n2: normal,
        uv0: u0,
        uv1: { x: 0.5, y: 1 },
        uv2: { x: 1, y: 0 },
        materialID,
    };
}

function createQuad(
    p0: vec3,
    p1: vec3,
    p2: vec3,
    p3: vec3,
    normal: vec3,
    materialID: number
): TriangleData[] {
    return [
        createTriangle(p0, p1, p2, normal, materialID),
        createTriangle(p0, p2, p3, normal, materialID),
    ];
}

function generateSphereTriangles(
    center: vec3,
    radius: number,
    materialID: number,
    latBands: number = 32,
    lonBands: number = 16
): TriangleData[] {
    const triangles: TriangleData[] = [];

    for (let lat = 0; lat < latBands; lat++) {
        const theta1 = (lat / latBands) * Math.PI;
        const theta2 = ((lat + 1) / latBands) * Math.PI;

        const sinTheta1 = Math.sin(theta1);
        const cosTheta1 = Math.cos(theta1);
        const sinTheta2 = Math.sin(theta2);
        const cosTheta2 = Math.cos(theta2);

        for (let lon = 0; lon < lonBands; lon++) {
            const phi1 = (lon / lonBands) * 2 * Math.PI;
            const phi2 = ((lon + 1) / lonBands) * 2 * Math.PI;

            const sinPhi1 = Math.sin(phi1);
            const cosPhi1 = Math.cos(phi1);
            const sinPhi2 = Math.sin(phi2);
            const cosPhi2 = Math.cos(phi2);

            const v0: vec3 = {
                x: center.x + radius * sinTheta1 * cosPhi1,
                y: center.y + radius * cosTheta1,
                z: center.z + radius * sinTheta1 * sinPhi1,
            };
            const v1: vec3 = {
                x: center.x + radius * sinTheta1 * cosPhi2,
                y: center.y + radius * cosTheta1,
                z: center.z + radius * sinTheta1 * sinPhi2,
            };
            const v2: vec3 = {
                x: center.x + radius * sinTheta2 * cosPhi2,
                y: center.y + radius * cosTheta2,
                z: center.z + radius * sinTheta2 * sinPhi2,
            };
            const v3: vec3 = {
                x: center.x + radius * sinTheta2 * cosPhi1,
                y: center.y + radius * cosTheta2,
                z: center.z + radius * sinTheta2 * sinPhi1,
            };

            const n0: vec3 = {
                x: (v0.x - center.x) / radius,
                y: (v0.y - center.y) / radius,
                z: (v0.z - center.z) / radius,
            };
            const n1: vec3 = {
                x: (v1.x - center.x) / radius,
                y: (v1.y - center.y) / radius,
                z: (v1.z - center.z) / radius,
            };
            const n2: vec3 = {
                x: (v2.x - center.x) / radius,
                y: (v2.y - center.y) / radius,
                z: (v2.z - center.z) / radius,
            };
            const n3: vec3 = {
                x: (v3.x - center.x) / radius,
                y: (v3.y - center.y) / radius,
                z: (v3.z - center.z) / radius,
            };

            triangles.push({
                v0,
                v1,
                v2,
                n0,
                n1,
                n2,
                uv0: { x: lon / lonBands, y: lat / latBands },
                uv1: { x: (lon + 1) / lonBands, y: lat / latBands },
                uv2: { x: (lon + 1) / lonBands, y: (lat + 1) / latBands },
                materialID,
            });

            triangles.push({
                v0,
                v1: v2,
                v2: v3,
                n0,
                n1: n2,
                n2: n3,
                uv0: { x: lon / lonBands, y: lat / latBands },
                uv1: { x: (lon + 1) / lonBands, y: (lat + 1) / latBands },
                uv2: { x: lon / lonBands, y: (lat + 1) / latBands },
                materialID,
            });
        }
    }

    return triangles;
}

function generateBoxTriangles(
    min: vec3,
    max: vec3,
    materialID: number
): TriangleData[] {
    const triangles: TriangleData[] = [];

    const v000: vec3 = { x: min.x, y: min.y, z: min.z };
    const v100: vec3 = { x: max.x, y: min.y, z: min.z };
    const v110: vec3 = { x: max.x, y: max.y, z: min.z };
    const v010: vec3 = { x: min.x, y: max.y, z: min.z };
    const v001: vec3 = { x: min.x, y: min.y, z: max.z };
    const v101: vec3 = { x: max.x, y: min.y, z: max.z };
    const v111: vec3 = { x: max.x, y: max.y, z: max.z };
    const v011: vec3 = { x: min.x, y: max.y, z: max.z };

    triangles.push(...createQuad(v000, v100, v110, v010, { x: 0, y: 0, z: -1 }, materialID));
    triangles.push(...createQuad(v101, v001, v011, v111, { x: 0, y: 0, z: 1 }, materialID));
    triangles.push(...createQuad(v001, v000, v010, v011, { x: -1, y: 0, z: 0 }, materialID));
    triangles.push(...createQuad(v100, v101, v111, v110, { x: 1, y: 0, z: 0 }, materialID));
    triangles.push(...createQuad(v010, v110, v111, v011, { x: 0, y: 1, z: 0 }, materialID));
    triangles.push(...createQuad(v001, v101, v100, v000, { x: 0, y: -1, z: 0 }, materialID));

    return triangles;
}

export function createCornellBox(): SceneData {
    const materials: PBRMaterial[] = [];
    const triangles: TriangleData[] = [];
    const instances: InstanceData[] = [];
    const textures: TextureInfo[] = [];
    const lights: LightData[] = [];

    const whiteMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.8, y: 0.8, z: 0.8, w: 1 }, 0, 0.8));

    const redMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.8, y: 0.1, z: 0.1, w: 1 }, 0, 0.8));

    const greenMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.1, y: 0.8, z: 0.1, w: 1 }, 0, 0.8));

    const lightMatID = materials.length;
    materials.push(
        createPBRMaterial(
            { x: 1, y: 1, z: 1, w: 1 },
            0,
            1,
            { x: 17, y: 12, z: 4 }
        )
    );

    const boxSize = 2.5;
    const half = boxSize / 2;

    triangles.push(...createQuad(
        { x: -half, y: -half, z: -half },
        { x: half, y: -half, z: -half },
        { x: half, y: -half, z: half },
        { x: -half, y: -half, z: half },
        { x: 0, y: 1, z: 0 },
        whiteMatID
    ));

    triangles.push(...createQuad(
        { x: -half, y: half, z: half },
        { x: half, y: half, z: half },
        { x: half, y: half, z: -half },
        { x: -half, y: half, z: -half },
        { x: 0, y: -1, z: 0 },
        whiteMatID
    ));

    triangles.push(...createQuad(
        { x: -half, y: -half, z: -half },
        { x: -half, y: -half, z: half },
        { x: -half, y: half, z: half },
        { x: -half, y: half, z: -half },
        { x: 1, y: 0, z: 0 },
        redMatID
    ));

    triangles.push(...createQuad(
        { x: half, y: -half, z: half },
        { x: half, y: -half, z: -half },
        { x: half, y: half, z: -half },
        { x: half, y: half, z: half },
        { x: -1, y: 0, z: 0 },
        greenMatID
    ));

    triangles.push(...createQuad(
        { x: -half, y: -half, z: half },
        { x: half, y: -half, z: half },
        { x: half, y: half, z: half },
        { x: -half, y: half, z: half },
        { x: 0, y: 0, z: -1 },
        whiteMatID
    ));

    const lightSize = 0.6;
    triangles.push(...createQuad(
        { x: -lightSize, y: half - 0.01, z: -lightSize },
        { x: lightSize, y: half - 0.01, z: -lightSize },
        { x: lightSize, y: half - 0.01, z: lightSize },
        { x: -lightSize, y: half - 0.01, z: lightSize },
        { x: 0, y: -1, z: 0 },
        lightMatID
    ));

    lights.push({
        type: LIGHT_TYPE_AREA,
        position: { x: 0, y: half - 0.01, z: 0 },
        direction: { x: 0, y: -1, z: 0 },
        color: { x: 1, y: 0.9, z: 0.8 },
        intensity: 15,
        radius: lightSize,
        innerConeAngle: 0,
        outerConeAngle: Math.PI / 2,
    });

    triangles.push(...generateBoxTriangles(
        { x: -0.8, y: -half, z: -0.2 },
        { x: -0.2, y: 0.3, z: 0.4 },
        whiteMatID
    ));

    triangles.push(...generateBoxTriangles(
        { x: 0.2, y: -half, z: -0.5 },
        { x: 0.8, y: 0.7, z: 0.1 },
        whiteMatID
    ));

    return {
        triangles,
        materials,
        instances,
        textures,
        lights,
        environmentMap: -1,
    };
}

export function createSimpleSpheres(): SceneData {
    const materials: PBRMaterial[] = [];
    const triangles: TriangleData[] = [];
    const instances: InstanceData[] = [];
    const textures: TextureInfo[] = [];
    const lights: LightData[] = [];

    const groundMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.3, y: 0.3, z: 0.35, w: 1 }, 0, 0.9));

    const diffuseMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.9, y: 0.2, z: 0.2, w: 1 }, 0, 0.7));

    const metalMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.95, y: 0.93, z: 0.88, w: 1 }, 1, 0.15));

    const glassMatID = materials.length;
    materials.push(createPBRMaterial({ x: 1, y: 1, z: 1, w: 1 }, 0, 0.02, undefined, 1, 1.5));

    const subsurfaceMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.9, y: 0.7, z: 0.6, w: 1 }, 0, 0.5, undefined, 0, 1.3, 0.8));

    const emissiveMatID = materials.length;
    materials.push(
        createPBRMaterial(
            { x: 0.2, y: 0.4, z: 1, w: 1 },
            0,
            1,
            { x: 2, y: 3, z: 8 }
        )
    );

    const planeSize = 10;
    triangles.push(...createQuad(
        { x: -planeSize, y: -1, z: -planeSize },
        { x: planeSize, y: -1, z: -planeSize },
        { x: planeSize, y: -1, z: planeSize },
        { x: -planeSize, y: -1, z: planeSize },
        { x: 0, y: 1, z: 0 },
        groundMatID
    ));

    triangles.push(...generateSphereTriangles({ x: -2.5, y: -0.2, z: 0 }, 0.8, diffuseMatID));

    triangles.push(...generateSphereTriangles({ x: 0, y: -0.2, z: 0 }, 0.8, metalMatID));

    triangles.push(...generateSphereTriangles({ x: 2.5, y: -0.2, z: 0 }, 0.8, glassMatID));

    triangles.push(...generateSphereTriangles({ x: -1.2, y: -0.2, z: 2.2 }, 0.8, subsurfaceMatID));

    triangles.push(...generateSphereTriangles({ x: 1.2, y: -0.2, z: 2.2 }, 0.8, emissiveMatID));

    lights.push({
        type: LIGHT_TYPE_AREA,
        position: { x: 0, y: 5, z: 2 },
        direction: { x: 0, y: -1, z: 0 },
        color: { x: 1, y: 0.95, z: 0.9 },
        intensity: 10,
        radius: 1.5,
        innerConeAngle: 0,
        outerConeAngle: Math.PI / 2,
    });

    return {
        triangles,
        materials,
        instances,
        textures,
        lights,
        environmentMap: -1,
    };
}

export function createPlaneScene(): SceneData {
    const materials: PBRMaterial[] = [];
    const triangles: TriangleData[] = [];
    const instances: InstanceData[] = [];
    const textures: TextureInfo[] = [];
    const lights: LightData[] = [];

    const groundMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.2, y: 0.22, z: 0.25, w: 1 }, 0.1, 0.3));

    const chromeMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.95, y: 0.95, z: 0.97, w: 1 }, 1, 0.05));

    const goldMatID = materials.length;
    materials.push(createPBRMaterial({ x: 1, y: 0.76, z: 0.33, w: 1 }, 1, 0.2));

    const copperMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.95, y: 0.64, z: 0.54, w: 1 }, 1, 0.3));

    const plasticMatID = materials.length;
    materials.push(createPBRMaterial({ x: 0.1, y: 0.4, z: 0.9, w: 1 }, 0, 0.4));

    const planeSize = 20;
    triangles.push(...createQuad(
        { x: -planeSize, y: 0, z: -planeSize },
        { x: planeSize, y: 0, z: -planeSize },
        { x: planeSize, y: 0, z: planeSize },
        { x: -planeSize, y: 0, z: planeSize },
        { x: 0, y: 1, z: 0 },
        groundMatID
    ));

    triangles.push(...generateSphereTriangles({ x: -3, y: 1, z: -1 }, 1, chromeMatID));
    triangles.push(...generateSphereTriangles({ x: 0, y: 1, z: -1 }, 1, goldMatID));
    triangles.push(...generateSphereTriangles({ x: 3, y: 1, z: -1 }, 1, copperMatID));

    triangles.push(...generateBoxTriangles(
        { x: -1.5, y: 0, z: 2 },
        { x: 1.5, y: 0.8, z: 3.5 },
        plasticMatID
    ));

    lights.push({
        type: LIGHT_TYPE_AREA,
        position: { x: -5, y: 6, z: -3 },
        direction: { x: 0.3, y: -0.8, z: 0.5 },
        color: { x: 1, y: 0.95, z: 0.85 },
        intensity: 12,
        radius: 2,
        innerConeAngle: 0,
        outerConeAngle: Math.PI / 3,
    });

    lights.push({
        type: LIGHT_TYPE_AREA,
        position: { x: 5, y: 6, z: 3 },
        direction: { x: -0.3, y: -0.8, z: -0.5 },
        color: { x: 0.7, y: 0.8, z: 1 },
        intensity: 8,
        radius: 1.5,
        innerConeAngle: 0,
        outerConeAngle: Math.PI / 3,
    });

    return {
        triangles,
        materials,
        instances,
        textures,
        lights,
        environmentMap: -1,
    };
}
