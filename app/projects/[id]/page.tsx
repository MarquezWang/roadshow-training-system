import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCurrentAccessUserId,
  getCurrentAuthUser,
  withOwnerFilter,
} from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { trainingStatusLabel } from "@/lib/training-status";

type ProjectDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

function formatDurationSec(durationSec: number | null) {
  if (durationSec === null) {
    return "未记录";
  }

  const minutes = Math.floor(durationSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (durationSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

const projectFields = [
  { key: "summary", label: "一句话简介", wide: true },
  { key: "field", label: "所属领域" },
  { key: "applicationScenario", label: "应用场景", wide: true },
  { key: "coreTechnology", label: "技术关键词" },
  { key: "productForm", label: "产品形态" },
  { key: "stage", label: "TRL 成熟度" },
  { key: "cooperationDemand", label: "合作需求" },
  { key: "cooperationDemandDetail", label: "合作需求补充说明", wide: true },
] as const;

const statusBadgeClass: Record<string, string> = {
  CREATED: "border-slate-200 bg-slate-50 text-slate-700",
  PITCH_READY: "border-sky-200 bg-sky-50 text-sky-800",
  PITCHING: "border-amber-200 bg-amber-50 text-amber-800",
  PITCH_ENDED: "border-indigo-200 bg-indigo-50 text-indigo-800",
  QA_READY: "border-sky-200 bg-sky-50 text-sky-800",
  QAING: "border-amber-200 bg-amber-50 text-amber-800",
  QA_ENDED: "border-teal-200 bg-teal-50 text-teal-800",
  REPORT_READY: "border-teal-200 bg-teal-50 text-teal-800",
  FINISHED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ABORTED: "border-rose-200 bg-rose-50 text-rose-800",
};

function getStatusBadgeClass(status: string) {
  return statusBadgeClass[status] ?? "border-slate-200 bg-slate-50 text-slate-700";
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function formatScoreDelta(delta: number | null) {
  if (delta === null) {
    return "暂无对比";
  }

  if (delta > 0) {
    return `较上次 +${delta}`;
  }

  if (delta < 0) {
    return `较上次 ${delta}`;
  }

  return "较上次持平";
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const currentUser = await getCurrentAuthUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const userId = await getCurrentAccessUserId();
  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id }, userId),
    include: {
      owner: isAdmin
        ? {
            select: {
              name: true,
              email: true,
            },
          }
        : false,
      trainingSessions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        select: {
          id: true,
          status: true,
          pitchDurationSec: true,
          currentPageIndex: true,
          createdAt: true,
          analyses: {
            where: {
              status: "SUCCESS",
              analysisType: "PITCH",
              overallScore: {
                not: null,
              },
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              overallScore: true,
              summary: true,
              strengthsJson: true,
              weaknessesJson: true,
              suggestionsJson: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const recentAnalyses = project.trainingSessions
    .flatMap((session) =>
      session.analyses.map((analysis) => ({
        sessionId: session.id,
        sessionCreatedAt: session.createdAt,
        score: analysis.overallScore ?? 0,
        summary: analysis.summary,
        strengths: parseJsonArray(analysis.strengthsJson),
        weaknesses: parseJsonArray(analysis.weaknessesJson),
        suggestions: parseJsonArray(analysis.suggestionsJson),
      })),
    )
    .sort(
      (first, second) =>
        first.sessionCreatedAt.getTime() - second.sessionCreatedAt.getTime(),
    );
  const latestAnalysis = recentAnalyses.at(-1) ?? null;
  const previousAnalysis =
    recentAnalyses.length >= 2 ? recentAnalyses.at(-2) ?? null : null;
  const scoreDelta =
    latestAnalysis && previousAnalysis
      ? latestAnalysis.score - previousAnalysis.score
      : null;
  const completedTrainingCount = project.trainingSessions.filter((session) =>
    ["QA_ENDED", "REPORT_READY", "FINISHED"].includes(session.status),
  ).length;
  const abortedTrainingCount = project.trainingSessions.filter(
    (session) => session.status === "ABORTED",
  ).length;
  const sessionsWithDuration = project.trainingSessions.filter(
    (session) => session.pitchDurationSec !== null,
  );
  const averagePitchDurationSec =
    sessionsWithDuration.length > 0
      ? Math.round(
          sessionsWithDuration.reduce(
            (total, session) => total + (session.pitchDurationSec ?? 0),
            0,
          ) / sessionsWithDuration.length,
        )
      : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
            {project.name}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            查看项目基础信息和最近几次路演训练记录。
          </p>
          {isAdmin && project.owner ? (
            <p className="mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              ?????{project.owner.name || project.owner.email}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href="/projects"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            返回项目列表
          </Link>
          <Link
            href={`/projects/${project.id}/edit`}
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            编辑项目
          </Link>
          <form
            action={`/projects/${project.id}/training-sessions?redirect=1`}
            method="post"
          >
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
            >
              开始路演训练
            </button>
          </form>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-950">
            训练进步趋势
          </h2>
          <p className="text-sm text-slate-600">
            基于最近 5 次已完成的路演分析，快速判断训练是否在进步。
          </p>
        </div>

        {latestAnalysis ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
              <p className="text-sm font-medium text-slate-500">最近一次评分</p>
              <div className="mt-3 flex items-end gap-3">
                <span className="text-4xl font-semibold text-slate-950">
                  {latestAnalysis.score}
                </span>
                <span className="pb-1 text-sm text-slate-500">/ 100</span>
              </div>
              <p
                className={`mt-3 text-sm font-medium ${
                  scoreDelta !== null && scoreDelta > 0
                    ? "text-emerald-700"
                    : scoreDelta !== null && scoreDelta < 0
                      ? "text-rose-700"
                      : "text-slate-600"
                }`}
              >
                {formatScoreDelta(scoreDelta)}
              </p>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                {latestAnalysis.summary}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-slate-700">
                  最近得分走势
                </p>
              </div>
              <div className="mt-5 flex h-32 items-end gap-3">
                {recentAnalyses.map((analysis, index) => (
                  <div
                    key={analysis.sessionId}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div className="flex h-24 w-full items-end rounded-md bg-slate-100">
                      <div
                        className="w-full rounded-md bg-teal-500"
                        style={{
                          height: `${Math.max(8, analysis.score)}%`,
                        }}
                      />
                    </div>
                    <div className="text-center text-xs text-slate-500">
                      <div>{analysis.score}</div>
                      <div>第 {index + 1} 次</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:col-span-2 lg:grid-cols-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                <h3 className="text-sm font-semibold text-emerald-900">
                  保持优势
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-emerald-900/80">
                  {(latestAnalysis.strengths.length > 0
                    ? latestAnalysis.strengths
                    : ["暂无明确优势记录"]
                  )
                    .slice(0, 3)
                    .map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                </ul>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
                <h3 className="text-sm font-semibold text-amber-900">
                  当前短板
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900/80">
                  {(latestAnalysis.weaknesses.length > 0
                    ? latestAnalysis.weaknesses
                    : ["暂无明确短板记录"]
                  )
                    .slice(0, 3)
                    .map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                </ul>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-4">
                <h3 className="text-sm font-semibold text-sky-900">
                  下一轮建议
                </h3>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-sky-900/80">
                  {(latestAnalysis.suggestions.length > 0
                    ? latestAnalysis.suggestions
                    : ["完成一次训练报告后，系统会给出下一轮建议"]
                  )
                    .slice(0, 3)
                    .map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6">
            {project.trainingSessions.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    已有训练记录，尚未生成评分趋势
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    当前项目已有训练记录，但还没有可用于统计的评分分析。训练报告生成后，这里会自动汇总最近评分趋势、优势、短板和下一轮建议。
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium text-slate-500">
                      最近训练数
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {project.trainingSessions.length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium text-slate-500">
                      已完成答辩
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-teal-700">
                      {completedTrainingCount}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <p className="text-xs font-medium text-slate-500">
                      平均路演用时
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {averagePitchDurationSec !== null
                        ? formatDurationSec(averagePitchDurationSec)
                        : "-"}
                    </p>
                  </div>
                  {abortedTrainingCount > 0 ? (
                    <div className="rounded-lg border border-rose-100 bg-rose-50 p-4 sm:col-span-3">
                      <p className="text-sm text-rose-700">
                        最近记录中有 {abortedTrainingCount} 次训练中止，不会计入评分趋势。
                      </p>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <h3 className="text-sm font-semibold text-slate-950">
                  暂无可分析的训练趋势
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  完成一次路演训练并生成分析后，这里会展示最近评分、变化趋势和下一轮训练建议。
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-950">训练记录</h2>
          <p className="text-sm text-slate-600">
            最近 5 次模拟路演训练，支持继续查看训练过程和报告。
          </p>
        </div>

        {project.trainingSessions.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="border-b border-slate-200 px-4 py-3 font-medium">
                      训练时间
                    </th>
                    <th className="border-b border-slate-200 px-4 py-3 font-medium">
                      状态
                    </th>
                    <th className="border-b border-slate-200 px-4 py-3 font-medium">
                      路演用时
                    </th>
                    <th className="border-b border-slate-200 px-4 py-3 font-medium">
                      当前页码
                    </th>
                    <th className="border-b border-slate-200 px-4 py-3 font-medium">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {project.trainingSessions.map((session) => (
                    <tr
                      key={session.id}
                      className="align-middle transition-colors hover:bg-slate-50"
                    >
                      <td className="border-b border-slate-100 px-4 py-3.5 text-slate-700">
                        {formatDateTime(session.createdAt)}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(session.status)}`}
                        >
                          {trainingStatusLabel[session.status] ?? session.status}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3.5 text-slate-700">
                        {formatDurationSec(session.pitchDurationSec)}
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3.5 text-slate-700">
                        第 {Math.max(1, session.currentPageIndex)} 页
                      </td>
                      <td className="border-b border-slate-100 px-4 py-3.5">
                        <Link
                          href={`/training/${session.id}`}
                          className="text-sm font-medium text-teal-700 hover:text-teal-900"
                        >
                          查看训练
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              还没有训练记录
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              点击上方“开始路演训练”创建第一次模拟路演。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <h2 className="text-base font-semibold text-slate-950">项目基础信息</h2>
          <p className="mt-1 text-sm text-slate-600">
            项目训练会参考这些基础档案信息。
          </p>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {projectFields.map((field) => (
            <div
              key={field.key}
              className={`rounded-lg border border-slate-200 bg-slate-50/60 p-4 ${
                "wide" in field && field.wide ? "sm:col-span-2" : ""
              }`}
            >
              <dt className="text-xs font-medium text-slate-500">
                {field.label}
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">
                {project[field.key] || "暂无"}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
