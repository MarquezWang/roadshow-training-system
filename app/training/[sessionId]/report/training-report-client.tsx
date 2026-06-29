"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  startedAt?: string | null;
  endedAt?: string | null;
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

type ReportPreviewFile = {
  id: string;
  originalName: string;
  fileType: string;
  previewPdfPath?: string | null;
  previewStatus?: string | null;
  previewError?: string | null;
  displaySource?: "PDF" | "POWERPOINT_PREVIEW";
};

type ReportSlideEvent = {
  id: string;
  fileId: string | null;
  pageIndex: number;
  eventType: string;
  elapsedSec: number;
  createdAt: string;
};

type PitchReplaySegment = {
  pageIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  ranges: Array<{
    startSec: number;
    endSec: number;
  }>;
};

type TranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string | null;
};

type TrainingReportClientProps = Readonly<{
  sessionId: string;
  sessionStatus: string;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  qaQuestions: TrainingQaQuestion[];
  recording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
  pitchDurationSec: number | null;
  previewFile: ReportPreviewFile | null;
  previewNotice: string | null;
  slideEvents: ReportSlideEvent[];
}>;

function formatReplayTime(totalSec: number) {
  const safeTotal = Number.isFinite(totalSec) ? Math.max(0, Math.floor(totalSec)) : 0;
  const minutes = Math.floor(safeTotal / 60);
  const seconds = safeTotal % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function buildPitchReplaySegments(
  events: ReportSlideEvent[],
  fallbackDurationSec: number | null,
): PitchReplaySegment[] {
  const orderedEvents = events
    .filter(
      (event) =>
        Number.isFinite(event.elapsedSec) &&
        Number.isFinite(event.pageIndex) &&
        event.pageIndex > 0,
    )
    .sort((a, b) => {
      if (a.elapsedSec !== b.elapsedSec) {
        return a.elapsedSec - b.elapsedSec;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  const maxEventSec = orderedEvents.reduce(
    (max, event) => Math.max(max, event.elapsedSec),
    0,
  );
  const totalDurationSec = Math.max(fallbackDurationSec ?? 0, maxEventSec);

  if (orderedEvents.length === 0) {
    return totalDurationSec > 0
      ? [
          {
            pageIndex: 1,
            startSec: 0,
            endSec: totalDurationSec,
            durationSec: totalDurationSec,
            ranges: [{ startSec: 0, endSec: totalDurationSec }],
          },
        ]
      : [];
  }

  const pageRanges = new Map<number, Array<{ startSec: number; endSec: number }>>();

  orderedEvents.forEach((event, index) => {
    if (event.eventType === "END") {
      return;
    }

    const startSec = Math.max(0, event.elapsedSec);
    const nextEvent = orderedEvents
      .slice(index + 1)
      .find((item) => item.elapsedSec >= startSec);
    const endSec = nextEvent ? nextEvent.elapsedSec : totalDurationSec;

    if (endSec <= startSec) {
      return;
    }

    const ranges = pageRanges.get(event.pageIndex) ?? [];
    ranges.push({ startSec, endSec });
    pageRanges.set(event.pageIndex, ranges);
  });

  return Array.from(pageRanges.entries())
    .map(([pageIndex, ranges]) => {
      const durationSec = ranges.reduce(
        (total, range) => total + Math.max(0, range.endSec - range.startSec),
        0,
      );
      return {
        pageIndex,
        startSec: ranges[0]?.startSec ?? 0,
        endSec: ranges[0]?.endSec ?? 0,
        durationSec,
        ranges,
      };
    })
    .filter((segment) => segment.durationSec > 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

function getTranscriptExcerptForSegment(
  text: string,
  segmentsJson: string | null | undefined,
  segment: PitchReplaySegment | null,
  totalDurationSec: number,
) {
  const segments = parseTranscriptSegments(segmentsJson);
  const preciseText = getPreciseTranscriptExcerpt(segments, segment);

  if (preciseText) {
    return {
      text: preciseText,
      matchType: "precise" as const,
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText || !segment || totalDurationSec <= 0) {
    return {
      text: "",
      matchType: "none" as const,
    };
  }

  const startRatio = Math.min(1, Math.max(0, segment.startSec / totalDurationSec));
  const endRatio = Math.min(1, Math.max(startRatio, segment.endSec / totalDurationSec));
  const startIndex = Math.floor(trimmedText.length * startRatio);
  const endIndex = Math.max(
    startIndex + 1,
    Math.ceil(trimmedText.length * endRatio),
  );

  return {
    text: trimmedText.slice(startIndex, endIndex).trim(),
    matchType: "estimated" as const,
  };
}

function parseTranscriptSegments(
  value: string | null | undefined,
): TranscriptSegment[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const segments: TranscriptSegment[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      const startMs = Number(record.startMs);
      const endMs = Number(record.endMs);
      const segmentText =
        typeof record.text === "string" ? record.text.trim() : "";

      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs ||
        !segmentText
      ) {
        continue;
      }

      segments.push({
        startMs,
        endMs,
        text: segmentText,
        speakerId:
          typeof record.speakerId === "string" ? record.speakerId : null,
      });
    }

    return segments.sort((left, right) => left.startMs - right.startMs);
  } catch {
    return [];
  }
}

function getPreciseTranscriptExcerpt(
  segments: TranscriptSegment[],
  segment: PitchReplaySegment | null,
) {
  if (!segment || segments.length === 0) {
    return "";
  }

  const startMs = segment.startSec * 1000;
  const endMs = segment.endSec * 1000;

  return segments
    .filter((item) => item.endMs > startMs && item.startMs < endMs)
    .map((item) => trimTranscriptSegmentToWindow(item, startMs, endMs))
    .filter(Boolean)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function trimTranscriptSegmentToWindow(
  segment: TranscriptSegment,
  windowStartMs: number,
  windowEndMs: number,
) {
  const segmentDurationMs = segment.endMs - segment.startMs;

  if (segmentDurationMs <= 0) {
    return "";
  }

  const characters = Array.from(segment.text);
  let startIndex = 0;
  let endIndex = characters.length;
  const crossesStart = segment.startMs < windowStartMs;
  const crossesEnd = segment.endMs > windowEndMs;

  if (crossesStart) {
    const startRatio = Math.min(
      1,
      Math.max(0, (windowStartMs - segment.startMs) / segmentDurationMs),
    );
    startIndex = Math.min(
      characters.length,
      Math.floor(characters.length * startRatio),
    );
  }

  if (crossesEnd) {
    const endRatio = Math.min(
      1,
      Math.max(0, (windowEndMs - segment.startMs) / segmentDurationMs),
    );
    endIndex = Math.max(startIndex, Math.ceil(characters.length * endRatio));
  }

  let text = characters.slice(startIndex, endIndex).join("").trim();

  if (crossesStart) {
    text = text.replace(/^[，。！？；、,.!?;\s]+/, "");
    const firstSentenceEnd = text.search(/[。！？!?；;]/);

    if (firstSentenceEnd >= 0 && firstSentenceEnd <= 18) {
      text = text.slice(firstSentenceEnd + 1).trim();
    }
  }

  if (crossesEnd) {
    text = text.replace(/[，。！？；、,.!?;\s]+$/, "");
  }

  return text;
}

const REPORT_GENERATION_FAILURE_MESSAGE =
  "报告生成失败，请稍后重试或返回项目详情重新开始训练。";

const REPORT_GENERATION_STAGES = [
  "正在整理路演转写与答辩记录",
  "正在分析路演表达、内容完整度与答辩表现",
  "正在生成评分、评语与改进建议",
];

function getReportGenerationStageIndex(elapsedMs: number) {
  return Math.floor(elapsedMs / 30_000) % REPORT_GENERATION_STAGES.length;
}

function ReportGenerationPanel({
  message,
  elapsedMs,
}: Readonly<{
  message: string;
  elapsedMs: number;
}>) {
  const activeStageIndex = getReportGenerationStageIndex(elapsedMs);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950 p-5 text-left shadow-sm">
      <div className="flex items-start gap-4">
        <div className="mt-1 h-8 w-8 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-blue-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">报告生成中</p>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {message || REPORT_GENERATION_STAGES[activeStageIndex]}
          </p>
          <div className="mt-4 space-y-2">
            {REPORT_GENERATION_STAGES.map((stage, index) => (
              <div
                key={stage}
                className="flex items-center gap-3 text-sm"
              >
                <span
                  className={
                    index === activeStageIndex
                      ? "h-2.5 w-2.5 rounded-full bg-blue-400 shadow-[0_0_0_4px_rgba(96,165,250,0.16)]"
                      : "h-2.5 w-2.5 rounded-full bg-slate-700"
                  }
                />
                <span
                  className={
                    index === activeStageIndex
                      ? "text-slate-100"
                      : "text-slate-500"
                  }
                >
                  {stage}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-400">
            报告生成通常需要 1-3 分钟，请勿刷新页面。完成后页面会自动更新。
          </p>
        </div>
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
  pitchDurationSec,
  previewFile,
  previewNotice,
  slideEvents,
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
  const [activeTab, setActiveTab] = useState<
    | "overview"
    | "pitch"
    | "replay"
    | "qa"
    | "abort-overview"
    | "abort-pitch"
    | "abort-qa"
  >(isAborted ? "abort-overview" : "overview");
  const contentRef = useRef<HTMLDivElement>(null);
  // 展开/收起：内容覆盖
  const [showAllCoverage, setShowAllCoverage] = useState(false);
  const [replayPageIndex, setReplayPageIndex] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [pageNotes, setPageNotes] = useState<Record<string, string>>({});
  const [isPageNotesLoaded, setIsPageNotesLoaded] = useState(false);
  const pitchReplayAudioRef = useRef<HTMLAudioElement | null>(null);

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
          setAnalysisMessage(REPORT_GENERATION_FAILURE_MESSAGE);
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

  const pitchReplaySegments = useMemo(
    () =>
      buildPitchReplaySegments(
        slideEvents,
        recording?.durationSec ?? pitchDurationSec,
      ),
    [pitchDurationSec, recording?.durationSec, slideEvents],
  );
  const safeReplayPageIndex =
    pitchReplaySegments.length > 0
      ? Math.min(replayPageIndex, pitchReplaySegments.length - 1)
      : 0;
  const currentReplaySegment = pitchReplaySegments[safeReplayPageIndex] ?? null;
  const replayTotalDurationSec =
    recording?.durationSec ??
    pitchDurationSec ??
    (currentReplaySegment?.endSec ?? 0);
  const replayPreviewUrl = previewFile
    ? `/api/files/${previewFile.id}/preview`
    : "";
  const replayPreviewPage = currentReplaySegment?.pageIndex ?? 1;
  const replayTranscriptExcerpt = useMemo(
    () =>
      getTranscriptExcerptForSegment(
        transcript?.text ?? "",
        transcript?.segmentsJson,
        currentReplaySegment,
        replayTotalDurationSec,
      ),
    [
      currentReplaySegment,
      replayTotalDurationSec,
      transcript?.segmentsJson,
      transcript?.text,
    ],
  );
  const replayNoteKey = currentReplaySegment
    ? String(currentReplaySegment.pageIndex)
    : "1";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const rawValue = window.localStorage.getItem(
          `training-report:${sessionId}:pitch-page-notes`,
        );
        const parsed = rawValue ? JSON.parse(rawValue) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setPageNotes(parsed as Record<string, string>);
        }
      } catch {
        setPageNotes({});
      } finally {
        setIsPageNotesLoaded(true);
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [sessionId]);

  useEffect(() => {
    if (!isPageNotesLoaded) {
      return;
    }

    window.localStorage.setItem(
      `training-report:${sessionId}:pitch-page-notes`,
      JSON.stringify(pageNotes),
    );
  }, [isPageNotesLoaded, pageNotes, sessionId]);

  useEffect(() => {
    const audio = pitchReplayAudioRef.current;
    if (!audio || !currentReplaySegment) {
      return undefined;
    }

    const handleTimeUpdate = () => {
      if (audio.currentTime >= currentReplaySegment.endSec) {
        audio.pause();
        setIsReplayPlaying(false);
      }
    };
    const handlePause = () => setIsReplayPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
    };
  }, [currentReplaySegment]);

  const playCurrentReplaySegment = useCallback(async () => {
    const audio = pitchReplayAudioRef.current;
    if (!audio || !currentReplaySegment) {
      return;
    }

    audio.currentTime = currentReplaySegment.startSec;

    try {
      await audio.play();
      setIsReplayPlaying(true);
    } catch {
      setIsReplayPlaying(false);
    }
  }, [currentReplaySegment]);

  const pauseCurrentReplaySegment = useCallback(() => {
    const audio = pitchReplayAudioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    setIsReplayPlaying(false);
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
      <nav className="sticky top-0 z-10 -mx-6 border-b border-[var(--border)] bg-[var(--surface)]/95 px-6 backdrop-blur sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10">
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
                    ? "border-b-2 border-teal-300 text-[var(--surface-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--surface-foreground)]"
                }`}
              >
                {tab.label}
              </button>
            ))
          : analysis?.status === "COMPLETED"
            ? [
                { key: "overview" as const, label: "总览" },
                { key: "pitch" as const, label: "路演表现" },
                { key: "replay" as const, label: "路演回放" },
                { key: "qa" as const, label: "答辩表现" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`relative -mb-px px-4 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === tab.key
                      ? "border-b-2 border-teal-300 text-[var(--surface-foreground)]"
                      : "text-[var(--muted-foreground)] hover:text-[var(--surface-foreground)]"
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
          {analysis?.status === "COMPLETED" ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    一页式复盘
                  </p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">
                    本次训练结论
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                    {onePageSummary.conclusion || analysis.summary}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row lg:flex-col lg:items-end">
                  <button
                    type="button"
                    onClick={() => {
                      void copyOnePageSummary();
                    }}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    复制复盘摘要
                  </button>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-center">
                    <p className="text-xs font-medium text-slate-500">
                      综合评分
                    </p>
                    <p className="mt-1 text-4xl font-semibold text-slate-950">
                      {analysis.overallScore ?? "-"}
                    </p>
                    <p className="text-xs text-slate-400">/ 100</p>
                  </div>
                  {copySummaryMessage ? (
                    <p className="text-xs text-teal-700">
                      {copySummaryMessage}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-4">
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
                  <p className="text-xs font-semibold text-emerald-700">
                    最大优势
                  </p>
                  <p className="mt-2 text-sm leading-6 text-emerald-950/80">
                    {onePageSummary.strongestPoint}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
                  <p className="text-xs font-semibold text-amber-700">
                    最大短板
                  </p>
                  <p className="mt-2 text-sm leading-6 text-amber-950/80">
                    {onePageSummary.biggestWeakness}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4">
                  <p className="text-xs font-semibold text-blue-700">
                    下一轮重点
                  </p>
                  <p className="mt-2 text-sm leading-6 text-blue-950/80">
                    {onePageSummary.nextTrainingFocus}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500">
                    正式展示建议
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {onePageSummary.readinessAdvice}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {analysis?.status === "COMPLETED" ? (
            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-800">
                  路演内容诊断
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {(diagnostics.content.length > 0
                    ? diagnostics.content
                    : ["暂无更细的内容诊断，建议查看内容覆盖与证据充分性。"]
                  ).map((item, index) => (
                    <li key={index}>· {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-800">
                  表达与节奏诊断
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {(diagnostics.delivery.length > 0
                    ? diagnostics.delivery
                    : ["暂无更细的表达诊断，建议查看路演表现分析。"]
                  ).map((item, index) => (
                    <li key={index}>· {item}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-800">
                  答辩表现诊断
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                  {(diagnostics.qa.length > 0
                    ? diagnostics.qa
                    : ["如本轮已完成答辩，可在答辩表现页查看逐题复盘。"]
                  ).map((item, index) => (
                    <li key={index}>· {item}</li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}

          {analysis?.status === "COMPLETED" && actionItems.length > 0 ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
                <h2 className="text-sm font-semibold text-slate-800">
                  可直接执行的修改建议
                </h2>
                <p className="text-xs text-slate-400">
                  按“问题—影响—改法—参考话术”拆解，便于下一轮直接改稿。
                </p>
              </div>
              <div className="mt-4 grid gap-4">
                {actionItems.slice(0, 4).map((item, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}. {item.issue}
                    </p>
                    <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 lg:grid-cols-3">
                      <p>
                        <span className="font-medium text-slate-800">
                          影响：
                        </span>
                        {item.whyItMatters}
                      </p>
                      <p>
                        <span className="font-medium text-slate-800">
                          改法：
                        </span>
                        {item.howToFix}
                      </p>
                      <p>
                        <span className="font-medium text-slate-800">
                          参考话术：
                        </span>
                        {item.sampleWording}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {analysis?.status === "COMPLETED" && nextTrainingTasks.length > 0 ? (
            <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-6">
              <h2 className="text-sm font-semibold text-blue-900">
                下一轮训练任务
              </h2>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                {nextTrainingTasks.slice(0, 3).map((task, index) => (
                  <div
                    key={index}
                    className="rounded-lg border border-blue-100 bg-white/80 p-4 text-sm leading-6 text-blue-950/80"
                  >
                    <p className="text-xs font-semibold text-blue-600">
                      任务 {index + 1}
                    </p>
                    <p className="mt-2">{task}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {analysis?.status === "COMPLETED" ? null : isAborted ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="rounded-md border border-red-100 bg-red-50/50 p-5">
                <p className="text-sm font-medium text-red-700">本轮训练已中止</p>
                <p className="mt-1 text-sm text-red-600/80">
                  本轮训练在正式流程中被中止，已完成内容会保留，但不能继续本轮路演或答辩。
                </p>
              </div>
            </section>
          ) : isAnalysisLoading ? (
            <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <ReportGenerationPanel
                message={analysisMessage}
                elapsedMs={reportGenerationElapsedMs}
              />
            </section>
          ) : analysis?.status === "FAILED" ? (
            <section className="rounded-lg border border-slate-100 bg-white p-6">
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-red-600">报告生成失败</p>
                <p className="mt-1 text-xs text-red-400">
                  {REPORT_GENERATION_FAILURE_MESSAGE}
                </p>
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
            <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <ReportGenerationPanel
                message={analysisMessage}
                elapsedMs={reportGenerationElapsedMs}
              />
            </section>
          ) : (
            <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
              <ReportGenerationPanel
                message={analysisMessage || "正在准备报告数据，请稍候……"}
              elapsedMs={reportGenerationElapsedMs}
            />
          </section>
          )}
        </div>
      )}

      {/* === 路演回放 Tab === */}
      {activeTab === "replay" && (
        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-100 bg-white p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">
                  路演逐页回放
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  按训练时翻页记录回看材料、音频片段、转写和个人笔记。
                </p>
              </div>
              <div className="text-xs text-slate-400">
                {pitchReplaySegments.length > 0
                  ? `共 ${pitchReplaySegments.length} 个页面片段`
                  : "暂无翻页片段"}
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <div className="rounded-lg border border-slate-100 bg-slate-950 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      {previewFile?.originalName ?? "暂无可预览材料"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {currentReplaySegment
                        ? `当前第 ${currentReplaySegment.pageIndex} 页`
                        : previewNotice ?? "未记录可回放的页面片段。"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setReplayPageIndex(() =>
                          Math.max(0, safeReplayPageIndex - 1),
                        )
                      }
                      disabled={safeReplayPageIndex <= 0}
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setReplayPageIndex(() =>
                          Math.min(
                            pitchReplaySegments.length - 1,
                            safeReplayPageIndex + 1,
                          ),
                        )
                      }
                      disabled={
                        safeReplayPageIndex >= pitchReplaySegments.length - 1
                      }
                      className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      下一页
                    </button>
                  </div>
                </div>

                <div className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-md border border-slate-800 bg-slate-950">
                  {previewFile && currentReplaySegment ? (
                    <iframe
                      key={`${previewFile.id}-${replayPreviewPage}`}
                      src={`${replayPreviewUrl}#page=${replayPreviewPage}`}
                      title={`第 ${replayPreviewPage} 页材料预览`}
                      className="h-[70vh] min-h-[420px] w-full bg-slate-950"
                    />
                  ) : (
                    <div className="px-6 text-center text-sm text-slate-400">
                      <p>{previewNotice ?? "当前没有可预览的 PDF 材料。"}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        仍可查看下方路演录音、转写和分析结果。
                      </p>
                    </div>
                  )}
                </div>

                {pitchReplaySegments.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pitchReplaySegments.map((segment, index) => (
                      <button
                        key={`${segment.pageIndex}-${index}`}
                        type="button"
                        onClick={() => setReplayPageIndex(index)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          index === safeReplayPageIndex
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        第 {segment.pageIndex} 页 ·{" "}
                        {formatReplayTime(segment.durationSec)}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <aside className="grid content-start gap-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-4">
                  <h3 className="text-sm font-semibold text-slate-800">
                    对应该页的路演音频切分
                  </h3>
                  {recording && currentReplaySegment ? (
                    <div className="mt-3 grid gap-3">
                      <audio
                        ref={pitchReplayAudioRef}
                        controls
                        preload="metadata"
                        src={recording.playbackUrl}
                        className="w-full"
                      >
                        <track kind="captions" />
                      </audio>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void playCurrentReplaySegment()}
                          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                        >
                          {isReplayPlaying ? "重新播放本页" : "播放本页片段"}
                        </button>
                        <button
                          type="button"
                          onClick={pauseCurrentReplaySegment}
                          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
                        >
                          暂停
                        </button>
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        片段区间：{formatReplayTime(currentReplaySegment.startSec)}
                        {" - "}
                        {formatReplayTime(currentReplaySegment.endSec)}
                        <br />
                        本页累计用时：
                        {formatReplayTime(currentReplaySegment.durationSec)}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      当前没有可用的路演录音或页面片段。
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-slate-100 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-800">
                    对应该页的音频转写
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {currentReplaySegment
                      ? `本页用时 ${formatReplayTime(
                          currentReplaySegment.durationSec,
                        )}`
                      : "暂无页面用时"}
                    {replayTranscriptExcerpt.matchType === "precise"
                      ? " · 已按句子时间戳精确匹配"
                      : replayTranscriptExcerpt.matchType === "estimated"
                        ? " · 按页面用时粗略匹配"
                        : ""}
                  </p>
                  <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-slate-100 bg-slate-50/60 p-3 text-sm leading-6 text-slate-600">
                    {replayTranscriptExcerpt.text ||
                      "暂无可匹配的本页转写片段。新训练若使用腾讯云极速版时间戳，将按本页音频时间精确匹配。"}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-100 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-800">笔记</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    记录这一页讲得不好的地方、需要补充的证据或下一轮改法。
                  </p>
                  <textarea
                    value={pageNotes[replayNoteKey] ?? ""}
                    onChange={(event) =>
                      setPageNotes((prev) => ({
                        ...prev,
                        [replayNoteKey]: event.target.value,
                      }))
                    }
                    placeholder="例如：这一页背景痛点讲得太泛，需要补一个真实客户场景。"
                    className="mt-3 min-h-36 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-slate-400"
                  />
                  <p className="mt-2 text-xs text-slate-400">
                    笔记会保存在当前浏览器本地。
                  </p>
                </div>
              </aside>
            </div>
          </section>
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
                  {REPORT_GENERATION_FAILURE_MESSAGE}
                </p>
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
