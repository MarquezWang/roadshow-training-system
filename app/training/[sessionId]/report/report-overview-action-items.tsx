"use client";

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
  return (
    <section className="rounded-lg border border-slate-100 bg-white p-6">
      <div className="flex flex-col gap-1 border-b border-slate-100 pb-4">
        <h2 className="text-sm font-semibold text-slate-800">
          可直接执行的修改建议
        </h2>
        <p className="text-xs text-slate-400">
          按“问题—影响—改法—参考话术”拆解，便于下一轮直接改稿。
        </p>
      </div>
      <div className="mt-4 grid gap-4">
        {actionItems.slice(0, 4).map((item, index) => (
          <div
            key={index}
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-4"
          >
            <p className="text-sm font-semibold text-slate-900">
              {index + 1}. {item.issue}
            </p>
            <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 lg:grid-cols-3">
              <p>
                <span className="font-medium text-slate-800">影响：</span>
                {item.whyItMatters}
              </p>
              <p>
                <span className="font-medium text-slate-800">改法：</span>
                {item.howToFix}
              </p>
              <p>
                <span className="font-medium text-slate-800">参考话术：</span>
                {item.sampleWording}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
