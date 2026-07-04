import {
  getQualityColor,
  getQuestionDimensionHint,
  getQuestionTypeLabel,
} from "./report-qa-helpers";
import { ReportQaRecordingBlock } from "./report-qa-recording-block";
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

      {qaReview ? (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <p className="text-xs font-semibold text-slate-500">回答复盘</p>
          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
            <p className="text-xs text-slate-400">回答摘要</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700">
              {qaReview.answerSummary}
            </p>
          </div>
          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
            <p className="text-xs text-slate-400">证据使用情况</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700">
              {qaReview.evidenceUse}
            </p>
          </div>
          {qaReview.missingPoints.length > 0 ? (
            <div className="rounded border border-red-50 bg-red-50/30 px-3 py-2">
              <p className="text-xs font-medium text-red-600">缺失要点</p>
              <ul className="mt-1.5 space-y-1">
                {qaReview.missingPoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="flex gap-1.5 text-xs leading-5 text-red-700/80"
                  >
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded border border-slate-100 bg-slate-50/50 px-3 py-2">
            <p className="text-xs text-slate-400">本题改进建议</p>
            <p className="mt-0.5 text-xs leading-5 text-slate-700">
              {qaReview.improvementAdvice}
            </p>
          </div>
          {qaReview.betterAnswerOutline.length > 0 ? (
            <div className="rounded border border-blue-50 bg-blue-50/30 px-3 py-2">
              <p className="text-xs font-medium text-blue-600">
                更优回答结构
              </p>
              <ul className="mt-1.5 space-y-1">
                {qaReview.betterAnswerOutline.map((outline, idx) => (
                  <li
                    key={idx}
                    className="flex gap-1.5 text-xs leading-5 text-blue-700/80"
                  >
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                    <span>{outline}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 border-t border-slate-100 pt-4">
          {suggestions.length > 0 ? (
            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
              <p className="text-xs font-medium text-slate-500">回答建议</p>
              <p className="mt-1 text-xs text-slate-600">
                {suggestions[question.orderIndex % suggestions.length]}
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
}
