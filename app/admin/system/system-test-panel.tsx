"use client";

import { useRef, useState } from "react";

type TestState = {
  status: "idle" | "running" | "success" | "error";
  message: string;
  detail?: string;
  elapsedMs?: number;
};

const initialState: TestState = {
  status: "idle",
  message: "尚未执行",
};

function ResultBox({ state }: { state: TestState }) {
  const colorClass =
    state.status === "success"
      ? "border-teal-200 bg-teal-50 text-teal-800"
      : state.status === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : state.status === "running"
          ? "border-blue-200 bg-blue-50 text-blue-800"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${colorClass}`}>
      <p>{state.message}</p>
      {typeof state.elapsedMs === "number" ? (
        <p className="mt-1 text-xs opacity-80">耗时：{state.elapsedMs}ms</p>
      ) : null}
      {state.detail ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-xs opacity-80">
          {state.detail}
        </p>
      ) : null}
    </div>
  );
}

export function SystemTestPanel() {
  const [aiState, setAiState] = useState<TestState>(initialState);
  const [asrState, setAsrState] = useState<TestState>(initialState);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function runAiTest() {
    const startedAt = Date.now();
    setAiState({
      status: "running",
      message: "AI 连通性测试中...",
    });

    try {
      const response = await fetch("/api/ai/test", {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "AI 测试失败。");
      }

      setAiState({
        status: "success",
        message: "AI 连通性正常。",
        detail: data.text?.slice(0, 300),
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      setAiState({
        status: "error",
        message: "AI 连通性测试失败。",
        detail: error instanceof Error ? error.message : "未知错误",
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  async function runAsrTest() {
    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setAsrState({
        status: "error",
        message: "请先选择一段 10MB 以内的测试音频。",
      });
      return;
    }

    const startedAt = Date.now();
    setAsrState({
      status: "running",
      message: "ASR 测试转写中...",
    });

    try {
      const formData = new FormData();
      formData.append("audio", file);
      const response = await fetch("/api/admin/system/asr-test", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as {
        provider?: string;
        elapsedMs?: number;
        text?: string;
        error?: string;
        detail?: string;
      };

      if (!response.ok) {
        throw new Error(data.detail || data.error || "ASR 测试失败。");
      }

      setAsrState({
        status: "success",
        message: `ASR 测试成功，provider=${data.provider ?? "unknown"}。`,
        detail: data.text?.trim() || "识别结果为空。",
        elapsedMs: data.elapsedMs ?? Date.now() - startedAt,
      });
    } catch (error) {
      setAsrState({
        status: "error",
        message: "ASR 测试失败。",
        detail: error instanceof Error ? error.message : "未知错误",
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="border-b border-slate-100 pb-4">
        <h2 className="text-base font-semibold text-slate-950">手动自检</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          用于部署后快速确认关键链路是否可用。ASR 测试会消耗一次当前服务商转写额度。
        </p>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                AI 连通性测试
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                调用现有轻量 AI 测试接口，验证模型服务是否可用。
              </p>
            </div>
            <button
              type="button"
              onClick={runAiTest}
              disabled={aiState.status === "running"}
              className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {aiState.status === "running" ? "测试中..." : "测试 AI"}
            </button>
          </div>
          <ResultBox state={aiState} />
        </div>

        <div className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">
                ASR 手动转写测试
              </h3>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                上传 5-10 秒测试音频，调用当前 TRANSCRIPTION_PROVIDER。
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.webm,.mp3,.m4a,.wav"
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={runAsrTest}
                disabled={asrState.status === "running"}
                className="rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {asrState.status === "running" ? "转写中..." : "测试 ASR"}
              </button>
            </div>
          </div>
          <ResultBox state={asrState} />
        </div>
      </div>
    </section>
  );
}
