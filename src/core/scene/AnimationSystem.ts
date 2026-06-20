import { mat4, vec3, quat } from 'gl-matrix';
import { AnimationData, AnimationChannel, AnimationSampler, SkinData } from './GLTFLoader';
import { TriangleData } from '@/types';

export interface NodeTransform {
    translation: vec3;
    rotation: quat;
    scale: vec3;
    matrix: mat4;
}

export interface BoneTransform {
    jointIndex: number;
    localMatrix: mat4;
    worldMatrix: mat4;
    skinMatrix: mat4;
}

export interface BakedAnimation {
    frame: number;
    nodeTransforms: Map<number, NodeTransform>;
    skinMatrices: Map<number, mat4[]>;
    deformedMeshes: Map<number, Float32Array>;
}

export interface MorphTargetState {
    weights: number[];
    currentWeights: Float32Array;
}

export class AnimationSystem {
    private animations: AnimationData[] = [];
    private skins: SkinData[] = [];
    private nodes: Array<{
        localMatrix: mat4;
        worldMatrix: mat4;
        children: number[];
        parent: number;
        mesh?: number;
        skin?: number;
    }> = [];
    private meshes: Array<{
        primitives: Array<{
            attributes: Record<string, Float32Array>;
            indices: Uint32Array;
            targets: Record<string, Float32Array>[];
        }>;
        weights: number[];
    }> = [];

    private currentAnimation: number = 0;
    private currentTime: number = 0;
    private isPlaying: boolean = false;
    private playbackSpeed: number = 1.0;
    private loop: boolean = true;

    private nodeTransforms: Map<number, NodeTransform> = new Map();
    private skinMatrices: Map<number, mat4[]> = new Map();
    private morphStates: Map<number, MorphTargetState> = new Map();

    constructor(
        animations: AnimationData[],
        skins: SkinData[],
        nodes: Array<{ localMatrix: mat4; worldMatrix: mat4; children: number[]; parent: number; mesh?: number; skin?: number }>,
        meshes: Array<{
            primitives: Array<{ attributes: Record<string, Float32Array>; indices: Uint32Array; targets: Record<string, Float32Array>[] }>;
            weights: number[];
        }>
    ) {
        this.animations = animations;
        this.skins = skins;
        this.nodes = nodes;
        this.meshes = meshes;
        this.initializeNodeTransforms();
        this.initializeMorphStates();
    }

    private initializeNodeTransforms(): void {
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const translation: vec3 = [0, 0, 0];
            const rotation: quat = [0, 0, 0, 1];
            const scale: vec3 = [1, 1, 1];

            mat4.getTranslation(translation, node.localMatrix);
            mat4.getRotation(rotation, node.localMatrix);
            mat4.getScaling(scale, node.localMatrix);

            this.nodeTransforms.set(i, {
                translation,
                rotation,
                scale,
                matrix: mat4.clone(node.localMatrix),
            });
        }
    }

    private initializeMorphStates(): void {
        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            const weights = mesh.weights.length > 0 ? [...mesh.weights] : [];

            for (const primitive of mesh.primitives) {
                if (primitive.targets.length > 0) {
                    this.morphStates.set(i, {
                        weights,
                        currentWeights: new Float32Array(weights.length),
                    });
                    break;
                }
            }
        }
    }

    getAnimationCount(): number {
        return this.animations.length;
    }

    getAnimationNames(): string[] {
        return this.animations.map(a => a.name);
    }

    getCurrentAnimation(): number {
        return this.currentAnimation;
    }

    setCurrentAnimation(index: number): boolean {
        if (index < 0 || index >= this.animations.length) return false;
        this.currentAnimation = index;
        this.currentTime = 0;
        return true;
    }

    getAnimationDuration(index?: number): number {
        const animIndex = index ?? this.currentAnimation;
        return this.animations[animIndex]?.duration ?? 0;
    }

    getCurrentTime(): number {
        return this.currentTime;
    }

    setCurrentTime(time: number): void {
        const duration = this.getAnimationDuration();
        if (duration > 0) {
            this.currentTime = Math.max(0, Math.min(time, duration));
        }
    }

    play(animationIndex?: number): void {
        if (animationIndex !== undefined) {
            this.setCurrentAnimation(animationIndex);
        }
        this.isPlaying = true;
    }

    pause(): void {
        this.isPlaying = false;
    }

    stop(): void {
        this.isPlaying = false;
        this.currentTime = 0;
    }

    setPlaybackSpeed(speed: number): void {
        this.playbackSpeed = speed;
    }

    getPlaybackSpeed(): number {
        return this.playbackSpeed;
    }

    setLoop(loop: boolean): void {
        this.loop = loop;
    }

    isLooping(): boolean {
        return this.loop;
    }

    update(deltaTime: number): void {
        if (!this.isPlaying && this.animations.length === 0) return;

        const animation = this.animations[this.currentAnimation];
        if (!animation) {
            this.currentTime += deltaTime * this.playbackSpeed;

            const duration = animation.duration;
            if (this.currentTime >= duration) {
                if (this.loop) {
                    this.currentTime = this.currentTime % duration;
                } else {
                    this.currentTime = duration;
                    this.isPlaying = false;
                }
            }

            this.sampleAnimation(this.currentTime);
        }
    }

    sampleAnimation(time: number): void {
        const animation = this.animations[this.currentAnimation];
        if (!animation) return;

        for (const channel of animation.channels) {
            const sampler = animation.samplers[channel.samplerIndex];
            if (!sampler) continue;

            const value = this.sampleSampler(sampler, time);
            if (!value) continue;

            const nodeTransform = this.nodeTransforms.get(channel.targetNode);
            if (!nodeTransform) continue;

            switch (channel.targetPath) {
                case 'translation':
                    nodeTransform.translation = value as vec3;
                    break;
                case 'rotation':
                    nodeTransform.rotation = value as quat;
                    break;
                case 'scale':
                    nodeTransform.scale = value as vec3;
                    break;
                case 'weights':
                    this.setMorphWeights(channel.targetNode, value as number[]);
                    continue;
            }

            this.updateNodeMatrix(channel.targetNode);
        }

            this.updateWorldMatrices();
            this.updateSkinMatrices();
    }

    private sampleSampler(sampler: AnimationSampler, time: number): Float32Array | number[] | null {
        const { input, output, interpolation } = sampler;

        if (input.length === 0) return null;

        let index = 0;
        while (index < input.length - 1 && input[index + 1] < time) {
            index++;
        }

        if (index === input.length - 1) {
            const componentSize = output.length / input.length;
            const start = index * componentSize;
            return output.slice(start, start + componentSize);
        }

        const t0 = input[index];
        const t1 = input[index + 1];
        const t = (time - t0) / (t1 - t0);

        const componentSize = output.length / input.length;

        if (interpolation === 'STEP') {
            const start = index * componentSize;
            return output.slice(start, start + componentSize);
        }

        const start0 = index * componentSize;
        const start1 = (index + 1) * componentSize;

        if (interpolation === 'LINEAR') {
            const result = new Float32Array(componentSize);
            for (let i = 0; i < componentSize; i++) {
                result[i] = output[start0 + i] * (1 - t) + output[start1 + i] * t;
            }
            return result;
        }

        if (interpolation === 'CUBICSPLINE') {
            return this.sampleCubicSpline(sampler, index, t, componentSize);
        }

        return null;
    }

    private sampleCubicSpline(
        sampler: AnimationSampler,
        index: number,
        t: number,
        componentSize: number
    ): Float32Array {
        const { output } = sampler;
        const stride = componentSize * 3;

        const p0 = output.slice(index * stride + componentSize, index * stride + componentSize * 2);
        const m0 = output.slice(index * stride, index * stride + componentSize);
        const p1 = output.slice((index + 1) * stride + componentSize, (index + 1) * stride + componentSize * 2);
        const m1 = output.slice((index + 1) * stride, (index + 1) * stride + componentSize);

        const result = new Float32Array(componentSize);
        const t2 = t * t;
        const t3 = t2 * t;

        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        const deltaTime = sampler.input[index + 1] - sampler.input[index];

        for (let i = 0; i < componentSize; i++) {
            result[i] = h00 * p0[i] + h10 * m0[i] * deltaTime + h01 * p1[i] + h11 * m1[i] * deltaTime;
        }

        return result;
    }

    private updateNodeMatrix(nodeIndex: number): void {
        const transform = this.nodeTransforms.get(nodeIndex);
        if (!transform) return;

        mat4.fromRotationTranslationScale(
            transform.matrix,
            transform.rotation,
            transform.translation,
            transform.scale
        );
    }

    private updateWorldMatrices(): void {
        const visited = new Set<number>();

        const traverse = (index: number, parentMatrix: mat4) => {
            if (visited.has(index)) return;
            visited.add(index);

            const node = this.nodes[index];
            const transform = this.nodeTransforms.get(index);

            if (transform) {
                mat4.multiply(node.worldMatrix, parentMatrix, transform.matrix);
            } else {
                mat4.multiply(node.worldMatrix, parentMatrix, node.localMatrix);
            }

            for (const childIdx of node.children) {
                traverse(childIdx, node.worldMatrix);
            }
        };

        for (let i = 0; i < this.nodes.length; i++) {
            if (this.nodes[i].parent === -1) {
                const identity = mat4.create();
                traverse(i, identity);
            }
        }
    }

    private updateSkinMatrices(): void {
        for (let skinIndex = 0; skinIndex < this.skins.length; skinIndex++) {
            const skin = this.skins[skinIndex];
            const skinMatrices: mat4[] = [];

            for (let i = 0; i < skin.joints.length; i++) {
                const jointIndex = skin.joints[i];
                const jointNode = this.nodes[jointIndex];
                const inverseBindMatrix = skin.inverseBindMatrices[i] ?? mat4.create();

                const skinMatrix = mat4.create();
                if (jointNode) {
                    mat4.multiply(skinMatrix, jointNode.worldMatrix, inverseBindMatrix);
                }

                skinMatrices.push(skinMatrix);
            }

            this.skinMatrices.set(skinIndex, skinMatrices);
        }
    }

    getSkinMatrices(skinIndex: number): mat4[] | null {
        return this.skinMatrices.get(skinIndex) ?? null;
    }

    computeSkinning(meshIndex: number, skinIndex: number, positions: Float32Array, joints: Uint8Array, weights: Float32Array): Float32Array {
        const skinMatrices = this.getSkinMatrices(skinIndex);
        if (!skinMatrices) {
            return positions;
        }

        const result = new Float32Array(positions.length);

        for (let i = 0; i < positions.length; i += 3) {
            const vertexIndex = i / 3;
            const joint0 = joints[vertexIndex * 4];
            const joint1 = joints[vertexIndex * 4 + 1];
            const joint2 = joints[vertexIndex * 4 + 2];
            const joint3 = joints[vertexIndex * 4 + 3];

            const weight0 = weights[vertexIndex * 4];
            const weight1 = weights[vertexIndex * 4 + 1];
            const weight2 = weights[vertexIndex * 4 + 2];
            const weight3 = weights[vertexIndex * 4 + 3];

            const pos: vec3 = [positions[i], positions[i + 1], positions[i + 2]];
            const skinnedPos: vec3 = [0, 0, 0];

            if (weight0 > 0) {
                const temp: vec3 = [0, 0, 0];
                vec3.transformMat4(temp, pos, skinMatrices[joint0]);
                vec3.scale(temp, temp, weight0);
                vec3.add(skinnedPos, skinnedPos, temp);
            }

            if (weight1 > 0) {
                const temp: vec3 = [0, 0, 0];
                vec3.transformMat4(temp, pos, skinMatrices[joint1]);
                vec3.scale(temp, temp, weight1);
                vec3.add(skinnedPos, skinnedPos, temp);
            }

            if (weight2 > 0) {
                const temp: vec3 = [0, 0, 0];
                vec3.transformMat4(temp, pos, skinMatrices[joint2]);
                vec3.scale(temp, temp, weight2);
                vec3.add(skinnedPos, skinnedPos, temp);
            }

            if (weight3 > 0) {
                const temp: vec3 = [0, 0, 0];
                vec3.transformMat4(temp, pos, skinMatrices[joint3]);
                vec3.scale(temp, temp, weight3);
                vec3.add(skinnedPos, skinnedPos, temp);
            }

            result[i] = skinnedPos[0];
            result[i + 1] = skinnedPos[1];
            result[i + 2] = skinnedPos[2];
        }

        return result;
    }

    setMorphWeights(meshNodeIndex: number, weights: number[]): void {
        const node = this.nodes[meshNodeIndex];
        if (node && node.mesh !== undefined) {
            const state = this.morphStates.get(node.mesh);
            if (state) {
                for (let i = 0; i < Math.min(state.weights.length, weights.length); i++) {
                    state.weights[i] = weights[i];
                }
            }
        }
    }

    setMorphWeight(meshIndex: number, targetIndex: number, weight: number): void {
        const state = this.morphStates.get(meshIndex);
        if (state && targetIndex < state.weights.length) {
            state.weights[targetIndex] = weight;
        }
    }

    getMorphWeights(meshIndex: number): number[] | null {
        return this.morphStates.get(meshIndex)?.weights ?? null;
    }

    applyMorphTargets(meshIndex: number, basePositions: Float32Array): Float32Array {
        const state = this.morphStates.get(meshIndex);
        if (!state || state.weights.length === 0) {
            return basePositions;
        }

        const mesh = this.meshes[meshIndex];
        if (!mesh) return basePositions;

        const result = new Float32Array(basePositions);

        for (const primitive of mesh.primitives) {
            for (let targetIdx = 0; targetIdx < primitive.targets.length; targetIdx++) {
                const target = primitive.targets[targetIdx];
                const weight = state.weights[targetIdx] ?? 0;

                if (weight === 0) continue;

                const targetPositions = target.POSITION;
                if (targetPositions) {
                    for (let i = 0; i < result.length; i++) {
                        result[i] += targetPositions[i] * weight;
                    }
                }
            }
        }

        return result;
    }

    bakeAnimation(frame: number, frameCount: number): BakedAnimation {
        const duration = this.getAnimationDuration();
        const time = (frame / Math.max(1, frameCount - 1)) * duration;

        this.sampleAnimation(time);

        const bakedNodeTransforms = new Map<number, NodeTransform>();
        const bakedSkinMatrices = new Map<number, mat4[]>();
        const bakedMeshes = new Map<number, Float32Array>();

        for (const [nodeIndex, transform] of this.nodeTransforms) {
            bakedNodeTransforms.set(nodeIndex, {
                translation: [...transform.translation] as vec3,
                rotation: [...transform.rotation] as quat,
                scale: [...transform.scale] as vec3,
                matrix: mat4.clone(transform.matrix),
            });
        }

        for (const [skinIndex, matrices] of this.skinMatrices) {
            bakedSkinMatrices.set(skinIndex, matrices.map(m => mat4.clone(m)));
        }

        for (let meshIndex = 0; meshIndex < this.meshes.length; meshIndex++) {
            const mesh = this.meshes[meshIndex];
            if (!mesh) continue;

            for (const primitive of mesh.primitives) {
                let positions = primitive.attributes.POSITION;
                if (!positions) continue;

                positions = this.applyMorphTargets(meshIndex, positions);

                const joints = primitive.attributes.JOINTS_0;
                const weights = primitive.attributes.WEIGHTS_0;
                const skinIndex = this.findMeshSkin(meshIndex);

                if (joints && weights && skinIndex >= 0) {
                    const jointIndices = new Uint8Array(joints.buffer, joints.byteOffset, joints.length);
                    const skinWeights = new Float32Array(weights.buffer, weights.byteOffset, weights.length);
                    positions = this.computeSkinning(meshIndex, skinIndex, positions, jointIndices, skinWeights);
                }

                bakedMeshes.set(meshIndex, positions);
                break;
            }
        }

        return {
            frame,
            nodeTransforms: bakedNodeTransforms,
            skinMatrices: bakedSkinMatrices,
            deformedMeshes: bakedMeshes,
        };
    }

    private findMeshSkin(meshIndex: number): number {
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            if (node.mesh === meshIndex && node.skin !== undefined) {
                return node.skin;
            }
        }
        return -1;
    }

    bakeAnimationRange(startFrame: number, endFrame: number, frameCount: number): BakedAnimation[] {
        const bakedFrames: BakedAnimation[] = [];
        for (let i = startFrame; i <= endFrame; i++) {
            bakedFrames.push(this.bakeAnimation(i, frameCount));
        }
        return bakedFrames;
    }

    getNodeWorldMatrix(nodeIndex: number): mat4 | null {
        return this.nodes[nodeIndex]?.worldMatrix ?? null;
    }

    getNodeTransform(nodeIndex: number): NodeTransform | null {
        return this.nodeTransforms.get(nodeIndex) ?? null;
    }

    reset(): void {
        this.currentTime = 0;
        this.currentAnimation = 0;
        this.isPlaying = false;
        this.initializeNodeTransforms();
        this.initializeMorphStates();
        this.updateWorldMatrices();
        this.updateSkinMatrices();
    }

    isAnimationPlaying(): boolean {
        return this.isPlaying;
    }

    clone(): AnimationSystem {
        const clonedAnimations = this.animations.map(a => ({
            ...a,
            samplers: a.samplers.map(s => ({
                ...s,
                input: new Float32Array(s.input),
                output: new Float32Array(s.output),
            })),
        }));

        const clonedSkins = this.skins.map(s => ({
            ...s,
            inverseBindMatrices: s.inverseBindMatrices.map(m => mat4.clone(m)),
        }));

        const clonedNodes = this.nodes.map(n => ({
            ...n,
            localMatrix: mat4.clone(n.localMatrix),
            worldMatrix: mat4.clone(n.worldMatrix),
        }));

        const clonedMeshes = this.meshes.map(m => ({
            ...m,
            primitives: m.primitives.map(p => ({
                ...p,
                attributes: Object.fromEntries(
                    Object.entries(p.attributes).map(([k, v]) => [k, new Float32Array(v)])
                ),
                indices: new Uint32Array(p.indices),
                targets: p.targets.map(t =>
                    Object.fromEntries(
                        Object.entries(t).map(([k, v]) => [k, new Float32Array(v)])
                    )
                ),
            })),
        }));

        return new AnimationSystem(clonedAnimations, clonedSkins, clonedNodes, clonedMeshes);
    }

    static interpolateBakedFrames(
        frameA: BakedAnimation,
        frameB: BakedAnimation,
        t: number
    ): BakedAnimation {
        const result: BakedAnimation = {
            frame: frameA.frame + (frameB.frame - frameA.frame) * t,
            nodeTransforms: new Map(),
            skinMatrices: new Map(),
            deformedMeshes: new Map(),
        };

        for (const [nodeIndex, transformA] of frameA.nodeTransforms) {
            const transformB = frameB.nodeTransforms.get(nodeIndex);
            if (transformB) {
                const translation: vec3 = [0, 0, 0];
                const rotation: quat = [0, 0, 0, 1];
                const scale: vec3 = [1, 1, 1];

                vec3.lerp(translation, transformA.translation, transformB.translation, t);
                quat.slerp(rotation, transformA.rotation, transformB.rotation, t);
                vec3.lerp(scale, transformA.scale, transformB.scale, t);

                const matrix = mat4.create();
                mat4.fromRotationTranslationScale(matrix, rotation, translation, scale);

                result.nodeTransforms.set(nodeIndex, {
                    translation,
                    rotation,
                    scale,
                    matrix,
                });
            }
        }

        for (const [skinIndex, matricesA] of frameA.skinMatrices) {
            const matricesB = frameB.skinMatrices.get(skinIndex);
            if (matricesB) {
                const matrices: mat4[] = [];
                for (let i = 0; i < matricesA.length; i++) {
                    const m = mat4.create();
                    for (let j = 0; j < 16; j++) {
                        m[j] = matricesA[i][j] * (1 - t) + matricesB[i][j] * t;
                    }
                }
                result.skinMatrices.set(skinIndex, matrices);
            }
        }

        for (const [meshIndex, positionsA] of frameA.deformedMeshes) {
            const positionsB = frameB.deformedMeshes.get(meshIndex);
            if (positionsB) {
                const positions = new Float32Array(positionsA.length);
                for (let i = 0; i < positionsA.length; i++) {
                    positions[i] = positionsA[i] * (1 - t) + positionsB[i] * t;
                }
                result.deformedMeshes.set(meshIndex, positions);
            }
        }

        return result;
    }
}
