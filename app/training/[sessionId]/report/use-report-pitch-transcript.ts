"use client";

import { useState } from "react";

export type ReportPitchTranscript = {
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

type ReportPitchRecording = {
  id: string;
  transcript: ReportPitchTranscript | null;
};

type UseReportPitchTranscriptOptions = Readonly<{
  sessionId: string;
  recording: ReportPitchRecording | null;
  isAborted: boolean;
}>;

export function useReportPitchTranscript({
  sessionId,
  recording,
  isAborted,
}: UseReportPitchTranscriptOptions) {
  const [transcript, setTranscript] = useState<ReportPitchTranscript | null>(
    recording?.transcript ?? null,
  );
  const [transcriptDraft, setTranscriptDraft] = useState(
    recording?.transcript?.text ?? "",
  );
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(
    !isAborted && recording !== null && !recording.transcript,
  );
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);

  function startTranscriptEditing() {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(true);
    setTranscriptMessage("");
    setTranscriptExpanded(true);
  }

  function cancelTranscriptEditing() {
    if (!transcript) {
      return;
    }

    setTranscriptDraft(transcript.text);
    setIsTranscriptEditing(false);
    setTranscriptMessage("");
  }

  function toggleTranscriptExpanded() {
    setTranscriptExpanded((prev) => !prev);
  }

  async function saveTranscript() {
    if (isAborted) {
      setTranscriptMessage("本轮训练已中止，报告页仅支持只读查看。");
      return;
    }

    const text = transcriptDraft.trim();

    if (!recording) {
      setTranscriptMessage("当前没有录音记录，不能保存转写文本。");
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
        `/training/${sessionId}/recordings/${recording.id}/transcript`,
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
        transcript: ReportPitchTranscript;
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
  }

  return {
    transcript,
    transcriptDraft,
    isTranscriptEditing,
    isTranscriptSaving,
    transcriptMessage,
    transcriptExpanded,
    setTranscriptDraft,
    startTranscriptEditing,
    cancelTranscriptEditing,
    toggleTranscriptExpanded,
    saveTranscript,
  };
}
