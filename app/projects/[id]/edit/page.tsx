import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/project-form";
import { prisma } from "@/lib/prisma";

type EditProjectPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

const getValue = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

async function updateProject(id: string, formData: FormData) {
  "use server";

  const name = getValue(formData, "name");

  if (!name) {
    throw new Error("项目名称不能为空");
  }

  await prisma.project.update({
    where: {
      id,
    },
    data: {
      name,
      field: getValue(formData, "field"),
      stage: getValue(formData, "stage"),
      summary: getValue(formData, "summary"),
      coreTechnology: getValue(formData, "coreTechnology"),
      applicationScenario: getValue(formData, "applicationScenario"),
      businessModel: getValue(formData, "businessModel"),
      cooperationDemand: getValue(formData, "cooperationDemand"),
    },
  });

  redirect(`/projects/${id}`);
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: {
      id,
    },
    select: {
      id: true,
      name: true,
      field: true,
      stage: true,
      summary: true,
      coreTechnology: true,
      applicationScenario: true,
      businessModel: true,
      cooperationDemand: true,
    },
  });

  if (!project) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="编辑项目"
        description={`正在编辑：${project.name}`}
      />
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ProjectForm
          action={updateProject.bind(null, project.id)}
          submitLabel="保存修改"
          cancelHref={`/projects/${project.id}`}
          initialValues={project}
        />
      </section>
    </main>
  );
}
