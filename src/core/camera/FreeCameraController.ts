import { mat4, vec3 } from 'gl-matrix';
import { CAMERA_SIZE } from '@/types';

export class FreeCameraController {
    position: vec3;
    yaw: number;
    pitch: number;
    fov: number;
    near: number;
    far: number;
    focalDistance: number;
    aperture: number;
    moveSpeed: number;
    rotateSpeed: number;
    zoomSpeed: number;

    private _direction: vec3;
    private _up: vec3;
    private _right: vec3;
    private _viewMatrix: mat4;
    private _projectionMatrix: mat4;
    private _inverseVP: mat4;
    private _prevInverseVP: mat4;
    private _viewDirty: boolean;
    private _projDirty: boolean;
    private _lastAspect: number;

    constructor() {
        this.position = vec3.fromValues(0, 1, 5);
        this.yaw = -Math.PI / 2;
        this.pitch = 0;
        this.fov = Math.PI / 3;
        this.near = 0.01;
        this.far = 1000;
        this.focalDistance = 10;
        this.aperture = 0;
        this.moveSpeed = 3;
        this.rotateSpeed = 0.003;
        this.zoomSpeed = 0.1;

        this._direction = vec3.create();
        this._up = vec3.fromValues(0, 1, 0);
        this._right = vec3.create();
        this._viewMatrix = mat4.create();
        this._projectionMatrix = mat4.create();
        this._inverseVP = mat4.create();
        this._prevInverseVP = mat4.create();
        this._viewDirty = true;
        this._projDirty = true;
        this._lastAspect = -1;

        this.updateDirection();
    }

    update(dt: number, keys: Set<string>, mouseDelta: { dx: number; dy: number }, scrollDelta: number): void {
        mat4.copy(this._prevInverseVP, this._inverseVP);

        const speedMultiplier = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3 : 1;
        const actualSpeed = this.moveSpeed * speedMultiplier * dt;

        this.yaw += mouseDelta.dx * this.rotateSpeed;
        this.pitch -= mouseDelta.dy * this.rotateSpeed;
        this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));

        this.updateDirection();

        const forward = vec3.clone(this._direction);
        const right = vec3.clone(this._right);
        const worldUp: vec3 = [0, 1, 0];

        if (keys.has('KeyW')) vec3.scaleAndAdd(this.position, this.position, forward, actualSpeed);
        if (keys.has('KeyS')) vec3.scaleAndAdd(this.position, this.position, forward, -actualSpeed);
        if (keys.has('KeyA')) vec3.scaleAndAdd(this.position, this.position, right, -actualSpeed);
        if (keys.has('KeyD')) vec3.scaleAndAdd(this.position, this.position, right, actualSpeed);
        if (keys.has('KeyE')) vec3.scaleAndAdd(this.position, this.position, worldUp, actualSpeed);
        if (keys.has('KeyQ')) vec3.scaleAndAdd(this.position, this.position, worldUp, -actualSpeed);

        if (scrollDelta !== 0) {
            this.fov -= scrollDelta * this.zoomSpeed;
            this.fov = Math.max(Math.PI / 12, Math.min(Math.PI * 2 / 3, this.fov));
            this._projDirty = true;
        }

        this._viewDirty = true;
    }

    private updateDirection(): void {
        this._direction[0] = Math.cos(this.pitch) * Math.cos(this.yaw);
        this._direction[1] = Math.sin(this.pitch);
        this._direction[2] = Math.cos(this.pitch) * Math.sin(this.yaw);
        vec3.normalize(this._direction, this._direction);

        const worldUp: vec3 = [0, 1, 0];
        vec3.cross(this._right, this._direction, worldUp);
        vec3.normalize(this._right, this._right);

        vec3.cross(this._up, this._right, this._direction);
        vec3.normalize(this._up, this._up);
    }

    getViewMatrix(): mat4 {
        if (this._viewDirty) {
            const target = vec3.create();
            vec3.add(target, this.position, this._direction);
            mat4.lookAt(this._viewMatrix, this.position, target, this._up);
            this._viewDirty = false;
        }
        return this._viewMatrix;
    }

    getProjectionMatrix(aspect: number): mat4 {
        if (this._projDirty || this._lastAspect !== aspect) {
            mat4.perspective(this._projectionMatrix, this.fov, aspect, this.near, this.far);
            this._lastAspect = aspect;
            this._projDirty = false;
        }
        return this._projectionMatrix;
    }

    getInverseViewProjection(aspect: number): mat4 {
        const vp = mat4.create();
        mat4.multiply(vp, this.getProjectionMatrix(aspect), this.getViewMatrix());
        mat4.invert(this._inverseVP, vp);
        return this._inverseVP;
    }

    getPrevInverseViewProjection(aspect: number): mat4 {
        return this._prevInverseVP;
    }

    beginFrame(aspect: number): void {
        mat4.copy(this._prevInverseVP, this.getInverseViewProjection(aspect));
        this._viewDirty = true;
        this._projDirty = true;
    }

    getPosition(): vec3 {
        return vec3.clone(this.position);
    }

    getDirection(): vec3 {
        return vec3.clone(this._direction);
    }

    getUp(): vec3 {
        return vec3.clone(this._up);
    }

    getCameraParams(aspect: number): Float32Array {
        const data = new Float32Array(CAMERA_SIZE / 4);

        data[0] = this.position[0];
        data[1] = this.position[1];
        data[2] = this.position[2];
        data[3] = this.fov;

        data[4] = this._direction[0];
        data[5] = this._direction[1];
        data[6] = this._direction[2];
        data[7] = aspect;

        data[8] = this._up[0];
        data[9] = this._up[1];
        data[10] = this._up[2];
        data[11] = this.near;

        data[12] = this.focalDistance;
        data[13] = this.aperture;
        data[14] = this.far;
        data[15] = 0;

        return data;
    }

    setPosition(x: number, y: number, z: number): void {
        this.position[0] = x;
        this.position[1] = y;
        this.position[2] = z;
        this._viewDirty = true;
    }

    setYawPitch(yaw: number, pitch: number): void {
        this.yaw = yaw;
        this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, pitch));
        this.updateDirection();
        this._viewDirty = true;
    }

    lookAt(target: vec3): void {
        const dir = vec3.create();
        vec3.sub(dir, target, this.position);
        vec3.normalize(dir, dir);

        this.yaw = Math.atan2(dir[2], dir[0]);
        this.pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));

        this.updateDirection();
        this._viewDirty = true;
    }
}
