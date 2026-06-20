import { useRef, useState } from 'react';
import { Box, Circle, Square, Upload, Loader2 } from 'lucide-react';
import { useRendererStore } from '@/store/useRendererStore';
import { createCornellBox, createSimpleSpheres, createPlaneScene } from '@/store/createDefaultScenes';
import type { SceneData } from '@/types';

interface SceneLoaderProps {
    onSceneLoaded: (sceneData: SceneData) => void;
    onGLTFFileSelected?: (file: File) => void;
}

const presetScenes = [
    { id: 'cornell', name: 'Cornell Box', icon: Box, creator: createCornellBox },
    { id: 'spheres', name: '材质球展示', icon: Circle, creator: createSimpleSpheres },
    { id: 'plane', name: '反射测试场', icon: Square, creator: createPlaneScene },
];

export default function SceneLoader({ onSceneLoaded, onGLTFFileSelected }: SceneLoaderProps) {
    const [isLoading, setIsLoading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const setLoading = useRendererStore((s) => s.setLoading);
    const setError = useRendererStore((s) => s.setError);
    const updateSceneInfo = useRendererStore((s) => s.updateSceneInfo);

    const loadPresetScene = (creator: () => SceneData) => {
        setIsLoading(true);
        setLoading(true);
        try {
            const sceneData = creator();
            onSceneLoaded(sceneData);
            updateSceneInfo({
                triangleCount: sceneData.triangles.length,
                materialCount: sceneData.materials.length,
                instanceCount: sceneData.instances.length,
                lightCount: sceneData.lights.length,
            });
        } catch (error) {
            setError(error instanceof Error ? error.message : '加载场景失败');
        } finally {
            setIsLoading(false);
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (onGLTFFileSelected) {
            setIsLoading(true);
            setLoading(true);
            onGLTFFileSelected(file);
            setIsLoading(false);
            setLoading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        setIsLoading(true);
        setLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const blob = new Blob([arrayBuffer], {
                type: file.name.endsWith('.glb') ? 'model/gltf-binary' : 'model/gltf+json',
            });
            const url = URL.createObjectURL(blob);

            const { SceneManager } = await import('@/core/scene/SceneManager');
            const tempManager = new SceneManager();
            const loaded = await tempManager.loadGLTF(url);

            URL.revokeObjectURL(url);

            onSceneLoaded(loaded.sceneData);
            updateSceneInfo({
                triangleCount: loaded.sceneData.triangles.length,
                materialCount: loaded.sceneData.materials.length,
                instanceCount: loaded.sceneData.instances.length,
                lightCount: loaded.sceneData.lights.length,
            });
        } catch (error) {
            setError(error instanceof Error ? error.message : '加载 GLTF 文件失败');
        } finally {
            setIsLoading(false);
            setLoading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-xl glass-panel p-3 shadow-2xl shadow-cyan-500/10">
            <div className="flex items-center gap-2">
                {presetScenes.map((scene) => (
                    <button
                        key={scene.id}
                        onClick={() => loadPresetScene(scene.creator)}
                        disabled={isLoading}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/50 transition-all text-sm text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        {isLoading ? (
                            <Loader2 size={16} className="animate-spin text-cyan-400" />
                        ) : (
                            <scene.icon size={16} className="text-cyan-400 group-hover:text-cyan-300" />
                        )}
                        <span>{scene.name}</span>
                    </button>
                ))}

                <div className="w-px h-8 bg-white/10 mx-1" />

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".gltf,.glb"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="gltf-upload"
                />
                <label
                    htmlFor="gltf-upload"
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500/20 to-purple-500/20 hover:from-cyan-500/30 hover:to-purple-500/30 border border-cyan-500/30 hover:border-cyan-500/50 transition-all text-sm text-gray-200 cursor-pointer disabled:opacity-50"
                >
                    <Upload size={16} className="text-cyan-400" />
                    <span>上传 GLTF</span>
                </label>
            </div>
        </div>
    );
}
