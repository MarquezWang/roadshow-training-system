type TrainingRecordingDialogsProps = Readonly<{
  status: string;
  recordingMessage: string;
  showRecordingPrepDialog: boolean;
  showRecordingOptOutConfirm: boolean;
  showRecordingReenableConfirm: boolean;
  onOpenRecordingOptOutConfirm: () => void;
  onCloseRecordingOptOutConfirm: () => void;
  onConfirmRecordingOptOut: () => void;
  onPrepareRecording: () => void | Promise<void>;
  onCloseRecordingReenableConfirm: () => void;
  onReenableRecording: () => void;
}>;

export function TrainingRecordingDialogs({
  status,
  recordingMessage,
  showRecordingPrepDialog,
  showRecordingOptOutConfirm,
  showRecordingReenableConfirm,
  onOpenRecordingOptOutConfirm,
  onCloseRecordingOptOutConfirm,
  onConfirmRecordingOptOut,
  onPrepareRecording,
  onCloseRecordingReenableConfirm,
  onReenableRecording,
}: TrainingRecordingDialogsProps) {
  return (
    <>
      {showRecordingPrepDialog && status === "CREATED" ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 px-4">
          <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-medium text-slate-500">录音准备</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              开始前请确认麦克风
            </h2>
            {showRecordingOptOutConfirm ? (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  确认不启用录音？本次路演将无法生成语音转写和表达分析，仅记录翻页和用时。
                </p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onCloseRecordingOptOutConfirm}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    返回开启麦克风
                  </button>
                  <button
                    type="button"
                    onClick={onConfirmRecordingOptOut}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    确认不录音
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  为保证训练顺利进行，本次路演建议开启麦克风录音。请先允许麦克风权限，系统将在正式开始路演后自动录制。
                </p>
                {recordingMessage ? (
                  <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
                    {recordingMessage}
                  </p>
                ) : null}
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onOpenRecordingOptOutConfirm}
                    className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    暂不录音，继续训练
                  </button>
                  <button
                    type="button"
                    onClick={() => void onPrepareRecording()}
                    className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    开启麦克风并准备训练
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {showRecordingReenableConfirm && status === "CREATED" ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/70 px-4">
          <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-2xl">
            <p className="text-xs font-medium text-slate-500">重新启用录音</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">
              本轮将启用录音
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              启用后，本轮路演将进行录音并在结束后保存。是否继续？
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCloseRecordingReenableConfirm}
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onReenableRecording}
                className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
              >
                继续启用录音
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
