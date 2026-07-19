import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ProjectForm } from "@/components/project-form";
import { getCurrentAccessUserId, withOwnerFilter } from "@/lib/auth-server";
import {
  assertTextLength,
  MAX_PROJECT_CONTACT_LENGTH,
  MAX_PROJECT_DETAIL_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SUMMARY_LENGTH,
} from "@/lib/input-limits";
import { prisma } from "@/lib/prisma";
import {
  isCooperationDemand,
  isProjectField,
} from "@/lib/project-profile";

type EditProjectPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

const getValue = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

async function updateProject(id: string, formData: FormData) {
  "use server";

  const limited = (key: string, label: string, maxLength: number) =>
    assertTextLength(getValue(formData, key), label, maxLength);
  const name = limited("name", "项目名称", MAX_PROJECT_NAME_LENGTH);
  const summary = limited("summary", "项目摘要", MAX_PROJECT_SUMMARY_LENGTH);
  const field = getValue(formData, "field");
  const stage = getValue(formData, "stage");
  const coreTechnology = limited(
    "coreTechnology",
    "技术关键词",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const applicationScenario = limited(
    "applicationScenario",
    "应用场景",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const cooperationDemands = [
    ...new Set(
      formData
        .getAll("cooperationDemand")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const cooperationDemandDetail = limited(
    "cooperationDemandDetail",
    "合作需求补充说明",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const needsConversionSupport =
    getValue(formData, "needsConversionSupport") === "true";
  const projectContact = limited(
    "projectContact",
    "项目联系人",
    MAX_PROJECT_CONTACT_LENGTH,
  );
  const contactPhone = getValue(formData, "contactPhone");

  if (
    !name ||
    !summary ||
    !isProjectField(field) ||
    !applicationScenario ||
    !coreTechnology ||
    !/^TRL [1-9]$/.test(stage)
  ) {
    throw new Error("请完整填写项目档案。");
  }

  if (
    needsConversionSupport &&
    (!projectContact || !/^1[3-9]\d{9}$/.test(contactPhone))
  ) {
    throw new Error("请填写项目联系人和有效的 11 位手机号。");
  }

  if (
    cooperationDemands.length === 0 ||
    cooperationDemands.some((demand) => !isCooperationDemand(demand)) ||
    (cooperationDemands.includes("其他") && !cooperationDemandDetail)
  ) {
    throw new Error("请完整填写合作需求。");
  }

  const userId = await getCurrentAccessUserId();
  const updated = await prisma.project.updateMany({
    where: withOwnerFilter({ id }, userId),
    data: {
      name,
      field,
      stage,
      summary,
      coreTechnology,
      applicationScenario,
      businessModel: limited(
        "businessModel",
        "商业模式",
        MAX_PROJECT_DETAIL_LENGTH,
      ),
      productForm: limited(
        "productForm",
        "产品形态",
        MAX_PROJECT_DETAIL_LENGTH,
      ),
      trlBasis: limited(
        "trlBasis",
        "TRL 判断依据",
        MAX_PROJECT_DETAIL_LENGTH,
      ),
      teamInfo: limited("teamInfo", "团队信息", MAX_PROJECT_DETAIL_LENGTH),
      cooperationDemand: cooperationDemands.join("、"),
      cooperationDemandDetail,
      needsConversionSupport,
      projectContact: needsConversionSupport ? projectContact : "",
      contactPhone: needsConversionSupport ? contactPhone : "",
    },
  });

  if (updated.count === 0) {
    notFound();
  }

  redirect(`/projects/${id}`);
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const userId = await getCurrentAccessUserId();
  const project = await prisma.project.findFirst({
    where: withOwnerFilter({ id }, userId),
    select: {
      id: true,
      name: true,
      field: true,
      stage: true,
      summary: true,
      coreTechnology: true,
      applicationScenario: true,
      businessModel: true,
      productForm: true,
      trlBasis: true,
      teamInfo: true,
      cooperationDemand: true,
      cooperationDemandDetail: true,
      needsConversionSupport: true,
      projectContact: true,
      contactPhone: true,
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
