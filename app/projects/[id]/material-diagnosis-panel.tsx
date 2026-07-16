"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  evidenceStatusLabel,
  readinessLevelLabel,
  type EvidenceStatus,
  type MaterialDiagnosisResult,
  type ReadinessLevel,
} from "@/lib/material-diagnosis";

type MaterialDiagnosisPanelProps = Readonly<{
  projectId: string;
  initialDiagnosis: MaterialDiagnosisResult | null;
  initialIsStale: boolean;
}>;

const readinessClass: Record<ReadinessLevel, string> = {
  HIGH: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MEDIUM: "border-sky-200 bg-sky-50 text-sky-800",
  LOW: "border-amber-200 bg-amber-50 text-amber-800",
  INSUFFICIENT: "border-rose-200 bg-rose-50 text-rose-800",
};

const criterionCardClass: Record<EvidenceStatus, string> = {
  SUFFICIENT:
    "border-emerald-200/80 bg-emerald-50/55 text-emerald-950 hover:border-emerald-300/80 hover:bg-emerald-50/80",
  PARTIAL:
    "border-amber-200/80 bg-amber-50/55 text-amber-950 hover:border-amber-300/80 hover:bg-amber-50/80",
  MISSING:
    "border-rose-200/80 bg-rose-50/55 text-rose-950 hover:border-rose-300/80 hover:bg-rose-50/80",
  UNKNOWN:
    "border-sky-200/80 bg-sky-50/55 text-sky-950 hover:border-sky-300/80 hover:bg-sky-50/80",
};

const criterionDetailClass: Record<EvidenceStatus, string> = {
  SUFFICIENT: "border-emerald-200 bg-emerald-50/80",
  PARTIAL: "border-amber-200 bg-amber-50/80",
  MISSING: "border-rose-200 bg-rose-50/80",
  UNKNOWN: "border-sky-200 bg-sky-50/80",
};

const evidencePillClass: Record<EvidenceStatus, string> = {
  SUFFICIENT: "border-emerald-600/80 bg-emerald-600/90 text-white",
  PARTIAL: "border-amber-600/80 bg-amber-600/90 text-white",
  MISSING: "border-rose-600/80 bg-rose-600/90 text-white",
  UNKNOWN: "border-sky-600/80 bg-sky-600/90 text-white",
};

async function readErrorMessage(response: Response) {
  try {
    const data = (await response.json()) as { message?: unknown };

    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // Ignore malformed error body and use the fallback message.
  }

  return "材料诊断生成失败，请稍后重试。";
}

export function MaterialDiagnosisPanel({
  projectId,
  initialDiagnosis,
  initialIsStale,
}: MaterialDiagnosisPanelProps) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis);
  const [isStale, setIsStale] = useState(initialIsStale);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCriterionKey, setSelectedCriterionKey] = useState("");
  const [criteriaAreaMinHeight, setCriteriaAreaMinHeight] = useState<
    number | null
  >(null);
  const criteriaGridRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMessage("");

    try {
      const response = await fetch(
        `/api/projects/${projectId}/material-diagnosis`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as {
        status?: string;
        diagnosis?: MaterialDiagnosisResult;
        message?: string;
      };

      if (data.status !== "success" || !data.diagnosis) {
        throw new Error(data.message || "材料诊断生成失败，请稍后重试。");
      }

      setDiagnosis(data.diagnosis);
      setIsStale(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "材料诊断生成失败，请稍后重试。",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const readinessScoreText =
    diagnosis?.readinessScore !== undefined ? `${diagnosis.readinessScore}` : "-";
  const taskCount = diagnosis?.priorityTasks.length ?? 0;
  const riskCount =
    diagnosis?.criteriaResults.filter(
      (criterion) =>
        criterion.evidenceStatus === "MISSING" ||
        criterion.evidenceStatus === "PARTIAL",
    ).length ?? 0;
  const firstPriorityTask = diagnosis?.priorityTasks[0] ?? null;
  const selectedCriterion =
    diagnosis?.criteriaResults.find(
      (criterion) =>
        `${criterion.category}-${criterion.criterionName}` ===
        selectedCriterionKey,
    ) ?? null;

  const handleSelectCriterion = (criterionKey: string) => {
    setCriteriaAreaMinHeight(criteriaGridRef.current?.offsetHeight ?? null);
    setSelectedCriterionKey(criterionKey);
  };

  return (
    <section
      id="materials"
      className="mt-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-700">
            Readiness
          </p>
          <h2 className="mt-2 text-base font-semibold text-slate-950">
            材料工作台
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            先看当前材料是否能支撑训练，再处理最影响答辩的缺口。
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-teal-700 px-4 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isGenerating ? "生成中..." : diagnosis ? "重新生成材料诊断" : "生成材料诊断"}
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
          {errorMessage}
        </div>
      ) : null}

      {isStale ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          项目档案、材料或评审规则已变化；当前诊断是历史结果，请重新生成。
        </div>
      ) : null}

      {!diagnosis ? (
        <div className="mt-5 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
          <h3 className="text-sm font-semibold text-slate-950">
            暂无材料诊断
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            上传材料并确认项目档案后，可以生成一次诊断。系统会标出强项、短板、优先任务和评委可能追问的问题。
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-slate-500">
                    材料准备度
                  </span>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${readinessClass[diagnosis.readinessLevel]}`}
                  >
                    {readinessLevelLabel[diagnosis.readinessLevel]}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">
                  {diagnosis.summary}
                </p>
                {firstPriorityTask ? (
                  <div className="mt-4 rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs font-medium text-slate-500">
                      当前最优先
                    </p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">
                      {firstPriorityTask.title}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                      {firstPriorityTask.reason}
                    </p>
                  </div>
                ) : null}
              </div>

              <ReadinessSnapshot
                score={readinessScoreText}
                taskCount={taskCount}
                riskCount={riskCount}
              />
            </div>
          </div>

          <section className="rounded-lg border border-slate-200 p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">
                  完整材料诊断
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  包含强项、短板、全部优先任务和 12 项指标。
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 lg:grid-cols-3">
              <SummaryList
                title="材料强项"
                items={diagnosis.strengths}
                fallback="暂无明确材料强项"
                className="border-emerald-100 bg-emerald-50/60 text-emerald-900"
              />
              <SummaryList
                title="主要短板"
                items={diagnosis.weaknesses}
                fallback="暂无明确材料短板"
                className="border-amber-100 bg-amber-50/70 text-amber-900"
              />
              <SummaryList
                title="评委追问"
                items={diagnosis.judgeQuestions}
                fallback="暂无明确追问"
                className="border-sky-100 bg-sky-50/70 text-sky-900"
              />
            </div>

            <section className="mt-5 rounded-lg border border-slate-200 p-5">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    全部优先任务
                  </h3>
                </div>
                <span className="text-xs font-medium text-slate-400">
                  {taskCount} 项
                </span>
              </div>
              {diagnosis.priorityTasks.length > 0 ? (
                <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {diagnosis.priorityTasks.map((task, index) => (
                    <article
                      key={`${task.title}-${index}`}
                      className="grid gap-4 bg-white p-4 lg:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)]"
                    >
                      <div className="flex items-start gap-3">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-950">
                            {task.title}
                          </span>
                          {task.relatedCriteria.length > 0 ? (
                            <span className="mt-2 block text-xs leading-5 text-slate-500">
                              关联指标：{task.relatedCriteria.join("、")}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-xs font-medium text-slate-400">
                            诊断原因
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-600">
                            {task.reason}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-slate-400">
                            建议动作
                          </p>
                          <p className="mt-1 text-sm leading-6 text-slate-800">
                            {task.action}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">
                  暂无优先修改任务。
                </p>
              )}
            </section>

            <section id="criteria" className="mt-5 rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-950">
                12 项指标诊断
              </h3>
              {selectedCriterion ? (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedCriterionKey("")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedCriterionKey("");
                    }
                  }}
                  className={`mt-4 w-full cursor-pointer border text-left transition-colors hover:shadow-sm ${criterionDetailClass[selectedCriterion.evidenceStatus]}`}
                  style={
                    criteriaAreaMinHeight
                      ? { minHeight: criteriaAreaMinHeight }
                      : undefined
                  }
                  aria-label="返回全部指标"
                >
                  <div className="flex flex-col gap-3 border-b border-white/70 bg-white/50 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">
                          {selectedCriterion.category} · 权重{" "}
                          {selectedCriterion.weight}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium shadow-sm ${evidencePillClass[selectedCriterion.evidenceStatus]}`}
                        >
                          {evidenceStatusLabel[selectedCriterion.evidenceStatus]}
                        </span>
                      </div>
                      <h4 className="mt-2 text-base font-semibold text-slate-950">
                        {selectedCriterion.criterionName}
                      </h4>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-teal-700">
                      点击返回全部指标
                    </span>
                  </div>

                  <div className="grid gap-4 px-6 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
                    <div className="space-y-4">
                      <div className="rounded-md border border-white/80 bg-white/80 p-4 shadow-sm">
                        <p className="text-xs font-medium text-slate-500">
                          核心问题
                        </p>
                        <p className="mt-2 text-base font-semibold leading-7 text-slate-950">
                          {selectedCriterion.issueSummary}
                        </p>
                      </div>
                      <div className="rounded-md border border-white/80 bg-white/65 p-4">
                        <p className="text-xs font-medium text-slate-500">
                          证据现状
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {selectedCriterion.evidenceSummary}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-md border border-white/80 bg-white/75 p-4">
                      <p className="text-xs font-medium text-slate-500">
                        建议动作
                      </p>
                      <p className="mt-2 text-sm font-medium leading-6 text-slate-900">
                        {selectedCriterion.improvementAdvice}
                      </p>
                    </div>
                  </div>
                  {selectedCriterion.likelyJudgeQuestions.length > 0 ? (
                    <div className="mx-6 mb-5 rounded-md border border-white/80 bg-white/60 p-4">
                      <p className="text-xs font-medium text-slate-500">
                        评委可能追问
                      </p>
                      <ul className="mt-2 grid gap-2 text-sm leading-6 text-slate-700 md:grid-cols-2">
                        {selectedCriterion.likelyJudgeQuestions.map((question) => (
                          <li key={question}>· {question}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  ref={criteriaGridRef}
                  className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
                >
                  {diagnosis.criteriaResults.map((criterion) => (
                    <button
                      key={`${criterion.category}-${criterion.criterionName}`}
                      type="button"
                      onClick={() =>
                        handleSelectCriterion(
                          `${criterion.category}-${criterion.criterionName}`,
                        )
                      }
                      className={`min-h-28 cursor-pointer border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${criterionCardClass[criterion.evidenceStatus]}`}
                    >
                      <div className="flex h-full flex-col justify-between gap-4">
                        <p className="text-xs font-medium opacity-80">
                          {criterion.category} · 权重 {criterion.weight}
                        </p>
                        <h4 className="text-sm font-semibold leading-6">
                          {criterion.criterionName}
                        </h4>
                        <span
                          className={`w-fit border px-2.5 py-1 text-xs font-medium ${evidencePillClass[criterion.evidenceStatus]}`}
                        >
                          {evidenceStatusLabel[criterion.evidenceStatus]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </section>
        </div>
      )}
    </section>
  );
}

function ReadinessSnapshot({
  score,
  taskCount,
  riskCount,
}: Readonly<{
  score: string;
  taskCount: number;
  riskCount: number;
}>) {
  return (
    <div className="flex rounded-lg border border-slate-200 bg-white p-4">
      <div className="my-auto w-full">
        <p className="text-xs font-medium text-slate-500">诊断快照</p>
        <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
          {score}
          <span className="ml-1 text-sm font-medium text-slate-400">/100</span>
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
          <div>
            <p className="text-xs font-medium text-slate-500">优先任务</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">
              {taskCount}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">风险指标</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">
              {riskCount}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryList({
  title,
  items,
  fallback,
  className,
}: Readonly<{
  title: string;
  items: string[];
  fallback: string;
  className: string;
}>) {
  const visibleItems = items.length > 0 ? items : [fallback];

  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 opacity-90">
        {visibleItems.slice(0, 3).map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}
