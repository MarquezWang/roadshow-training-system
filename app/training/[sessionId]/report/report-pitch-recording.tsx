import { ReportPitchAudioBlock } from "./report-pitch-audio-block";
import { ReportPitchTranscriptBlock } from "./report-pitch-transcript-block";

export type PitchTranscript = {
  text: string;
  source: string;
};

export type PitchRecording = {
  playbackUrl: string;
  durationSec: number | null;
};

export function ReportPitchRecording({
  recording,
  transcript,
  isAborted,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptDraft,
  transcriptExpanded,
  transcriptMessage,
  onStartTranscriptEditing,
  onToggleTranscriptExpanded,
  onTranscriptDraftChange,
  onCancelTranscriptEditing,
  onSaveTranscript,
}: Readonly<{
  recording: PitchRecording | null;
  transcript: PitchTranscript | null;
  isAborted: boolean;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptDraft: string;
  transcriptExpanded: boolean;
  transcriptMessage: string;
  onStartTranscriptEditing: () => void;
  onToggleTranscriptExpanded: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onCancelTranscriptEditing: () => void;
  onSaveTranscript: () => void;
}>) {
  return recording ? (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <h3 className="text-sm font-semibold text-slate-800">
        路演录音与转写
      </h3>
      <p className="mt-1 text-xs text-slate-400">原始录音回放与转写文本。</p>

      <div className="mt-4 grid gap-4">
        <ReportPitchAudioBlock recording={recording} />

        <ReportPitchTranscriptBlock
          transcript={transcript}
          isAborted={isAborted}
          isTranscriptEditing={isTranscriptEditing}
          isTranscriptSaving={isTranscriptSaving}
          transcriptDraft={transcriptDraft}
          transcriptExpanded={transcriptExpanded}
          transcriptMessage={transcriptMessage}
          onStartTranscriptEditing={onStartTranscriptEditing}
          onToggleTranscriptExpanded={onToggleTranscriptExpanded}
          onTranscriptDraftChange={onTranscriptDraftChange}
          onCancelTranscriptEditing={onCancelTranscriptEditing}
          onSaveTranscript={onSaveTranscript}
        />
      </div>

      <p className="mt-4 text-xs text-slate-400">
        逐页讲解时间轴与分页面建议将在后续版本中完善。
      </p>
    </section>
  ) : (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <p className="text-sm text-slate-500">本轮没有路演录音记录。</p>
    </section>
  );
}
