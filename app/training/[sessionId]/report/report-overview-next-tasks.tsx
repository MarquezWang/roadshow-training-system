"use client";

type ReportOverviewNextTasksProps = Readonly<{
  nextTrainingTasks: string[];
}>;

export function ReportOverviewNextTasks({
  nextTrainingTasks,
}: ReportOverviewNextTasksProps) {
  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-6">
      <h2 className="text-sm font-semibold text-blue-900">下一轮训练任务</h2>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {nextTrainingTasks.slice(0, 3).map((task, index) => (
          <div
            key={index}
            className="rounded-lg border border-blue-100 bg-white/80 p-4 text-sm leading-6 text-blue-950/80"
          >
            <p className="text-xs font-semibold text-blue-600">
              任务 {index + 1}
            </p>
            <p className="mt-2">{task}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
