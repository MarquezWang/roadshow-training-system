"use client";

import { useCallback, useState } from "react";
import type {
  TrainingTranscript,
  TranscribeStatus,
} from "@/lib/use-pitch-transcript";

export type TrainingCoverageItem = {
  item: string;
  covered: "true" | "false" | "partial";
  evidence: string;
  suggestion: string;
};

export type TrainingAnalysis = {
  id: string;
  sessionId: string;
  projectId: string;
  transcriptId: string | null;
  status: string;
  analysisType: string;
  durationSec: number;
  pageCount: number | null;
  slideEventCount: number | null;
  overallScore: number | null;
  isFallbackReport: boolean;
  fallbackReason: string | null;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  coverage: TrainingCoverageItem[];
  timing: Record<string, unknown>;
  slideSync: Record<string, unknown>;
  riskQuestions: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type UsePitchAnalysisOptions = {
  sessionId: string;
  isEnded: boolean;
  transcript: TrainingTranscript | null;
  transcribeStatus: TranscribeStatus;
  initialAnalysis: TrainingAnalysis | null;
};

export function usePitchAnalysis({
  sessionId,
  isEnded,
  transcript,
  transcribeStatus,
  initialAnalysis,
}: UsePitchAnalysisOptions) {
  const [analysis, setAnalysis] = useState<TrainingAnalysis | null>(
    initialAnalysis,
  );
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");

  const generateAnalysis = useCallback(async () => {
    if (!isEnded) {
      setAnalysisMessage("请先结束路演后再分析。");
      return;
    }

    if (!transcript?.text.trim()) {
      if (transcribeStatus === "transcribing") {
        setAnalysisMessage("自动转写仍在进行中，请等待转写完成后再生成分析。");
      } else if (transcribeStatus === "failed") {
        setAnalysisMessage(
          "自动转写未完成，无法生成分析。请先重试转写或手动输入转写文本。",
        );
      } else {
        setAnalysisMessage("请先保存转写文本后再分析。");
      }
      return;
    }

    setIsAnalysisLoading(true);
    setAnalysisMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/analysis`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        analysis?: TrainingAnalysis;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(body?.error ?? "路演表现分析生成失败。");
      }

      if (!body?.analysis) {
        throw new Error("路演表现分析接口未返回分析结果。");
      }

      setAnalysis(body.analysis);
      setAnalysisMessage("路演表现分析已生成。");
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error ? error.message : "路演表现分析生成失败。",
      );
    } finally {
      setIsAnalysisLoading(false);
    }
  }, [isEnded, sessionId, transcript, transcribeStatus]);

  return {
    analysis,
    isAnalysisLoading,
    analysisMessage,
    generateAnalysis,
  };
}
