import { useEffect, useRef } from 'react';
import { DeviceManager } from '@/core/webgpu/DeviceManager';

interface RenderCanvasProps {
    width: number;
    height: number;
    onReady: (canvas: HTMLCanvasElement) => void;
}

export default function RenderCanvas({ width, height, onReady }: RenderCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const keysRef = useRef<Set<string>>(new Set());
    const mouseDeltaRef = useRef({ dx: 0, dy: 0 });
    const scrollDeltaRef = useRef(0);
    const isPointerLockedRef = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = width;
        canvas.height = height;

        const init = async () => {
            try {
                const deviceManager = DeviceManager.getInstance();
                await deviceManager.initialize(canvas);
                onReady(canvas);
            } catch (error) {
                console.error('Failed to initialize WebGPU:', error);
            }
        };

        init();

        const handleKeyDown = (e: KeyboardEvent) => {
            keysRef.current.add(e.code);
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            keysRef.current.delete(e.code);
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (isPointerLockedRef.current) {
                mouseDeltaRef.current.dx += e.movementX;
                mouseDeltaRef.current.dy += e.movementY;
            }
        };

        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            scrollDeltaRef.current += e.deltaY * 0.01;
        };

        const handleClick = () => {
            if (!isPointerLockedRef.current) {
                canvas.requestPointerLock();
            }
        };

        const handlePointerLockChange = () => {
            isPointerLockedRef.current = document.pointerLockElement === canvas;
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('click', handleClick);
        document.addEventListener('pointerlockchange', handlePointerLockChange);

        (window as any).__renderInput = {
            keys: keysRef.current,
            mouseDelta: mouseDeltaRef.current,
            scrollDelta: scrollDeltaRef.current,
        };

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('click', handleClick);
            document.removeEventListener('pointerlockchange', handlePointerLockChange);
        };
    }, [width, height, onReady]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 w-full h-full block cursor-crosshair"
            style={{ touchAction: 'none' }}
        />
    );
}
