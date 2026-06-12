"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MicrophoneStatus } from "./use-audio-input";

type UseMicrophoneMonitorOptions = {
  stream: MediaStream | null;
  /** 增益倍数，默认为 1 */
  gain?: number;
  /** 是否开启返听（将输入输出到扬声器），默认 false */
  sidetone?: boolean;
};

export const PREFERRED_GAIN_KEY = "roadshow:preferred-audio-gain";

export function loadPreferredGain(): number {
  if (typeof window === "undefined") return 1;
  try {
    const raw = localStorage.getItem(PREFERRED_GAIN_KEY);
    if (raw !== null) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 3) return parsed;
    }
  } catch {
    // localStorage 不可用
  }
  return 1;
}

export function savePreferredGain(gain: number) {
  try {
    localStorage.setItem(PREFERRED_GAIN_KEY, String(gain));
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function useMicrophoneMonitor({
  stream,
  gain = 1,
  sidetone = false,
}: UseMicrophoneMonitorOptions) {
  const [volume, setVolume] = useState(0);
  const [status, setStatus] = useState<MicrophoneStatus>("unchecked");
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastVolumeTimeRef = useRef<number>(0);
  const gainRef = useRef(gain);
  const sidetoneRef = useRef(sidetone);

  // 同步 gain 到 ref，避免在 rAF 中读取到旧值
  useEffect(() => {
    gainRef.current = gain;
  }, [gain]);

  // 同步 sidetone 到 ref
  useEffect(() => {
    sidetoneRef.current = sidetone;
  }, [sidetone]);

  // 独立的 sidetone 管理 effect：仅在 sidetone 变化时连接/断开 destination
  useEffect(() => {
    const gainNode = gainNodeRef.current;
    const ctx = audioContextRef.current;
    if (!gainNode || !ctx) return;

    if (sidetone) {
      try {
        gainNode.connect(ctx.destination);
      } catch {
        // 已连接时忽略
      }
    } else {
      try {
        gainNode.disconnect(ctx.destination);
      } catch {
        // 未连接时忽略
      }
    }
  }, [sidetone]);

  const cleanupAudioGraph = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {
      // AudioContext 关闭失败时静默处理
    });
    audioContextRef.current = null;
  }, []);

  useEffect(() => {
    if (!stream) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 响应 stream 变化重置状态
      setVolume(0);
      setStatus("unchecked");
      cleanupAudioGraph();
      return;
    }

    const hasLiveTrack = stream
      .getAudioTracks()
      .some((t) => t.readyState === "live");

    if (!hasLiveTrack) {
      setStatus("no-input");
      setVolume(0);
      cleanupAudioGraph();
      return;
    }

    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = gainRef.current;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(gainNode);
      gainNode.connect(analyser);

      // 按需连接返听
      if (sidetoneRef.current) {
        try {
          gainNode.connect(audioContext.destination);
        } catch {
          // 连接失败时忽略
        }
      }

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
      sourceRef.current = source;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      lastVolumeTimeRef.current = Date.now();

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // 更新增益值
        if (gainNodeRef.current) {
          gainNodeRef.current.gain.value = gainRef.current;
        }

        const sum = dataArray.reduce((acc, v) => acc + v, 0);
        const avg = sum / dataArray.length;
        const normalizedVolume = Math.min(1, avg / 128);

        setVolume(normalizedVolume);

        if (normalizedVolume > 0.01) {
          lastVolumeTimeRef.current = Date.now();
          setStatus("connected");
        } else {
          const silenceDuration = Date.now() - lastVolumeTimeRef.current;
          if (silenceDuration > 2000) {
            setStatus("no-input");
          }
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      tick();
      setStatus("connected");
    } catch {
      setStatus("error");
      cleanupAudioGraph();
    }

    return cleanupAudioGraph;
  }, [stream, cleanupAudioGraph]);

  return { volume, status };
}