import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { formatFileSize, saveProjectUpload } from "@/lib/file-upload";
import { parseFileToText } from "@/lib/file-parser";
import {
  extractProjectProfileFromText,
  formatTrlStage,
} from "@/lib/project-profile-ai";
import { prisma } from "@/lib/prisma";

type NewProjectPageProps = Readonly<{
  searchParams: Promise<{
    aiError?: string;
    parseError?: string;
    profileStatus?: string;
    projectId?: string;
    step?: string;
    uploadError?: string;
  }>;
}>;

const steps = [
  { key: "upload", label: "上传材料" },
  { key: "confirm", label: "确认档案" },
  { key: "manual", label: "补充信息" },
] as const;

const trlOptions = [
  { value: 1, label: "TRL 1 基础原理阶段" },
  { value: 2, label: "TRL 2 技术概念阶段" },
  { value: 3, label: "TRL 3 原理验证阶段" },
  { value: 4, label: "TRL 4 实验室样机阶段" },
  { value: 5, label: "TRL 5 相关环境验证阶段" },
  { value: 6, label: "TRL 6 工程样机验证阶段" },
  { value: 7, label: "TRL 7 真实场景试点阶段" },
  { value: 8, label: "TRL 8 定型应用阶段" },
  { value: 9, label: "TRL 9 成熟应用阶段" },
] as const;

const inputClass =
  "mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";
const textareaClass = `${inputClass} min-h-24`;

const getValue = (formData: FormData, key: string) =>
  String(formData.get(key) ?? "").trim();

function getOptionalTrlLevel(formData: FormData) {
  const value = getValue(formData, "trlLevel");

  if (!value) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 9) {
    return null;
  }

  return numericValue;
}

function redirectToWizard(params: Record<string, string>) {
  const query = new URLSearchParams(params);

  redirect(`/projects/new?${query.toString()}`);
}

function getFallbackProjectName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "待确认项目";
}

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

async function uploadAndRecognizeProject(formData: FormData) {
  "use server";

  const file = formData.get("file");

  if (!(file instanceof File)) {
    redirectToWizard({ uploadError: "请选择需要上传的项目材料。" });
  }

  const ownerId = await findProjectOwnerId();
  const fallbackName = getFallbackProjectName(file.name);
  const project = await prisma.project.create({
    data: {
      ownerId,
      name: fallbackName,
      field: "",
      stage: "",
      summary: "",
      coreTechnology: "",
      applicationScenario: "",
      businessModel: "",
      cooperationDemand: "",
      productForm: "",
      trlLevel: null,
      trlReason: "",
      teamInfo: "",
      currentProgress: "",
    },
    select: {
      id: true,
    },
  });

  let savedFile: Awaited<ReturnType<typeof saveProjectUpload>>;

  try {
    savedFile = await saveProjectUpload(project.id, file);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件保存失败。";

    redirectToWizard({ uploadError: message });
  }

  let extractedText = "";

  try {
    extractedText = await parseFileToText(savedFile.filePath, savedFile.fileType);

    await prisma.fileAsset.create({
      data: {
        projectId: project.id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
        fileSize: savedFile.fileSize,
        parseStatus: "SUCCESS",
        extractedText,
        parseError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件解析失败。";

    await prisma.fileAsset.create({
      data: {
        projectId: project.id,
        originalName: savedFile.originalName,
        fileType: savedFile.fileType,
        filePath: savedFile.filePath,
        fileSize: savedFile.fileSize,
        parseStatus: "FAILED",
        extractedText: null,
        parseError: message,
      },
    });

    redirectToWizard({
      projectId: project.id,
      step: "confirm",
      parseError: message,
    });
  }

  try {
    const profile = await extractProjectProfileFromText(savedFile.originalName, extractedText);

    await prisma.project.update({
      where: {
        id: project.id,
      },
      data: {
        name: profile.name || fallbackName,
        summary: profile.summary,
        field: profile.field,
        applicationScenario: profile.applicationScenario,
        coreTechnology: profile.technicalKeywords.join("、"),
        productForm: profile.productForm,
        trlLevel: profile.trlLevel,
        stage: formatTrlStage(profile.trlLevel),
        trlReason: profile.trlReason,
        currentProgress: profile.currentProgress,
      },
    });

    redirectToWizard({
      projectId: project.id,
      step: "confirm",
      profileStatus: "success",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "项目档案识别失败。";

    redirectToWizard({
      projectId: project.id,
      step: "confirm",
      aiError: message,
    });
  }
}

async function confirmExtractedProfile(formData: FormData) {
  "use server";

  const projectId = getValue(formData, "projectId");
  const name = getValue(formData, "name");
  const trlLevel = getOptionalTrlLevel(formData);

  if (!projectId) {
    redirectToWizard({ uploadError: "项目草稿不存在，请重新上传材料。" });
  }

  if (!name) {
    redirectToWizard({
      projectId,
      step: "confirm",
      aiError: "项目名称不能为空。",
    });
  }

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      name,
      summary: getValue(formData, "summary"),
      field: getValue(formData, "field"),
      applicationScenario: getValue(formData, "applicationScenario"),
      coreTechnology: getValue(formData, "coreTechnology"),
      productForm: getValue(formData, "productForm"),
      trlLevel,
      stage: getValue(formData, "stage") || formatTrlStage(trlLevel),
      trlReason: getValue(formData, "trlReason"),
    },
  });

  redirectToWizard({ projectId, step: "manual" });
}

async function completeProjectProfile(formData: FormData) {
  "use server";

  const projectId = getValue(formData, "projectId");

  if (!projectId) {
    redirectToWizard({ uploadError: "项目草稿不存在，请重新上传材料。" });
  }

  await prisma.project.update({
    where: {
      id: projectId,
    },
    data: {
      teamInfo: getValue(formData, "teamInfo"),
      cooperationDemand: getValue(formData, "cooperationDemand"),
      currentProgress: getValue(formData, "currentProgress"),
    },
  });

  redirect(`/projects/${projectId}`);
}

function StepIndicator({ currentStep }: { currentStep: string }) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === currentStep),
  );

  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => {
        const isActive = step.key === currentStep;
        const isDone = index < currentIndex;

        return (
          <li
            key={step.key}
            className={`rounded-lg border px-4 py-3 text-sm ${
              isActive
                ? "border-slate-950 bg-slate-950 text-white"
                : isDone
                  ? "border-teal-200 bg-teal-50 text-teal-800"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className="font-semibold">{index + 1}. </span>
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function Alert({ type, children }: Readonly<{ type: "success" | "warning" | "error"; children: React.ReactNode }>) {
  const className = {
    success: "border-teal-200 bg-teal-50 text-teal-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-700",
  }[type];

  return (
    <p className={`rounded-md border px-3 py-2 text-sm leading-6 ${className}`}>
      {children}
    </p>
  );
}

function FieldLabel({ children, required }: Readonly<{ children: React.ReactNode; required?: boolean }>) {
  return (
    <span className="text-sm font-medium text-slate-900">
      {children}
      {required ? <span className="text-red-600"> *</span> : null}
    </span>
  );
}

function UploadStep({ uploadError }: Readonly<{ uploadError?: string }>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-base font-semibold text-slate-950">上传项目材料</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          先上传路演 PPTX、PDF、DOCX 或 TXT。系统会解析材料，并自动识别项目名称、领域、应用场景、技术关键词和 TRL 成熟度。
        </p>
      </div>

      <form action={uploadAndRecognizeProject} className="mt-5 grid gap-5">
        {uploadError ? <Alert type="error">{uploadError}</Alert> : null}

        <label className="block">
          <FieldLabel required>项目材料</FieldLabel>
          <input
            name="file"
            type="file"
            required
            accept=".pptx,.pdf,.docx,.txt,application/pdf,text/plain"
            className="mt-2 block w-full rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-950 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:bg-slate-100"
          />
        </label>

        <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm leading-6 text-cyan-900">
          这里不会设置路演时长、答辩时长或评分规则。训练参数后续由赛事专题或自定义训练入口决定。
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          <Link
            href="/projects"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            返回项目列表
          </Link>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            上传并识别项目
          </button>
        </div>
      </form>
    </section>
  );
}

function ConfirmStep({
  aiError,
  parseError,
  profileStatus,
  project,
}: Readonly<{
  aiError?: string;
  parseError?: string;
  profileStatus?: string;
  project: NonNullable<Awaited<ReturnType<typeof getWizardProject>>>;
}>) {
  const firstFile = project.fileAssets[0];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-base font-semibold text-slate-950">确认 AI 识别结果</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          系统已生成项目档案草稿。请确认必要字段，尤其是 TRL 成熟度，AI 只能作为推测，最终以你确认的版本为准。
        </p>
      </div>

      <form action={confirmExtractedProfile} className="mt-5 grid gap-5">
        <input type="hidden" name="projectId" value={project.id} />

        {profileStatus === "success" ? (
          <Alert type="success">项目档案已根据材料自动识别，请确认后继续。</Alert>
        ) : null}
        {parseError ? <Alert type="error">材料解析失败：{parseError}</Alert> : null}
        {aiError ? <Alert type="warning">AI 识别未完成：{aiError}</Alert> : null}

        {firstFile ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
            已上传：{firstFile.originalName}（{formatFileSize(firstFile.fileSize)}）
          </div>
        ) : null}

        <label className="block">
          <FieldLabel required>项目名称</FieldLabel>
          <input name="name" defaultValue={project.name} required className={inputClass} />
        </label>

        <label className="block">
          <FieldLabel required>一句话简介</FieldLabel>
          <textarea
            name="summary"
            defaultValue={project.summary}
            required
            rows={3}
            className={textareaClass}
          />
        </label>

        <label className="block">
          <FieldLabel required>所属领域</FieldLabel>
          <input name="field" defaultValue={project.field} required className={inputClass} />
        </label>

        <label className="block">
          <FieldLabel required>应用场景</FieldLabel>
          <textarea
            name="applicationScenario"
            defaultValue={project.applicationScenario}
            required
            rows={3}
            className={textareaClass}
          />
        </label>

        <label className="block">
          <FieldLabel required>技术关键词</FieldLabel>
          <textarea
            name="coreTechnology"
            defaultValue={project.coreTechnology}
            required
            rows={3}
            className={textareaClass}
          />
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            可用顿号、逗号或换行分隔。
          </span>
        </label>

        <label className="block">
          <FieldLabel>产品形态</FieldLabel>
          <input
            name="productForm"
            defaultValue={project.productForm}
            placeholder="如：软件平台、硬件设备、系统方案、算法模型、材料工艺"
            className={inputClass}
          />
        </label>

        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <label className="block">
            <FieldLabel>TRL 等级</FieldLabel>
            <select
              name="trlLevel"
              defaultValue={project.trlLevel ?? ""}
              className={inputClass}
            >
              <option value="">暂不确定</option>
              {trlOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <FieldLabel>成熟度描述</FieldLabel>
            <input
              name="stage"
              defaultValue={project.stage}
              placeholder="如：TRL 6 工程样机验证阶段"
              className={inputClass}
            />
          </label>
        </div>

        <label className="block">
          <FieldLabel>TRL 判断依据</FieldLabel>
          <textarea
            name="trlReason"
            defaultValue={project.trlReason}
            rows={3}
            className={textareaClass}
          />
        </label>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
          <Link
            href="/projects/new"
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            重新上传
          </Link>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            下一步：补充人工信息
          </button>
        </div>
      </form>
    </section>
  );
}

function ManualStep({
  project,
}: Readonly<{
  project: NonNullable<Awaited<ReturnType<typeof getWizardProject>>>;
}>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-base font-semibold text-slate-950">补充人工信息</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          团队/单位信息和合作需求不建议由 AI 猜测。这里填写的是你希望后续训练与答辩重点真正围绕的口径。
        </p>
      </div>

      <form action={completeProjectProfile} className="mt-5 grid gap-5">
        <input type="hidden" name="projectId" value={project.id} />

        <label className="block">
          <FieldLabel>团队/单位信息</FieldLabel>
          <textarea
            name="teamInfo"
            defaultValue={project.teamInfo}
            rows={4}
            placeholder="填写项目团队、所在单位、核心成员或承担主体。"
            className={textareaClass}
          />
        </label>

        <label className="block">
          <FieldLabel>合作需求</FieldLabel>
          <textarea
            name="cooperationDemand"
            defaultValue={project.cooperationDemand}
            rows={4}
            placeholder="填写场景试点、产业合作、客户导入、投融资对接、进入下一轮路演等真实诉求。"
            className={textareaClass}
          />
        </label>

        <label className="block">
          <FieldLabel>当前已有进展</FieldLabel>
          <textarea
            name="currentProgress"
            defaultValue={project.currentProgress}
            rows={4}
            placeholder="可填写样机、Demo、测试报告、专利、软著、试点、客户、订单、获奖或立项情况。"
            className={textareaClass}
          />
        </label>

        <div className="rounded-md border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm leading-6 text-cyan-900">
          创建完成后将进入项目工作台。材料上传、解析状态、纳入 AI 上下文和后续训练入口仍在项目详情页管理。
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-between">
          <Link
            href={`/projects/new?projectId=${project.id}&step=confirm`}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            上一步
          </Link>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            完成建档
          </button>
        </div>
      </form>
    </section>
  );
}

async function getWizardProject(projectId?: string) {
  if (!projectId) {
    return null;
  }

  return prisma.project.findUnique({
    where: {
      id: projectId,
    },
    select: {
      id: true,
      name: true,
      field: true,
      stage: true,
      summary: true,
      coreTechnology: true,
      applicationScenario: true,
      cooperationDemand: true,
      productForm: true,
      trlLevel: true,
      trlReason: true,
      teamInfo: true,
      currentProgress: true,
      fileAssets: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        select: {
          originalName: true,
          fileSize: true,
        },
      },
    },
  });
}

export default async function NewProjectPage({ searchParams }: NewProjectPageProps) {
  const {
    aiError,
    parseError,
    profileStatus,
    projectId,
    step: requestedStep,
    uploadError,
  } = await searchParams;
  const project = await getWizardProject(projectId);
  const currentStep = project ? requestedStep ?? "confirm" : "upload";

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title="新建项目"
        description="上传项目材料，确认 AI 识别结果，再补充团队与合作需求。训练参数后续由专题训练入口决定。"
      />

      <div className="mt-6">
        <StepIndicator currentStep={currentStep} />
      </div>

      <div className="mt-6">
        {!project ? <UploadStep uploadError={uploadError} /> : null}
        {project && currentStep !== "manual" ? (
          <ConfirmStep
            aiError={aiError}
            parseError={parseError}
            profileStatus={profileStatus}
            project={project}
          />
        ) : null}
        {project && currentStep === "manual" ? <ManualStep project={project} /> : null}
      </div>
    </main>
  );
}
