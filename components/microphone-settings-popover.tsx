"use client";

import { useEffect, useRef } from "react";
import type { AudioInputDevice } from "@/lib/use-audio-input";

type MicrophoneSettingsPopoverProps = {
  devices: AudioInputDevice[];
  selectedDeviceId: string | null;
  gain: number;
  onDeviceChange: (deviceId: string) => void;
  onGainChange: (gain: number) => void;
  onRefreshDevices: () => void;
  onClose: () => void;
};

export function MicrophoneSettingsPopover({
  devices,
  selectedDeviceId,
  gain,
  onDeviceChange,
  onGainChange,
  onRefreshDevices,
  onClose,
}: MicrophoneSettingsPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">麦克风设置</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:text-white"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {/* 设备选择 */}
        <div>
          <label className="block text-xs font-medium text-slate-400">
            输入设备
          </label>
          {devices.length > 0 ? (
            <select
              value={selectedDeviceId ?? ""}
              onChange={(e) => onDeviceChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-white focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 text-xs text-slate-500">未检测到音频输入设备</p>
          )}
          <button
            type="button"
            onClick={onRefreshDevices}
            className="mt-1 text-xs text-slate-400 hover:text-slate-200"
          >
            刷新设备列表
          </button>
        </div>

        {/* 增益控制 */}
        <div>
          <label className="block text-xs font-medium text-slate-400">
            输入增益
          </label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-xs text-slate-500">0.5x</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={gain}
              onChange={(e) => onGainChange(parseFloat(e.target.value))}
              className="h-1.5 flex-1 appearance-none rounded-full bg-slate-700 accent-slate-400"
            />
            <span className="text-xs text-slate-500">3x</span>
          </div>
          <p className="mt-1 text-right text-xs text-slate-500">
            {gain.toFixed(1)}x
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        切换设备或调整增益不会影响系统音量，仅用于音量显示参考。
      </p>
    </div>
  );
}