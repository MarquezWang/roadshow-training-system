"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioInput } from "@/lib/use-audio-input";
import {
  useMicrophoneMonitor,
  loadPreferredGain,
  savePreferredGain,
} from "@/lib/use-microphone-monitor";
import { MicrophoneSettingsPopover } from "./microphone-settings-popover";
import type { MicrophoneStatus } from "@/lib/use-audio-input";

const statusColorMap: Record<MicrophoneStatus, string> = {
  unchecked: "text-slate-400",
  requesting: "text-blue-400",
  denied: "text-red-400",
  connected: "text-green-400",
  "no-input": "text-amber-400",
  error: "text-red-400",
};

export function MicrophoneStatusBar() {
  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    getStream,
    refreshDevices,
  } = useAudioInput();

  const [monitorStream, setMonitorStream] = useState<MediaStream | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [gain, setGain] = useState(loadPreferredGain);
  const streamRef = useRef<MediaStream | null>(null);

  const { volume, status } = useMicrophoneMonitor({
    stream: monitorStream,
    gain,
    // pitch / QA 页面永不开启返听
    sidetone: false,
  });

  // 启动监控流
  const startMonitorStream = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    try {
      const stream = await getStream();
      if (stream) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        setMonitorStream(stream);
      }
    } catch {
      // 监控流获取失败不影响主流程
    }
  }, [getStream]);

  // 启动时自动获取监控流
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 启动时获取监控流
    void startMonitorStream();
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [startMonitorStream]);

  // 切换设备时重新获取监控流
  useEffect(() => {
    if (monitorStream) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 切换设备时重新获取流
      void startMonitorStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId]);

  const handleDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
    },
    [setSelectedDeviceId],
  );

  const handleGainChange = useCallback((newGain: number) => {
    setGain(newGain);
    savePreferredGain(newGain);
  }, []);

  const handleRefreshDevices = useCallback(() => {
    void refreshDevices();
  }, [refreshDevices]);

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setShowSettings((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        title="麦克风设置"
      >
        {/* 麦克风图标 */}
        <svg
          className={`h-4 w-4 ${statusColorMap[status]}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 10v2a7 7 0 0 1-14 0v-2"
          />
          <line
            strokeLinecap="round"
            strokeLinejoin="round"
            x1="12"
            y1="19"
            x2="12"
            y2="23"
          />
          <line
            strokeLinecap="round"
            strokeLinejoin="round"
            x1="8"
            y1="23"
            x2="16"
            y2="23"
          />
        </svg>
        {/* 迷你音量条 */}
        <div className="flex h-3 w-12 items-end gap-px">
          {Array.from({ length: 8 }).map((_, i) => {
            const threshold = (i + 1) / 8;
            const isActive = volume >= threshold;
            return (
              <div
                key={i}
                className={`flex-1 rounded-sm transition-all ${
                  isActive ? "bg-green-400" : "bg-slate-300"
                }`}
                style={{ height: `${Math.max(2, (i + 1) * 1.5)}px` }}
              />
            );
          })}
        </div>
      </button>

      {showSettings ? (
        <MicrophoneSettingsPopover
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          gain={gain}
          onDeviceChange={handleDeviceChange}
          onGainChange={handleGainChange}
          onRefreshDevices={handleRefreshDevices}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}