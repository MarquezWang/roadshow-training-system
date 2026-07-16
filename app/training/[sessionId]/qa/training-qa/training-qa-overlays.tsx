import type { QuestionTextDialog } from "@/lib/use-qa-speech";

type TrainingQaOverlaysProps = Readonly<{
  isGuardResolved: boolean;
  showDynamicFollowupIntro: boolean;
  questionTextDialog: QuestionTextDialog;
  preAnswerOverlay: number | null;
  isCurrentDynamicFollowup: boolean;
  shouldShowMessageToast: boolean;
  message: string;
  onConfirmQuestionText: () => void;
}>;

export function TrainingQaOverlays({
  isGuardResolved,
  showDynamicFollowupIntro,
  questionTextDialog,
  preAnswerOverlay,
  isCurrentDynamicFollowup,
  shouldShowMessageToast,
  message,
  onConfirmQuestionText,
}: TrainingQaOverlaysProps) {
  return (
    <>
      {!isGuardResolved ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <p className="text-xl font-semibold text-white">正在结束训练...</p>
        </div>
      ) : null}

      {showDynamicFollowupIntro ? <DynamicFollowupIntro /> : null}

      {questionTextDialog ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-5 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 p-6 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.18em] text-cyan-200">
                  QUESTION TEXT
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  评委提问
                </h2>
              </div>
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                {questionTextDialog.mode === "fallback"
                  ? "已切换为文字"
                  : questionTextDialog.mode === "review"
                    ? "题目文字"
                    : "语音提问中"}
              </span>
            </div>

            <p className="mt-5 rounded-lg border border-slate-700 bg-slate-900/70 p-4 text-sm leading-6 text-slate-200">
              {questionTextDialog.mode === "fallback"
                ? "当前浏览器未能播放语音，已自动显示本题文字。请阅读题目后再开始回答。"
                : questionTextDialog.mode === "review"
                  ? "这是当前评委问题文字。关闭后可以继续答辩。"
                  : "评委正在语音提问，题目文字同步展示。语音结束后将自动进入“请准备、3、2、1”。"}
            </p>

            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900 p-5">
              <p className="text-xs font-medium uppercase text-slate-400">
                Q{questionTextDialog.question.orderIndex} /{" "}
                {questionTextDialog.question.questionType ?? "QUESTION"}
              </p>
              {questionTextDialog.question.source === "DYNAMIC_FOLLOWUP" ? (
                <span className="mt-3 inline-block rounded bg-blue-900/60 px-2 py-0.5 text-xs font-medium text-blue-200">
                  基于本轮路演追问
                </span>
              ) : null}
              <p className="mt-3 text-lg font-semibold leading-8 text-white">
                {questionTextDialog.question.questionText}
              </p>
              {questionTextDialog.question.basis ? (
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  依据：{questionTextDialog.question.basis}
                </p>
              ) : null}
            </div>

            {questionTextDialog.mode !== "reading" ? (
              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={onConfirmQuestionText}
                  className="inline-flex h-11 items-center justify-center rounded-md bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200"
                >
                  {questionTextDialog.mode === "fallback"
                    ? "我已阅读，开始回答"
                    : "关闭"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {preAnswerOverlay !== null ? (
        <PreAnswerCountdown
          value={preAnswerOverlay}
          isDynamicFollowup={isCurrentDynamicFollowup}
        />
      ) : null}

      {shouldShowMessageToast ? (
        <div className="fixed bottom-20 left-1/2 z-40 w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950/90 p-3 text-center text-sm leading-6 text-slate-200 shadow-2xl shadow-black/40">
          <p>{message}</p>
        </div>
      ) : null}
    </>
  );
}

function DynamicFollowupIntro() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-slate-950/45 bg-[radial-gradient(circle_at_80%_20%,rgba(99,102,241,0.16),transparent_34%),radial-gradient(circle_at_20%_80%,rgba(34,211,238,0.10),transparent_36%)] px-6 backdrop-blur-sm">
      <div className="absolute inset-0 animate-[followupSweep_2.6s_ease-in-out_forwards] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,0.05),transparent)]" />
      <div className="relative w-full max-w-lg animate-[followupCard_2.6s_cubic-bezier(0.22,1,0.36,1)_forwards] overflow-hidden rounded-lg border border-cyan-300/35 bg-slate-950/80 p-1 shadow-[0_0_38px_rgba(34,211,238,0.18)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200 to-transparent" />
        <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-400/12 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-28 w-28 rounded-full bg-cyan-300/12 blur-3xl" />
        <div className="relative overflow-hidden rounded-md border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.88),rgba(30,41,59,0.78))] p-7 text-left">
          <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_10px)] opacity-35" />
          <div className="relative flex items-center justify-between gap-4">
            <span className="inline-flex rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-cyan-100">
              DYNAMIC FOLLOW-UP
            </span>
            <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-violet-300/35 bg-violet-400/10">
              <span className="absolute h-full w-full animate-ping rounded-full border border-cyan-200/25" />
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-200" />
            </span>
          </div>
          <div className="relative mt-8">
            <p className="text-sm font-medium text-cyan-200">动态追问</p>
            <h2 className="mt-2 text-4xl font-semibold tracking-wide text-white">
              特殊追问回合
            </h2>
            <p className="mt-4 text-base leading-7 text-slate-200">
              系统已根据本轮路演内容生成追问
            </p>
            <p className="mt-2 text-sm font-medium text-cyan-200">
              本题独立限时 1 分钟
            </p>
          </div>
          <div className="relative mt-7 h-1 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-2/3 animate-[followupBar_2.5s_ease-in-out_forwards] rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400" />
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes followupCard {
          0% {
            opacity: 0;
            transform: translateX(80vw) scale(0.96);
          }
          18% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          74% {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
          100% {
            opacity: 0;
            transform: translateX(-70vw) scale(0.98);
          }
        }

        @keyframes followupSweep {
          0% {
            transform: translateX(70vw);
            opacity: 0;
          }
          25% {
            opacity: 1;
          }
          100% {
            transform: translateX(-70vw);
            opacity: 0;
          }
        }

        @keyframes followupBar {
          0% {
            transform: translateX(-120%);
          }
          82% {
            transform: translateX(24%);
          }
          100% {
            transform: translateX(120%);
          }
        }
      `}</style>
    </div>
  );
}

function PreAnswerCountdown({
  value,
  isDynamicFollowup,
}: Readonly<{ value: number; isDynamicFollowup: boolean }>) {
  if (!isDynamicFollowup) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <p className="text-6xl font-bold text-white">
          {value >= 4 ? "请准备" : value >= 1 ? String(value) : "请开始回答"}
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 bg-[radial-gradient(circle_at_center,rgba(79,70,229,0.10),transparent_42%)] backdrop-blur-sm">
      <div className="relative flex h-64 w-64 items-center justify-center rounded-full border border-cyan-300/15 bg-slate-950/45 shadow-[0_0_24px_rgba(34,211,238,0.14)]">
        <span className="absolute inset-3 animate-pulse rounded-full border border-cyan-200/20" />
        <span className="absolute inset-8 rounded-full border border-violet-300/15" />
        <span className="absolute h-full w-full animate-ping rounded-full border border-cyan-300/10" />
        <div className="relative text-center">
          <p className="text-xs font-semibold tracking-[0.18em] text-cyan-100">
            动态追问
          </p>
          <p className="mt-5 animate-pulse text-7xl font-bold text-white drop-shadow-[0_0_10px_rgba(125,211,252,0.45)]">
            {value >= 4 ? "请准备" : value >= 1 ? String(value) : "开始回答"}
          </p>
        </div>
      </div>
    </div>
  );
}
