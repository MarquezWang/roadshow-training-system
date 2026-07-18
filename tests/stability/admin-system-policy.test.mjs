import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL(
    "../../app/admin/system/system-status-policy.ts",
    import.meta.url,
  ),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const {
  displayConfigValue,
  getSystemConfigurationStatus,
  hasConfiguredValue,
} = await import(moduleUrl);

function status(transcriptionProvider, env = {}) {
  return getSystemConfigurationStatus({ env, transcriptionProvider });
}

test("系统配置值按空白归一化，但保留已配置原值", () => {
  assert.equal(hasConfiguredValue(undefined), false);
  assert.equal(hasConfiguredValue("   "), false);
  assert.equal(hasConfiguredValue(" configured "), true);
  assert.equal(displayConfigValue(undefined), "未配置");
  assert.equal(displayConfigValue("  ", "默认值"), "默认值");
  assert.equal(displayConfigValue(" configured "), " configured ");
});

test("OpenAI 转写只依赖通用转写密钥，登录开关保持严格匹配", () => {
  const configured = status("openai", {
    AUTH_ENABLED: "true",
    AI_PROVIDER: "openai",
    AI_API_KEY: "ai-secret",
    TRANSCRIPTION_API_KEY: "asr-secret",
  });

  assert.equal(configured.authEnabled, true);
  assert.equal(configured.aiConfigured, true);
  assert.equal(configured.aiProvider, "openai");
  assert.equal(configured.asrCredentialReady, true);
  assert.equal(configured.usesTencentCredential, false);
  assert.equal(configured.usesXfyunProvider, false);

  assert.equal(
    status("openai", {
      AUTH_ENABLED: " true ",
      TRANSCRIPTION_API_KEY: "asr-secret",
    }).authEnabled,
    false,
  );
});

test("普通腾讯云转写需要密钥对，但不把极速版 App ID 当成前置条件", () => {
  const configured = status("tencent", {
    TENCENT_SECRET_ID: "secret-id",
    TENCENT_SECRET_KEY: "secret-key",
  });

  assert.equal(configured.usesTencentCredential, true);
  assert.equal(configured.usesTencentStandardAsr, true);
  assert.equal(configured.usesTencentFlashAsr, false);
  assert.equal(configured.tencentCredentialReady, true);
  assert.equal(configured.tencentAppIdConfigured, false);
  assert.equal(configured.tencentFlashReady, true);
  assert.equal(configured.asrCredentialReady, true);
  assert.equal(configured.tencentAsrRegionConfigured, false);
  assert.equal(configured.tencentAsrEngineModelTypeConfigured, false);
});

test("腾讯云极速版必须同时配置密钥对和 App ID", () => {
  const missingAppId = status("tencent_flash", {
    TENCENT_SECRET_ID: "secret-id",
    TENCENT_SECRET_KEY: "secret-key",
  });

  assert.equal(missingAppId.tencentCredentialReady, true);
  assert.equal(missingAppId.tencentFlashReady, false);
  assert.equal(missingAppId.asrCredentialReady, false);

  const configured = status("tencent_flash", {
    TENCENT_SECRET_ID: "secret-id",
    TENCENT_SECRET_KEY: "secret-key",
    TENCENT_APP_ID: "app-id",
    TENCENT_ASR_FLASH_ENGINE_TYPE: "16k_zh",
    TENCENT_ASR_FLASH_VOICE_FORMAT: "webm",
  });

  assert.equal(configured.tencentFlashReady, true);
  assert.equal(configured.asrCredentialReady, true);
  assert.equal(configured.tencentFlashEngineType, "16k_zh");
  assert.equal(configured.tencentFlashVoiceFormat, "webm");
});

test("讯飞转写仅在 App ID 和 Secret Key 都存在时就绪", () => {
  assert.equal(
    status("xfyun", { XFYUN_APP_ID: "app-id" }).asrCredentialReady,
    false,
  );

  const configured = status("xfyun", {
    XFYUN_APP_ID: "app-id",
    XFYUN_SECRET_KEY: "secret-key",
  });

  assert.equal(configured.usesXfyunProvider, true);
  assert.equal(configured.xfyunCredentialReady, true);
  assert.equal(configured.asrCredentialReady, true);
});

test("安全配置快照只保留就绪状态，不携带密钥明文", () => {
  const sensitiveValues = [
    "ai-secret-value",
    "tencent-secret-id-value",
    "tencent-secret-key-value",
    "xfyun-secret-key-value",
    "transcription-secret-value",
  ];
  const snapshot = status("tencent_flash", {
    AI_API_KEY: sensitiveValues[0],
    TENCENT_SECRET_ID: sensitiveValues[1],
    TENCENT_SECRET_KEY: sensitiveValues[2],
    XFYUN_SECRET_KEY: sensitiveValues[3],
    TRANSCRIPTION_API_KEY: sensitiveValues[4],
    TENCENT_APP_ID: "visible-app-id",
  });
  const serialized = JSON.stringify(snapshot);

  for (const sensitiveValue of sensitiveValues) {
    assert.equal(serialized.includes(sensitiveValue), false, sensitiveValue);
  }
  assert.equal(snapshot.aiConfigured, true);
  assert.equal(snapshot.tencentCredentialReady, true);
  assert.equal(snapshot.tencentAppId, "visible-app-id");
});
