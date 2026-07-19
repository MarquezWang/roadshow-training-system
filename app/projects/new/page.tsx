import { redirect } from "next/navigation";
import { NewProjectWizard } from "@/components/new-project-wizard";
import { PageHeader } from "@/components/page-header";
import { getCurrentAuthUserId } from "@/lib/auth-server";
import { removeProjectUpload } from "@/lib/file-upload";
import {
  assertTextLength,
  MAX_MATERIAL_TOKEN_LENGTH,
  MAX_PROJECT_CONTACT_LENGTH,
  MAX_PROJECT_DETAIL_LENGTH,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_SUMMARY_LENGTH,
} from "@/lib/input-limits";
import { prisma } from "@/lib/prisma";
import {
  deleteProjectMaterialRecord,
  discardReservedProjectMaterial,
  finalizeProjectMaterial,
  reserveProjectMaterial,
} from "@/lib/project-material-staging";
import {
  generatePowerPointPreviewPdf,
  isPowerPointFile,
} from "@/lib/powerpoint-preview";
import {
  isCooperationDemand,
  isProjectField,
} from "@/lib/project-profile";

const getValue = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

async function findProjectOwnerId(currentUserId: string | null) {
  if (currentUserId) {
    return currentUserId;
  }

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

  const name = assertTextLength(
    getValue(formData, "name"),
    "项目名称",
    MAX_PROJECT_NAME_LENGTH,
  );
  const summary = assertTextLength(
    getValue(formData, "summary"),
    "项目摘要",
    MAX_PROJECT_SUMMARY_LENGTH,
  );
  const field = getValue(formData, "field");
  const applicationScenario = assertTextLength(
    getValue(formData, "applicationScenario"),
    "应用场景",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const technicalKeywords = assertTextLength(
    getValue(formData, "technicalKeywords"),
    "技术关键词",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const trl = getValue(formData, "trl");
  const cooperationDemands = [
    ...new Set(
      formData
        .getAll("cooperationDemand")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const otherDemandDetail = assertTextLength(
    getValue(formData, "otherDemandDetail"),
    "其他合作需求",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const conversionSupport = getValue(formData, "conversionSupport");
  const needsConversionSupport = conversionSupport === "需要";
  const projectContact = assertTextLength(
    getValue(formData, "projectContact"),
    "项目联系人",
    MAX_PROJECT_CONTACT_LENGTH,
  );
  const contactPhone = getValue(formData, "contactPhone");
  const materialToken = assertTextLength(
    getValue(formData, "materialToken"),
    "材料令牌",
    MAX_MATERIAL_TOKEN_LENGTH,
  );
  const businessModel = assertTextLength(
    getValue(formData, "businessModel"),
    "商业模式",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const productForm = assertTextLength(
    getValue(formData, "productForm"),
    "产品形态",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const trlBasis = assertTextLength(
    getValue(formData, "trlReason"),
    "TRL 判断依据",
    MAX_PROJECT_DETAIL_LENGTH,
  );
  const teamInfo = assertTextLength(
    getValue(formData, "teamInfo"),
    "团队信息",
    MAX_PROJECT_DETAIL_LENGTH,
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

  if (!materialToken) {
    throw new Error("材料令牌无效，请重新上传材料。");
  }

  const currentUserId = await getCurrentAuthUserId();
  const ownerId = await findProjectOwnerId(currentUserId);
  const material = await reserveProjectMaterial(materialToken, currentUserId);
  let project: { id: string } | null = null;
  let savedFile: Awaited<ReturnType<typeof finalizeProjectMaterial>> | null = null;
  try {
    project = await prisma.project.create({
      data: {
        ownerId,
        name,
        field,
        stage: trl,
        summary,
        coreTechnology: technicalKeywords,
        applicationScenario,
        businessModel,
        cooperationDemand: cooperationDemands.join("、"),
        productForm,
        trlBasis,
        teamInfo,
        cooperationDemandDetail: cooperationDemands.includes("其他")
          ? otherDemandDetail
          : "",
        needsConversionSupport,
        projectContact: needsConversionSupport ? projectContact : "",
        contactPhone: needsConversionSupport ? contactPhone : "",
      },
      select: { id: true },
    });
    savedFile = await finalizeProjectMaterial(project.id, material);

    const fileAsset = await prisma.fileAsset.create({
      data: {
        projectId: project.id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
        fileSize: savedFile.fileSize,
        extractedText: material.extractedText,
        parseStatus: material.parseStatus,
        parseError: material.parseError,
      },
    });

    if (isPowerPointFile(savedFile)) {
      await generatePowerPointPreviewPdf({
        id: fileAsset.id,
        projectId: project.id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
      });
    }
    await deleteProjectMaterialRecord(material.id);
  } catch (error) {
    await Promise.allSettled([
      ...(project ? [prisma.project.delete({ where: { id: project.id } })] : []),
      ...(savedFile ? [removeProjectUpload(savedFile.filePath)] : []),
      ...(!savedFile
        ? [discardReservedProjectMaterial(material.id, material.filePath)]
        : [deleteProjectMaterialRecord(material.id)]),
    ]);
    throw error;
  }

  if (!project) {
    throw new Error("项目创建失败。");
  }
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
