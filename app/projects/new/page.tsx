import { redirect } from "next/navigation";
import { NewProjectWizard } from "@/components/new-project-wizard";
import { PageHeader } from "@/components/page-header";
import { parseFileToText } from "@/lib/file-parser";
import {
  saveProjectUpload,
  validateInitialProjectMaterial,
} from "@/lib/file-upload";
import { prisma } from "@/lib/prisma";
import {
  isCooperationDemand,
  isProjectField,
} from "@/lib/project-profile";

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
  const summary = getValue(formData, "summary");
  const field = getValue(formData, "field");
  const applicationScenario = getValue(formData, "applicationScenario");
  const technicalKeywords = getValue(formData, "technicalKeywords");
  const trl = getValue(formData, "trl");
  const cooperationDemands = [
    ...new Set(
      formData
        .getAll("cooperationDemand")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const otherDemandDetail = getValue(formData, "otherDemandDetail");
  const conversionSupport = getValue(formData, "conversionSupport");
  const needsConversionSupport = conversionSupport === "需要";
  const projectContact = getValue(formData, "projectContact");
  const contactPhone = getValue(formData, "contactPhone");
  const materials = formData
    .getAll("materials")
    .filter(
      (value): value is File =>
        value instanceof File && value.size > 0 && value.name.trim() !== "",
    );

  if (
    !name ||
    !summary ||
    !isProjectField(field) ||
    !applicationScenario ||
    !technicalKeywords ||
    !/^TRL [1-9]$/.test(trl)
  ) {
    throw new Error("请完整填写项目档案。");
  }

  if (
    cooperationDemands.length === 0 ||
    cooperationDemands.some((demand) => !isCooperationDemand(demand)) ||
    (cooperationDemands.includes("其他") && !otherDemandDetail)
  ) {
    throw new Error("请完整填写合作需求。");
  }

  if (conversionSupport !== "需要" && conversionSupport !== "暂不需要") {
    throw new Error("请选择是否需要成果转化机构协助对接。");
  }

  if (
    needsConversionSupport &&
    (!projectContact || !/^1[3-9]\d{9}$/.test(contactPhone))
  ) {
    throw new Error("请填写项目联系人和有效的 11 位手机号。");
  }

  const material = validateInitialProjectMaterial(materials);

  const ownerId = await findProjectOwnerId();
  const project = await prisma.project.create({
    data: {
      ownerId,
      name,
      field,
      stage: trl,
      summary,
      coreTechnology: technicalKeywords,
      applicationScenario,
      businessModel: "",
      cooperationDemand: cooperationDemands.join("、"),
      productForm: getValue(formData, "productForm"),
      trlBasis: getValue(formData, "trlReason"),
      cooperationDemandDetail: cooperationDemands.includes("其他")
        ? otherDemandDetail
        : "",
      needsConversionSupport,
      projectContact: needsConversionSupport ? projectContact : "",
      contactPhone: needsConversionSupport ? contactPhone : "",
    },
    select: {
      id: true,
    },
  });

  const savedFile = await saveProjectUpload(project.id, material);
  let extractedText: string | null = null;
  let parseStatus = "SUCCESS";
  let parseError: string | null = null;

  try {
    extractedText = await parseFileToText(
      savedFile.filePath,
      savedFile.fileType,
    );
  } catch (error) {
    parseStatus = "FAILED";
    parseError =
      error instanceof Error ? error.message : "文件解析失败，请稍后重试。";
  }

  await prisma.fileAsset.create({
    data: {
      projectId: project.id,
      originalName: savedFile.originalName,
      fileType: savedFile.fileType,
      filePath: savedFile.filePath,
      fileSize: savedFile.fileSize,
      extractedText,
      parseStatus,
      parseError,
    },
  });

  redirect(`/projects/${project.id}`);
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="新建项目"
        description="两步完成项目建档：上传材料并确认档案，再补充合作需求与转化对接信息。"
      />
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewProjectWizard action={createProject} />
      </section>
    </main>
  );
}
