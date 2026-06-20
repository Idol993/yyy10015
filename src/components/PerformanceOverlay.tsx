import { useEffect, useState } from 'react';
import { useRendererStore } from '@/store/useRendererStore';

export default function PerformanceOverlay() {
    const metrics = useRendererStore((s) => s.performanceMetrics);
    const sceneInfo = useRendererStore((s) => s.sceneInfo);
    const [displayData, setDisplayData] = useState({
        fps: 0,
        frameTime: 0,
        passTimes: {} as Record<string, number>,
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setDisplayData({
                fps: metrics.fps,
                frameTime: metrics.frameTime,
                passTimes: { ...metrics.passTimes },
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [metrics]);

    const maxPassTime = Math.max(1, ...Object.values(displayData.passTimes));

    return (
        <div className="fixed top-4 left-4 z-40 rounded-xl glass-panel p-4 min-w-[220px] shadow-2xl shadow-cyan-500/10">
            <div className="flex items-baseline gap-2 mb-3">
                <span className="text-4xl font-bold text-cyan-400 font-mono neon-text">
                    {displayData.fps}
                </span>
                <span className="text-sm text-gray-400">FPS</span>
            </div>

            <div className="text-xs text-gray-400 mb-3">
                <span className="text-gray-200 font-mono">{displayData.frameTime.toFixed(1)}</span> ms / 帧
            </div>

            <div className="border-t border-white/10 pt-3 mb-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                    <span className="text-gray-400">三角形数</span>
                    <span className="text-gray-200 font-mono">
                        {(sceneInfo.triangleCount || metrics.triangleCount).toLocaleString()}
                    </span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-400">BVH 节点</span>
                    <span className="text-gray-200 font-mono">
                        {(sceneInfo.bvhNodeCount || metrics.bvhNodeCount).toLocaleString()}
                    </span>
                </div>
            </div>

            {Object.keys(displayData.passTimes).length > 0 && (
                <div className="border-t border-white/10 pt-3">
                    <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Pass 耗时</div>
                    <div className="space-y-1.5">
                        {Object.entries(displayData.passTimes).map(([name, time]) => (
                            <div key={name} className="space-y-0.5">
                                <div className="flex justify-between text-xs">
                                    <span className="text-gray-400">{name}</span>
                                    <span className="text-cyan-300 font-mono">{time.toFixed(2)}ms</span>
                                </div>
                                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full transition-all duration-300"
                                        style={{ width: `${(time / maxPassTime) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
