import type { TranscriptionProvider } from "@/lib/transcription";

type SystemEnvironment = Readonly<Record<string, string | undefined>>;

export type SystemConfigurationStatus = {
  authEnabled: boolean;
  aiConfigured: boolean;
  aiProvider: string;
  aiProviderConfigured: boolean;
  aiTimeout: string;
  transcriptionProvider: TranscriptionProvider;
  usesTencentCredential: boolean;
  usesTencentStandardAsr: boolean;
  usesTencentFlashAsr: boolean;
  usesXfyunProvider: boolean;
  tencentCredentialReady: boolean;
  tencentFlashReady: boolean;
  tencentAppId: string;
  tencentAppIdConfigured: boolean;
  tencentAsrRegion: string;
  tencentAsrRegionConfigured: boolean;
  tencentAsrEngineModelType: string;
  tencentAsrEngineModelTypeConfigured: boolean;
  tencentFlashEngineType: string;
  tencentFlashVoiceFormat: string;
  xfyunCredentialReady: boolean;
  asrCredentialReady: boolean;
  libreOfficePath: string;
};

export function hasConfiguredValue(value: string | undefined) {
  return Boolean(value?.trim());
}

export function displayConfigValue(
  value: string | undefined,
  fallback = "未配置",
) {
  return value?.trim() ? value : fallback;
}

export function getSystemConfigurationStatus({
  env,
  transcriptionProvider,
}: {
  env: SystemEnvironment;
  transcriptionProvider: TranscriptionProvider;
}): SystemConfigurationStatus {
  const usesTencentCredential = transcriptionProvider.startsWith("tencent");
  const usesTencentStandardAsr = transcriptionProvider === "tencent";
  const usesTencentFlashAsr = transcriptionProvider === "tencent_flash";
  const usesXfyunProvider = transcriptionProvider === "xfyun";
  const tencentCredentialReady =
    hasConfiguredValue(env.TENCENT_SECRET_ID) &&
    hasConfiguredValue(env.TENCENT_SECRET_KEY);
  const tencentAppIdConfigured = hasConfiguredValue(env.TENCENT_APP_ID);
  const tencentFlashReady =
    !usesTencentFlashAsr ||
    (tencentCredentialReady && tencentAppIdConfigured);
  const xfyunCredentialReady =
    hasConfiguredValue(env.XFYUN_APP_ID) &&
    hasConfiguredValue(env.XFYUN_SECRET_KEY);
  const asrCredentialReady = usesTencentCredential
    ? tencentCredentialReady &&
      (!usesTencentFlashAsr || tencentAppIdConfigured)
    : usesXfyunProvider
      ? xfyunCredentialReady
      : hasConfiguredValue(env.TRANSCRIPTION_API_KEY);

  return {
    authEnabled: env.AUTH_ENABLED === "true",
    aiConfigured: hasConfiguredValue(env.AI_API_KEY),
    aiProvider: displayConfigValue(env.AI_PROVIDER),
    aiProviderConfigured: hasConfiguredValue(env.AI_PROVIDER),
    aiTimeout: displayConfigValue(env.AI_TIMEOUT_MS, "默认值"),
    transcriptionProvider,
    usesTencentCredential,
    usesTencentStandardAsr,
    usesTencentFlashAsr,
    usesXfyunProvider,
    tencentCredentialReady,
    tencentFlashReady,
    tencentAppId: displayConfigValue(env.TENCENT_APP_ID),
    tencentAppIdConfigured,
    tencentAsrRegion: displayConfigValue(env.TENCENT_ASR_REGION),
    tencentAsrRegionConfigured: hasConfiguredValue(env.TENCENT_ASR_REGION),
    tencentAsrEngineModelType: displayConfigValue(
      env.TENCENT_ASR_ENGINE_MODEL_TYPE,
    ),
    tencentAsrEngineModelTypeConfigured: hasConfiguredValue(
      env.TENCENT_ASR_ENGINE_MODEL_TYPE,
    ),
    tencentFlashEngineType: displayConfigValue(
      env.TENCENT_ASR_FLASH_ENGINE_TYPE,
      "默认",
    ),
    tencentFlashVoiceFormat: displayConfigValue(
      env.TENCENT_ASR_FLASH_VOICE_FORMAT,
      "默认",
    ),
    xfyunCredentialReady,
    asrCredentialReady,
    libreOfficePath: displayConfigValue(env.LIBREOFFICE_PATH),
  };
}
