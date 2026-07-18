import { AI_MODEL_FAST, AI_MODEL_STRONG } from "@/lib/ai-models";
import type { LibreOfficeCheckResult } from "@/lib/powerpoint-preview/types";
import type { SystemConfigurationStatus } from "./system-status-policy";
import { ConfigRow, Section } from "./system-status-ui";

export function SystemConfigSections({
  configuration,
  libreOffice,
}: {
  configuration: SystemConfigurationStatus;
  libreOffice: LibreOfficeCheckResult;
}) {
  return (
    <>
      <Section
        title="AI 模型与调用配置"
        description="用于项目识别、TRL 判断、评委问题、动态追问和报告生成等任务。"
      >
        <ConfigRow
          label="AI_PROVIDER"
          value={configuration.aiProvider}
          ok={configuration.aiProviderConfigured}
        />
        <ConfigRow
          label="AI_API_KEY"
          value={configuration.aiConfigured ? "已配置" : "未配置"}
          ok={configuration.aiConfigured}
          note="这里只显示是否配置，不显示密钥内容。"
        />
        <ConfigRow label="AI_MODEL_FAST" value={AI_MODEL_FAST} />
        <ConfigRow label="AI_MODEL_STRONG" value={AI_MODEL_STRONG} />
        <ConfigRow label="AI_TIMEOUT_MS" value={configuration.aiTimeout} />
      </Section>

      <Section
        title="语音转写配置"
        description="用于路演和答辩录音转文字。转写失败不会阻塞训练完成，但会影响报告质量。"
      >
        <ConfigRow
          label="TRANSCRIPTION_PROVIDER"
          value={configuration.transcriptionProvider}
        />
        <ConfigRow
          label="腾讯云密钥"
          value={
            configuration.tencentCredentialReady ? "已配置" : "未完整配置"
          }
          ok={
            !configuration.usesTencentCredential ||
            configuration.tencentCredentialReady
          }
          note="仅在 provider 使用 tencent 或 tencent_flash 时需要。"
        />
        <ConfigRow
          label="TENCENT_APP_ID"
          value={configuration.tencentAppId}
          ok={
            !configuration.usesTencentFlashAsr ||
            configuration.tencentAppIdConfigured
          }
          note="仅腾讯云录音文件识别极速版 tencent_flash 需要。"
        />
        <ConfigRow
          label="TENCENT_ASR_REGION"
          value={configuration.tencentAsrRegion}
          ok={
            !configuration.usesTencentStandardAsr ||
            configuration.tencentAsrRegionConfigured
          }
          note="仅普通腾讯云录音文件识别需要；tencent_flash 极速版不依赖该项。"
        />
        <ConfigRow
          label="TENCENT_ASR_ENGINE_MODEL_TYPE"
          value={configuration.tencentAsrEngineModelType}
          ok={
            !configuration.usesTencentStandardAsr ||
            configuration.tencentAsrEngineModelTypeConfigured
          }
          note="仅普通腾讯云录音文件识别需要；tencent_flash 极速版使用下方极速版配置。"
        />
        <ConfigRow
          label="极速版配置"
          value={
            configuration.usesTencentFlashAsr
              ? `已启用，engine=${configuration.tencentFlashEngineType}，format=${configuration.tencentFlashVoiceFormat}`
              : "未启用"
          }
        />
        <ConfigRow
          label="讯飞配置"
          value={
            configuration.xfyunCredentialReady ? "已配置" : "未完整配置"
          }
          ok={
            !configuration.usesXfyunProvider ||
            configuration.xfyunCredentialReady
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
          value={configuration.libreOfficePath}
        />
      </Section>
    </>
  );
}
