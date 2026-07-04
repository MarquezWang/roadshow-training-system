export function ReportQaTranscriptTextBlock({
  recordingId,
  isExpanded,
  textPreview,
  fullText,
  onToggleTranscriptExpand,
}: Readonly<{
  recordingId: string;
  isExpanded: boolean;
  textPreview: string;
  fullText: string;
  onToggleTranscriptExpand: (recordingId: string) => void;
}>) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3">
      {isExpanded ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
            {fullText}
          </p>
          <button
            type="button"
            onClick={() => onToggleTranscriptExpand(recordingId)}
            className="mt-2 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
          >
            收起
          </button>
        </>
      ) : (
        <>
          <p className="text-sm leading-6 text-slate-600">
            {textPreview}
            {fullText.length > 150 ? "..." : ""}
          </p>
          <button
            type="button"
            onClick={() => onToggleTranscriptExpand(recordingId)}
            className="mt-1 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
          >
            展开完整转写
          </button>
        </>
      )}
    </div>
  );
}
