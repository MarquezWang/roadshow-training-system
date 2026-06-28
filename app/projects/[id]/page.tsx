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
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

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
