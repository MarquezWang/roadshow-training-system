"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  buildEndPitchRequestBody,
  getPitchTiming,
  getQaPreparePath,
} from "./training-session-policy";

type UseTrainingPitchEndOptions = Readonly<{
  currentPageNumber: number;
  elapsedSec: number;
  handlePitchEndedWithoutRecording: () => void;
  hasAutoEndedPitchRef: MutableRefObject<boolean>;
  isCompletingNormallyRef: MutableRefObject<boolean>;
  isPitching: boolean;
  isRecordingActive: () => boolean;
  markTranscribePreparing: () => void;
  primaryFileId: string | null;
  redirectToQaAfterPitchEnd: boolean;
  remainingSec: number;
  sessionId: string;
  setElapsedSec: Dispatch<SetStateAction<number>>;
  setIsSubmitting: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setPageIndex: Dispatch<SetStateAction<number>>;
  setRemainingSec: Dispatch<SetStateAction<number>>;
  setStatus: Dispatch<SetStateAction<string>>;
  stopRecordingAndUpload: () => Promise<string | undefined>;
  triggerTranscribe: (recordingId?: string) => Promise<void>;
}>;

export function useTrainingPitchEnd({
  currentPageNumber,
  elapsedSec,
  handlePitchEndedWithoutRecording,
  hasAutoEndedPitchRef,
  isCompletingNormallyRef,
  isPitching,
  isRecordingActive,
  markTranscribePreparing,
  primaryFileId,
  redirectToQaAfterPitchEnd,
  remainingSec,
  sessionId,
  setElapsedSec,
  setIsSubmitting,
  setMessage,
  setPageIndex,
  setRemainingSec,
  setStatus,
  stopRecordingAndUpload,
  triggerTranscribe,
}: UseTrainingPitchEndOptions) {
  const router = useRouter();
  const endPitch = useCallback(async () => {
    setIsSubmitting(true);
    setMessage("");
    const shouldUploadRecording = isRecordingActive();

    try {
      const response = await fetch(`/training/${sessionId}/end-pitch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildEndPitchRequestBody({
            pitchDurationSec: elapsedSec,
            pageIndex: currentPageNumber,
            fileId: primaryFileId,
          }),
        ),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "结束路演失败。");
      }

      const body = (await response.json()) as {
        session: {
          status: string;
          pitchDurationSec: number;
          currentPageIndex: number;
        };
      };
      const timing = getPitchTiming(null, body.session.pitchDurationSec);

      setStatus(body.session.status);
      setPageIndex(Math.max(0, body.session.currentPageIndex - 1));
      setElapsedSec(timing.elapsedSec);
      setRemainingSec(timing.remainingSec);

      let savedPitchRecordingId: string | undefined;

      if (shouldUploadRecording) {
        const savedRecordingId = await stopRecordingAndUpload();

        if (savedRecordingId) {
          savedPitchRecordingId = savedRecordingId;
          // 启动后台转写，不等待真实 ASR 完成。
          await triggerTranscribe(savedRecordingId);
          markTranscribePreparing();
        }
      } else {
        handlePitchEndedWithoutRecording();
      }

      if (redirectToQaAfterPitchEnd) {
        isCompletingNormallyRef.current = true;
        router.replace(getQaPreparePath(sessionId, savedPitchRecordingId));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "结束路演失败。");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    currentPageNumber,
    elapsedSec,
    handlePitchEndedWithoutRecording,
    isCompletingNormallyRef,
    isRecordingActive,
    markTranscribePreparing,
    primaryFileId,
    redirectToQaAfterPitchEnd,
    router,
    sessionId,
    setElapsedSec,
    setIsSubmitting,
    setMessage,
    setPageIndex,
    setRemainingSec,
    setStatus,
    stopRecordingAndUpload,
    triggerTranscribe,
  ]);

  useEffect(() => {
    if (!isPitching || remainingSec > 0 || hasAutoEndedPitchRef.current) {
      return;
    }

    hasAutoEndedPitchRef.current = true;
    void endPitch();
  }, [endPitch, hasAutoEndedPitchRef, isPitching, remainingSec]);

  return { endPitch };
}
