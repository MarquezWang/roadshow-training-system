import {
  getQualityColor,
  getQuestionDimensionHint,
  getQuestionTypeLabel,
} from "./report-qa-helpers";
import { ReportQaRecordingBlock } from "./report-qa-recording-block";
import { ReportQaReviewBlock } from "./report-qa-review-block";
import type { QaQuestion, QaReview, QaTranscript } from "./report-qa-types";

type ReportQaQuestionCardProps = Readonly<{
  question: QaQuestion;
  qaReview: QaReview | undefined;
  suggestions: string[];
  qaTranscripts: Record<string, QaTranscript | null | undefined>;
  qaTranscribingSet: Set<string>;
  expandedTranscripts: Set<string>;
  isAborted: boolean;
  onToggleTranscriptExpand: (recordingId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

export function ReportQaQuestionCard({
  question,
  qaReview,
  suggestions,
  qaTranscripts,
  qaTranscribingSet,
  expandedTranscripts,
  isAborted,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: ReportQaQuestionCardProps) {
  const typeLabel = getQuestionTypeLabel(question.questionType);
  const dimensionHint = getQuestionDimensionHint(question.questionType);
  const qualityLabel = qaReview?.responseQualityLabel ?? null;
  const qualityColor = getQualityColor(qaReview?.responseQuality);
  const recording = question.answer?.recording ?? null;

  return (
    <article className="rounded-md border border-slate-100 p-4">
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

      <p className="mt-2 text-sm font-medium leading-6 text-slate-800">
        {question.questionText}
      </p>
      {question.basis ? (
        <p className="mt-1 text-xs text-slate-400">依据：{question.basis}</p>
      ) : null}

      {qaReview?.judgeIntent ? (
        <div className="mt-2 rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
          <p className="text-xs text-slate-400">提问角度</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">
            {qaReview.judgeIntent}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-400">{dimensionHint}</p>
      )}

      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
        <p>
          回答用时：
          {question.answer?.durationSec !== null &&
          question.answer?.durationSec !== undefined
            ? `${question.answer.durationSec} 秒`
            : "未记录"}
        </p>
        <p>
          查看文字：{question.answer?.revealedQuestionText ? "是" : "否"}
        </p>
        <p>
          回答方式：
          {question.answer?.answerText?.trim() ? "文字记录" : "语音回答"}
        </p>
      </div>

      {question.answer?.answerText?.trim() ? (
        <p className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm leading-6 text-slate-700">
          {question.answer.answerText}
        </p>
      ) : null}

      {recording ? (
        <ReportQaRecordingBlock
          recording={recording}
          transcript={qaTranscripts[recording.id]}
          isTranscribing={qaTranscribingSet.has(recording.id)}
          isExpanded={expandedTranscripts.has(recording.id)}
          isAborted={isAborted}
          onToggleTranscriptExpand={onToggleTranscriptExpand}
          onRetryQaTranscribe={onRetryQaTranscribe}
        />
      ) : (
        <p className="mt-3 text-xs text-slate-400">本题未保存录音。</p>
      )}

      <ReportQaReviewBlock
        qaReview={qaReview}
        suggestions={suggestions}
        questionOrderIndex={question.orderIndex}
      />
    </article>
  );
}
