import type { PitchRecording } from "./report-pitch-recording";

export function ReportPitchAudioBlock({
  recording,
}: Readonly<{
  recording: PitchRecording;
}>) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/50 p-4">
      <p className="text-xs font-medium text-slate-500">路演录音回放</p>
      <audio controls src={recording.playbackUrl} className="mt-2 w-full">
        <track kind="captions" />
      </audio>
      <p className="mt-1 text-xs text-slate-400">
        {recording.durationSec !== null
          ? `录音时长 ${recording.durationSec} 秒`
          : "录音时长未记录"}
      </p>
    </div>
  );
}
