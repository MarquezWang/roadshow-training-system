"use client";

import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { getPitchTiming } from "./training-session-policy";

type UseTrainingPitchTimerOptions = Readonly<{
  isGuardResolved: boolean;
  isPitching: boolean;
  pitchStartedAt: string | null;
  setElapsedSec: Dispatch<SetStateAction<number>>;
  setRemainingSec: Dispatch<SetStateAction<number>>;
}>;

export function useTrainingPitchTimer({
  isGuardResolved,
  isPitching,
  pitchStartedAt,
  setElapsedSec,
  setRemainingSec,
}: UseTrainingPitchTimerOptions) {
  useEffect(() => {
    if (!isPitching || !isGuardResolved) {
      return;
    }

    const updateTimer = () => {
      const timing = getPitchTiming(pitchStartedAt, 0);

      setElapsedSec(timing.elapsedSec);
      setRemainingSec(timing.remainingSec);
    };

    updateTimer();
    const timer = window.setInterval(updateTimer, 1000);

    return () => window.clearInterval(timer);
  }, [
    isGuardResolved,
    isPitching,
    pitchStartedAt,
    setElapsedSec,
    setRemainingSec,
  ]);
}
