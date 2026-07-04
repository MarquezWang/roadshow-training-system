export type ContentCoverageItem = {
  item: string;
  covered: string;
  evidence: string;
  suggestion: string;
};

export function ReportPitchCoverage({
  contentCoverage,
  showAllCoverage,
  onToggleShowAllCoverage,
}: Readonly<{
  contentCoverage: ContentCoverageItem[];
  showAllCoverage: boolean;
  onToggleShowAllCoverage: () => void;
}>) {
  if (contentCoverage.length === 0) return null;

  return (
    <div className="rounded-md border border-slate-100 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-800">
        内容覆盖与证据充分性
      </h4>
      <div className="mt-3 grid gap-2.5">
        {(showAllCoverage ? contentCoverage : contentCoverage.slice(0, 5)).map(
          (item, index) => {
            const coveredLabel =
              item.covered === "true"
                ? "证据较充分"
                : item.covered === "partial"
                  ? "提到但证据不足"
                  : "未充分覆盖";
            const coveredColor =
              item.covered === "true"
                ? "text-emerald-600 bg-emerald-50"
                : item.covered === "partial"
                  ? "text-amber-600 bg-amber-50"
                  : "text-red-500 bg-red-50";

            return (
              <div key={index} className="rounded border border-slate-100 p-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-medium text-slate-800">
                    {item.item}
                  </span>
                  <span
                    className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium ${coveredColor}`}
                  >
                    {coveredLabel}
                  </span>
                </div>
                {item.evidence ? (
                  <p className="mt-2 text-xs text-slate-500">
                    证据：{item.evidence}
                  </p>
                ) : null}
                {item.suggestion ? (
                  <p className="mt-1 text-xs text-blue-600">
                    建议：{item.suggestion}
                  </p>
                ) : null}
              </div>
            );
          },
        )}
      </div>
      {contentCoverage.length > 5 ? (
        <button
          type="button"
          onClick={onToggleShowAllCoverage}
          className="mt-3 text-xs font-medium text-blue-500 transition-colors hover:text-blue-700"
        >
          {showAllCoverage ? "收起" : `展开全部（${contentCoverage.length} 项）`}
        </button>
      ) : null}
    </div>
  );
}
