import { PageHeader } from "@/components/page-header";
import { ProjectCard } from "@/components/project-card";
import { prisma } from "@/lib/prisma";

export default async function ProjectsPage() {
  const projects = await prisma.project.findMany({
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      field: true,
      stage: true,
      summary: true,
      cooperationDemand: true,
      createdAt: true,
    },
  });

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="项目管理"
        description="查看、新建和编辑路演项目基础信息。"
        action={{ href: "/projects/new", label: "新建项目" }}
      />

      {projects.length > 0 ? (
        <div className="mt-6 grid gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-base font-semibold text-slate-950">
            暂无项目
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            先创建一个项目，后续可继续补充材料诊断、评分和答辩训练。
          </p>
        </div>
      )}
    </main>
  );
}
