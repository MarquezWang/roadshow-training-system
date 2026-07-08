"use client";

type ReportOverviewNextTasksProps = Readonly<{
  nextTrainingTasks: string[];
}>;

export function ReportOverviewNextTasks({
  nextTrainingTasks,
}: ReportOverviewNextTasksProps) {
  return (
    <section className="rounded-lg border border-teal-900/70 bg-[#071512] p-6 text-white shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-teal-300">
            下轮训练
          </p>
          <h2 className="mt-2 text-lg font-semibold">
            下一轮训练任务
            <span className="ml-2 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-semibold text-slate-300">
              {nextTrainingTasks.length}
            </span>
          </h2>
        </div>
        <p className="text-xs text-slate-400">建议按顺序完成前三项。</p>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {nextTrainingTasks.slice(0, 3).map((task, index) => (
          <div
            key={index}
            className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-slate-200"
          >
            <p className="text-xs font-semibold text-teal-300">
              任务 {index + 1}
            </p>
            <p className="mt-2">{task}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
