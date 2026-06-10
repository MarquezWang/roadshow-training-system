"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PrepareFile = {
  id: string;
  originalName: string;
  fileType: string;
};

type RecordingPreference = "record" | "skip" | null;

type TrainingPrepareClientProps = Readonly<{
  sessionId: string;
  projectId: string;
  projectName: string;
  files: PrepareFile[];
  previewFile: PrepareFile | null;
}>;

function getRecordingPreferenceKey(sessionId: string) {
  return `training:${sessionId}:recordingPreference`;
}

export function TrainingPrepareClient({
  sessionId,
  projectId,
  projectName,
  files,
  previewFile,
}: TrainingPrepareClientProps) {
  const router = useRouter();
  const [recordingPreference, setRecordingPreference] =
    useState<RecordingPreference>(null);
  const [microphoneMessage, setMicrophoneMessage] = useState("");
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [isPreparingMicrophone, setIsPreparingMicrophone] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState("");

  async function markReady(preference: Exclude<RecordingPreference, null>) {
    window.sessionStorage.setItem(getRecordingPreferenceKey(sessionId), preference);

    const response = await fetch(`/training/${sessionId}/ready`, {
      method: "POST",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      throw new Error(body?.error ?? "训练准备状态保存失败。");
    }
  }

  async function prepareMicrophone() {
    setIsPreparingMicrophone(true);
    setMessage("");
    setMicrophoneMessage("");

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingPreference(null);
      setMicrophoneMessage("当前浏览器不支持录音，可选择暂不录音继续训练。");
      setIsPreparingMicrophone(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const hasLiveAudioTrack = stream
        .getAudioTracks()
        .some((track) => track.readyState === "live");

      stream.getTracks().forEach((track) => track.stop());

      if (!hasLiveAudioTrack) {
        throw new Error("未检测到可用的麦克风音轨。");
      }

      await markReady("record");
      setRecordingPreference("record");
      setShowSkipConfirm(false);
      setMicrophoneMessage("麦克风已就绪，本轮将录音。");
    } catch (error) {
      setRecordingPreference(null);
      setMicrophoneMessage(
        error instanceof Error
          ? `麦克风准备失败：${error.message}`
          : "麦克风准备失败。",
      );
    } finally {
      setIsPreparingMicrophone(false);
    }
  }

  async function confirmSkipRecording() {
    setMessage("");

    try {
      await markReady("skip");
      setRecordingPreference("skip");
      setShowSkipConfirm(false);
      setMicrophoneMessage("本轮未启用录音，仅记录翻页和用时。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "训练准备状态保存失败。");
    }
  }

  async function startPitch() {
    if (!recordingPreference) {
      setMessage("请先选择开启麦克风，或明确选择暂不录音。");
      return;
    }

    setIsStarting(true);
    setMessage("");

    try {
      const response = await fetch(`/training/${sessionId}/start-pitch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileId: previewFile?.id ?? null,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(body?.error ?? "正式开始路演失败。");
      }

      router.push(`/training/${sessionId}/pitch`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "正式开始路演失败。");
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">训练准备</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">
          {projectName}
        </h2>

        <div className="mt-6 grid gap-4">
          <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-semibold text-slate-950">路演规则</h3>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
              <li>路演时间 9 分钟。</li>
              <li>正式开始后不可暂停。</li>
              <li>训练过程中请勿刷新页面。</li>
              <li>请保持环境安静，并在开始前确认麦克风策略。</li>
            </ul>
          </section>

          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-950">材料预览</h3>
            {previewFile ? (
              <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                <p className="break-words text-sm font-medium text-slate-900">
                  {previewFile.originalName}
                </p>
                <a
                  href={`/api/files/${previewFile.id}/preview`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  打开材料预览
                </a>
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
                当前没有可预览的 PDF 材料，仍可继续训练。
              </p>
            )}
          </section>
        </div>
      </section>

      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">麦克风准备</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          请在正式进入路演页前完成录音策略选择。进入路演页后不会再首次弹出麦克风权限确认。
        </p>

        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={() => void prepareMicrophone()}
            disabled={isPreparingMicrophone || isStarting}
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isPreparingMicrophone ? "麦克风测试中..." : "开启麦克风并准备训练"}
          </button>
          <button
            type="button"
            onClick={() => setShowSkipConfirm(true)}
            disabled={isStarting}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          >
            暂不录音，继续训练
          </button>
        </div>

        {showSkipConfirm ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm leading-6 text-amber-900">
              确认本轮不录音？系统仍会记录翻页和用时，但不会保存音频。
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmSkipRecording()}
                className="inline-flex h-8 items-center justify-center rounded-md bg-amber-900 px-3 text-xs font-medium text-white"
              >
                确认不录音
              </button>
              <button
                type="button"
                onClick={() => setShowSkipConfirm(false)}
                className="inline-flex h-8 items-center justify-center rounded-md border border-amber-300 bg-white px-3 text-xs font-medium text-amber-900"
              >
                返回
              </button>
            </div>
          </div>
        ) : null}

        {microphoneMessage ? (
          <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            {microphoneMessage}
          </p>
        ) : null}

        {message ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-700">
            {message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void startPitch()}
          disabled={!recordingPreference || isStarting}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isStarting ? "正在进入路演..." : "正式开始路演"}
        </button>

        <a
          href={`/projects/${projectId}`}
          className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          返回项目详情
        </a>
      </aside>

      <section className="lg:col-span-2 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">
          纳入 AI 上下文的材料
        </h3>
        {files.length > 0 ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="rounded-md border border-slate-200 bg-slate-50 p-3"
              >
                <p className="break-words text-sm font-medium text-slate-900">
                  {file.originalName}
                </p>
                <p className="mt-1 text-xs uppercase text-slate-500">
                  {file.fileType}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-md border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
            暂无已解析且纳入 AI 上下文的材料。
          </p>
        )}
      </section>
    </div>
  );
}
