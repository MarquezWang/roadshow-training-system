import Link from "next/link";

type ProjectCardProps = Readonly<{
  project: {
    id: string;
    name: string;
    field: string;
    stage: string;
    summary: string;
    cooperationDemand: string;
    createdAt: Date;
    _count: {
      fileAssets: number;
    };
  };
}>;

const excerpt = (value: string, length = 80) => {
  if (!value) {
    return "暂无";
  }

  return value.length > length ? `${value.slice(0, length)}...` : value;
};

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">
            {project.name}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-md bg-teal-50 px-2.5 py-1 text-teal-800">
              {project.field || "未填写赛道"}
            </span>
            <span className="rounded-md bg-slate-100 px-2.5 py-1 text-slate-700">
              {project.stage || "未填写阶段"}
            </span>
            <span
              className={
                project._count.fileAssets > 0
                  ? "rounded-md bg-cyan-50 px-2.5 py-1 text-cyan-800"
                  : "rounded-md bg-amber-50 px-2.5 py-1 text-amber-800"
              }
            >
              {project._count.fileAssets > 0
                ? `已上传 ${project._count.fileAssets} 份材料`
                : "暂无材料"}
            </span>
          </div>
        </div>
        <p className="text-sm text-slate-500">{formatDate(project.createdAt)}</p>
      </div>

      <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-600">
        <p>
          <span className="font-medium text-slate-900">项目简介：</span>
          {excerpt(project.summary)}
        </p>
        <p>
          <span className="font-medium text-slate-900">合作/融资诉求：</span>
          {excerpt(project.cooperationDemand)}
        </p>
      </div>

      <div className="mt-5">
        <Link
          href={`/projects/${project.id}`}
          className="text-sm font-medium text-teal-700 hover:text-teal-900"
        >
          查看项目
        </Link>
      </div>
    </article>
  );
}
