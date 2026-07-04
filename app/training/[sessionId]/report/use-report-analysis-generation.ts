"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { REPORT_GENERATION_FAILURE_MESSAGE } from "./report-ui";

type DynamicFollowupReview = {
  questionId: string;
  question: string;
  answerSummary: string;
  targetWeakness: string;
  evidenceSupplement: string;
  improvementAdvice: string;
};

export type ReportTrainingAnalysis = {
  id: string;
  status: string;
  overallScore: number | null;
  summary: string;
  errorMessage: string | null;
  updatedAt: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  onePageSummary: {
    conclusion: string;
    strongestPoint: string;
    biggestWeakness: string;
    nextTrainingFocus: string;
    readinessAdvice: string;
  } | null;
  diagnostics: {
    content: string[];
    delivery: string[];
    qa: string[];
  } | null;
  actionItems: Array<{
    issue: string;
    whyItMatters: string;
    howToFix: string;
    sampleWording: string;
  }>;
  nextTrainingTasks: string[];
  contentCoverage: Array<{
    item: string;
    covered: string;
    evidence: string;
    suggestion: string;
  }>;
  timing: Record<string, unknown>;
  slideSync: Record<string, unknown>;
  riskQuestions: string[];
  qaReviews: Array<{
    questionId: string;
    questionIndex: number;
    dimension: string;
    question: string;
    judgeIntent: string;
    answerSummary: string;
    responseQuality: string;
    responseQualityLabel: string;
    missingPoints: string[];
    evidenceUse: string;
    improvementAdvice: string;
    betterAnswerOutline: string[];
  }>;
  dynamicFollowupReview: DynamicFollowupReview | null;
};

type UseReportAnalysisGenerationOptions = Readonly<{
  sessionId: string;
  isAborted: boolean;
  initialAnalysis: ReportTrainingAnalysis | null;
}>;

export function useReportAnalysisGeneration({
  sessionId,
  isAborted,
  initialAnalysis,
}: UseReportAnalysisGenerationOptions) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<ReportTrainingAnalysis | null>(
    initialAnalysis,
  );
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(
    initialAnalysis === null || initialAnalysis.status !== "COMPLETED",
  );
  const [analysisMessage, setAnalysisMessage] = useState(
    initialAnalysis === null || initialAnalysis.status !== "COMPLETED"
      ? "正在整理路演与答辩表现，请稍候……"
      : "",
  );
  const reportGenerationStartedAtRef = useRef(0);
  const [reportGenerationElapsedMs, setReportGenerationElapsedMs] = useState(0);
  const [canRetryAnalysisGeneration, setCanRetryAnalysisGeneration] =
    useState(false);

  // 单一 status polling 控制
  const statusPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isGeneratingAnalysisRef = useRef(false);
  const statusInFlightRef = useRef(false);
  // 追踪已 refresh 过的已稳定 transcript recordingId（COMPLETED 或 FAILED），避免刷新循环
  const settledTranscriptsRef = useRef<Set<string>>(new Set());
  // 中止报告 transcript 状态轮询
  const abortPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAnalysisLoading || isAborted) {
      return undefined;
    }

    const startedAt = reportGenerationStartedAtRef.current || Date.now();

    if (reportGenerationStartedAtRef.current === 0) {
      reportGenerationStartedAtRef.current = startedAt;
    }

    const timer = window.setInterval(() => {
      setReportGenerationElapsedMs(Date.now() - startedAt);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isAnalysisLoading, isAborted]);

  async function generateAnalysis() {
    if (isAborted) {
      setAnalysisMessage("本轮训练已中止，不能继续生成训练报告。");
      setIsAnalysisLoading(false);
      return;
    }

    reportGenerationStartedAtRef.current = Date.now();
    setReportGenerationElapsedMs(0);
    setIsAnalysisLoading(true);
    setAnalysisMessage("正在生成训练报告……");

    try {
      const response = await fetch(`/training/${sessionId}/analysis`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        analysis?: ReportTrainingAnalysis;
        error?: string;
      } | null;

      if (!response.ok) {
        // 409: 转写还在进行中，不当作致命错误，返回让 polling 继续
        if (response.status === 409) {
          const errBody = body as {
            pendingCount?: number;
          } | null;
          setAnalysisMessage(
            `答辩回答转写中（${errBody?.pendingCount ?? "?"} 题待完成），等待转写完成后自动生成报告……`,
          );
          return;
        }
        throw new Error(body?.error ?? "报告生成失败，请稍后重试。");
      }

      if (!body?.analysis) {
        throw new Error("报告生成失败，请稍后重试。");
      }

      setAnalysis(body.analysis);
      if (body.analysis.status === "COMPLETED") {
        setAnalysisMessage("");
        setIsAnalysisLoading(false);
      } else if (body.analysis.status === "FAILED") {
        setAnalysisMessage(REPORT_GENERATION_FAILURE_MESSAGE);
        setIsAnalysisLoading(false);
      }
      // PROCESSING 状态：保持 analysisLoading 和 analysisMessage，由 polling 接管
    } catch {
      setAnalysisMessage(REPORT_GENERATION_FAILURE_MESSAGE);
      setIsAnalysisLoading(false);
    }
  }

  function retryAnalysisGeneration() {
    setCanRetryAnalysisGeneration(false);
    void generateAnalysis();
  }

  // 单一 status polling：定期检查 report/status，驱动整个自动生成流程
  useEffect(() => {
    if (isAborted) return;

    const pollStatus = async () => {
      if (statusInFlightRef.current) return;
      statusInFlightRef.current = true;
      try {
        const res = await fetch(
          `/training/${sessionId}/report/status`,
          { cache: "no-store" },
        );
        const status = (await res.json().catch(() => null)) as {
          analysisStatus?: string;
          analysisError?: string | null;
          canGenerateAnalysis?: boolean;
          hasStaleAnalysis?: boolean;
          analysisProcessingTimedOut?: boolean;
          qaTranscriptPendingCount?: number;
          qaTranscriptProcessingCount?: number;
          qaTranscriptItems?: Array<{
            recordingId: string;
            questionId: string | null;
            transcriptStatus: string;
            completedAt: string | null;
          }>;
        } | null;

        if (!status) return;

        // 已完成且非 stale：检查是否还有 transcript 未完成
        if (
          status.analysisStatus === "COMPLETED" &&
          !status.hasStaleAnalysis
        ) {
          const pendingCount =
            (status.qaTranscriptPendingCount ?? 0) +
            (status.qaTranscriptProcessingCount ?? 0);

          // 检查是否有新完成或新失败的 transcript（之前未 refresh 过的）
          const items = status.qaTranscriptItems ?? [];
          const newlySettled = items.filter(
            (item) =>
              (item.transcriptStatus === "COMPLETED" ||
                item.transcriptStatus === "FAILED") &&
              !settledTranscriptsRef.current.has(item.recordingId),
          );

          if (newlySettled.length > 0) {
            // 标记已 refresh，避免循环
            newlySettled.forEach((item) =>
              settledTranscriptsRef.current.add(item.recordingId),
            );
            router.refresh();
            // 不停止轮询，继续等待其余 transcript
            if (pendingCount > 0) return;
          }

          // 所有 transcript 已完成或失败 → 停止轮询
          if (pendingCount === 0) {
            if (statusPollTimerRef.current) {
              clearInterval(statusPollTimerRef.current);
              statusPollTimerRef.current = null;
            }
            // 获取完整 analysis 数据
            const analysisRes = await fetch(
              `/training/${sessionId}/analysis`,
            );
            const analysisBody = (await analysisRes.json().catch(() => null)) as {
              analysis?: ReportTrainingAnalysis | null;
            } | null;
            if (analysisBody?.analysis) {
              setAnalysis(analysisBody.analysis);
              setIsAnalysisLoading(false);
              setCanRetryAnalysisGeneration(false);
              setAnalysisMessage("");
            }
            return;
          }

          // 还有 transcript 未完成，继续轮询
          return;
        }

        // 失败 → 停止轮询
        if (status.analysisStatus === "FAILED") {
          if (statusPollTimerRef.current) {
            clearInterval(statusPollTimerRef.current);
            statusPollTimerRef.current = null;
          }
          setIsAnalysisLoading(false);
          setCanRetryAnalysisGeneration(true);
          setAnalysisMessage(REPORT_GENERATION_FAILURE_MESSAGE);
          return;
        }

        // 判断是否需要触发生成
        const needsGeneration =
          status.analysisStatus === "NONE" ||
          status.analysisStatus === "FAILED" ||
          status.analysisProcessingTimedOut ||
          status.hasStaleAnalysis;

        if (
          (status.canGenerateAnalysis || status.hasStaleAnalysis) &&
          needsGeneration &&
          !isGeneratingAnalysisRef.current
        ) {
          isGeneratingAnalysisRef.current = true;
          setCanRetryAnalysisGeneration(false);
          setAnalysisMessage(
            status.hasStaleAnalysis
              ? "报告正在根据最新转写内容更新……"
              : status.analysisProcessingTimedOut
                ? "检测到上一次报告生成可能已中断，正在重新生成……"
              : "正在生成训练报告……",
          );
          await generateAnalysis();
          isGeneratingAnalysisRef.current = false;
        } else if (!status.canGenerateAnalysis && !status.hasStaleAnalysis) {
          // 还不能生成，显示等待状态
          const pendingTotal =
            (status.qaTranscriptPendingCount ?? 0) +
            (status.qaTranscriptProcessingCount ?? 0);
          if (pendingTotal > 0) {
            setAnalysisMessage(
              `答辩回答转写中（${pendingTotal} 题待完成），等待转写完成后自动生成报告……`,
            );
          }
        }
      } catch {
        // 忽略轮询网络错误
      } finally {
        statusInFlightRef.current = false;
      }
    };

    // 立即轮询一次
    void pollStatus();

    // 启动定时轮询（4 秒间隔）
    statusPollTimerRef.current = setInterval(() => {
      void pollStatus();
    }, 4000);

    return () => {
      if (statusPollTimerRef.current) {
        clearInterval(statusPollTimerRef.current);
        statusPollTimerRef.current = null;
      }
    };
    // 只依赖 sessionId 和 isAborted，不依赖会变化的状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAborted, sessionId]);

  // 中止报告：轻量轮询 transcript 状态，直到全部稳定
  useEffect(() => {
    if (!isAborted) return;

    const pollAbortTranscripts = async () => {
      try {
        const res = await fetch(
          `/training/${sessionId}/report/status`,
          { cache: "no-store" },
        );
        const status = (await res.json().catch(() => null)) as {
          pitchTranscriptStatus?: string;
          qaTranscriptItems?: Array<{
            recordingId: string;
            transcriptStatus: string;
          }>;
        } | null;

        if (!status) return;

        const pitchUnstable =
          status.pitchTranscriptStatus === "PENDING" ||
          status.pitchTranscriptStatus === "PROCESSING";
        const items = status.qaTranscriptItems ?? [];
        const hasUnstableQa = items.some(
          (item) =>
            item.transcriptStatus === "PENDING" ||
            item.transcriptStatus === "PROCESSING",
        );

        if (pitchUnstable || hasUnstableQa) {
          router.refresh();
          return;
        }

        // 全部稳定，停止轮询
        if (abortPollTimerRef.current) {
          clearInterval(abortPollTimerRef.current);
          abortPollTimerRef.current = null;
        }
      } catch {
        // 忽略轮询网络错误
      }
    };

    void pollAbortTranscripts();
    abortPollTimerRef.current = setInterval(() => {
      void pollAbortTranscripts();
    }, 4000);

    return () => {
      if (abortPollTimerRef.current) {
        clearInterval(abortPollTimerRef.current);
        abortPollTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAborted, sessionId]);

  return {
    analysis,
    isAnalysisLoading,
    analysisMessage,
    reportGenerationElapsedMs,
    canRetryAnalysisGeneration,
    retryAnalysisGeneration,
  };
}
