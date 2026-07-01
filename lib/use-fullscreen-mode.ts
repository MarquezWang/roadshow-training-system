"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseFullscreenModeOptions = {
  initialBigScreenMode?: boolean;
  onLayoutChanged?: () => void;
};

export function useFullscreenMode({
  initialBigScreenMode = false,
  onLayoutChanged,
}: UseFullscreenModeOptions = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isBigScreenMode, setIsBigScreenMode] = useState(
    initialBigScreenMode,
  );
  const [isFullscreenSupported, setIsFullscreenSupported] = useState(false);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [fullscreenMessage, setFullscreenMessage] = useState("");

  const notifyLayoutChanged = useCallback(() => {
    onLayoutChanged?.();
  }, [onLayoutChanged]);

  useEffect(() => {
    setIsFullscreenSupported(
      Boolean(document.fullscreenEnabled && containerRef.current),
    );

    const handleFullscreenChange = () => {
      setIsFullscreenActive(document.fullscreenElement !== null);
      notifyLayoutChanged();
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [notifyLayoutChanged]);

  const enterBigScreen = useCallback(
    async (requestBrowserFullscreen = true) => {
      setFullscreenMessage("");
      setIsBigScreenMode(true);
      notifyLayoutChanged();

      if (!requestBrowserFullscreen) {
        return true;
      }

      if (!document.fullscreenEnabled || !containerRef.current) {
        setFullscreenMessage("当前浏览器不支持全屏，可继续使用大屏模式。");
        return false;
      }

      try {
        await containerRef.current.requestFullscreen();
        return true;
      } catch {
        setFullscreenMessage("浏览器阻止了自动全屏，请点击“进入全屏”。");
        return false;
      }
    },
    [notifyLayoutChanged],
  );

  const exitBigScreen = useCallback(async () => {
    setIsBigScreenMode(false);
    setFullscreenMessage("");
    notifyLayoutChanged();

    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {
        setFullscreenMessage("退出浏览器全屏失败，可按 Esc 退出。");
      });
    }
  }, [notifyLayoutChanged]);

  return {
    containerRef,
    isBigScreenMode,
    isFullscreenSupported,
    isFullscreenActive,
    fullscreenMessage,
    enterBigScreen,
    exitBigScreen,
  };
}
