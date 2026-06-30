import { readdir } from "fs/promises";
import Link from "next/link";
import path from "path";
import { AI_MODEL_FAST, AI_MODEL_STRONG } from "@/lib/ai-models";
import { requireAdminUser } from "@/lib/auth-server";
import { readRecentDiagnosticEvents } from "@/lib/diagnostic-log";
import { checkLibreOfficeAvailability } from "@/lib/powerpoint-preview";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PROMPTS_DIR = path.resolve(process.cwd(), "prompts");
const PROMPT_TESTS_DIR = path.resolve(process.cwd(), "prompt-tests");
const MANAGEMENT_PROMPT_FILES = new Set([
  "README.md",
  "registry.md",
  "changelog.md",
]);

const adminModules = [
  {
    title: "用户管理",
    description: "创建内测账号、调整角色、重置密码。",
    href: "/admin/users",
    status: "已启用",
    accent: "teal",
  },
  {
    title: "Prompt 管理",
    description: "查看 Prompt 资产、模型档位、风险等级和测试样本。",
    href: "/admin/prompts",
    status: "已启用",
    accent: "cyan",
  },
  {
    title: "系统状态",
    description: "集中查看 AI、ASR、LibreOffice 和预览链路配置状态。",
    href: "/admin/system",
    status: "已启用",
    accent: "amber",
  },
  {
    title: "更新日志",
    description: "查看内部测试阶段的版本变更记录。",
    href: "/changelog",
    status: "已启用",
    accent: "slate",
  },
  {
    title: "项目列表",
    description: "返回项目管理与路演训练入口。",
    href: "/projects",
    status: "常用入口",
    accent: "slate",
  },
];

function hasValue(value: string | undefined) {
  return Boolean(value && value.trim());
}

async function countPromptFiles() {
  try {
    const entries = await readdir(PROMPTS_DIR, { withFileTypes: true });
    return entries.filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !MANAGEMENT_PROMPT_FILES.has(entry.name),
    ).length;
  } catch {
    return 0;
  }
}

async function countPromptTestSamples() {
  try {
    const suites = await readdir(PROMPT_TESTS_DIR, { withFileTypes: true });
    const counts = await Promise.all(
      suites
        .filter((suite) => suite.isDirectory())
        .map(async (suite) => {
          const files = await readdir(path.join(PROMPT_TESTS_DIR, suite.name));
          return files.filter((file) => file.endsWith(".json")).length;
        }),
    );

    return counts.reduce((sum, count) => sum + count, 0);
  } catch {
    return 0;
  }
}

function StatusPill({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-teal-200 bg-teal-50 text-teal-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function ModuleCard({
  title,
  description,
  href,
  status,
  accent,
}: {
  title: string;
  description: string;
  href: string;
  status: string;
  accent: string;
}) {
  const accentClass =
    accent === "teal"
      ? "bg-teal-500"
      : accent === "cyan"
        ? "bg-cyan-500"
        : accent === "amber"
          ? "bg-amber-500"
          : "bg-slate-400";

  return (
    <Link href={href} className="group block">
      <div className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition group-hover:border-slate-300 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${accentClass}`} />
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          </div>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
            {status}
          </span>
        </div>
        <p className="mt-3 flex-1 text-sm leading-6 text-slate-600">
          {description}
        </p>
        <p className="mt-5 text-sm font-medium text-slate-950">进入</p>
      </div>
    </Link>
  );
}

function HealthRow({
  label,
  value,
  ok,
  note,
}: {
  label: string;
  value: string;
  ok: boolean;
  note: string;
}) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-5 py-4 last:border-b-0 md:grid-cols-[160px_1fr_auto] md:items-center">
      <p className="text-sm text-slate-500">{label}</p>
      <div>
        <p className="font-mono text-sm text-slate-800">{value}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
      </div>
      <StatusPill ok={ok}>{ok ? "正常" : "需检查"}</StatusPill>
    </div>
  );
}

export default async function AdminHomePage() {
  await requireAdminUser();

  const [
    userCount,
    loginUserCount,
    projectCount,
    sessionCount,
    completedSessionCount,
    promptFileCount,
    promptTestSampleCount,
    libreOffice,
    diagnosticEvents,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: {
        passwordHash: {
          not: null,
        },
      },
    }),
    prisma.project.count(),
    prisma.trainingSession.count(),
    prisma.trainingSession.count({
      where: {
        status: {
          in: ["QA_COMPLETED", "REPORT_READY", "COMPLETED"],
        },
      },
    }),
    countPromptFiles(),
    countPromptTestSamples(),
    checkLibreOfficeAvailability(),
    readRecentDiagnosticEvents(5),
  ]);

  const aiConfigured = hasValue(process.env.AI_API_KEY);
  const transcriptionProvider = process.env.TRANSCRIPTION_PROVIDER || "xfyun";
  const tencentConfigured =
    hasValue(process.env.TENCENT_SECRET_ID) &&
    hasValue(process.env.TENCENT_SECRET_KEY);
  const xfyunConfigured =
    hasValue(process.env.XFYUN_APP_ID) && hasValue(process.env.XFYUN_SECRET_KEY);
  const asrConfigured =
    transcriptionProvider === "tencent" ||
    transcriptionProvider === "tencent_flash"
      ? tencentConfigured
      : xfyunConfigured;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员后台</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            后台管理
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            集中查看内部测试系统的账号、Prompt、关键依赖和版本记录。仅
            ADMIN 用户可访问。
          </p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          返回项目列表
        </Link>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <StatCard
          label="用户"
          value={userCount}
          note={`${loginUserCount} 个账号可登录`}
        />
        <StatCard label="项目" value={projectCount} note="当前数据库项目数" />
        <StatCard
          label="训练记录"
          value={sessionCount}
          note={`${completedSessionCount} 条已完成答辩或报告`}
        />
        <StatCard
          label="Prompt 资产"
          value={promptFileCount}
          note={`${promptTestSampleCount} 个回归测试样本`}
        />
      </section>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            关键链路状态
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            这里只展示是否具备基础运行条件，完整自检请进入系统状态页。
          </p>
        </div>
        <HealthRow
          label="AI 调用"
          value={`fast=${AI_MODEL_FAST} / strong=${AI_MODEL_STRONG}`}
          ok={aiConfigured}
          note={aiConfigured ? "AI Key 已配置。" : "AI Key 未配置。"}
        />
        <HealthRow
          label="语音转写"
          value={transcriptionProvider}
          ok={asrConfigured}
          note={
            asrConfigured
              ? "当前转写 provider 所需密钥已配置。"
              : "当前转写 provider 缺少必要密钥。"
          }
        />
        <HealthRow
          label="PPT/PPTX 预览"
          value={libreOffice.available ? libreOffice.command : "未找到"}
          ok={libreOffice.available}
          note={
            libreOffice.available
              ? "LibreOffice 可用，PPT/PPTX 可尝试转换为展示 PDF。"
              : "LibreOffice 不可用，PPT/PPTX 展示预览会降级。"
          }
        />
        <HealthRow
          label="最近诊断"
          value={`${diagnosticEvents.length} 条`}
          ok={true}
          note="最近 AI、ASR、PPT 预览和系统测试诊断事件。"
        />
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              管理入口
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              常用后台功能集中在这里，避免记忆单独路径。
            </p>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminModules.map((module) => (
            <ModuleCard key={module.title} {...module} />
          ))}
        </div>
      </section>
    </main>
  );
}
