import { DynamicFollowupSection } from "./report-qa-dynamic-followup";
import { ReportQaQuestionCard } from "./report-qa-question-card";
import type {
  DynamicFollowupReview,
  QaQuestion,
  QaReview,
  QaTranscript,
} from "./report-qa-types";

type ReportQaTabProps = Readonly<{
  enteredQuestions: QaQuestion[];
  dynamicFollowupQuestion: QaQuestion | null;
  dynamicFollowupReview: DynamicFollowupReview | null;
  enteredQaReviews: QaReview[];
  skippedCount: number;
  suggestions: string[];
  qaTranscripts: Record<string, QaTranscript | null | undefined>;
  qaTranscribingSet: Set<string>;
  expandedTranscripts: Set<string>;
  isAborted: boolean;
  isQaCompleted: boolean;
  qaStartedAt: string | null;
  qaEndedAt: string | null;
  qaDurationSec: number | null;
  onToggleTranscriptExpand: (recordingId: string) => void;
  onRetryQaTranscribe: (recordingId: string) => void;
}>;

export function ReportQaTab({
  enteredQuestions,
  dynamicFollowupQuestion,
  dynamicFollowupReview,
  enteredQaReviews,
  skippedCount,
  suggestions,
  qaTranscripts,
  qaTranscribingSet,
  expandedTranscripts,
  isAborted,
  isQaCompleted,
  qaStartedAt,
  qaEndedAt,
  qaDurationSec,
  onToggleTranscriptExpand,
  onRetryQaTranscribe,
}: ReportQaTabProps) {
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-slate-100 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-800">答辩表现</h2>
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
            {qaEndedAt ? ` 至 ${new Date(qaEndedAt).toLocaleString()}` : ""}
            {qaDurationSec !== null ? `（用时 ${qaDurationSec} 秒）` : ""}
          </p>
        ) : null}

        {enteredQuestions.length > 0 ? (
          <div className="mt-4 grid gap-5">
            {enteredQuestions.map((question) => {
              const qaReview = enteredQaReviews.find(
                (r) => r.questionId === question.id,
              );

              return (
                <ReportQaQuestionCard
                  key={question.id}
                  question={question}
                  qaReview={qaReview}
                  suggestions={suggestions}
                  qaTranscripts={qaTranscripts}
                  qaTranscribingSet={qaTranscribingSet}
                  expandedTranscripts={expandedTranscripts}
                  isAborted={isAborted}
                  onToggleTranscriptExpand={onToggleTranscriptExpand}
                  onRetryQaTranscribe={onRetryQaTranscribe}
                />
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-md border border-dashed border-slate-200 p-4 text-sm text-slate-500">
            暂无答辩问题。
          </p>
        )}
      </section>

      {dynamicFollowupQuestion ? (
        <DynamicFollowupSection
          question={dynamicFollowupQuestion}
          review={dynamicFollowupReview}
          qaTranscripts={qaTranscripts}
        />
      ) : null}
    </div>
  );
}
