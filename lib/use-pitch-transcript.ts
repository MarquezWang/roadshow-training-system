"use client";

import { useCallback, useState } from "react";
import { devLog } from "@/lib/dev-log";

export type TrainingTranscript = {
  id: string;
  recordingId: string;
  sessionId: string;
  status: string;
  source: string;
  language: string;
  text: string;
  segmentsJson: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TranscribeStatus =
  | "idle"
  | "transcribing"
  | "completed"
  | "failed";

type SavedRecordingRef = {
  id: string;
};

type UsePitchTranscriptOptions = {
  sessionId: string;
  recordingId: string;
  initialTranscript: TrainingTranscript | null;
};

export function usePitchTranscript({
  sessionId,
  recordingId,
  initialTranscript,
}: UsePitchTranscriptOptions) {
  const [activeRecordingId, setActiveRecordingId] = useState(recordingId);
  const [transcript, setTranscript] =
    useState<TrainingTranscript | null>(initialTranscript);
  const [transcriptDraft, setTranscriptDraft] = useState(
    initialTranscript?.text ?? "",
  );
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(
    !initialTranscript,
  );
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [transcribeStatus, setTranscribeStatus] = useState<TranscribeStatus>(
    initialTranscript?.status === "COMPLETED" && initialTranscript.text
      ? "completed"
      : "idle",
  );
  const [transcribeErrorMessage, setTranscribeErrorMessage] = useState("");

  const resetTranscriptAfterRecordingSaved = useCallback(
    (recording: SavedRecordingRef) => {
      setActiveRecordingId(recording.id);
      setTranscript(null);
      setTranscriptDraft("");
      setIsTranscriptEditing(true);
      setTranscriptMessage("");
    },
    [],
  );

  const saveTranscript = useCallback(async () => {
    const text = transcriptDraft.trim();

    if (!activeRecordingId) {
      setTranscriptMessage("录音尚未保存，不能保存转写文本。");
      return;
    }

    if (!text) {
      setTranscriptMessage("转写文本不能为空。");
      return;
    }

    setIsTranscriptSaving(true);
    setTranscriptMessage("");

    try {
      const response = await fetch(
        `/training/${sessionId}/recordings/${activeRecordingId}/transcript`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text,
            source: "MANUAL",
            language: "zh-CN",
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "转写文本保存失败。");
      }

      const body = (await response.json()) as {
        transcript: TrainingTranscript;
      };

      setTranscript(body.transcript);
      setTranscriptDraft(body.transcript.text);
      setIsTranscriptEditing(false);
      setTranscriptMessage("转写文本已保存。");
    } catch (error) {
      setTranscriptMessage(
        error instanceof Error ? error.message : "转写文本保存失败。",
      );
    } finally {
      setIsTranscriptSaving(false);
    }
  }, [activeRecordingId, sessionId, transcriptDraft]);

  const startTranscriptEditing = useCallback(() => {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(true);
    setTranscriptMessage("");
  }, [transcript]);

  const cancelTranscriptEditing = useCallback(() => {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(false);
    setTranscriptMessage("");
  }, [transcript]);

  const triggerTranscribe = useCallback(
    async (targetRecordingId?: string) => {
      const rid = targetRecordingId ?? activeRecordingId;

      if (!rid) {
        setTranscribeErrorMessage("没有录音 ID，无法触发转写。");
        return;
      }

      const transcribeUrl = `/training/${sessionId}/recordings/${rid}/transcribe/start`;
      devLog("[triggerTranscribe]", {
        sessionId,
        savedRecordingId: targetRecordingId,
        recordingId: activeRecordingId,
        rid,
        transcribeUrl,
      });

      setTranscribeStatus("transcribing");
      setTranscribeErrorMessage("");

      try {
        const response = await fetch(transcribeUrl, { method: "POST" });

        devLog("[triggerTranscribe] response", {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          url: response.url,
        });

        const body = (await response.json().catch(() => null)) as {
          transcript?: TrainingTranscript;
          error?: string;
          ok?: boolean;
          message?: string;
        } | null;

        if (!response.ok) {
          throw new Error(
            body?.error ?? `自动转写请求失败 (HTTP ${response.status})。`,
          );
        }

        // 业务失败：HTTP 200 但 body.ok === false
        if (body?.ok === false && body.transcript) {
          setTranscript(body.transcript);
          setTranscribeStatus("failed");
          setTranscribeErrorMessage(
            body.message ?? body.transcript.errorMessage ?? "自动转写未返回有效文本。",
          );
          return;
        }

        const transcript = body?.transcript;

        if (transcript?.status === "COMPLETED" && transcript.text) {
          setTranscript(transcript);
          setTranscriptDraft(transcript.text);
          setIsTranscriptEditing(false);
          setTranscribeStatus("completed");
          setTranscriptMessage("自动转写已完成。");
        } else if (
          transcript?.status === "PENDING" ||
          transcript?.status === "PROCESSING"
        ) {
          setTranscript(transcript);
          setTranscribeStatus("transcribing");
          setTranscriptMessage("自动转写已启动，系统将在后台继续处理。");
        } else {
          setTranscribeStatus("failed");
          setTranscribeErrorMessage(
            transcript?.errorMessage ?? "自动转写未返回有效文本。",
          );
        }
      } catch (error) {
        setTranscribeStatus("failed");
        setTranscribeErrorMessage(
          error instanceof Error ? error.message : "自动转写失败。",
        );
      }
    },
    [activeRecordingId, sessionId],
  );

  return {
    transcript,
    transcriptDraft,
    setTranscriptDraft,
    isTranscriptEditing,
    setIsTranscriptEditing,
    isTranscriptSaving,
    transcriptMessage,
    setTranscriptMessage,
    transcribeStatus,
    transcribeErrorMessage,
    saveTranscript,
    startTranscriptEditing,
    cancelTranscriptEditing,
    triggerTranscribe,
    resetTranscriptAfterRecordingSaved,
  };
}
