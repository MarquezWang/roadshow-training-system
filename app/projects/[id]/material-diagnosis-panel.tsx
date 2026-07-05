"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
}>;

const readinessClass: Record<ReadinessLevel, string> = {
  HIGH: "border-emerald-200 bg-emerald-50 text-emerald-800",
  MEDIUM: "border-sky-200 bg-sky-50 text-sky-800",
  LOW: "border-amber-200 bg-amber-50 text-amber-800",
  INSUFFICIENT: "border-rose-200 bg-rose-50 text-rose-800",
};

const evidenceClass: Record<EvidenceStatus, string> = {
  SUFFICIENT: "border-emerald-200 bg-emerald-50 text-emerald-800",
  PARTIAL: "border-amber-200 bg-amber-50 text-amber-800",
  MISSING: "border-rose-200 bg-rose-50 text-rose-800",
  UNKNOWN: "border-slate-200 bg-slate-50 text-slate-700",
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
}: MaterialDiagnosisPanelProps) {
  const router = useRouter();
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            赛前材料诊断
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            基于项目档案、上传材料和当前 12 项评审规则，检查材料证据是否充分。该诊断不代表正式评审结果。
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

      {!diagnosis ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8">
          <h3 className="text-sm font-semibold text-slate-950">
            暂无材料诊断
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            上传材料并确认项目档案后，可以生成一次赛前材料诊断。系统会标出强项、短板、优先修改任务和评委可能追问的问题。
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
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
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
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
              title="可能评委追问"
              items={diagnosis.judgeQuestions}
              fallback="暂无明确追问"
              className="border-sky-100 bg-sky-50/70 text-sky-900"
            />
          </div>

          <div className="rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-950">
              优先修改任务
            </h3>
            {diagnosis.priorityTasks.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {diagnosis.priorityTasks.map((task, index) => (
                  <div
                    key={`${task.title}-${index}`}
                    className="rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-medium text-white">
                        {index + 1}
                      </span>
                      <h4 className="text-sm font-semibold text-slate-950">
                        {task.title}
                      </h4>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-600">
                      {task.reason}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-800">
                      {task.action}
                    </p>
                    {task.relatedCriteria.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        关联指标：{task.relatedCriteria.join("、")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                暂无优先修改任务。
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-950">
              12 项指标逐项诊断
            </h3>
            <div className="mt-4 grid gap-3">
              {diagnosis.criteriaResults.map((criterion) => (
                <div
                  key={`${criterion.category}-${criterion.criterionName}`}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {criterion.category} · 权重 {criterion.weight}
                      </p>
                      <h4 className="mt-1 text-sm font-semibold text-slate-950">
                        {criterion.criterionName}
                      </h4>
                    </div>
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${evidenceClass[criterion.evidenceStatus]}`}
                    >
                      {evidenceStatusLabel[criterion.evidenceStatus]}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-3">
                    <p>
                      <span className="font-medium text-slate-950">证据：</span>
                      {criterion.evidenceSummary}
                    </p>
                    <p>
                      <span className="font-medium text-slate-950">问题：</span>
                      {criterion.issueSummary}
                    </p>
                    <p>
                      <span className="font-medium text-slate-950">建议：</span>
                      {criterion.improvementAdvice}
                    </p>
                  </div>
                  {criterion.likelyJudgeQuestions.length > 0 ? (
                    <ul className="mt-3 space-y-1 text-sm leading-6 text-slate-600">
                      {criterion.likelyJudgeQuestions.map((question) => (
                        <li key={question}>· {question}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
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
    <div className={`rounded-xl border p-4 ${className}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm leading-6 opacity-90">
        {visibleItems.slice(0, 5).map((item) => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}
