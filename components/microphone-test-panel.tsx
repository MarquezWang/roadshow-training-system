"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioInput } from "@/lib/use-audio-input";
import { useMicrophoneMonitor, loadPreferredGain, savePreferredGain } from "@/lib/use-microphone-monitor";
import type { MicrophoneStatus } from "@/lib/use-audio-input";

type MicrophoneTestPanelProps = {
  onReady: () => void;
  /** 外部传入是否正在等待确认 */
  isPreparing: boolean;
};

const statusLabelMap: Record<MicrophoneStatus, string> = {
  unchecked: "未检测",
  requesting: "检测中",
  denied: "未授权",
  connected: "已连接",
  "no-input": "无输入",
  error: "异常",
};

const statusColorMap: Record<MicrophoneStatus, string> = {
  unchecked: "bg-slate-200 text-slate-600",
  requesting: "bg-blue-100 text-blue-700",
  denied: "bg-red-100 text-red-700",
  connected: "bg-green-100 text-green-700",
  "no-input": "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
};

export function MicrophoneTestPanel({
  onReady,
  isPreparing,
}: MicrophoneTestPanelProps) {
  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    getStream,
    refreshDevices,
  } = useAudioInput();

  const [testStream, setTestStream] = useState<MediaStream | null>(null);
  const [testStatus, setTestStatus] = useState<MicrophoneStatus>("requesting");
  const [errorMessage, setErrorMessage] = useState("");
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [gain, setGain] = useState(loadPreferredGain);
  const [sidetoneEnabled, setSidetoneEnabled] = useState(false);
  const [isSwitchingDevice, setIsSwitchingDevice] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);

  const { volume, status: monitorStatus } = useMicrophoneMonitor({
    stream: testStream,
    gain,
    sidetone: sidetoneEnabled,
  });

  // 同步 monitorStatus 到 testStatus
  useEffect(() => {
    if (testStream) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 同步外部 hook 状态
      setTestStatus(monitorStatus);
    }
  }, [monitorStatus, testStream]);

  const stopTestStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTestStream(null);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // 自动开始测试
  const startTest = useCallback(async () => {
    setErrorMessage("");
    setTestStatus("requesting");

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setTestStatus("error");
      setErrorMessage("当前浏览器不支持麦克风访问。");
      return;
    }

    try {
      const stream = await getStream();
      if (!stream) {
        setTestStatus("denied");
        setErrorMessage("无法获取麦克风权限，请检查浏览器设置。");
        return;
      }

      const hasLiveTrack = stream
        .getAudioTracks()
        .some((t) => t.readyState === "live");

      if (!hasLiveTrack) {
        stream.getTracks().forEach((t) => t.stop());
        setTestStatus("no-input");
        setErrorMessage("未检测到可用的麦克风音轨。");
        return;
      }

      stopTestStream();
      streamRef.current = stream;
      setTestStream(stream);
      // 刷新设备列表以获取带 label 的设备名
      void refreshDevices();
    } catch {
      setTestStatus("denied");
      setErrorMessage("麦克风权限被拒绝或设备不可用。");
    }
  }, [getStream, refreshDevices, stopTestStream]);

  // 挂载时自动启动测试
  const startedRef = useRef(false);
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      void startTest();
    }
  }, [startTest]);

  const handleDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      setIsSwitchingDevice(true);
      setErrorMessage("");
      void (async () => {
        try {
          const stream = await getStream();
          if (stream) {
            stopTestStream();
            streamRef.current = stream;
            setTestStream(stream);
          } else {
            setTestStatus("error");
            setErrorMessage("切换设备失败，请重新选择。");
          }
        } catch {
          setTestStatus("error");
          setErrorMessage("切换设备时发生错误，请重试。");
        } finally {
          setIsSwitchingDevice(false);
        }
      })();
    },
    [getStream, setSelectedDeviceId, stopTestStream],
  );

  const handleConfirm = useCallback(() => {
    // 强制关闭返听
    setSidetoneEnabled(false);
    // 保存增益设置
    savePreferredGain(gain);
    // 停止测试流
    stopTestStream();
    setIsConfirmed(true);
    onReady();
  }, [onReady, gain, stopTestStream]);

  const isTesting = testStream !== null || isSwitchingDevice;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-slate-950">麦克风测试</h4>

      {/* 提示文案 */}
      <div className="mt-2 space-y-1 rounded-md bg-amber-50 p-2.5 text-xs leading-5 text-amber-800">
        <p>建议佩戴耳机进行测试，避免扬声器外放产生啸叫。</p>
        <p>麦克风音量仅影响本系统录音和检测，不会修改电脑系统音量。</p>
      </div>

      {isTesting && !isConfirmed ? (
        <div className="mt-3 space-y-3">
          {/* 状态标签 */}
          <div className="flex items-center gap-2">
            {isSwitchingDevice ? (
              <span className="inline-flex h-6 items-center rounded-full bg-blue-100 px-2.5 text-xs font-medium text-blue-700">
                正在切换输入设备...
              </span>
            ) : (
              <span
                className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${statusColorMap[testStatus]}`}
              >
                {statusLabelMap[testStatus]}
              </span>
            )}
            {errorMessage ? (
              <span className="text-xs text-red-600">{errorMessage}</span>
            ) : null}
          </div>

          {/* 设备选择 */}
          {devices.length > 1 ? (
            <div>
              <label className="block text-xs font-medium text-slate-600">
                声音输入设备
              </label>
              <select
                value={selectedDeviceId ?? ""}
                onChange={(e) => handleDeviceChange(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          ) : devices.length === 1 ? (
            <p className="text-xs text-slate-500">
              输入设备：{devices[0].label}
            </p>
          ) : null}

          {/* 音量条 */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">
                实时音量
              </span>
              <span className="text-xs text-slate-400">
                {Math.round(volume * 100)}%
              </span>
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-green-500 transition-all duration-75"
                style={{ width: `${volume * 100}%` }}
              />
            </div>
          </div>

          {/* 增益滑块 */}
          <div>
            <label className="block text-xs font-medium text-slate-600">
              麦克风音量 / 输入增益
            </label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs text-slate-500">0.5x</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.1"
                value={gain}
                onChange={(e) => setGain(parseFloat(e.target.value))}
                className="h-1.5 flex-1 appearance-none rounded-full bg-slate-200 accent-slate-600"
              />
              <span className="text-xs text-slate-500">3x</span>
            </div>
            <p className="mt-0.5 text-right text-xs text-slate-400">
              {gain.toFixed(1)}x
            </p>
          </div>

          {/* 返听开关 */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={sidetoneEnabled}
              onChange={(e) => setSidetoneEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-500"
            />
            <span className="text-sm text-slate-700">听到自己的声音</span>
          </label>

          {/* 确认按钮 */}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isPreparing}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            确认麦克风，准备训练
          </button>
        </div>
      ) : null}

      {!isTesting && !isConfirmed ? (
        <div className="mt-3">
          <p className="text-sm text-slate-500">正在启动麦克风测试...</p>
          {errorMessage ? (
            <p className="mt-2 text-sm text-red-600">{errorMessage}</p>
          ) : null}
        </div>
      ) : null}

      {isConfirmed ? (
        <p className="mt-3 text-sm text-green-700">麦克风已就绪</p>
      ) : null}
    </div>
  );
}