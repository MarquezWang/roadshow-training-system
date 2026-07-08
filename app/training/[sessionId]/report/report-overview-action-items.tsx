"use client";

import { useCallback, useState } from "react";

type ActionItem = {
  issue: string;
  whyItMatters: string;
  howToFix: string;
  sampleWording: string;
};

type ReportOverviewActionItemsProps = Readonly<{
  actionItems: ActionItem[];
}>;

export function ReportOverviewActionItems({
  actionItems,
}: ReportOverviewActionItemsProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const toggleRow = useCallback((index: number) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  }, []);

  const copySampleWording = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex(null), 1600);
    } catch {
      setCopiedIndex(null);
    }
  }, []);

  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-950 text-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400">
            行动清单
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            可直接执行的修改建议
            <span className="ml-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-semibold text-slate-300">
              {actionItems.length}
            </span>
          </h2>
        </div>
        <p className="text-xs text-slate-400">
          默认收起长文本，展开后可复制参考话术。
        </p>
      </div>
      <div className="divide-y divide-white/10">
        {actionItems.slice(0, 4).map((item, index) => (
          <div
            key={index}
            className="bg-white/[0.02]"
          >
            <button
              type="button"
              onClick={() => toggleRow(index)}
              className="grid w-full gap-4 px-5 py-4 text-left transition-colors hover:bg-white/[0.04] lg:grid-cols-[120px_minmax(0,1fr)_minmax(0,1.2fr)_80px]"
              aria-expanded={expandedRows.has(index)}
            >
              <span className="text-xs font-semibold text-teal-300">
                优先级 {index + 1}
              </span>
              <span className="text-sm font-semibold leading-6 text-white">
                {item.issue}
              </span>
              <span className="text-sm leading-6 text-slate-300">
                {item.whyItMatters}
              </span>
              <span className="text-xs font-semibold text-slate-400 lg:text-right">
                {expandedRows.has(index) ? "收起" : "展开"}
              </span>
            </button>
            {expandedRows.has(index) ? (
              <div className="grid gap-3 border-t border-white/10 px-5 pb-5 pt-1 lg:grid-cols-2">
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                  <p className="text-xs font-semibold text-slate-400">改法</p>
                  <p className="mt-2">{item.howToFix}</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-slate-400">
                      参考话术
                    </p>
                    <button
                      type="button"
                      onClick={() => void copySampleWording(item.sampleWording, index)}
                      className="inline-flex h-7 items-center rounded-md border border-white/10 px-2 text-xs font-semibold text-slate-200 transition-colors hover:border-teal-300/50 hover:bg-teal-300/10"
                    >
                      {copiedIndex === index ? "已复制" : "复制"}
                    </button>
                  </div>
                  <p className="mt-2">{item.sampleWording}</p>
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
