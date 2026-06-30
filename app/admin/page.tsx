import Link from "next/link";
import { requireAdminUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const adminModules = [
  {
    title: "用户管理",
    description: "创建内测账号、调整角色、重置密码。",
    href: "/admin/users",
    status: "已启用",
  },
  {
    title: "Prompt 管理",
    description: "查看 Prompt 资产、模型档位、风险等级和测试样本。",
    href: "/admin/prompts",
    status: "已启用",
  },
  {
    title: "更新日志",
    description: "查看内部测试阶段的版本变更记录。",
    href: "/changelog",
    status: "已启用",
  },
  {
    title: "系统状态",
    description: "后续集中展示 AI、ASR、LibreOffice 和预览链路状态。",
    href: null,
    status: "规划中",
  },
  {
    title: "内部测试清单",
    description: "后续把关键路径验收清单做成页面。",
    href: null,
    status: "规划中",
  },
  {
    title: "训练数据概览",
    description: "后续统计训练次数、报告成功率、ASR 成功率等运营指标。",
    href: null,
    status: "规划中",
  },
];

function ModuleCard({
  title,
  description,
  href,
  status,
}: {
  title: string;
  description: string;
  href: string | null;
  status: string;
}) {
  const content = (
    <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
            status === "已启用"
              ? "border-teal-200 bg-teal-50 text-teal-700"
              : "border-slate-200 bg-slate-50 text-slate-500"
          }`}
        >
          {status}
        </span>
      </div>
      <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
        {description}
      </p>
      <p className="mt-5 text-sm font-medium text-slate-950">
        {href ? "进入管理" : "暂未开放"}
      </p>
    </div>
  );

  if (!href) {
    return <div className="opacity-80">{content}</div>;
  }

  return (
    <Link href={href} className="block">
      {content}
    </Link>
  );
}

export default async function AdminHomePage() {
  await requireAdminUser();

  const [userCount, projectCount, sessionCount] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.trainingSession.count(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员后台</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            后台管理
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            仅 ADMIN 用户可访问。这里集中放置用户、Prompt、版本和后续系统状态相关管理入口。
          </p>
        </div>
        <Link
          href="/projects"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          返回项目列表
        </Link>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">用户数</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {userCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">项目数</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {projectCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">训练记录</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">
            {sessionCount}
          </p>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {adminModules.map((module) => (
          <ModuleCard key={module.title} {...module} />
        ))}
      </section>
    </main>
  );
}

