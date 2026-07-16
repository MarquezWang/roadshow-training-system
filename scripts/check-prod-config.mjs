#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertProductionAuthEnabled } from "../lib/production-auth-guard.mjs";

const PROJECT_ROOT = process.cwd();
const VALID_TRANSCRIPTION_PROVIDERS = new Set([
  "openai",
  "xfyun",
  "tencent",
  "tencent_flash",
]);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const entries = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

function loadEffectiveEnv() {
  return {
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env")),
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env.local")),
    ...process.env,
  };
}

function hasValue(env, key) {
  return Boolean(env[key] && String(env[key]).trim());
}

function firstValue(env, keys) {
  for (const key of keys) {
    if (hasValue(env, key)) return env[key];
  }
  return "";
}

function findLibreOffice(env) {
  const explicitPath = env.LIBREOFFICE_PATH?.trim();

  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      return {
        ok: false,
        detail: `LIBREOFFICE_PATH 不存在：${explicitPath}`,
      };
    }

    const result = spawnSync(explicitPath, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
    });

    return {
      ok: result.status === 0,
      detail:
        result.status === 0
          ? `${explicitPath} ${firstOutputLine(result)}`
          : `LIBREOFFICE_PATH 无法执行：${explicitPath}`,
    };
  }

  for (const command of ["libreoffice", "soffice"]) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      windowsHide: true,
    });

    if (result.status === 0) {
      return {
        ok: true,
        detail: `${command} ${firstOutputLine(result)}`,
      };
    }
  }

  return {
    ok: false,
    detail: "未找到 libreoffice 或 soffice 命令",
  };
}

function firstOutputLine(result) {
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0] ?? "";
}

function pushCheck(checks, ok, label, detail = "") {
  checks.push({ ok, label, detail });
}

function getAuthSecretError(env) {
  try {
    assertProductionAuthEnabled({
      ...env,
      NODE_ENV: "production",
      AUTH_ENABLED: "true",
    });
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function run() {
  const env = loadEffectiveEnv();
  const checks = [];
  const provider = env.TRANSCRIPTION_PROVIDER?.trim() || "openai";
  const libreOffice = findLibreOffice(env);
  const authSecretError = getAuthSecretError(env);

  pushCheck(
    checks,
    env.AUTH_ENABLED === "true",
    "AUTH_ENABLED=true",
    "生产环境必须开启登录保护",
  );
  pushCheck(
    checks,
    !authSecretError,
    "AUTH_SECRET 与可选 AUTH_SECRET_PREVIOUS 配置合格",
    authSecretError,
  );
  pushCheck(checks, hasValue(env, "DATABASE_URL"), "DATABASE_URL 已配置");
  pushCheck(checks, hasValue(env, "AI_API_KEY"), "AI_API_KEY 已配置");
  pushCheck(
    checks,
    hasValue(env, "AI_MODEL_FAST") || hasValue(env, "AI_MODEL"),
    `AI_MODEL_FAST=${env.AI_MODEL_FAST || "(未配置，可能回退 AI_MODEL)"}`,
  );
  pushCheck(
    checks,
    hasValue(env, "AI_MODEL_STRONG") || hasValue(env, "AI_MODEL"),
    `AI_MODEL_STRONG=${env.AI_MODEL_STRONG || "(未配置，可能回退 AI_MODEL)"}`,
  );
  pushCheck(
    checks,
    VALID_TRANSCRIPTION_PROVIDERS.has(provider),
    `TRANSCRIPTION_PROVIDER=${provider || "(未配置)"}`,
  );

  if (provider === "xfyun") {
    pushCheck(checks, hasValue(env, "XFYUN_APP_ID"), "XFYUN_APP_ID 已配置");
    pushCheck(
      checks,
      hasValue(env, "XFYUN_SECRET_KEY"),
      "XFYUN_SECRET_KEY 已配置",
    );
  }

  if (provider === "openai") {
    pushCheck(
      checks,
      hasValue(env, "TRANSCRIPTION_API_KEY"),
      "TRANSCRIPTION_API_KEY 已配置",
    );
  }

  if (provider === "tencent" || provider === "tencent_flash") {
    pushCheck(
      checks,
      Boolean(firstValue(env, ["TENCENT_SECRET_ID", "TENCENTCLOUD_SECRET_ID"])),
      "腾讯云 SecretId 已配置",
    );
    pushCheck(
      checks,
      Boolean(
        firstValue(env, ["TENCENT_SECRET_KEY", "TENCENTCLOUD_SECRET_KEY"]),
      ),
      "腾讯云 SecretKey 已配置",
    );
  }

  if (provider === "tencent") {
    pushCheck(
      checks,
      hasValue(env, "TENCENT_ASR_REGION"),
      "TENCENT_ASR_REGION 已配置",
    );
    pushCheck(
      checks,
      hasValue(env, "TENCENT_ASR_ENGINE_MODEL_TYPE"),
      "TENCENT_ASR_ENGINE_MODEL_TYPE 已配置",
    );
  }

  if (provider === "tencent_flash") {
    pushCheck(
      checks,
      Boolean(firstValue(env, ["TENCENT_APP_ID", "TENCENTCLOUD_APP_ID"])),
      "腾讯云 AppID 已配置",
    );
    pushCheck(
      checks,
      hasValue(env, "TENCENT_ASR_FLASH_ENGINE_TYPE"),
      "TENCENT_ASR_FLASH_ENGINE_TYPE 已配置",
    );
    pushCheck(
      checks,
      hasValue(env, "TENCENT_ASR_FLASH_VOICE_FORMAT"),
      "TENCENT_ASR_FLASH_VOICE_FORMAT 已配置",
    );
  }

  pushCheck(checks, libreOffice.ok, "LibreOffice 可用", libreOffice.detail);

  const failed = checks.filter((check) => !check.ok);

  console.log("[PROD_CONFIG] production readiness checks");
  for (const check of checks) {
    const mark = check.ok ? "OK" : "FAIL";
    const detail = check.detail ? ` - ${check.detail}` : "";
    console.log(`[${mark}] ${check.label}${detail}`);
  }

  if (failed.length > 0) {
    console.error(
      `[PROD_CONFIG] failed ${failed.length}/${checks.length} checks`,
    );
    process.exit(1);
  }

  console.log(`[PROD_CONFIG] all ${checks.length} checks passed`);
}

run();
