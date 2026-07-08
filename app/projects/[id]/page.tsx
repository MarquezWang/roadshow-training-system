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
import { TrainingRecordsPanel } from "./training-records-panel";

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
  const projectSummary =
    project.summary?.trim() ||
    "暂无项目简介，建议先补充一句话说明，方便训练时快速进入语境。";
  const trainingRecordItems = project.trainingSessions.map((session) => ({
    id: session.id,
    statusLabel: trainingStatusLabel[session.status] ?? session.status,
    statusClassName: getStatusBadgeClass(session.status),
    createdAtText: formatDateTime(session.createdAt),
    durationText: formatDurationSec(session.pitchDurationSec),
    pageText: `第 ${Math.max(1, session.currentPageIndex)} 页`,
    trainingHref: `/training/${session.id}`,
    replayHref: `/training/${session.id}/replay`,
    deleteUrl: `/projects/${project.id}/training-sessions/${session.id}`,
  }));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="p-6 lg:p-7">
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
            <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-slate-100 pt-5 sm:grid-cols-2">
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
                  <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-900">
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

          <aside className="flex border-t border-slate-100 p-6 lg:border-l lg:border-t-0">
            <div className="my-auto w-full">
              <div className="border-b border-slate-100 pb-5">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                  下一步
                </p>
                <h2 className="mt-2 text-base font-semibold text-slate-950">
                  {activeSession
                    ? "继续未完成训练"
                    : latestSession
                      ? "开始新一轮训练"
                      : "创建第一次训练"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {activeSession
                    ? "有一场训练还没完成，先回到当前流程更稳。"
                    : latestSession
                      ? "最近训练已结束，可以复盘报告，也可以直接再跑一轮。"
                      : "还没有训练记录，可以先创建一次模拟路演。"}
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

              <div className="mt-5 grid grid-cols-3 gap-2">
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

      <TrainingRecordsPanel records={trainingRecordItems} />

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
