import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCurrentAccessUserId,
  getCurrentAuthUser,
  withOwnerFilter,
} from "@/lib/auth-server";
import { parseStoredMaterialDiagnosis } from "@/lib/material-diagnosis";
import { prisma } from "@/lib/prisma";
import {
  getTrainingFlowPath,
  isTerminalTrainingStatus,
  trainingStatusLabel,
} from "@/lib/training-status";
import { MaterialDiagnosisPanel } from "./material-diagnosis-panel";

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
  { key: "applicationScenario", label: "应用场景", wide: true },
  { key: "coreTechnology", label: "技术关键词" },
  { key: "productForm", label: "产品形态" },
  { key: "cooperationDemand", label: "合作需求" },
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

function parseLatestMaterialDiagnosis(
  diagnosis: Parameters<typeof parseStoredMaterialDiagnosis>[0] | null,
) {
  if (!diagnosis) {
    return null;
  }

  try {
    return parseStoredMaterialDiagnosis(diagnosis);
  } catch {
    return null;
  }
}

function getCompactSummary(value: string | null, fallback: string) {
  if (!value?.trim()) {
    return fallback;
  }

  return value.length > 92 ? `${value.slice(0, 92)}...` : value;
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
        select: {
          id: true,
          status: true,
          pitchDurationSec: true,
          currentPageIndex: true,
          createdAt: true,
        },
      },
      materialDiagnoses: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          summary: true,
          readinessLevel: true,
          readinessScore: true,
          strengths: true,
          weaknesses: true,
          priorityTasks: true,
          judgeQuestions: true,
          criteriaResults: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const completedTrainingCount = project.trainingSessions.filter((session) =>
    ["QA_ENDED", "REPORT_READY", "FINISHED"].includes(session.status),
  ).length;
  const latestMaterialDiagnosis = parseLatestMaterialDiagnosis(
    project.materialDiagnoses[0] ?? null,
  );
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
  const latestSession = project.trainingSessions[0] ?? null;
  const activeSession =
    project.trainingSessions.find(
      (session) => !isTerminalTrainingStatus(session.status),
    ) ?? null;
  const nextTrainingSession = activeSession ?? latestSession;
  const nextTrainingHref = nextTrainingSession
    ? getTrainingFlowPath(nextTrainingSession.id, nextTrainingSession.status)
    : null;
  const projectSummary = getCompactSummary(
    project.summary,
    "暂无项目简介，建议先补充一句话说明，方便训练时快速进入语境。",
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-2">
              {project.field ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  {project.field}
                </span>
              ) : null}
              {project.stage ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
                  {project.stage}
                </span>
              ) : null}
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-normal text-slate-950">
              {project.name}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              {projectSummary}
            </p>
            <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-2">
              {projectFields.map((field) => (
                <div
                  key={field.key}
                  className={
                    "wide" in field && field.wide ? "sm:col-span-2" : ""
                  }
                >
                  <dt className="text-xs font-medium text-slate-500">
                    {field.label}
                  </dt>
                  <dd className="mt-1 line-clamp-2 text-sm leading-6 text-slate-900">
                    {project[field.key] || "暂无"}
                  </dd>
                </div>
              ))}
            </dl>
            {isAdmin && project.owner ? (
              <p className="mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              所属用户：{project.owner.name || project.owner.email}
              </p>
            ) : null}
          </div>

          <aside className="border-t border-slate-100 bg-slate-50/70 p-6 lg:border-l lg:border-t-0">
            <div>
              <h2 className="text-base font-semibold text-slate-950">下一步</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
              {activeSession
                ? "有一场训练还没完成，建议先继续当前流程。"
                : latestSession
                  ? "最近训练已结束，可以查看报告或重新开始一轮。"
                  : "还没有训练记录，可以直接创建第一次路演训练。"}
              </p>

              <div className="mt-5">
                {activeSession && nextTrainingHref ? (
                  <Link
                    href={nextTrainingHref}
                    className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                  >
                    继续当前训练
                  </Link>
                ) : latestSession && nextTrainingHref ? (
                  <div className="grid gap-2">
                    <form
                      action={`/projects/${project.id}/training-sessions?redirect=1`}
                      method="post"
                    >
                      <button
                        type="submit"
                        className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                      >
                        开始新训练
                      </button>
                    </form>
                    <Link
                      href={nextTrainingHref}
                      className="inline-flex h-10 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      查看最近报告
                    </Link>
                  </div>
                ) : (
                  <form
                    action={`/projects/${project.id}/training-sessions?redirect=1`}
                    method="post"
                  >
                    <button
                      type="submit"
                      className="inline-flex h-10 w-full items-center justify-center rounded-md bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                    >
                      开始路演训练
                    </button>
                  </form>
                )}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-200 pt-5">
              <StatTile
                label="训练次数"
                value={String(project.trainingSessions.length)}
              />
              <StatTile label="已完成" value={String(completedTrainingCount)} />
              <StatTile
                label="平均用时"
                value={
                  averagePitchDurationSec !== null
                    ? formatDurationSec(averagePitchDurationSec)
                    : "-"
                }
              />
            </div>
          </aside>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-6 py-4">
            <Link
              href="/projects"
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              返回项目列表
            </Link>
            <Link
              href={`/projects/${project.id}/edit`}
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              编辑项目
            </Link>
          </div>
      </section>

      <section
        id="records"
        className="mt-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">训练记录</h2>
            <p className="text-sm text-slate-600">
              全部模拟路演训练记录，按时间倒序展示。
            </p>
          </div>
          <span className="text-sm font-medium text-slate-500">
            共 {project.trainingSessions.length} 次
          </span>
        </div>

        {project.trainingSessions.length > 0 ? (
          <div className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {project.trainingSessions.map((session) => (
              <article
                key={session.id}
                className="grid gap-4 p-4 transition-colors hover:bg-slate-50 lg:grid-cols-[minmax(0,1fr)_220px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(session.status)}`}
                    >
                      {trainingStatusLabel[session.status] ?? session.status}
                    </span>
                    <time className="text-sm font-medium text-slate-900">
                        {formatDateTime(session.createdAt)}
                    </time>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <p>
                      <span className="text-slate-400">路演用时</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {formatDurationSec(session.pitchDurationSec)}
                      </span>
                    </p>
                    <p>
                      <span className="text-slate-400">当前页码</span>
                      <span className="ml-2 font-medium text-slate-900">
                        第 {Math.max(1, session.currentPageIndex)} 页
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 lg:justify-end">
                  <Link
                    href={`/training/${session.id}`}
                    className="inline-flex h-9 items-center justify-center rounded-md bg-teal-700 px-3 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                  >
                    查看训练
                  </Link>
                  <Link
                    href={`/training/${session.id}/replay`}
                    className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    路演回放
                  </Link>
                </div>
              </article>
            ))}
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

      <MaterialDiagnosisPanel
        projectId={project.id}
        initialDiagnosis={latestMaterialDiagnosis}
      />
    </main>
  );
}

function StatTile({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}
