"use client";

import { useState } from "react";

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
};

type TrainingReportClientProps = Readonly<{
  sessionId: string;
  recording: TrainingRecording | null;
  initialAnalysis: TrainingAnalysis | null;
}>;

export function TrainingReportClient({
  sessionId,
  recording,
  initialAnalysis,
}: TrainingReportClientProps) {
  const [transcript, setTranscript] = useState<TrainingTranscript | null>(
    recording?.transcript ?? null,
  );
  const [transcriptDraft, setTranscriptDraft] = useState(
    recording?.transcript?.text ?? "",
  );
  const [isTranscriptEditing, setIsTranscriptEditing] = useState(
    recording !== null && !recording.transcript,
  );
  const [isTranscriptSaving, setIsTranscriptSaving] = useState(false);
  const [transcriptMessage, setTranscriptMessage] = useState("");
  const [analysis, setAnalysis] = useState<TrainingAnalysis | null>(
    initialAnalysis,
  );
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState("");

  async function saveTranscript() {
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
        throw new Error("路演表现分析接口未返回结果。");
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
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">综合报告占位</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">
          本轮训练已完成
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          后续将在此展示材料表现、路演表现、答辩表现、综合评分和雷达图。本阶段不生成完整综合报告。
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">
          录音与转写文本
        </h3>
        {recording ? (
          <div className="mt-4 grid gap-4">
            <audio controls src={recording.playbackUrl} className="w-full">
              <track kind="captions" />
            </audio>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h4 className="text-sm font-semibold text-slate-950">
                  手动转写文本
                </h4>
                {transcript && !isTranscriptEditing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setTranscriptDraft(transcript.text);
                      setIsTranscriptEditing(true);
                      setTranscriptMessage("");
                    }}
                    className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    编辑转写文本
                  </button>
                ) : null}
              </div>

              {isTranscriptEditing ? (
                <div className="mt-3 grid gap-3">
                  <textarea
                    value={transcriptDraft}
                    onChange={(event) => setTranscriptDraft(event.target.value)}
                    rows={8}
                    className="w-full resize-y rounded-md border border-slate-300 bg-white p-3 text-sm leading-6 text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-slate-500"
                    placeholder="粘贴或编辑人工整理后的路演转写文本"
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
                        className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      >
                        取消编辑
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void saveTranscript()}
                      disabled={isTranscriptSaving}
                      className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {isTranscriptSaving ? "保存中..." : "保存转写文本"}
                    </button>
                  </div>
                </div>
              ) : transcript ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {transcript.text}
                </p>
              ) : null}

              {transcriptMessage ? (
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  {transcriptMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
            本轮没有录音记录。如准备阶段选择了不录音，系统仅保留翻页和用时。
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">
              路演表现分析
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              分析结果将在后续综合报告中使用。本页只展示简要状态。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateAnalysis()}
            disabled={isAnalysisLoading || !transcript?.text.trim()}
            className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isAnalysisLoading
              ? "分析中..."
              : analysis
                ? "重新生成分析"
                : "生成路演表现分析"}
          </button>
        </div>

        {!transcript?.text.trim() ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
            请先保存转写文本，再生成路演表现分析。
          </p>
        ) : null}

        {analysisMessage ? (
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {analysisMessage}
          </p>
        ) : null}

        {analysis ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">当前分析状态：{analysis.status}</p>
            {analysis.status === "COMPLETED" ? (
              <>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {analysis.overallScore ?? "-"} / 100
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  {analysis.summary}
                </p>
              </>
            ) : null}
            {analysis.status === "FAILED" ? (
              <p className="mt-2 text-sm leading-6 text-red-700">
                {analysis.errorMessage ?? "分析生成失败。"}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
            暂无路演表现分析。
          </p>
        )}
      </section>
    </div>
  );
}
