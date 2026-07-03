"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canRetryTranscript } from "@/lib/transcript-error-message";
import {
  REPORT_GENERATION_FAILURE_MESSAGE,
  ReportTabNavigation,
  type ReportTabKey,
} from "./report-ui";
import {
  ReportAbortOverviewTab,
  ReportAbortPitchTab,
  ReportAbortQaTab,
} from "./report-abort";
import { ReportOverviewTab } from "./report-overview";
import { ReportPitchTab } from "./report-pitch";
import { ReportQaTab } from "./report-qa";

type TrainingTranscript = {
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

type TrainingRecording = {
  id: string;
  phase: string;
  playbackUrl: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  transcript: TrainingTranscript | null;
};

type TrainingAnalysis = {
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

type DynamicFollowupReview = {
  questionId: string;
  question: string;
  answerSummary: string;
  targetWeakness: string;
  evidenceSupplement: string;
  improvementAdvice: string;
};

type TrainingQaQuestion = {
  id: string;
  orderIndex: number;
  questionText: string;
  questionType: string | null;
  source: string;
  basis: string | null;
  answer: {
    id: string;
    answerText: string | null;
    revealedQuestionText: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSec: number | null;
    recording: TrainingRecording | null;
  } | null;
};

function isDynamicFollowupQuestion(question: TrainingQaQuestion) {
  return (
    question.source === "DYNAMIC_FOLLOWUP" ||
    question.questionType === "FOLLOWUP"
  );
}

function hasEnteredQaQuestion(question: TrainingQaQuestion) {
  return Boolean(
    question.answer?.startedAt ||
      question.answer?.endedAt ||
      question.answer?.recording ||
      question.answer?.answerText?.trim(),
  );
}

type TrainingReportClientProps = Readonly<{
  sessionId: string;
  sessionStatus: string;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  qaQuestions: TrainingQaQuestion[];
  recording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
}>;

export function TrainingReportClient({
  sessionId,
  sessionStatus,
  qaStartedAt,
  qaEndedAt,
  qaDurationSec,
  qaQuestions,
  recording,
  initialAnalysis,
}: TrainingReportClientProps) {
  const router = useRouter();
  const isAborted = sessionStatus === "ABORTED";
  const isQaCompleted =
    sessionStatus === "QA_ENDED" ||
    sessionStatus === "REPORT_READY" ||
    sessionStatus === "FINISHED";
  const [transcript, setTranscript] = useState<TrainingTranscript | null>(
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
  const [analysis, setAnalysis] = useState<TrainingAnalysis | null>(
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
  const reportGenerationStartedAtRef = useRef(
    initialAnalysis === null || initialAnalysis.status !== "COMPLETED"
      ? Date.now()
      : 0,
  );
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

  // QA 转写状态：仅用于 QA Tab 展示，不参与轮询
  const [qaTranscripts, setQaTranscripts] = useState<
    Record<string, TrainingTranscript | null>
  >(
    () =>
      Object.fromEntries(
        qaQuestions
          .filter((q) => q.answer?.recording?.transcript)
          .map((q) => [q.answer!.recording!.id, q.answer!.recording!.transcript!]),
      ),
  );
  const [qaTranscribingSet, setQaTranscribingSet] = useState<Set<string>>(
    new Set(),
  );
  // 当 qaQuestions 刷新后（router.refresh），同步 qaTranscripts 状态
  useEffect(() => {
    const next = Object.fromEntries(
      qaQuestions
        .filter((q) => q.answer?.recording?.transcript)
        .map((q) => [q.answer!.recording!.id, q.answer!.recording!.transcript!]),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- router.refresh() 后同步 props 到派生状态的必要操作
    setQaTranscripts((prev) => {
      // 只在有变化时更新，避免不必要的重渲染
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        if (prev[key]?.status !== next[key]?.status) return next;
        if (prev[key]?.text !== next[key]?.text) return next;
      }
      return prev;
    });
  }, [qaQuestions]);
  // 长文本展开/收起
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(
    new Set(),
  );
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [copySummaryMessage, setCopySummaryMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ReportTabKey>(
    isAborted ? "abort-overview" : "overview",
  );
  const contentRef = useRef<HTMLDivElement>(null);
  // 展开/收起：内容覆盖
  const [showAllCoverage, setShowAllCoverage] = useState(false);

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

  // 切换 Tab 时回到内容顶部
  useEffect(() => {
    const el = contentRef.current;

    if (el) {
      el.scrollIntoView({ block: "start" });
    }
  }, [activeTab]);

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
              analysis?: TrainingAnalysis | null;
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

  const toggleTranscriptExpand = useCallback((key: string) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  const strengths = useMemo(
    () => (Array.isArray(analysis?.strengths) ? analysis.strengths : []),
    [analysis?.strengths],
  );
  const weaknesses = useMemo(
    () => (Array.isArray(analysis?.weaknesses) ? analysis.weaknesses : []),
    [analysis?.weaknesses],
  );
  const suggestions = useMemo(
    () => (Array.isArray(analysis?.suggestions) ? analysis.suggestions : []),
    [analysis?.suggestions],
  );
  const contentCoverage = useMemo(
    () =>
      Array.isArray(analysis?.contentCoverage)
        ? analysis.contentCoverage
        : [],
    [analysis?.contentCoverage],
  );
  const onePageSummary = useMemo(
    () =>
      analysis?.onePageSummary ?? {
        conclusion: analysis?.summary ?? "",
        strongestPoint: strengths[0] ?? "本轮暂未形成明确优势结论。",
        biggestWeakness: weaknesses[0] ?? "本轮暂未形成明确短板结论。",
        nextTrainingFocus:
          suggestions[0] ?? "下一轮建议先补齐路演中的关键证据。",
        readinessAdvice: "建议完成下一轮针对性训练后再进入正式展示。",
      },
    [analysis?.onePageSummary, analysis?.summary, strengths, suggestions, weaknesses],
  );
  const diagnostics = analysis?.diagnostics ?? {
    content: weaknesses.slice(0, 2),
    delivery: suggestions.slice(0, 2),
    qa: [],
  };
  const actionItems =
    Array.isArray(analysis?.actionItems) && analysis.actionItems.length > 0
      ? analysis.actionItems
      : suggestions.slice(0, 3).map((item) => ({
          issue: item,
          whyItMatters: "该问题会影响评委对项目价值、表达清晰度或证据可信度的判断。",
          howToFix: item,
          sampleWording: "可结合项目真实数据、客户案例或测试结果重写这一段表达。",
        }));
  const nextTrainingTasks =
    Array.isArray(analysis?.nextTrainingTasks) &&
    analysis.nextTrainingTasks.length > 0
      ? analysis.nextTrainingTasks
      : suggestions.slice(0, 3);

  const buildOnePageSummaryText = useCallback(() => {
    const score =
      analysis?.overallScore !== null && analysis?.overallScore !== undefined
        ? `${analysis.overallScore}/100`
        : "暂无评分";
    const taskLines =
      nextTrainingTasks.length > 0
        ? nextTrainingTasks
            .slice(0, 3)
            .map((task, index) => `${index + 1}. ${task}`)
            .join("\n")
        : "暂无明确任务";

    return [
      "训练报告摘要",
      "",
      `综合评分：${score}`,
      "",
      "本次训练结论：",
      onePageSummary.conclusion || analysis?.summary || "暂无结论",
      "",
      "最大优势：",
      onePageSummary.strongestPoint,
      "",
      "最大短板：",
      onePageSummary.biggestWeakness,
      "",
      "下一轮重点：",
      onePageSummary.nextTrainingFocus,
      "",
      "正式展示建议：",
      onePageSummary.readinessAdvice,
      "",
      "下一轮训练任务：",
      taskLines,
    ].join("\n");
  }, [analysis?.overallScore, analysis?.summary, nextTrainingTasks, onePageSummary]);

  const copyOnePageSummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildOnePageSummaryText());
      setCopySummaryMessage("已复制");
      window.setTimeout(() => setCopySummaryMessage(""), 1800);
    } catch {
      setCopySummaryMessage("复制失败，请手动选择文本");
    }
  }, [buildOnePageSummaryText]);

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
  }

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
        analysis?: TrainingAnalysis;
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

  async function retryQaTranscribe(recordingId: string) {
    // 检查当前失败类型是否允许重试
    const currentTs = qaTranscripts[recordingId];
    if (currentTs?.status === "FAILED" && !canRetryTranscript(currentTs.errorMessage)) {
      return;
    }
    // 防止重复提交
    if (qaTranscribingSet.has(recordingId)) return;

    setQaTranscribingSet((prev) => {
      const next = new Set(prev);
      next.add(recordingId);
      return next;
    });

    try {
      const response = await fetch(
        `/training/${sessionId}/recordings/${recordingId}/transcribe`,
        { method: "POST" },
      );
      const body = (await response.json().catch(() => null)) as {
        transcript?: TrainingTranscript;
        error?: string;
        ok?: boolean;
        message?: string;
      } | null;

      if (response.ok && body?.transcript) {
        // 成功或业务失败：都有 transcript 对象
        setQaTranscripts((prev) => ({
          ...prev,
          [recordingId]: body.transcript!,
        }));
      } else if (!response.ok && body?.error) {
        // 系统错误 500：构造 FAILED 状态
        setQaTranscripts((prev) => ({
          ...prev,
          [recordingId]: {
            id: "",
            recordingId,
            sessionId,
            status: "FAILED" as const,
            source: "ASR_PROVIDER" as const,
            language: "zh-CN" as const,
            text: "",
            segmentsJson: null,
            errorMessage: body.error ?? null,
            startedAt: null,
            completedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }));
      }
    } catch {
      // 网络错误，不更新状态
    } finally {
      setQaTranscribingSet((prev) => {
        const next = new Set(prev);
        next.delete(recordingId);
        return next;
      });
    }
  }

  return (
    <div className="grid gap-5">
      {/* === Tab 导航（sticky） === */}
      <ReportTabNavigation
        isAborted={isAborted}
        isAnalysisCompleted={analysis?.status === "COMPLETED"}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* === Tab 内容区 === */}
      <div ref={contentRef} className="scroll-mt-14">
        {/* === 中止态：中止概览 Tab === */}
        {activeTab === "abort-overview" && (
          <ReportAbortOverviewTab
            recording={recording}
            qaQuestions={qaQuestions}
          />
        )}

        {/* === 中止态：路演记录 Tab === */}
        {activeTab === "abort-pitch" && (
          <ReportAbortPitchTab
            recording={recording}
            transcriptExpanded={transcriptExpanded}
            onToggleTranscriptExpanded={() =>
              setTranscriptExpanded((prev) => !prev)
            }
          />
        )}

        {/* === 中止态：答辩记录 Tab === */}
        {activeTab === "abort-qa" && (
          <ReportAbortQaTab
            qaQuestions={qaQuestions}
            expandedTranscripts={expandedTranscripts}
            qaTranscribingSet={qaTranscribingSet}
            onToggleTranscriptExpand={toggleTranscriptExpand}
            onRetryQaTranscribe={(recordingId) => {
              void retryQaTranscribe(recordingId);
            }}
          />
        )}

        {/* === 总览 Tab === */}
        {activeTab === "overview" && (
          <ReportOverviewTab
            analysis={analysis}
            onePageSummary={onePageSummary}
            diagnostics={diagnostics}
            actionItems={actionItems}
            nextTrainingTasks={nextTrainingTasks}
            copySummaryMessage={copySummaryMessage}
            isAborted={isAborted}
            isAnalysisLoading={isAnalysisLoading}
            analysisMessage={analysisMessage}
            reportGenerationElapsedMs={reportGenerationElapsedMs}
            canRetryAnalysisGeneration={canRetryAnalysisGeneration}
            onCopyOnePageSummary={() => {
              void copyOnePageSummary();
            }}
            onRetryAnalysisGeneration={() => {
              setCanRetryAnalysisGeneration(false);
              void generateAnalysis();
            }}
          />
        )}

      {/* === 路演表现 Tab === */}
      {activeTab === "pitch" && (
        <ReportPitchTab
          analysis={analysis}
          transcript={transcript}
          strengths={strengths}
          weaknesses={weaknesses}
          suggestions={suggestions}
          contentCoverage={contentCoverage}
          showAllCoverage={showAllCoverage}
          isAborted={isAborted}
          recording={recording}
          isTranscriptEditing={isTranscriptEditing}
          isTranscriptSaving={isTranscriptSaving}
          transcriptDraft={transcriptDraft}
          transcriptExpanded={transcriptExpanded}
          transcriptMessage={transcriptMessage}
          onToggleShowAllCoverage={() => setShowAllCoverage((p) => !p)}
          onStartTranscriptEditing={() => {
            if (!transcript) {
              return;
            }
            setTranscriptDraft(transcript.text);
            setIsTranscriptEditing(true);
            setTranscriptMessage("");
            setTranscriptExpanded(true);
          }}
          onToggleTranscriptExpanded={() => setTranscriptExpanded((p) => !p)}
          onTranscriptDraftChange={setTranscriptDraft}
          onCancelTranscriptEditing={() => {
            if (!transcript) {
              return;
            }
            setTranscriptDraft(transcript.text);
            setIsTranscriptEditing(false);
            setTranscriptMessage("");
          }}
          onSaveTranscript={() => void saveTranscript()}
        />
      )}

      {/* === 答辩表现 Tab === */}
      {activeTab === "qa" && (
        (() => {
          // 只展示用户实际进入过的题目。
          const baseQuestions = qaQuestions.filter(
            (q) => !isDynamicFollowupQuestion(q),
          );
          const enteredQuestions = baseQuestions.filter(hasEnteredQaQuestion);
          const dynamicFollowupQuestion =
            qaQuestions.find(
              (q) => isDynamicFollowupQuestion(q) && hasEnteredQaQuestion(q),
            ) ?? null;
          const dynamicFollowupReview =
            analysis?.dynamicFollowupReview ?? null;
          const skippedCount = baseQuestions.length - enteredQuestions.length;
          // QA 复盘也仅过滤已进入的题目
          const enteredQuestionIds = new Set(enteredQuestions.map((q) => q.id));
          const enteredQaReviews = (analysis?.qaReviews ?? []).filter(
            (r) => enteredQuestionIds.has(r.questionId),
          );

          return (
            <ReportQaTab
              enteredQuestions={enteredQuestions}
              dynamicFollowupQuestion={dynamicFollowupQuestion}
              dynamicFollowupReview={dynamicFollowupReview}
              enteredQaReviews={enteredQaReviews}
              skippedCount={skippedCount}
              suggestions={suggestions}
              qaTranscripts={qaTranscripts}
              qaTranscribingSet={qaTranscribingSet}
              expandedTranscripts={expandedTranscripts}
              isAborted={isAborted}
              isQaCompleted={isQaCompleted}
              qaStartedAt={qaStartedAt}
              qaEndedAt={qaEndedAt}
              qaDurationSec={qaDurationSec}
              onToggleTranscriptExpand={toggleTranscriptExpand}
              onRetryQaTranscribe={(recordingId) => {
                void retryQaTranscribe(recordingId);
              }}
            />
          );
        })())}
    </div>
    </div>
  );
}
