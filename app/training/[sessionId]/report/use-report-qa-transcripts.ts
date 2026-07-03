"use client";

import { useCallback, useEffect, useState } from "react";
import { canRetryTranscript } from "@/lib/transcript-error-message";

type ReportQaTranscript = {
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

type ReportQaQuestion = {
  answer: {
    recording: {
      id: string;
      transcript: ReportQaTranscript | null;
    } | null;
  } | null;
};

type UseReportQaTranscriptsOptions = Readonly<{
  sessionId: string;
  qaQuestions: ReportQaQuestion[];
}>;

export function useReportQaTranscripts({
  sessionId,
  qaQuestions,
}: UseReportQaTranscriptsOptions) {
  const [qaTranscripts, setQaTranscripts] = useState<
    Record<string, ReportQaTranscript | null>
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
  const [expandedTranscripts, setExpandedTranscripts] = useState<Set<string>>(
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
        transcript?: ReportQaTranscript;
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

  return {
    qaTranscripts,
    qaTranscribingSet,
    expandedTranscripts,
    toggleTranscriptExpand,
    retryQaTranscribe,
  };
}
