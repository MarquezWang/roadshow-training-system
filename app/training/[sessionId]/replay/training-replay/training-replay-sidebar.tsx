import type { RefObject } from "react";
import { formatReplayTime } from "./training-replay-flow";
import type {
  PitchReplaySegment,
  ReplayRecording,
  ReplayTranscriptExcerpt,
} from "./training-replay-types";

type TrainingReplaySidebarProps = Readonly<{
  recording: ReplayRecording | null;
  currentReplaySegment: PitchReplaySegment | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  isReplayPlaying: boolean;
  replayTranscriptExcerpt: ReplayTranscriptExcerpt;
  noteValue: string;
  noteSavedMessage: string;
  onPlay: () => void | Promise<void>;
  onPause: () => void;
  onNoteChange: (value: string) => void;
  onSaveNote: () => void;
}>;

export function TrainingReplaySidebar({
  recording,
  currentReplaySegment,
  audioRef,
  isReplayPlaying,
  replayTranscriptExcerpt,
  noteValue,
  noteSavedMessage,
  onPlay,
  onPause,
  onNoteChange,
  onSaveNote,
}: TrainingReplaySidebarProps) {
  return (
    <aside className="grid content-start gap-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <h3 className="text-sm font-semibold text-slate-100">本页音频</h3>
        {recording && currentReplaySegment ? (
          <div className="mt-3 grid gap-3">
            <audio
              ref={audioRef}
              controls
              preload="metadata"
              src={recording.playbackUrl}
              className="w-full"
            >
              <track kind="captions" />
            </audio>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onPlay()}
                className="rounded-md bg-teal-400/90 px-3 py-1.5 text-xs font-medium text-slate-950 transition-colors hover:bg-teal-300"
              >
                {isReplayPlaying ? "重新播放本页" : "播放本页片段"}
              </button>
              <button
                type="button"
                onClick={onPause}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
              >
                暂停
              </button>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              片段区间：{formatReplayTime(currentReplaySegment.startSec)}
              {" - "}
              {formatReplayTime(currentReplaySegment.endSec)}
              <br />
              本页累计用时：
              {formatReplayTime(currentReplaySegment.durationSec)}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-slate-500">
            当前没有可用的路演录音或页面片段。
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <h3 className="text-sm font-semibold text-slate-100">本页转写</h3>
        <p className="mt-1 text-xs text-slate-500">
          {currentReplaySegment
            ? `本页用时 ${formatReplayTime(currentReplaySegment.durationSec)}`
            : "暂无页面用时"}
          {replayTranscriptExcerpt.matchType === "precise"
            ? " · 已按句子时间戳精确匹配"
            : replayTranscriptExcerpt.matchType === "estimated"
              ? " · 按页面用时粗略匹配"
              : ""}
        </p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/70 p-3 text-sm leading-6 text-slate-300">
          {replayTranscriptExcerpt.text ||
            "暂无可匹配的本页转写片段。新训练若使用腾讯云极速版时间戳，将按本页音频时间精确匹配。"}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-4">
        <h3 className="text-sm font-semibold text-slate-100">本页笔记</h3>
        <p className="mt-1 text-xs text-slate-500">
          记录这一页讲得不好的地方、需要补充的证据或下一轮改法。
        </p>
        <textarea
          value={noteValue}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="例如：这一页背景痛点讲得太泛，需要补一个真实客户场景。"
          className="mt-3 min-h-36 w-full resize-y rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm leading-6 text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-teal-400"
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">笔记会保存在当前浏览器本地。</p>
          <div className="flex items-center gap-2">
            {noteSavedMessage ? (
              <span className="text-xs text-emerald-400">
                {noteSavedMessage}
              </span>
            ) : null}
            <button
              type="button"
              onClick={onSaveNote}
              className="rounded-md bg-teal-400/90 px-3 py-1.5 text-xs font-medium text-slate-950 transition-colors hover:bg-teal-300"
            >
              记录
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
