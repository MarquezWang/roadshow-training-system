import Link from "next/link";

type TrainingReplayHeaderProps = Readonly<{
  sessionId: string;
  projectId: string;
  projectName: string;
}>;

export function TrainingReplayHeader({
  sessionId,
  projectId,
  projectName,
}: TrainingReplayHeaderProps) {
  return (
    <header className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs text-slate-500">路演回放</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-50">
          {projectName}
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          按训练时翻页记录同步查看材料、音频、转写和个人笔记。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/training/${sessionId}/report`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
        >
          查看报告
        </Link>
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex h-9 items-center justify-center rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
        >
          返回项目详情
        </Link>
      </div>
    </header>
  );
}
