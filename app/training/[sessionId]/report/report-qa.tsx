import {
  canRetryTranscript,
  formatTranscriptErrorMessage,
} from "@/lib/transcript-error-message";
import { DynamicFollowupSection } from "./report-qa-dynamic-followup";
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

function getQuestionTypeLabel(questionType: string | null) {
  const qType = questionType ?? "QUESTION";
  return qType === "TECH"
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
}

function getQuestionDimensionHint(questionType: string | null) {
  const qType = questionType ?? "QUESTION";
  return qType === "TECH"
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
}

function getQualityColor(responseQuality: string | undefined) {
  return responseQuality === "GOOD"
    ? "bg-emerald-50 text-emerald-600"
    : responseQuality === "PARTIAL"
      ? "bg-amber-50 text-amber-600"
      : responseQuality === "WEAK"
        ? "bg-red-50 text-red-500"
        : "";
}

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
              const typeLabel = getQuestionTypeLabel(question.questionType);
              const dimensionHint = getQuestionDimensionHint(
                question.questionType,
              );
              const qaReview = enteredQaReviews.find(
                (r) => r.questionId === question.id,
              );
              const qualityLabel = qaReview?.responseQualityLabel ?? null;
              const qualityColor = getQualityColor(qaReview?.responseQuality);

              return (
                <article
                  key={question.id}
                  className="rounded-md border border-slate-100 p-4"
                >
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
                    <p className="mt-1 text-xs text-slate-400">
                      依据：{question.basis}
                    </p>
                  ) : null}

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

                  {question.answer?.answerText?.trim() ? (
                    <p className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50/50 p-3 text-sm leading-6 text-slate-700">
                      {question.answer.answerText}
                    </p>
                  ) : null}

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
                      const hasText = status === "COMPLETED" && ts?.text?.trim();
                      const textPreview = hasText && ts ? ts.text.slice(0, 150) : "";
                      const fullText = ts?.text ?? "";

                      return (
                        <div className="mt-3 space-y-2">
                          <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-slate-500">
                                回答录音
                                {question.answer.recording.durationSec !== null
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

                          {hasText ? (
                            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
                              {isExpanded ? (
                                <>
                                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                    {fullText}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => onToggleTranscriptExpand(rId)}
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
                                    onClick={() => onToggleTranscriptExpand(rId)}
                                    className="mt-1 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
                                  >
                                    展开完整转写
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}

                          {status === "FAILED" ? (
                            <details className="rounded-md border border-red-100 bg-red-50/30 p-3">
                              <summary className="cursor-pointer text-xs text-red-500">
                                查看错误详情
                              </summary>
                              <p className="mt-1 text-xs text-red-400">
                                {formatTranscriptErrorMessage(
                                  ts?.errorMessage ?? null,
                                )}
                              </p>
                              {!isAborted ? (
                                canRetryTranscript(ts?.errorMessage ?? null) ? (
                                  <button
                                    type="button"
                                    onClick={() => onRetryQaTranscribe(rId)}
                                    disabled={isTranscribing}
                                    className="mt-2 inline-flex h-7 items-center justify-center rounded border border-red-200 bg-white px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                                  >
                                    {isTranscribing ? "转写中..." : "重试转写"}
                                  </button>
                                ) : (
                                  <p className="mt-1 text-xs text-slate-400">
                                    当前失败类型不建议重试
                                  </p>
                                )
                              ) : null}
                            </details>
                          ) : null}

                          {status !== "COMPLETED" && status !== "FAILED" ? (
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

                  {qaReview ? (
                    <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                      <p className="text-xs font-semibold text-slate-500">
                        回答复盘
                      </p>
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
                          <p className="text-xs font-medium text-red-600">
                            缺失要点
                          </p>
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
