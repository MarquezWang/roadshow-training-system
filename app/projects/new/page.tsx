import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/project-form";
import { prisma } from "@/lib/prisma";

const getValue = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

async function findProjectOwnerId() {
  const seedTeamUser = await prisma.user.findUnique({
    where: {
      email: "team@example.com",
    },
    select: {
      id: true,
    },
  });

  if (seedTeamUser) {
    return seedTeamUser.id;
  }

  const fallbackTeamUser = await prisma.user.findFirst({
    where: {
      role: "TEAM",
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  if (fallbackTeamUser) {
    return fallbackTeamUser.id;
  }

  const createdTeamUser = await prisma.user.create({
    data: {
      name: "项目团队用户",
      email: "team@example.com",
      role: "TEAM",
    },
    select: {
      id: true,
    },
  });

  return createdTeamUser.id;
}

async function createProject(formData: FormData) {
  "use server";

  const name = getValue(formData, "name");

  if (!name) {
    throw new Error("项目名称不能为空");
  }

  const ownerId = await findProjectOwnerId();
  const project = await prisma.project.create({
    data: {
      ownerId,
      name,
      field: getValue(formData, "field"),
      stage: getValue(formData, "stage"),
      summary: getValue(formData, "summary"),
      coreTechnology: getValue(formData, "coreTechnology"),
      applicationScenario: getValue(formData, "applicationScenario"),
      businessModel: getValue(formData, "businessModel"),
      cooperationDemand: getValue(formData, "cooperationDemand"),
    },
    select: {
      id: true,
    },
  });

  redirect(`/projects/${project.id}`);
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="新建项目"
        description="填写项目的基础路演信息，后续训练功能会基于这些内容展开。"
      />
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ProjectForm
          action={createProject}
          submitLabel="创建项目"
          cancelHref="/projects"
        />
      </section>
    </main>
  );
}
