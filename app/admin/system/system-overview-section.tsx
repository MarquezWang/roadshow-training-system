import { AI_MODEL_FAST, AI_MODEL_STRONG } from "@/lib/ai-models";
import type { LibreOfficeCheckResult } from "@/lib/powerpoint-preview/types";
import type { RuntimeVersion } from "./system-status-data";
import type { SystemConfigurationStatus } from "./system-status-policy";
import { RiskRow, Section } from "./system-status-ui";

export function SystemOverviewSection({
  configuration,
  libreOffice,
  runtimeVersion,
}: {
  configuration: SystemConfigurationStatus;
  libreOffice: LibreOfficeCheckResult;
  runtimeVersion: RuntimeVersion;
}) {
  return (
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
            AUTH_ENABLED={configuration.authEnabled ? "true" : "false"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-500">后台任务模式</p>
          <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-950">
            {configuration.backgroundTaskMode}
          </p>
        </div>
      </div>

      <RiskRow
        title="登录保护"
        level={configuration.authEnabled ? "正常" : "风险"}
        detail={
          configuration.authEnabled
            ? "已启用登录保护，项目、训练和后台接口会按用户身份校验。"
            : "当前未启用登录保护，仅适合本地开发；生产环境应设置 AUTH_ENABLED=true。"
        }
      />
      <RiskRow
        title="AI 调用"
        level={configuration.aiConfigured ? "正常" : "风险"}
        detail={
          configuration.aiConfigured
            ? `AI Key 已配置，fast=${AI_MODEL_FAST}，strong=${AI_MODEL_STRONG}。`
            : "AI Key 未配置，项目识别、问题生成、动态追问和报告生成会失败。"
        }
      />
      <RiskRow
        title="后台任务"
        level={
          configuration.backgroundTaskMode === "external" ? "正常" : "注意"
        }
        detail={
          configuration.backgroundTaskMode === "external"
            ? "报告生成、转写恢复与上传维护由独立 Worker 执行，Web 进程只负责入队。"
            : "后台任务仍嵌入 Web 进程，仅适合单实例固定服务器。"
        }
      />
      <RiskRow
        title="ASR 转写"
        level={configuration.asrCredentialReady ? "正常" : "风险"}
        detail={
          configuration.asrCredentialReady
            ? "当前转写 provider 所需密钥已配置。"
            : "当前转写 provider 缺少必要密钥；录音可保存，但转写与报告质量会受影响。"
        }
      />
      <RiskRow
        title="极速版 ASR"
        level={configuration.tencentFlashReady ? "正常" : "注意"}
        detail={
          configuration.usesTencentFlashAsr
            ? configuration.tencentAppIdConfigured
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
  );
}
