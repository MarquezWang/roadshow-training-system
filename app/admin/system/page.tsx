import { access, mkdir, rm, writeFile } from "fs/promises";
import { execFile } from "child_process";
import Link from "next/link";
import path from "path";
import type { ReactNode } from "react";
import { promisify } from "util";
import { AI_MODEL_FAST, AI_MODEL_STRONG } from "@/lib/ai-models";
import { requireAdminUser } from "@/lib/auth-server";
import { readRecentDiagnosticEvents } from "@/lib/diagnostic-log";
import { checkLibreOfficeAvailability } from "@/lib/powerpoint-preview";
import { prisma } from "@/lib/prisma";
import { getTranscriptionProvider } from "@/lib/transcription";
import { SystemTestPanel } from "./system-test-panel";
import { UploadMaintenancePanel } from "./upload-maintenance-panel";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

function displayValue(value: string | undefined, fallback = "未配置"): string {
  return value?.trim() ? value : fallback;
}

function StatusBadge({
  ok,
  label,
}: {
  ok: boolean;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
        ok
          ? "border-teal-200 bg-teal-50 text-teal-700"
          : "border-amber-200 bg-amber-50 text-amber-700"
      }`}
    >
      {label ?? (ok ? "正常" : "需配置")}
    </span>
  );
}

function ConfigRow({
  label,
  value,
  ok = true,
  note,
}: {
  label: string;
  value: string;
  ok?: boolean;
  note?: string;
}) {
  return (
    <div className="grid gap-y-2 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)_auto] md:items-start md:gap-x-6">
      <div className="min-w-0 break-all text-sm font-medium text-slate-600">
        {label}
      </div>
      <div className="min-w-0 break-all font-mono text-sm leading-6 text-slate-950">
        {value}
      </div>
      <div className="md:text-right">
        <StatusBadge ok={ok} />
      </div>
      {note ? (
        <p className="min-w-0 text-sm leading-6 text-slate-500 md:col-start-2 md:col-end-4">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-4">
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
      <div className="pt-2">{children}</div>
    </section>
  );
}

function RiskPill({
  level,
}: {
  level: "正常" | "注意" | "风险";
}) {
  const className =
    level === "正常"
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : level === "注意"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {level}
    </span>
  );
}

function RiskRow({
  title,
  detail,
  level,
}: {
  title: string;
  detail: string;
  level: "正常" | "注意" | "风险";
}) {
  return (
    <div className="grid gap-2 border-b border-slate-100 py-3 last:border-b-0 md:grid-cols-[160px_minmax(0,1fr)_auto] md:items-start md:gap-x-4">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      <p className="text-sm leading-6 text-slate-600">{detail}</p>
      <div className="md:text-right">
        <RiskPill level={level} />
      </div>
    </div>
  );
}

function CommandList({ commands }: { commands: string[] }) {
  return (
    <div className="grid gap-2">
      {commands.map((command) => (
        <code
          key={command}
          className="block overflow-x-auto rounded-md border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
        >
          {command}
        </code>
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
        <span>
          <span className="block text-base font-semibold text-slate-950">
            {title}
          </span>
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {description}
          </span>
        </span>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 transition group-open:bg-slate-50">
          <span className="group-open:hidden">展开</span>
          <span className="hidden group-open:inline">收起</span>
        </span>
      </summary>
      <div className="mt-4 border-t border-slate-100 pt-2">{children}</div>
    </details>
  );
}

async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, value: "可连接" };
  } catch (error) {
    return {
      ok: false,
      value: "连接失败",
      note: error instanceof Error ? error.message : "未知错误",
    };
  }
}

async function checkUploadDirectory() {
  const uploadsDir = path.join(process.cwd(), "uploads");
  const testFile = path.join(uploadsDir, `.write-test-${Date.now()}.tmp`);

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(testFile, "ok");
    await access(testFile);
    await rm(testFile, { force: true });

    return { ok: true, value: "可写" };
  } catch (error) {
    await rm(testFile, { force: true }).catch(() => undefined);

    return {
      ok: false,
      value: "不可写",
      note: error instanceof Error ? error.message : "未知错误",
    };
  }
}

async function readGitValue(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: 1500,
    });

    return stdout.trim() || "未知";
  } catch {
    return "不可用";
  }
}

async function readRuntimeVersion() {
  const [branch, commit] = await Promise.all([
    readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    readGitValue(["rev-parse", "--short", "HEAD"]),
  ]);

  return { branch, commit };
}

export default async function AdminSystemPage() {
  await requireAdminUser();

  const [
    libreOffice,
    databaseCheck,
    uploadDirectoryCheck,
    diagnosticEvents,
    runtimeVersion,
  ] = await Promise.all([
    checkLibreOfficeAvailability(),
    checkDatabaseConnection(),
    checkUploadDirectory(),
    readRecentDiagnosticEvents(12),
    readRuntimeVersion(),
  ]);
  const transcriptionProvider = getTranscriptionProvider();
  const authEnabled = process.env.AUTH_ENABLED === "true";
  const usesTencentCredential = transcriptionProvider.startsWith("tencent");
  const usesTencentStandardAsr = transcriptionProvider === "tencent";
  const usesTencentFlashAsr = transcriptionProvider === "tencent_flash";
  const usesXfyunProvider = transcriptionProvider === "xfyun";
  const aiConfigured = hasValue(process.env.AI_API_KEY);
  const tencentCredentialReady =
    hasValue(process.env.TENCENT_SECRET_ID) &&
    hasValue(process.env.TENCENT_SECRET_KEY);
  const tencentFlashReady =
    !usesTencentFlashAsr ||
    (tencentCredentialReady && hasValue(process.env.TENCENT_APP_ID));
  const asrCredentialReady = usesTencentCredential
    ? tencentCredentialReady &&
      (!usesTencentFlashAsr || hasValue(process.env.TENCENT_APP_ID))
    : usesXfyunProvider
      ? hasValue(process.env.XFYUN_APP_ID) &&
        hasValue(process.env.XFYUN_SECRET_KEY)
      : hasValue(process.env.TRANSCRIPTION_API_KEY);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">管理员工具</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            系统状态
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            只读查看关键外部依赖与环境配置，不展示密钥明文。
          </p>
        </div>
        <Link
          href="/admin"
          className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          返回
        </Link>
      </div>

      <div className="mt-6 grid gap-6">
        <SystemTestPanel />
        <UploadMaintenancePanel />

        <Section
          title="运行版本与上线风险"
          description="用于快速确认当前运行代码、关键开关和部署前后最容易出问题的点。"
        >
          <div className="grid gap-3 border-b border-slate-100 py-3 md:grid-cols-4">
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">当前分支</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-950">
                {runtimeVersion.branch}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">当前 Commit</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-950">
                {runtimeVersion.commit}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">登录开关</p>
              <p className="mt-2 font-mono text-sm font-semibold text-slate-950">
                AUTH_ENABLED={authEnabled ? "true" : "false"}
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs text-slate-500">转写 Provider</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-950">
                {transcriptionProvider}
              </p>
            </div>
          </div>

          <RiskRow
            title="登录保护"
            level={authEnabled ? "正常" : "风险"}
            detail={
              authEnabled
                ? "已启用登录保护，项目、训练和后台接口会按用户身份校验。"
                : "当前未启用登录保护，仅适合本地开发；生产环境应设置 AUTH_ENABLED=true。"
            }
          />
          <RiskRow
            title="AI 调用"
            level={aiConfigured ? "正常" : "风险"}
            detail={
              aiConfigured
                ? `AI Key 已配置，fast=${AI_MODEL_FAST}，strong=${AI_MODEL_STRONG}。`
                : "AI Key 未配置，项目识别、问题生成、动态追问和报告生成会失败。"
            }
          />
          <RiskRow
            title="ASR 转写"
            level={asrCredentialReady ? "正常" : "风险"}
            detail={
              asrCredentialReady
                ? "当前转写 provider 所需密钥已配置。"
                : "当前转写 provider 缺少必要密钥；录音可保存，但转写与报告质量会受影响。"
            }
          />
          <RiskRow
            title="极速版 ASR"
            level={tencentFlashReady ? "正常" : "注意"}
            detail={
              usesTencentFlashAsr
                ? hasValue(process.env.TENCENT_APP_ID)
                  ? "已启用腾讯云极速版，并配置 TENCENT_APP_ID。"
                  : "已启用腾讯云极速版，但缺少 TENCENT_APP_ID；极速版调用可能失败。"
                : "当前未使用腾讯云极速版；如后续切换为 tencent_flash，需要同时配置 TENCENT_APP_ID。"
            }
          />
          <RiskRow
            title="PPT 预览"
            level={libreOffice.available ? "正常" : "注意"}
            detail={
              libreOffice.available
                ? `LibreOffice 可用，命令：${libreOffice.command}。`
                : "LibreOffice 不可用时，PDF 预览不受影响，但 PPT/PPTX 不会生成展示 PDF。"
            }
          />
        </Section>

        <Section
          title="AI 模型与调用配置"
          description="用于项目识别、TRL 判断、评委问题、动态追问和报告生成等任务。"
        >
          <ConfigRow
            label="AI_PROVIDER"
            value={displayValue(process.env.AI_PROVIDER)}
            ok={hasValue(process.env.AI_PROVIDER)}
          />
          <ConfigRow
            label="AI_API_KEY"
            value={hasValue(process.env.AI_API_KEY) ? "已配置" : "未配置"}
            ok={hasValue(process.env.AI_API_KEY)}
            note="这里只显示是否配置，不显示密钥内容。"
          />
          <ConfigRow label="AI_MODEL_FAST" value={AI_MODEL_FAST} />
          <ConfigRow label="AI_MODEL_STRONG" value={AI_MODEL_STRONG} />
          <ConfigRow
            label="AI_TIMEOUT_MS"
            value={displayValue(process.env.AI_TIMEOUT_MS, "默认值")}
          />
        </Section>

        <Section
          title="语音转写配置"
          description="用于路演和答辩录音转文字。转写失败不会阻塞训练完成，但会影响报告质量。"
        >
          <ConfigRow
            label="TRANSCRIPTION_PROVIDER"
            value={transcriptionProvider}
            ok={hasValue(transcriptionProvider)}
          />
          <ConfigRow
            label="腾讯云密钥"
            value={
              tencentCredentialReady ? "已配置" : "未完整配置"
            }
            ok={
              !usesTencentCredential || tencentCredentialReady
            }
            note="仅在 provider 使用 tencent 或 tencent_flash 时需要。"
          />
          <ConfigRow
            label="TENCENT_APP_ID"
            value={displayValue(process.env.TENCENT_APP_ID)}
            ok={!usesTencentFlashAsr || hasValue(process.env.TENCENT_APP_ID)}
            note="仅腾讯云录音文件识别极速版 tencent_flash 需要。"
          />
          <ConfigRow
            label="TENCENT_ASR_REGION"
            value={displayValue(process.env.TENCENT_ASR_REGION)}
            ok={
              !usesTencentStandardAsr ||
              hasValue(process.env.TENCENT_ASR_REGION)
            }
            note="仅普通腾讯云录音文件识别需要；tencent_flash 极速版不依赖该项。"
          />
          <ConfigRow
            label="TENCENT_ASR_ENGINE_MODEL_TYPE"
            value={displayValue(process.env.TENCENT_ASR_ENGINE_MODEL_TYPE)}
            ok={
              !usesTencentStandardAsr ||
              hasValue(process.env.TENCENT_ASR_ENGINE_MODEL_TYPE)
            }
            note="仅普通腾讯云录音文件识别需要；tencent_flash 极速版使用下方极速版配置。"
          />
          <ConfigRow
            label="极速版配置"
            value={
              usesTencentFlashAsr
                ? `已启用，engine=${displayValue(
                    process.env.TENCENT_ASR_FLASH_ENGINE_TYPE,
                    "默认",
                  )}，format=${displayValue(
                    process.env.TENCENT_ASR_FLASH_VOICE_FORMAT,
                    "默认",
                  )}`
                : "未启用"
            }
            ok={true}
          />
          <ConfigRow
            label="讯飞配置"
            value={
              hasValue(process.env.XFYUN_APP_ID) &&
              hasValue(process.env.XFYUN_SECRET_KEY)
                ? "已配置"
                : "未完整配置"
            }
            ok={
              !usesXfyunProvider ||
              (hasValue(process.env.XFYUN_APP_ID) &&
                hasValue(process.env.XFYUN_SECRET_KEY))
            }
            note="仅在 provider 使用 xfyun 时需要。"
          />
        </Section>

        <Section
          title="PPT / PPTX 展示预览"
          description="用于把 PPT/PPTX 转换成展示 PDF，供训练准备、路演、答辩和回放页面预览。"
        >
          <ConfigRow
            label="LibreOffice"
            value={libreOffice.available ? "可用" : "不可用"}
            ok={libreOffice.available}
            note={
              libreOffice.available
                ? "PPT/PPTX 可尝试转换为展示 PDF。"
                : "LibreOffice 不可用时，上传和 AI 解析仍可继续，只是 PPT/PPTX 展示预览不可用。"
            }
          />
          <ConfigRow
            label="使用命令"
            value={libreOffice.available ? libreOffice.command : "未找到"}
            ok={libreOffice.available}
          />
          <ConfigRow
            label="版本 / 原因"
            value={
              libreOffice.available ? libreOffice.version : libreOffice.reason
            }
            ok={libreOffice.available}
          />
          <ConfigRow
            label="LIBREOFFICE_PATH"
            value={displayValue(process.env.LIBREOFFICE_PATH)}
            ok={true}
          />
        </Section>

        <CollapsibleSection
          title="运维提示"
          description="这里展示的是配置状态，不替代真实业务链路测试。"
        >
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>AI Key 未配置时，项目识别、问题生成和报告生成会失败。</li>
            <li>ASR Key 未配置时，录音仍可保存，但转写和报告质量会受影响。</li>
            <li>
              LibreOffice 未配置时，PDF 预览不受影响；PPT/PPTX 只是不生成展示 PDF。
            </li>
            <li>
              如修改服务器环境变量，需要重启应用并确认 PM2 使用了最新环境。
            </li>
          </ul>
        </CollapsibleSection>

        <CollapsibleSection
          title="常用运维命令"
          description="用于服务器部署、诊断和回滚前检查。只展示命令，不会自动执行。"
        >
          <CommandList
            commands={[
              "git status -sb",
              "git pull --ff-only origin internal-test",
              "npm run lint && npm run build",
              "pm2 status",
              "pm2 restart roadshow-training-system --update-env",
              "pm2 logs roadshow-training-system --lines 120 --nostream",
              "sudo nginx -t && sudo systemctl reload nginx",
              "libreoffice --version || soffice --version",
            ]}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="基础运行检查"
          description="不调用大模型、不转写音频，只检查基础依赖是否可用。"
        >
          <ConfigRow
            label="数据库连接"
            value={databaseCheck.value}
            ok={databaseCheck.ok}
            note={databaseCheck.ok ? undefined : databaseCheck.note}
          />
          <ConfigRow
            label="上传目录"
            value={uploadDirectoryCheck.value}
            ok={uploadDirectoryCheck.ok}
            note={uploadDirectoryCheck.ok ? undefined : uploadDirectoryCheck.note}
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="最近诊断事件"
          description="记录 AI、ASR、PPT 预览和系统测试中的最近异常或测试结果。"
        >
          {diagnosticEvents.length > 0 ? (
            <div className="grid gap-3">
              {diagnosticEvents.map((event, index) => (
                <div
                  key={`${event.ts}-${index}`}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                        {event.type}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(event.ts).toLocaleString("zh-CN")}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                    {event.message}
                  </p>
                  {event.meta ? (
                    <pre className="mt-2 overflow-x-auto rounded-md border border-slate-100 bg-white px-3 py-2 text-xs leading-5 text-slate-500">
                      {JSON.stringify(event.meta, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              暂无诊断事件。
            </p>
          )}
        </CollapsibleSection>
      </div>
    </main>
  );
}
