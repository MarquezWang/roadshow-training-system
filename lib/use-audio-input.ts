"use client";

import { useCallback, useEffect, useState } from "react";

export type MicrophoneStatus =
  | "unchecked"
  | "requesting"
  | "denied"
  | "connected"
  | "no-input"
  | "error";

export type AudioInputDevice = {
  deviceId: string;
  label: string;
  groupId: string;
};

export const PREFERRED_DEVICE_KEY = "roadshow:preferred-audio-device-id";

function loadPreferredDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PREFERRED_DEVICE_KEY);
  } catch {
    return null;
  }
}

function savePreferredDeviceId(deviceId: string) {
  try {
    localStorage.setItem(PREFERRED_DEVICE_KEY, deviceId);
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function useAudioInput() {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(
    loadPreferredDeviceId,
  );
  const [permissionGranted, setPermissionGranted] = useState(false);

  const refreshDevices = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      return;
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const rawAudioInputs = allDevices.filter(
        (device) => device.kind === "audioinput" && device.deviceId,
      );
      const hasPermission = rawAudioInputs.some((device) => device.label);
      const audioInputs: AudioInputDevice[] = rawAudioInputs
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}`,
          groupId: d.groupId || "",
        }));

      setDevices(audioInputs);
      setPermissionGranted(hasPermission);

      if (hasPermission) {
        setSelectedDeviceIdState((prev) => {
          if (prev && !audioInputs.some((d) => d.deviceId === prev)) {
            const firstId = audioInputs[0]?.deviceId ?? null;
            if (firstId) savePreferredDeviceId(firstId);
            return firstId;
          }
          return prev;
        });
      }
    } catch {
      // enumerateDevices 失败时不处理
    }
  }, []);

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    setSelectedDeviceIdState(deviceId);
    savePreferredDeviceId(deviceId);
  }, []);

  const getStream = useCallback(
    async (): Promise<MediaStream | null> => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        return null;
      }

      const audioConstraints: MediaTrackConstraints = selectedDeviceId
        ? { deviceId: { exact: selectedDeviceId } }
        : {};

      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
      } catch {
        // 如果精确 deviceId 失败，尝试不带 deviceId
        if (selectedDeviceId) {
          try {
            return await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            return null;
          }
        }
        return null;
      }
    },
    [selectedDeviceId],
  );

  useEffect(() => {
    // enumerateDevices 不会主动申请麦克风权限。
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始化时只读枚举设备
    refreshDevices();
  }, [refreshDevices]);

  // 监听设备变化
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices
    ) {
      return;
    }

    const handler = () => {
      void refreshDevices();
    };

    try {
      navigator.mediaDevices.addEventListener("devicechange", handler);
      return () => {
        navigator.mediaDevices.removeEventListener("devicechange", handler);
      };
    } catch {
      // 某些浏览器不支持 devicechange 事件
    }
  }, [refreshDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    getStream,
    refreshDevices,
    permissionGranted,
  };
}
