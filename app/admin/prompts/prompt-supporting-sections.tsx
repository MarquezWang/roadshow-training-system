import type { PromptTestSuite } from "./prompt-types";

export function PromptSupportingSections({
  testSuites,
  changelogItems,
}: {
  testSuites: PromptTestSuite[];
  changelogItems: string[];
}) {
  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">测试样本</h2>
        <div className="mt-4 grid gap-3">
          {testSuites.length > 0 ? (
            testSuites.map((suite) => (
              <div
                key={suite.name}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3"
              >
                <span className="font-mono text-sm text-slate-700">
                  prompt-tests/{suite.name}
                </span>
                <span className="text-sm text-slate-500">
                  {suite.count} 个样本
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无测试样本。</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">
          最近 Prompt 记录
        </h2>
        <div className="mt-4 grid gap-3">
          {changelogItems.length > 0 ? (
            changelogItems.map((item) => (
              <div
                key={item}
                className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                {item}
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">暂无变更记录。</p>
          )}
        </div>
      </div>
    </section>
  );
}
