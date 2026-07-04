type CompletedAtTranscript = Readonly<{
  completedAt: Date | null;
}>;

type RecordingWithTranscript = Readonly<{
  transcript: CompletedAtTranscript | null;
}>;

type QuestionWithRecordingTranscript = Readonly<{
  answer: Readonly<{
    recording: Readonly<{
      transcript: CompletedAtTranscript | null;
    }> | null;
  }> | null;
}>;

export function isReportAnalysisStale({
  sessionId,
  analysisStatus,
  analysisUpdatedAt,
  recordings,
  trainingQuestions,
}: Readonly<{
  sessionId: string;
  analysisStatus: string | null;
  analysisUpdatedAt: Date | null;
  recordings: readonly RecordingWithTranscript[];
  trainingQuestions: readonly QuestionWithRecordingTranscript[];
}>) {
  if (analysisStatus !== "COMPLETED" || !analysisUpdatedAt) {
    return false;
  }

  const analysisUpdatedAtMs = analysisUpdatedAt.getTime();
  const allTranscripts = [
    ...recordings
      .filter((r) => r.transcript?.completedAt)
      .map((r) => r.transcript!.completedAt!.getTime()),
    ...trainingQuestions
      .filter((q) => q.answer?.recording?.transcript?.completedAt)
      .map((q) => q.answer!.recording!.transcript!.completedAt!.getTime()),
  ];

  if (allTranscripts.length === 0) {
    return false;
  }

  const latestTranscriptTime = Math.max(...allTranscripts);
  if (latestTranscriptTime <= analysisUpdatedAtMs) {
    return false;
  }

  console.log("[report:page] stale analysis detected, will trigger regeneration", {
    sessionId,
    analysisUpdatedAt: new Date(analysisUpdatedAtMs).toISOString(),
    latestTranscriptTime: new Date(latestTranscriptTime).toISOString(),
  });

  return true;
}
