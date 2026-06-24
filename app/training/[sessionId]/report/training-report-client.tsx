"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTranscriptErrorMessage, canRetryTranscript } from "@/lib/transcript-error-message";

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

function RadarChart({ overallScore }: { readonly overallScore: number | null }) {
  const score = overallScore ?? 0;
  const ratio = Math.max(0.1, Math.min(1, score / 100));
  const dimensions = [
    { label: "内容完整度", angle: -90 },
    { label: "表达清晰度", angle: -30 },
    { label: "技术可信度", angle: 30 },
    { label: "市场与商业化", angle: 90 },
    { label: "数据支撑", angle: 150 },
    { label: "答辩应变", angle: 210 },
  ];

  const center = 130;
  const maxRadius = 95;
  const levels = 3;

  function hexPoint(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    const x = center + radius * Math.cos(rad);
    const y = center + radius * Math.sin(rad);
    return `${x},${y}`;
  }

  const bgPolygons = Array.from({ length: levels }, (_, i) => {
    const r = (maxRadius / levels) * (i + 1);
    return dimensions
      .map((d) => hexPoint(d.angle, r))
      .join(" ");
  });

  const dataPoints = dimensions
    .map((d) => hexPoint(d.angle, maxRadius * ratio))
    .join(" ");

  // Label positions: push slightly further out than maxRadius
  const labelRadius = maxRadius + 28;

  return (
    <div className="rounded-lg border border-slate-100 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-800">能力维度雷达图</h3>
      <p className="mt-1 text-xs text-slate-400">
        维度图基于当前报告数据生成，后续将结合逐页与逐题数据完善。
      </p>
      <div className="relative mx-auto mt-4 flex items-center justify-center" style={{ minHeight: 300, width: "100%", maxWidth: 420 }}>
        <svg
          viewBox="0 0 260 260"
          style={{ width: "100%", height: "100%", maxHeight: 380 }}
          aria-label="能力维度雷达图"
        >
          {/* 背景六边形 */}
          {bgPolygons.map((points, i) => (
            <polygon
              key={i}
              points={points}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          ))}
          {/* 轴线 */}
          {dimensions.map((d, i) => (
            <line
              key={i}
              x1={center}
              y1={center}
              x2={hexPoint(d.angle, maxRadius).split(",")[0]}
              y2={hexPoint(d.angle, maxRadius).split(",")[1]}
              stroke="#e2e8f0"
              strokeWidth="1"
            />
          ))}
          {/* 数据多边形 */}
          <polygon
            points={dataPoints}
            fill="rgba(59,130,246,0.12)"
            stroke="#3b82f6"
            strokeWidth="1.5"
          />
          {/* 数据点 */}
          {dimensions.map((d, i) => (
            <circle
              key={i}
              cx={hexPoint(d.angle, maxRadius * ratio).split(",")[0]}
              cy={hexPoint(d.angle, maxRadius * ratio).split(",")[1]}
              r="3"
              fill="#3b82f6"
            />
          ))}
        </svg>
        {/* 标签用 HTML 定位，避免 SVG 裁切 */}
        {dimensions.map((d, i) => {
          const rad = (d.angle * Math.PI) / 180;
          const lx = center + labelRadius * Math.cos(rad);
          const ly = center + labelRadius * Math.sin(rad);
          const pctX = (lx / 260) * 100;
          const pctY = (ly / 260) * 100;

          return (
            <span
              key={i}
              className="absolute text-xs font-medium text-slate-600"
              style={{
                left: `${pctX}%`,
                top: `${pctY}%`,
                transform: "translate(-50%, -50%)",
                whiteSpace: "nowrap",
              }}
            >
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState<
    "overview" | "pitch" | "qa" | "abort-overview" | "abort-pitch" | "abort-qa"
  >(isAborted ? "abort-overview" : "overview");
  const contentRef = useRef<HTMLDivElement>(null);
  // 展开/收起：内容覆盖
  const [showAllCoverage, setShowAllCoverage] = useState(false);

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
          setAnalysisMessage(status.analysisError ?? "报告生成失败。");
          return;
        }

        // 判断是否需要触发生成
        const needsGeneration =
          status.analysisStatus === "NONE" ||
          status.analysisStatus === "FAILED" ||
          status.hasStaleAnalysis;

        if (
          (status.canGenerateAnalysis || status.hasStaleAnalysis) &&
          needsGeneration &&
          !isGeneratingAnalysisRef.current
        ) {
          isGeneratingAnalysisRef.current = true;
          setAnalysisMessage(
            status.hasStaleAnalysis
              ? "报告正在根据最新转写内容更新……"
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

  const strengths = Array.isArray(analysis?.strengths) ? analysis.strengths : [];
  const weaknesses = Array.isArray(analysis?.weaknesses) ? analysis.weaknesses : [];
  const suggestions = Array.isArray(analysis?.suggestions) ? analysis.suggestions : [];
  const contentCoverage = Array.isArray(analysis?.contentCoverage) ? analysis.contentCoverage : [];

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
        setAnalysisMessage(body.analysis.errorMessage ?? "报告生成失败。");
        setIsAnalysisLoading(false);
      }
      // PROCESSING 状态：保持 analysisLoading 和 analysisMessage，由 polling 接管
    } catch (error) {
      setAnalysisMessage(
        error instanceof Error ? error.message : "报告生成失败，请稍后重试。",
      );
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
      <nav className="sticky top-0 z-10 -mx-6 border-b border-slate-100 bg-white/95 px-6 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
        {isAborted
          ? [
              { key: "abort-overview" as const, label: "中止概览" },
              { key: "abort-pitch" as const, label: "路演记录" },
              { key: "abort-qa" as const, label: "答辩记录" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-b-2 border-slate-900 text-slate-900"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))
          : analysis?.status === "COMPLETED"
            ? [
                { key: "overview" as const, label: "总览" },
                { key: "pitch" as const, label: "路演表现" },
                { key: "qa" as const, label: "答辩表现" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "border-b-2 border-slate-900 text-slate-900"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))
            : null}
      </nav>

      {/* === Tab 内容区 === */}
      <div ref={contentRef} className="scroll-mt-14">
        {/* === 中止态：中止概览 Tab === */}
        {activeTab === "abort-overview" && (
          <div className="grid gap-6">
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="rounded-md border border-amber-100 bg-amber-50/70 p-5">
                <p className="text-sm font-semibold text-amber-800">
                  本轮训练已中止
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-700/80">
                  本轮训练在进行中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
                </p>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs text-slate-400">路演录音</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {recording ? "已保存" : "未保存"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs text-slate-400">路演转写</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {recording?.transcript
                      ? recording.transcript.status === "COMPLETED"
                        ? "已转写"
                        : recording.transcript.status === "FAILED"
                          ? "转写失败"
                          : "转写处理中"
                      : "未生成"}
                  </p>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs text-slate-400">已进入答辩题数</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {qaQuestions.filter(hasEnteredQaQuestion).length} /{" "}
                    {qaQuestions.length}
                  </p>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs text-slate-400">答辩回答转写</p>
                  <p className="mt-1 text-sm font-medium text-slate-700">
                    {(() => {
                      const answered = qaQuestions.filter(
                        (q) => q.answer?.recording?.transcript,
                      );
                      if (answered.length === 0) return "暂无";
                      const completed = answered.filter(
                        (q) => q.answer!.recording!.transcript!.status === "COMPLETED",
                      );
                      const failed = answered.filter(
                        (q) => q.answer!.recording!.transcript!.status === "FAILED",
                      );
                      const pending = answered.length - completed.length - failed.length;
                      const parts: string[] = [];
                      if (completed.length > 0)
                        parts.push(`${completed.length} 题已转写`);
                      if (pending > 0) parts.push(`${pending} 题处理中`);
                      if (failed.length > 0) parts.push(`${failed} 题失败`);
                      return parts.join("，") || "暂无";
                    })()}
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* === 中止态：路演记录 Tab === */}
        {activeTab === "abort-pitch" && (
          <div className="grid gap-6">
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <h2 className="text-sm font-semibold text-slate-800">路演记录</h2>
              <p className="mt-1 text-xs text-slate-400">
                训练中止前已保存的路演录音与转写内容。
              </p>

              {recording ? (
                <div className="mt-4 grid gap-4">
                  {/* 录音播放器 */}
                  <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
                    <p className="text-xs font-medium text-slate-500">路演录音</p>
                    <div className="mt-2">
                      <audio
                        controls
                        className="h-10 w-full"
                        src={recording.playbackUrl}
                        preload="metadata"
                      />
                    </div>
                    {recording.durationSec != null ? (
                      <p className="mt-1 text-xs text-slate-400">
                        时长：{Math.round(recording.durationSec)} 秒
                      </p>
                    ) : null}
                  </div>

                  {/* 转写状态 */}
                  <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
                    <p className="text-xs font-medium text-slate-500">
                      路演转写
                    </p>
                    {recording.transcript ? (
                      recording.transcript.status === "COMPLETED" ? (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            <span className="text-xs text-emerald-600">已转写</span>
                          </div>
                          {recording.transcript.text ? (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => setTranscriptExpanded((prev) => !prev)}
                                className="text-xs font-medium text-blue-600 hover:text-blue-700"
                              >
                                {transcriptExpanded ? "收起转写文本" : "展开转写文本"}
                              </button>
                              {transcriptExpanded ? (
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                                  {recording.transcript.text}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-1 text-xs text-slate-400">
                              转写已完成，但暂未生成本文。
                            </p>
                          )}
                        </div>
                      ) : recording.transcript.status === "FAILED" ? (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                            <span className="text-xs text-red-600">转写失败</span>
                          </div>
                          {recording.transcript.errorMessage ? (
                            <p className="mt-1 text-xs text-red-400">
                              {formatTranscriptErrorMessage(recording.transcript.errorMessage)}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2">
                          <div className="flex items-center gap-2">
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-200 border-t-amber-400" />
                            <span className="text-xs text-amber-600">转写处理中</span>
                          </div>
                        </div>
                      )
                    ) : (
                      <p className="mt-2 text-xs text-slate-400">
                        暂未生成转写文本。
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                  本轮训练未保存路演录音，可能是在录音保存前中止。
                </p>
              )}
            </section>
          </div>
        )}

        {/* === 中止态：答辩记录 Tab === */}
        {activeTab === "abort-qa" && (
          <div className="grid gap-6">
            {(() => {
              const enteredQuestions = qaQuestions.filter(hasEnteredQaQuestion);

              return (
                <section className="rounded-lg border border-slate-100 bg-white p-6">
                  <h2 className="text-sm font-semibold text-slate-800">答辩记录</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    训练中止前已进入并回答过的答辩问题。
                  </p>

                  {enteredQuestions.length > 0 ? (
                    <div className="mt-4 grid gap-5">
                      {enteredQuestions.map((question) => (
                        <div
                          key={question.id}
                          className="rounded-md border border-slate-100 bg-slate-50/50 p-4"
                        >
                          <p className="text-xs font-medium text-slate-400">
                            第 {question.orderIndex} 题
                          </p>
                          <p className="mt-1 text-sm font-medium text-slate-800">
                            {question.questionText}
                          </p>

                          {question.answer ? (
                            <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3">
                              {/* 回答用时 */}
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400">回答用时：</span>
                                <span className="text-xs font-medium text-slate-600">
                                  {question.answer.durationSec != null
                                    ? `${Math.round(question.answer.durationSec)} 秒`
                                    : "未知"}
                                </span>
                              </div>

                              {/* 回答录音 */}
                              {question.answer.recording ? (
                                <div className="rounded-md border border-slate-200 bg-white p-3">
                                  <p className="text-xs text-slate-400">
                                    回答录音
                                  </p>
                                  <div className="mt-1">
                                    <audio
                                      controls
                                      className="h-10 w-full"
                                      src={question.answer.recording.playbackUrl}
                                      preload="metadata"
                                    />
                                  </div>
                                  {question.answer.recording.durationSec != null ? (
                                    <p className="mt-1 text-xs text-slate-400">
                                      时长：{Math.round(question.answer.recording.durationSec)}{" "}
                                      秒
                                    </p>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">
                                  未保存回答录音。
                                </p>
                              )}

                              {/* 回答转写 */}
                              {question.answer.recording?.transcript ? (
                                <div className="rounded-md border border-slate-200 bg-white p-3">
                                  <p className="text-xs text-slate-400">
                                    回答转写
                                  </p>
                                  {question.answer.recording.transcript.status ===
                                  "COMPLETED" ? (
                                    <div className="mt-1">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                        <span className="text-xs text-emerald-600">
                                          已转写
                                        </span>
                                      </div>
                                      {question.answer.recording.transcript.text ? (
                                        <div className="mt-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              toggleTranscriptExpand(
                                                question.answer!.recording!.id,
                                              )
                                            }
                                            className="text-xs font-medium text-blue-600 hover:text-blue-700"
                                          >
                                            {expandedTranscripts.has(
                                              question.answer.recording.id,
                                            )
                                              ? "收起转写文本"
                                              : "展开转写文本"}
                                          </button>
                                          {expandedTranscripts.has(
                                            question.answer.recording.id,
                                          ) ? (
                                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                                              {question.answer.recording.transcript.text}
                                            </p>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <p className="mt-1 text-xs text-slate-400">
                                          转写已完成，但暂未生成本文。
                                        </p>
                                      )}
                                    </div>
                                  ) : question.answer.recording.transcript.status ===
                                    "FAILED" ? (
                                    <div className="mt-1">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex h-1.5 w-1.5 rounded-full bg-red-400" />
                                        <span className="text-xs text-red-600">
                                          转写失败
                                        </span>
                                      </div>
                                      {question.answer.recording.transcript
                                                  .errorMessage ? (
                                                <p className="mt-1 text-xs text-red-400">
                                                  {formatTranscriptErrorMessage(question.answer.recording.transcript.errorMessage)}
                                                </p>
                                              ) : null}
                                              {canRetryTranscript(
                                                question.answer.recording.transcript.errorMessage,
                                              ) ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    void retryQaTranscribe(
                                                      question.answer!.recording!.id,
                                                    );
                                                  }}
                                                  disabled={qaTranscribingSet.has(
                                                    question.answer.recording.id,
                                                  )}
                                                  className="mt-2 inline-flex h-7 items-center rounded border border-red-200 bg-white px-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                                                >
                                                  {qaTranscribingSet.has(
                                                    question.answer.recording.id,
                                                  )
                                                    ? "转写中..."
                                                    : "重试转写"}
                                                </button>
                                              ) : (
                                                <p className="mt-1 text-xs text-slate-400">
                                                  当前失败类型不建议重试
                                                </p>
                                              )}
                                    </div>
                                  ) : (
                                    <div className="mt-1">
                                      <div className="flex items-center gap-2">
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-200 border-t-amber-400" />
                                        <span className="text-xs text-amber-600">
                                          转写处理中
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-400">
                                  暂未生成转写文本。
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-400">
                      本轮训练尚未进入答辩，或未保存答辩回答。
                    </p>
                  )}
                </section>
              );
            })()}
          </div>
        )}

        {/* === 总览 Tab === */}
        {activeTab === "overview" && (
        <div className="grid gap-6">
          {/* 第一行：主结论卡 + 雷达图 */}
          {analysis?.status === "COMPLETED" ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* 主结论卡 */}
              <section className="rounded-lg border border-slate-100 bg-white p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      训练状态
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">
                      报告已生成
                    </p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-slate-900">
                      {analysis.overallScore ?? "-"}
                    </span>
                    <span className="text-sm text-slate-400">/ 100</span>
                  </div>
                </div>

                {/* 主结论 */}
                {analysis.summary ? (
                  <div className="mt-4 rounded-md bg-slate-50/70 p-4">
                    <p className="text-xs font-medium text-slate-400">主结论</p>
                    <p className="mt-1.5 text-sm leading-6 text-slate-700">
                      {analysis.summary}
                    </p>
                  </div>
                ) : null}

                {/* 下一轮优先动作 */}
                {suggestions.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400">
                      下一轮优先改进
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {suggestions.slice(0, 3).map((item, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm leading-6 text-slate-600"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>

              {/* 能力维度雷达图 */}
              <RadarChart overallScore={analysis.overallScore} />
            </div>
          ) : isAborted ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="rounded-md border border-red-100 bg-red-50/50 p-5">
                <p className="text-sm font-medium text-red-700">本轮训练已中止</p>
                <p className="mt-1 text-sm text-red-600/80">
                  本轮训练在正式流程中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
                </p>
              </div>
            </section>
          ) : isAnalysisLoading ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="py-8 text-center">
                <div className="mb-4 flex items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-500" />
                </div>
                <p className="text-sm font-medium text-slate-600">报告生成中</p>
                <p className="mt-1 text-xs text-slate-400">
                  {analysisMessage || "正在整理路演与答辩表现，请稍候……"}
                </p>
                <p className="mt-3 text-xs text-slate-300">
                  通常需要几十秒，页面会自动更新。
                </p>
              </div>
            </section>
          ) : analysis?.status === "FAILED" ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-red-600">报告生成失败</p>
                <p className="mt-1 text-xs text-red-400">
                  报告生成失败，请稍后重试。
                </p>
                {analysis.errorMessage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-red-300">
                      查看详情
                    </summary>
                    <p className="mt-1 text-xs text-red-300/80">
                      {analysis.errorMessage}
                    </p>
                  </details>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    void generateAnalysis();
                  }}
                  disabled={isAnalysisLoading}
                  className="mt-4 inline-flex h-8 items-center justify-center rounded border border-red-200 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  重试生成报告
                </button>
              </div>
            </section>
          ) : analysis ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    训练状态
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">报告生成中</p>
                </div>
              </div>
              {analysisMessage ? (
                <p className="mt-3 text-sm leading-6 text-slate-600">{analysisMessage}</p>
              ) : null}
            </section>
          ) : (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-slate-600">报告生成中</p>
                <p className="mt-1 text-xs text-slate-400">
                  {analysisMessage || "正在准备报告数据，请稍候……"}
                </p>
              </div>
            </section>
          )}

          {/* 第二行：关键优势 + 主要短板 */}
          {analysis?.status === "COMPLETED" ? (
            <div className="grid gap-6 lg:grid-cols-2">
              {/* 关键优势 */}
              <div className="rounded-lg border border-slate-100 bg-white p-6">
                <h3 className="text-sm font-semibold text-slate-800">关键优势</h3>
                {strengths.length > 0 ? (
                  <ul className="mt-3 space-y-2.5">
                    {strengths.slice(0, 5).map((item, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-sm leading-6 text-slate-600"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">暂无优势数据。</p>
                )}
              </div>

              {/* 主要短板 */}
              <div className="rounded-lg border border-slate-100 bg-white p-6">
                <h3 className="text-sm font-semibold text-slate-800">主要短板</h3>
                {weaknesses.length > 0 ? (
                  <ul className="mt-3 space-y-2.5">
                    {weaknesses.slice(0, 5).map((item, index) => (
                      <li
                        key={index}
                        className="flex gap-2 text-sm leading-6 text-slate-600"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">暂无短板数据。</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* === 路演表现 Tab === */}
      {activeTab === "pitch" && (
        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-100 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-800">
              路演表现分析
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              基于路演转写文本的 AI 评估结果。
            </p>

            {isAborted ? (
              <p className="mt-4 rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-600">
                本轮训练已中止，报告不再继续生成。
              </p>
            ) : !transcript?.text.trim() ? (
              <p className="mt-4 rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-600">
                请先保存路演转写文本，再生成训练报告。
              </p>
            ) : !analysis ? (
              <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                正在等待报告生成，完成后将自动展示。
              </p>
            ) : analysis.status === "FAILED" ? (
              <div className="mt-4 rounded-md border border-red-100 bg-red-50/50 p-4">
                <p className="text-sm font-medium text-red-700">报告生成失败</p>
                <p className="mt-1 text-sm text-red-600/80">
                  报告生成失败，请稍后重试。
                </p>
                {analysis.errorMessage ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-red-400">
                      查看详情
                    </summary>
                    <p className="mt-1 text-xs text-red-400/80">
                      {analysis.errorMessage}
                    </p>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                {/* 评分 */}
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-slate-900">
                    {analysis.overallScore ?? "-"}
                  </span>
                  <span className="text-sm text-slate-400">/ 100</span>
                </div>

                {/* 路演主结论 */}
                {analysis.summary ? (
                  <div className="rounded-md bg-slate-50 p-4">
                    <p className="text-xs font-medium text-slate-400">主结论</p>
                    <p className="mt-1 text-sm leading-6 text-slate-700">
                      {analysis.summary}
                    </p>
                  </div>
                ) : null}

                {/* 优势 */}
                {strengths.length > 0 ? (
                  <div className="rounded-md border border-emerald-100 bg-emerald-50/50 p-4">
                    <h4 className="text-sm font-semibold text-emerald-800">
                      路演优势
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {strengths.map((item, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm leading-6 text-emerald-700/80"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* 问题 */}
                {weaknesses.length > 0 ? (
                  <div className="rounded-md border border-amber-100 bg-amber-50/50 p-4">
                    <h4 className="text-sm font-semibold text-amber-800">
                      路演问题
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {weaknesses.map((item, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm leading-6 text-amber-700/80"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* 改进建议 */}
                {suggestions.length > 0 ? (
                  <div className="rounded-md border border-blue-100 bg-blue-50/50 p-4">
                    <h4 className="text-sm font-semibold text-blue-800">
                      路演改进建议
                    </h4>
                    <ul className="mt-2 space-y-2">
                      {suggestions.map((item, index) => (
                        <li
                          key={index}
                          className="flex gap-2 text-sm leading-6 text-blue-700/80"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* 内容覆盖 */}
                {contentCoverage.length > 0 ? (
                  <div className="rounded-md border border-slate-100 bg-white p-4">
                    <h4 className="text-sm font-semibold text-slate-800">
                      内容覆盖与证据充分性
                    </h4>
                    <div className="mt-3 grid gap-2.5">
                      {(showAllCoverage
                        ? contentCoverage
                        : contentCoverage.slice(0, 5)
                      ).map((item, index) => {
                        const coveredLabel =
                          item.covered === "true"
                            ? "证据较充分"
                            : item.covered === "partial"
                              ? "提到但证据不足"
                              : "未充分覆盖";
                        const coveredColor =
                          item.covered === "true"
                            ? "text-emerald-600 bg-emerald-50"
                            : item.covered === "partial"
                              ? "text-amber-600 bg-amber-50"
                              : "text-red-500 bg-red-50";

                        return (
                          <div
                            key={index}
                            className="rounded border border-slate-100 p-3"
                          >
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <span className="text-sm font-medium text-slate-800">
                                {item.item}
                              </span>
                              <span
                                className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${coveredColor}`}
                              >
                                {coveredLabel}
                              </span>
                            </div>
                            {item.evidence ? (
                              <p className="mt-2 text-xs text-slate-500">
                                证据：{item.evidence}
                              </p>
                            ) : null}
                            {item.suggestion ? (
                              <p className="mt-1 text-xs text-blue-600">
                                建议：{item.suggestion}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    {contentCoverage.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllCoverage((p) => !p)}
                        className="mt-3 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                      >
                        {showAllCoverage
                          ? "收起"
                          : `展开全部（${contentCoverage.length} 项）`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* 路演录音与转写 */}
          {recording ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <h3 className="text-sm font-semibold text-slate-800">
                路演录音与转写
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                原始录音回放与转写文本。
              </p>

              <div className="mt-4 grid gap-4">
                {/* 路演录音 */}
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
                  <p className="text-xs font-medium text-slate-500">路演录音回放</p>
                  <audio
                    controls
                    src={recording.playbackUrl}
                    className="mt-2 w-full"
                  >
                    <track kind="captions" />
                  </audio>
                  <p className="mt-1 text-xs text-slate-400">
                    {recording.durationSec !== null
                      ? `录音时长 ${recording.durationSec} 秒`
                      : "录音时长未记录"}
                  </p>
                </div>

                {/* 路演转写（默认折叠） */}
                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-slate-700">
                      路演转写文本
                      {transcript ? (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          {transcript.source === "ASR_PROVIDER"
                            ? "（自动转写）"
                            : "（手动输入）"}
                        </span>
                      ) : null}
                    </h4>
                    <div className="flex items-center gap-2">
                      {transcript && !isTranscriptEditing && !isAborted ? (
                        <button
                          type="button"
                          onClick={() => {
                            setTranscriptDraft(transcript.text);
                            setIsTranscriptEditing(true);
                            setTranscriptMessage("");
                            setTranscriptExpanded(true);
                          }}
                          className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-600"
                        >
                          编辑
                        </button>
                      ) : null}
                      {transcript && !isTranscriptEditing ? (
                        <button
                          type="button"
                          onClick={() => setTranscriptExpanded((p) => !p)}
                          className="text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                        >
                          {transcriptExpanded ? "收起" : "展开"}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {isTranscriptEditing && !isAborted ? (
                    <div className="mt-3 grid gap-3">
                      <textarea
                        value={transcriptDraft}
                        onChange={(event) =>
                          setTranscriptDraft(event.target.value)
                        }
                        rows={8}
                        className="w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400"
                        placeholder="粘贴或编辑路演转写文本"
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        {transcript ? (
                          <button
                            type="button"
                            onClick={() => {
                              setTranscriptDraft(transcript.text);
                              setIsTranscriptEditing(false);
                              setTranscriptMessage("");
                            }}
                            disabled={isTranscriptSaving}
                            className="inline-flex h-8 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                          >
                            取消
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void saveTranscript()}
                          disabled={isTranscriptSaving}
                          className="inline-flex h-8 items-center justify-center rounded-md bg-slate-900 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {isTranscriptSaving ? "保存中..." : "保存"}
                        </button>
                      </div>
                    </div>
                  ) : transcript && transcriptExpanded ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {transcript.text}
                    </p>
                  ) : transcript ? (
                    <p className="mt-3 text-sm text-slate-400">
                      转写文本已折叠，点击&ldquo;展开&rdquo;查看完整内容。
                    </p>
                  ) : null}

                  {transcriptMessage ? (
                    <p className="mt-3 text-xs text-slate-500">
                      {transcriptMessage}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* 预留：逐页复盘提示 */}
              <p className="mt-4 text-xs text-slate-400">
                逐页讲解时间轴与分页面建议将在后续版本中完善。
              </p>
            </section>
          ) : (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <p className="text-sm text-slate-500">
                本轮没有路演录音记录。
              </p>
            </section>
          )}
        </div>
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
        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-100 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-800">
              答辩表现
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              评委提问与用户回答逐题复盘。
            </p>

            {skippedCount > 0 ? (
              <p className="mt-3 rounded-md border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                本次答辩实际进行 {enteredQuestions.length} 题
                {skippedCount > 0
                  ? `，${skippedCount} 道预生成问题因时间用尽未进入`
                  : ""}
                。
              </p>
            ) : null}

            {isAborted ? (
              <p className="mt-4 rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-600">
                本轮训练已中止。若需要继续训练，请回到项目详情重新开始一轮。
              </p>
            ) : !isQaCompleted ? (
              <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                尚未完成答辩。完成模拟答辩后，本页会展示逐题复盘。
              </p>
            ) : null}

            {qaStartedAt ? (
              <p className="mt-3 text-xs text-slate-400">
                答辩时间：{new Date(qaStartedAt).toLocaleString()}
                {qaEndedAt
                  ? ` 至 ${new Date(qaEndedAt).toLocaleString()}`
                  : ""}
                {qaDurationSec !== null ? `（用时 ${qaDurationSec} 秒）` : ""}
              </p>
            ) : null}

            {enteredQuestions.length > 0 ? (
              <div className="mt-4 grid gap-5">
                {enteredQuestions.map((question) => {
                  const qType = question.questionType ?? "QUESTION";
                  const typeLabel =
                    qType === "TECH"
                      ? "技术"
                      : qType === "MARKET"
                        ? "市场"
                        : qType === "RISK"
                          ? "风险"
                          : qType === "TEAM"
                            ? "团队"
                            : qType === "FINANCE"
                              ? "财务"
                              : qType;

                  const dimensionHint =
                    qType === "TECH"
                      ? "主要考察技术可行性"
                      : qType === "MARKET"
                        ? "主要考察市场判断"
                        : qType === "RISK"
                          ? "主要考察风险识别"
                          : qType === "TEAM"
                            ? "主要考察团队能力"
                            : qType === "FINANCE"
                              ? "主要考察财务模型"
                              : "主要考察答辩应变能力";

                  // 查找本题对应的 qaReview
                  const qaReview = enteredQaReviews.find(
                    (r) => r.questionId === question.id,
                  );

                  const qualityLabel = qaReview?.responseQualityLabel ?? null;
                  const qualityColor =
                    qaReview?.responseQuality === "GOOD"
                      ? "bg-emerald-50 text-emerald-600"
                      : qaReview?.responseQuality === "PARTIAL"
                        ? "bg-amber-50 text-amber-600"
                        : qaReview?.responseQuality === "WEAK"
                          ? "bg-red-50 text-red-500"
                          : "";

                  return (
                    <article
                      key={question.id}
                      className="rounded-md border border-slate-100 p-4"
                    >
                      {/* 顶部：题号、维度、回答质量 */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-6 items-center rounded bg-slate-200/70 px-2 text-xs font-semibold text-slate-600">
                          Q{question.orderIndex}
                        </span>
                        <span className="text-xs font-medium text-slate-400">
                          {typeLabel}
                        </span>
                        {qualityLabel ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${qualityColor}`}
                          >
                            {qualityLabel}
                          </span>
                        ) : null}
                      </div>

                      {/* 评委问题 */}
                      <p className="mt-2 text-sm font-medium leading-6 text-slate-800">
                        {question.questionText}
                      </p>
                      {question.basis ? (
                        <p className="mt-1 text-xs text-slate-400">
                          依据：{question.basis}
                        </p>
                      ) : null}

                      {/* 提问角度 */}
                      {qaReview?.judgeIntent ? (
                        <div className="mt-2 rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
                          <p className="text-xs text-slate-400">提问角度</p>
                          <p className="mt-0.5 text-xs leading-5 text-slate-600">
                            {qaReview.judgeIntent}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">
                          {dimensionHint}
                        </p>
                      )}

                      {/* 回答信息 */}
                      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                        <p>
                          回答用时：
                          {question.answer?.durationSec !== null &&
                          question.answer?.durationSec !== undefined
                            ? `${question.answer.durationSec} 秒`
                            : "未记录"}
                        </p>
                        <p>
                          查看文字：
                          {question.answer?.revealedQuestionText ? "是" : "否"}
                        </p>
                        <p>
                          回答方式：
                          {question.answer?.answerText?.trim()
                            ? "文字记录"
                            : "语音回答"}
                        </p>
                      </div>

                      {/* 文字回答 */}
                      {question.answer?.answerText?.trim() ? (
                        <p className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm leading-6 text-slate-700">
                          {question.answer.answerText}
                        </p>
                      ) : null}

                      {/* 录音与转写 */}
                      {question.answer?.recording ? (
                        (() => {
                          const rId = question.answer.recording.id;
                          const ts = qaTranscripts[rId];
                          const isTranscribing = qaTranscribingSet.has(rId);
                          const status = ts?.status ?? "PENDING";
                          const statusLabel =
                            status === "COMPLETED"
                              ? "已转写"
                              : status === "FAILED"
                                ? "转写失败"
                                : status === "PROCESSING" || isTranscribing
                                  ? "转写中"
                                  : "等待中";
                          const statusColor =
                            status === "COMPLETED"
                              ? "text-emerald-600"
                              : status === "FAILED"
                                ? "text-red-500"
                                : "text-amber-600";
                          const isExpanded = expandedTranscripts.has(rId);
                          const hasText =
                            status === "COMPLETED" && ts?.text?.trim();
                          const textPreview =
                            hasText && ts
                              ? ts.text.slice(0, 150)
                              : "";
                          const fullText = ts?.text ?? "";

                          return (
                            <div className="mt-3 space-y-2">
                              {/* 录音回放 */}
                              <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-medium text-slate-500">
                                    回答录音
                                    {question.answer.recording.durationSec !==
                                    null
                                      ? `（${question.answer.recording.durationSec} 秒）`
                                      : ""}
                                  </p>
                                  <span className={`text-xs ${statusColor}`}>
                                    {statusLabel}
                                  </span>
                                </div>
                                <audio
                                  controls
                                  src={question.answer.recording.playbackUrl}
                                  className="mt-2 w-full"
                                >
                                  <track kind="captions" />
                                </audio>
                              </div>

                              {/* 转写文本 */}
                              {hasText ? (
                                <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                                  {isExpanded ? (
                                    <>
                                      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                        {fullText}
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleTranscriptExpand(rId)
                                        }
                                        className="mt-2 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                                      >
                                        收起
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-sm leading-6 text-slate-600">
                                        {textPreview}
                                        {fullText.length > 150 ? "..." : ""}
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          toggleTranscriptExpand(rId)
                                        }
                                        className="mt-1 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                                      >
                                        展开完整转写
                                      </button>
                                    </>
                                  )}
                                </div>
                              ) : null}

                              {/* 失败 */}
                              {status === "FAILED" ? (
                                <details className="rounded-md border border-red-100 bg-red-50/30 p-3">
                                  <summary className="cursor-pointer text-xs text-red-500">
                                    查看错误详情
                                  </summary>
                                  <p className="mt-1 text-xs text-red-400">
                                    {formatTranscriptErrorMessage(ts?.errorMessage ?? null)}
                                  </p>
                                  {!isAborted ? (
                                    canRetryTranscript(ts?.errorMessage ?? null) ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void retryQaTranscribe(rId)
                                        }
                                        disabled={isTranscribing}
                                        className="mt-2 inline-flex h-7 items-center justify-center rounded border border-red-200 bg-white px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                                      >
                                        {isTranscribing
                                          ? "转写中..."
                                          : "重试转写"}
                                      </button>
                                    ) : (
                                      <p className="mt-1 text-xs text-slate-400">
                                        当前失败类型不建议重试
                                      </p>
                                    )
                                  ) : null}
                                </details>
                              ) : null}

                              {/* 等待中 */}
                              {status !== "COMPLETED" &&
                              status !== "FAILED" ? (
                                <p className="text-xs text-slate-400">
                                  {isTranscribing
                                    ? "转写进行中，请稍后刷新..."
                                    : "等待转写完成..."}
                                </p>
                              ) : null}
                            </div>
                          );
                        })()
                      ) : (
                        <p className="mt-3 text-xs text-slate-400">
                          本题未保存录音。
                        </p>
                      )}

                      {/* 回答复盘（qaReviews 数据） */}
                      {qaReview ? (
                        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                          <p className="text-xs font-semibold text-slate-500">
                            回答复盘
                          </p>

                          {/* 回答摘要 */}
                          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
                            <p className="text-xs text-slate-400">回答摘要</p>
                            <p className="mt-0.5 text-xs leading-5 text-slate-700">
                              {qaReview.answerSummary}
                            </p>
                          </div>

                          {/* 证据使用 */}
                          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
                            <p className="text-xs text-slate-400">
                              证据使用情况
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-slate-700">
                              {qaReview.evidenceUse}
                            </p>
                          </div>

                          {/* 缺失要点 */}
                          {qaReview.missingPoints.length > 0 ? (
                            <div className="rounded border border-red-50 bg-red-50/30 px-3 py-2">
                              <p className="text-xs font-medium text-red-600">
                                缺失要点
                              </p>
                              <ul className="mt-1.5 space-y-1">
                                {qaReview.missingPoints.map(
                                  (point, idx) => (
                                    <li
                                      key={idx}
                                      className="flex gap-1.5 text-xs leading-5 text-red-700/80"
                                    >
                                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                                      <span>{point}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}

                          {/* 改进建议 */}
                          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
                            <p className="text-xs text-slate-400">
                              本题改进建议
                            </p>
                            <p className="mt-0.5 text-xs leading-5 text-slate-700">
                              {qaReview.improvementAdvice}
                            </p>
                          </div>

                          {/* 更优回答结构 */}
                          {qaReview.betterAnswerOutline.length > 0 ? (
                            <div className="rounded border border-blue-50 bg-blue-50/30 px-3 py-2">
                              <p className="text-xs font-medium text-blue-600">
                                更优回答结构
                              </p>
                              <ul className="mt-1.5 space-y-1">
                                {qaReview.betterAnswerOutline.map(
                                  (outline, idx) => (
                                    <li
                                      key={idx}
                                      className="flex gap-1.5 text-xs leading-5 text-blue-700/80"
                                    >
                                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                                      <span>{outline}</span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        /* 无 qaReviews 时的 fallback */
                        <div className="mt-4 border-t border-slate-100 pt-4">
                          {suggestions.length > 0 ? (
                            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                              <p className="text-xs font-medium text-slate-500">
                                回答建议
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {
                                  suggestions[
                                    question.orderIndex % suggestions.length
                                  ]
                                }
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400">
                              后续可结合评分结果补充本题回答建议。
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
                暂无答辩问题。
              </p>
            )}
          </section>
          {dynamicFollowupQuestion
            ? (() => {
                const recordingId =
                  dynamicFollowupQuestion.answer?.recording?.id ?? null;
                const transcriptText = recordingId
                  ? qaTranscripts[recordingId]?.status === "COMPLETED"
                    ? qaTranscripts[recordingId]?.text?.trim() ?? ""
                    : ""
                  : "";
                const answerText =
                  dynamicFollowupQuestion.answer?.answerText?.trim() ||
                  transcriptText;

                return (
                  <section className="rounded-lg border border-cyan-100 bg-cyan-50/30 p-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-slate-800">
                        动态追问表现
                      </h2>
                      <span className="inline-flex rounded-full border border-cyan-200 bg-white px-2 py-0.5 text-xs font-medium text-cyan-700">
                        Q{dynamicFollowupQuestion.orderIndex}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      本模块仅展示动态追问表现，当前不计入总分。
                    </p>

                    <div className="mt-4 rounded-md border border-white/70 bg-white/80 p-4">
                      <p className="text-xs font-medium text-cyan-700">
                        动态追问问题
                      </p>
                      <p className="mt-2 text-sm font-medium leading-6 text-slate-800">
                        {dynamicFollowupQuestion.questionText}
                      </p>
                    </div>

                    {answerText ? (
                      <div className="mt-3 rounded-md border border-white/70 bg-white/80 p-4">
                        <p className="text-xs font-medium text-cyan-700">
                          用户回答
                        </p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {answerText}
                        </p>
                      </div>
                    ) : null}

                    {dynamicFollowupReview ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border border-white/70 bg-white/80 p-3">
                          <p className="text-xs font-medium text-slate-500">
                            回答摘要
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">
                            {dynamicFollowupReview.answerSummary}
                          </p>
                        </div>
                        <div className="rounded-md border border-white/70 bg-white/80 p-3">
                          <p className="text-xs font-medium text-slate-500">
                            追问针对的薄弱点
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">
                            {dynamicFollowupReview.targetWeakness}
                          </p>
                        </div>
                        <div className="rounded-md border border-white/70 bg-white/80 p-3">
                          <p className="text-xs font-medium text-slate-500">
                            关键证据补充情况
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">
                            {dynamicFollowupReview.evidenceSupplement}
                          </p>
                        </div>
                        <div className="rounded-md border border-white/70 bg-white/80 p-3">
                          <p className="text-xs font-medium text-slate-500">
                            改进建议
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-700">
                            {dynamicFollowupReview.improvementAdvice}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </section>
                );
              })()
            : null}
        </div>
          );
        })())}
    </div>
    </div>
  );
}
