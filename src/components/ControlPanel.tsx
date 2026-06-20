import { useState } from 'react';
import { Settings, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useRendererStore } from '@/store/useRendererStore';
import { TONEMAP_TYPE_NONE, TONEMAP_TYPE_ACES, TONEMAP_TYPE_REINHARD, TONEMAP_TYPE_FILMIC } from '@/types';

const tonemapOptions = [
    { label: 'None', value: TONEMAP_TYPE_NONE },
    { label: 'ACES', value: TONEMAP_TYPE_ACES },
    { label: 'Reinhard', value: TONEMAP_TYPE_REINHARD },
    { label: 'Filmic', value: TONEMAP_TYPE_FILMIC },
];

function Section({
    title,
    children,
    defaultOpen = true,
}: {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-white/10 last:border-b-0">
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-200 hover:bg-white/5 transition-colors"
            >
                <span>{title}</span>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
        </div>
    );
}

function Slider({
    label,
    value,
    min,
    max,
    step = 0.01,
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (v: number) => void;
}) {
    return (
        <div className="space-y-1">
            <div className="flex justify-between text-xs">
                <span className="text-gray-400">{label}</span>
                <span className="text-cyan-400 font-mono">{value.toFixed(2)}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
        </div>
    );
}

function Toggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{label}</span>
            <button
                onClick={() => onChange(!checked)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                    checked ? 'bg-cyan-500' : 'bg-white/20'
                }`}
            >
                <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        checked ? 'translate-x-5' : ''
                    }`}
                />
            </button>
        </div>
    );
}

function Select({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: number;
    options: { label: string; value: number }[];
    onChange: (v: number) => void;
}) {
    return (
        <div className="space-y-1">
            <span className="text-xs text-gray-400">{label}</span>
            <select
                value={value}
                onChange={(e) => onChange(parseInt(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-gray-200 focus:outline-none focus:border-cyan-500"
            >
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-gray-900">
                        {opt.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

export default function ControlPanel() {
    const [visible, setVisible] = useState(true);
    const renderSettings = useRendererStore((s) => s.renderSettings);
    const cameraParams = useRendererStore((s) => s.cameraParams);
    const updateSettings = useRendererStore((s) => s.updateSettings);
    const updateCameraParams = useRendererStore((s) => s.updateCameraParams);

    if (!visible) {
        return (
            <button
                onClick={() => setVisible(true)}
                className="fixed top-4 right-4 z-40 p-3 rounded-lg glass-panel hover:bg-white/20 transition-all"
            >
                <Settings size={20} className="text-cyan-400" />
            </button>
        );
    }

    return (
        <div className="fixed top-4 right-4 z-40 w-80 rounded-xl glass-panel overflow-hidden shadow-2xl shadow-cyan-500/10 neon-border">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <Settings size={18} className="text-cyan-400" />
                    <span className="text-sm font-semibold text-white">渲染设置</span>
                </div>
                <button
                    onClick={() => setVisible(false)}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                >
                    <X size={16} className="text-gray-400" />
                </button>
            </div>

            <div className="max-h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar">
                <Section title="渲染设置">
                    <Slider
                        label="每帧采样数"
                        value={renderSettings.samplesPerFrame}
                        min={1}
                        max={4}
                        step={1}
                        onChange={(v) => updateSettings({ samplesPerFrame: v })}
                    />
                    <Slider
                        label="最大反弹次数"
                        value={renderSettings.maxBounces}
                        min={1}
                        max={16}
                        step={1}
                        onChange={(v) => updateSettings({ maxBounces: v })}
                    />
                    <Toggle
                        label="启用下一级事件估计 (NEE)"
                        checked={renderSettings.enableNEE}
                        onChange={(v) => updateSettings({ enableNEE: v })}
                    />
                    <Toggle
                        label="启用多重重要性采样 (MIS)"
                        checked={renderSettings.enableMIS}
                        onChange={(v) => updateSettings({ enableMIS: v })}
                    />
                    <Toggle
                        label="启用俄罗斯轮盘赌"
                        checked={renderSettings.enableRussianRoulette}
                        onChange={(v) => updateSettings({ enableRussianRoulette: v })}
                    />
                </Section>

                <Section title="降噪">
                    <Toggle
                        label="启用降噪器"
                        checked={renderSettings.enableDenoiser}
                        onChange={(v) => updateSettings({ enableDenoiser: v })}
                    />
                </Section>

                <Section title="后处理">
                    <Slider
                        label="曝光"
                        value={renderSettings.exposure}
                        min={0.1}
                        max={5.0}
                        onChange={(v) => updateSettings({ exposure: v })}
                    />
                    <Select
                        label="色调映射"
                        value={renderSettings.tonemapType}
                        options={tonemapOptions}
                        onChange={(v) => updateSettings({ tonemapType: v })}
                    />
                    <Toggle
                        label="启用 Bloom"
                        checked={renderSettings.enableBloom}
                        onChange={(v) => updateSettings({ enableBloom: v })}
                    />
                    {renderSettings.enableBloom && (
                        <>
                            <Slider
                                label="Bloom 阈值"
                                value={renderSettings.bloomThreshold}
                                min={0.5}
                                max={5.0}
                                onChange={(v) => updateSettings({ bloomThreshold: v })}
                            />
                            <Slider
                                label="Bloom 强度"
                                value={renderSettings.bloomIntensity}
                                min={0}
                                max={2.0}
                                onChange={(v) => updateSettings({ bloomIntensity: v })}
                            />
                        </>
                    )}
                    <Toggle
                        label="启用景深 (DOF)"
                        checked={renderSettings.enableDOF}
                        onChange={(v) => updateSettings({ enableDOF: v })}
                    />
                </Section>

                <Section title="相机">
                    <Slider
                        label="FOV (度)"
                        value={(cameraParams.fov * 180) / Math.PI}
                        min={30}
                        max={90}
                        step={1}
                        onChange={(v) => updateCameraParams({ fov: (v * Math.PI) / 180 })}
                    />
                    <Slider
                        label="光圈"
                        value={cameraParams.aperture ?? 0}
                        min={0}
                        max={0.5}
                        onChange={(v) => updateCameraParams({ aperture: v })}
                    />
                    <Slider
                        label="焦距"
                        value={cameraParams.focalDistance ?? 10}
                        min={0.1}
                        max={100}
                        onChange={(v) => updateCameraParams({ focalDistance: v })}
                    />
                </Section>
            </div>
        </div>
    );
}
