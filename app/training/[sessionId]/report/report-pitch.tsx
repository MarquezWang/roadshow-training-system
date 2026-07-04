"use client";

import { REPORT_GENERATION_FAILURE_MESSAGE } from "./report-ui";
import {
  ReportPitchCoverage,
  type ContentCoverageItem,
} from "./report-pitch-coverage";
import { ReportPitchInsightList } from "./report-pitch-insight-list";
import {
  ReportPitchRecording,
  type PitchRecording,
  type PitchTranscript,
} from "./report-pitch-recording";

type PitchAnalysis = {
  status: string;
  overallScore: number | null;
  summary: string;
};

type ReportPitchTabProps = Readonly<{
  analysis: PitchAnalysis | null;
  transcript: PitchTranscript | null;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  contentCoverage: ContentCoverageItem[];
  showAllCoverage: boolean;
  isAborted: boolean;
  recording: PitchRecording | null;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptDraft: string;
  transcriptExpanded: boolean;
  transcriptMessage: string;
  onToggleShowAllCoverage: () => void;
  onStartTranscriptEditing: () => void;
  onToggleTranscriptExpanded: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onCancelTranscriptEditing: () => void;
  onSaveTranscript: () => void;
}>;

export function ReportPitchTab({
  analysis,
  transcript,
  strengths,
  weaknesses,
  suggestions,
  contentCoverage,
  showAllCoverage,
  isAborted,
  recording,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptDraft,
  transcriptExpanded,
  transcriptMessage,
  onToggleShowAllCoverage,
  onStartTranscriptEditing,
  onToggleTranscriptExpanded,
  onTranscriptDraftChange,
  onCancelTranscriptEditing,
  onSaveTranscript,
}: ReportPitchTabProps) {
  const hasTranscriptText = Boolean(transcript?.text.trim());
  const hasFailedTranscript = transcript?.status === "FAILED";

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-slate-100 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">路演表现分析</h2>
        <p className="mt-1 text-xs text-slate-400">
          基于路演转写文本的 AI 评估结果。
        </p>

        {isAborted ? (
          <p className="mt-4 rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-600">
            本轮训练已中止，报告不再继续生成。
          </p>
        ) : !hasTranscriptText ? (
          <p className="mt-4 rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-600">
            {hasFailedTranscript
              ? "路演音频转写失败，当前没有可用于分析的转写文本。建议重新录制本轮路演，或在下方手动补充转写文本后再生成训练报告。"
              : "尚未保存路演转写文本。请在下方“路演录音与转写”中补充并保存文本后，再生成训练报告。"}
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
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-slate-900">
                {analysis.overallScore ?? "-"}
              </span>
              <span className="text-sm text-slate-400">/ 100</span>
            </div>

            {analysis.summary ? (
              <div className="rounded-md bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-400">主结论</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">
                  {analysis.summary}
                </p>
              </div>
            ) : null}

            <ReportPitchInsightList
              title="路演优势"
              items={strengths}
              tone="emerald"
            />

            <ReportPitchInsightList
              title="路演问题"
              items={weaknesses}
              tone="amber"
            />

            <ReportPitchInsightList
              title="路演改进建议"
              items={suggestions}
              tone="blue"
            />

            <ReportPitchCoverage
              contentCoverage={contentCoverage}
              showAllCoverage={showAllCoverage}
              onToggleShowAllCoverage={onToggleShowAllCoverage}
            />
          </div>
        )}
      </section>

      <ReportPitchRecording
        recording={recording}
        transcript={transcript}
        isAborted={isAborted}
        isTranscriptEditing={isTranscriptEditing}
        isTranscriptSaving={isTranscriptSaving}
        transcriptDraft={transcriptDraft}
        transcriptExpanded={transcriptExpanded}
        transcriptMessage={transcriptMessage}
        onStartTranscriptEditing={onStartTranscriptEditing}
        onToggleTranscriptExpanded={onToggleTranscriptExpanded}
        onTranscriptDraftChange={onTranscriptDraftChange}
        onCancelTranscriptEditing={onCancelTranscriptEditing}
        onSaveTranscript={onSaveTranscript}
      />
    </div>
  );
}
