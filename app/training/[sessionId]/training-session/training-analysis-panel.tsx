import type {
  TrainingAnalysis,
  TrainingCoverageItem,
} from "@/lib/use-pitch-analysis";

type TrainingAnalysisPanelProps = Readonly<{
  analysis: TrainingAnalysis | null;
  analysisMessage: string;
  isAnalysisLoading: boolean;
  isEnded: boolean;
  transcriptText: string;
  onGenerateAnalysis: () => void | Promise<void>;
}>;

function stringifyAnalysisValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "暂无";
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return JSON.stringify(value);
}

function getCoverageLabel(value: TrainingCoverageItem["covered"]) {
  const labels: Record<TrainingCoverageItem["covered"], string> = {
    true: "已覆盖",
    false: "未覆盖",
    partial: "部分覆盖",
  };

  return labels[value] ?? value;
}

export function TrainingAnalysisPanel({
  analysis,
  analysisMessage,
  isAnalysisLoading,
  isEnded,
  transcriptText,
  onGenerateAnalysis,
}: TrainingAnalysisPanelProps) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            路演表现分析
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            基于本轮转写文本、翻页事件和项目上下文生成。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onGenerateAnalysis()}
          disabled={isAnalysisLoading || !isEnded || !transcriptText.trim()}
          className="inline-flex h-9 items-center justify-center rounded-md bg-slate-950 px-3 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isAnalysisLoading
            ? "分析中..."
            : analysis
              ? "重新生成分析"
              : "生成路演表现分析"}
        </button>
      </div>

      {!isEnded ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          结束路演后可生成分析。
        </p>
      ) : !transcriptText.trim() ? (
        <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          请先保存转写文本，再生成路演表现分析。
        </p>
      ) : null}

      {analysisMessage ? (
        <p className="mt-3 text-xs leading-5 text-slate-600">
          {analysisMessage}
        </p>
      ) : null}

      {analysis?.status === "FAILED" ? (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">
          {analysis.errorMessage ?? "路演表现分析生成失败。"}
        </p>
      ) : null}

      {analysis?.status === "COMPLETED" ? (
        <div className="mt-4 grid gap-4 text-sm">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">路演表现分</span>
              <strong className="text-xl font-semibold text-slate-950">
                {analysis.overallScore ?? "-"} / 100
              </strong>
            </div>
            <p className="mt-3 leading-6 text-slate-700">{analysis.summary}</p>
          </div>

          <AnalysisList title="优点" items={analysis.strengths} />
          <AnalysisList title="问题" items={analysis.weaknesses} />
          <AnalysisList title="改进建议" items={analysis.suggestions} />

          <div className="grid gap-3">
            <h3 className="text-base font-semibold text-slate-950">
              内容覆盖情况
            </h3>
            <div className="grid gap-2">
              {analysis.coverage.map((item) => (
                <div
                  key={item.item}
                  className="rounded-md border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-950">
                      {item.item}
                    </span>
                    <span className="text-slate-500">
                      {getCoverageLabel(item.covered)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    证据：{item.evidence}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    建议：{item.suggestion}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <AnalysisValue
            title="时间节奏"
            assessment={analysis.timing.assessment}
            suggestion={analysis.timing.suggestion}
          />
          <AnalysisValue
            title="翻页节奏"
            assessment={analysis.slideSync.assessment}
            suggestion={analysis.slideSync.suggestion}
          />
          <AnalysisList
            title="可能被追问的问题"
            items={analysis.riskQuestions}
          />
        </div>
      ) : null}
    </section>
  );
}

function AnalysisList({
  title,
  items,
}: Readonly<{ title: string; items: string[] }>) {
  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <ul className="grid gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="whitespace-pre-wrap text-sm leading-6 text-slate-700"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisValue({
  title,
  assessment,
  suggestion,
}: Readonly<{
  title: string;
  assessment: unknown;
  suggestion: unknown;
}>) {
  return (
    <div className="grid gap-3">
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {stringifyAnalysisValue(assessment)}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
        建议：{stringifyAnalysisValue(suggestion)}
      </p>
    </div>
  );
}
