#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  backgroundTaskModes,
  getBackgroundTaskMode,
} from "../lib/background-task-mode.mjs";
import { assertProductionAuthEnabled } from "../lib/production-auth-guard.mjs";
import {
  getBackgroundWorkerTiming,
  readBackgroundWorkerHealth,
  TRAINING_ANALYSIS_CAPABILITY,
  TRAINING_TRANSCRIPTION_CAPABILITY,
  UPLOAD_MAINTENANCE_CAPABILITY,
} from "../lib/worker-heartbeat.mjs";

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

function findCommand(command, args = ["-version"]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });

  return {
    ok: result.status === 0,
    detail:
      result.status === 0
        ? firstOutputLine(result)
        : `${command} 不可执行或未安装`,
  };
}

function integerInRange(env, key, fallback, minimum, maximum) {
  const raw = hasValue(env, key) ? env[key] : String(fallback);
  const value = Number(raw);
  return {
    ok: Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    value: raw,
    range: `${minimum}..${maximum}`,
  };
}

function checkUploadStorage(env) {
  const uploadRoot = path.join(PROJECT_ROOT, "uploads");
  const probePath = path.join(
    uploadRoot,
    `.production-check-${process.pid}-${Date.now()}`,
  );

  try {
    fs.mkdirSync(uploadRoot, { recursive: true });
    fs.writeFileSync(probePath, "ok", { flag: "wx" });
    fs.unlinkSync(probePath);

    const minimumFreeBytes = Number(env.MIN_FREE_DISK_BYTES || 1024 ** 3);
    const stats = fs.statfsSync(uploadRoot);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      ok:
        Number.isSafeInteger(minimumFreeBytes) &&
        minimumFreeBytes > 0 &&
        freeBytes >= minimumFreeBytes,
      detail: `可用空间 ${(freeBytes / 1024 ** 3).toFixed(2)}GB，最低要求 ${(minimumFreeBytes / 1024 ** 3).toFixed(2)}GB`,
    };
  } catch (error) {
    try {
      fs.unlinkSync(probePath);
    } catch {
      // The probe may not have been created.
    }
    return {
      ok: false,
      detail: `uploads 目录不可写：${error instanceof Error ? error.message : String(error)}`,
    };
  }
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

function readBackgroundConfiguration(env) {
  try {
    return {
      mode: getBackgroundTaskMode(env),
      timing: getBackgroundWorkerTiming(env),
      error: "",
    };
  } catch (error) {
    return {
      mode: "",
      timing: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkBackgroundWorker(env, requiredCapabilities) {
  if (!hasValue(env, "DATABASE_URL")) {
    return {
      ok: false,
      detail: "无法在缺少 DATABASE_URL 时读取 Worker 心跳",
    };
  }

  const client = new PrismaClient({
    datasources: { db: { url: String(env.DATABASE_URL) } },
  });
  try {
    const health = await readBackgroundWorkerHealth(client, {
      requiredCapabilities,
    });
    const latest = health.latest;
    return {
      ok: health.healthy,
      detail: health.healthy
        ? `${health.capableCount} 个可用 Worker；最近心跳 ${latest?.lastSeenAt.toISOString()}`
        : `未发现能力齐全且心跳有效的 Worker（活跃 ${health.activeCount} 个）`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: `读取 Worker 心跳失败：${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await client.$disconnect();
  }
}

async function run() {
  const env = loadEffectiveEnv();
  const checks = [];
  const provider = env.TRANSCRIPTION_PROVIDER?.trim() || "openai";
  const libreOffice = findLibreOffice(env);
  const ffprobe = findCommand("ffprobe");
  const ffmpeg = findCommand("ffmpeg");
  const uploadStorage = checkUploadStorage(env);
  const authSecretError = getAuthSecretError(env);
  const backgroundConfiguration = readBackgroundConfiguration(env);

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

  for (const [key, fallback, minimum, maximum] of [
    ["TRUSTED_PROXY_HOPS", 0, 0, 10],
    ["AI_TIMEOUT_MS", 240_000, 1_000, 10 * 60_000],
    ["AI_MAX_OUTPUT_TOKENS", 6_000, 1, 100_000],
    ["TRANSCRIPTION_TIMEOUT_MS", 300_000, 10_000, 30 * 60_000],
    ["TRANSCRIPTION_MAX_CONCURRENCY", 2, 1, 16],
    ["TRANSCRIPTION_QUEUE_TIMEOUT_MS", 30_000, 1_000, 10 * 60_000],
    ["TRANSCRIPTION_MAX_AUDIO_BYTES", 100 * 1024 * 1024, 1024 * 1024, 250 * 1024 * 1024],
    ["TRANSCRIPTION_MAX_DURATION_SEC", 7_200, 60, 8 * 60 * 60],
    ["BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS", 5_000, 1_000, 60_000],
    ["BACKGROUND_WORKER_HEARTBEAT_TTL_MS", 30_000, 5_000, 5 * 60_000],
    ["BACKGROUND_WORKER_POLL_INTERVAL_MS", 5_000, 1_000, 60_000],
  ]) {
    const result = integerInRange(env, key, fallback, minimum, maximum);
    pushCheck(
      checks,
      result.ok,
      `${key}=${result.value}`,
      `允许范围 ${result.range}`,
    );
  }

  if (provider === "xfyun") {
    pushCheck(checks, hasValue(env, "XFYUN_APP_ID"), "XFYUN_APP_ID 已配置");
    pushCheck(
      checks,
      hasValue(env, "XFYUN_SECRET_KEY"),
      "XFYUN_SECRET_KEY 已配置",
    );
    pushCheck(
      checks,
      env.XFYUN_KEEP_TEMP_AUDIO?.trim().toLowerCase() !== "true",
      "XFYUN_KEEP_TEMP_AUDIO 未启用",
      "生产环境不应长期保留讯飞临时音频",
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
  pushCheck(checks, ffprobe.ok, "ffprobe 可用", ffprobe.detail);
  if (provider !== "openai") {
    pushCheck(checks, ffmpeg.ok, "ffmpeg 可用", ffmpeg.detail);
  }
  pushCheck(
    checks,
    uploadStorage.ok,
    "uploads 目录可写且磁盘空间充足",
    uploadStorage.detail,
  );
  pushCheck(
    checks,
    env.UPLOAD_MAINTENANCE_ENABLED?.trim().toLowerCase() === "true",
    "UPLOAD_MAINTENANCE_ENABLED=true",
    "生产环境必须启用上传目录保留与清理任务",
  );
  pushCheck(
    checks,
    backgroundConfiguration.mode === backgroundTaskModes.external,
    `BACKGROUND_TASK_MODE=${backgroundConfiguration.mode || "(无效)"}`,
    backgroundConfiguration.error || "生产环境必须由独立 Worker 执行后台任务",
  );
  pushCheck(
    checks,
    Boolean(backgroundConfiguration.timing),
    "后台 Worker 心跳与轮询时间配置合格",
    backgroundConfiguration.error,
  );

  const workerHealth =
    backgroundConfiguration.mode === backgroundTaskModes.external
      ? await checkBackgroundWorker(env, [
          TRAINING_ANALYSIS_CAPABILITY,
          TRAINING_TRANSCRIPTION_CAPABILITY,
          UPLOAD_MAINTENANCE_CAPABILITY,
        ])
      : {
          ok: false,
          detail: "只有 external 模式会检查独立 Worker 心跳",
        };
  pushCheck(
    checks,
    workerHealth.ok,
    "独立后台 Worker 心跳有效且能力齐全",
    workerHealth.detail,
  );

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

run().catch((error) => {
  console.error(
    "[PROD_CONFIG] unexpected failure:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
