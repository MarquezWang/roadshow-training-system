import type { TrainingAnalysis } from "@/lib/use-pitch-analysis";
import type { RecordingStatus } from "@/lib/use-pitch-recording";
import type {
  TrainingTranscript,
  TranscribeStatus,
} from "@/lib/use-pitch-transcript";
import { TrainingAnalysisPanel } from "./training-analysis-panel";
import { formatDuration } from "./training-session-format";
import { TrainingTranscriptPanel } from "./training-transcript-panel";

type TrainingPitchSidebarProps = Readonly<{
  elapsedSec: number;
  pageLabel: string;
  recordingStatus: RecordingStatus;
  recordingStatusLabel: string;
  recordingMessage: string;
  recordingPlaybackUrl: string | null;
  recordingId: string | null;
  isEnded: boolean;
  transcript: TrainingTranscript | null;
  transcriptDraft: string;
  isTranscriptEditing: boolean;
  isTranscriptSaving: boolean;
  transcriptMessage: string;
  transcribeStatus: TranscribeStatus;
  transcribeErrorMessage: string;
  showAnalysisPanel: boolean;
  analysis: TrainingAnalysis | null;
  analysisMessage: string;
  isAnalysisLoading: boolean;
  onRetryTranscribe: () => void | Promise<void>;
  onStartTranscriptEditing: () => void;
  onCancelTranscriptEditing: () => void;
  onTranscriptDraftChange: (value: string) => void;
  onSaveTranscript: () => void | Promise<void>;
  onGenerateAnalysis: () => void | Promise<void>;
}>;

export function TrainingPitchSidebar({
  elapsedSec,
  pageLabel,
  recordingStatus,
  recordingStatusLabel,
  recordingMessage,
  recordingPlaybackUrl,
  recordingId,
  isEnded,
  transcript,
  transcriptDraft,
  isTranscriptEditing,
  isTranscriptSaving,
  transcriptMessage,
  transcribeStatus,
  transcribeErrorMessage,
  showAnalysisPanel,
  analysis,
  analysisMessage,
  isAnalysisLoading,
  onRetryTranscribe,
  onStartTranscriptEditing,
  onCancelTranscriptEditing,
  onTranscriptDraftChange,
  onSaveTranscript,
  onGenerateAnalysis,
}: TrainingPitchSidebarProps) {
  const canShowTranscriptEditor =
    isEnded && recordingStatus === "SAVED" && Boolean(recordingId);

  return (
    <aside className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">路演信息</h2>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <dt className="text-slate-500">路演用时</dt>
            <dd className="font-medium text-slate-950">
              {formatDuration(elapsedSec)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-500">当前页码</dt>
            <dd className="font-medium text-slate-950">{pageLabel}</dd>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <dt className="text-slate-500">录音状态</dt>
            <dd className="font-medium text-slate-950">
              {recordingStatusLabel}
            </dd>
          </div>
        </dl>
        {recordingMessage ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            {recordingMessage}
          </p>
        ) : null}
        {recordingPlaybackUrl ? (
          <audio controls src={recordingPlaybackUrl} className="mt-3 w-full">
            <track kind="captions" />
          </audio>
        ) : null}

        <TrainingTranscriptPanel
          isEnded={isEnded}
          recordingStatus={recordingStatus}
          canShowTranscriptEditor={canShowTranscriptEditor}
          transcript={transcript}
          transcriptDraft={transcriptDraft}
          isTranscriptEditing={isTranscriptEditing}
          isTranscriptSaving={isTranscriptSaving}
          transcriptMessage={transcriptMessage}
          transcribeStatus={transcribeStatus}
          transcribeErrorMessage={transcribeErrorMessage}
          onRetryTranscribe={onRetryTranscribe}
          onStartEditing={onStartTranscriptEditing}
          onCancelEditing={onCancelTranscriptEditing}
          onTranscriptDraftChange={onTranscriptDraftChange}
          onSaveTranscript={onSaveTranscript}
        />
      </section>

      {showAnalysisPanel ? (
        <TrainingAnalysisPanel
          analysis={analysis}
          analysisMessage={analysisMessage}
          isAnalysisLoading={isAnalysisLoading}
          isEnded={isEnded}
          transcriptText={transcript?.text ?? ""}
          onGenerateAnalysis={onGenerateAnalysis}
        />
      ) : null}
    </aside>
  );
}
