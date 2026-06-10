import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { formatFileSize } from "@/lib/file-upload";
import { prisma } from "@/lib/prisma";

type ProjectDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    uploadError?: string;
    uploadStatus?: string;
    parseError?: string;
    parseStatus?: string;
    contextError?: string;
    contextStatus?: string;
    diagnosisError?: string;
    diagnosisStatus?: string;
    scoringError?: string;
    scoringStatus?: string;
    questionError?: string;
    questionStatus?: string;
  }>;
}>;

type DiagnosisIssues = {
  keyIssues: string[];
};

type DiagnosisSuggestions = {
  priorityActions: string[];
  source?: string;
};

type ScoreDetail = {
  categoryScores: Array<{
    category: string;
    maxScore: number;
    score: number;
    reason: string;
  }>;
  scoreItems: Array<{
    category: string;
    criterion: string;
    maxScore: number;
    score: number;
    reason: string;
    deductionReason: string;
    suggestion: string;
    evidence?: {
      evidenceText: string;
      evidenceLocation: string;
    };
  }>;
  scoreWarnings: string[];
};

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

const trainingStatusLabel: Record<string, string> = {
  CREATED: "待开始",
  PITCHING: "路演中",
  PITCH_ENDED: "路演已结束",
  QA_READY: "问答准备中",
  FINISHED: "已完成",
};

function formatDurationSec(durationSec: number | null) {
  if (durationSec === null) {
    return "未记录";
  }

  const minutes = Math.floor(durationSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (durationSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

const projectFields = [
  { key: "field", label: "所属赛道" },
  { key: "stage", label: "项目阶段" },
  { key: "summary", label: "项目简介" },
  { key: "coreTechnology", label: "核心技术" },
  { key: "applicationScenario", label: "应用场景" },
  { key: "businessModel", label: "商业模式" },
  { key: "cooperationDemand", label: "合作/融资诉求" },
] as const;

const parseStatusLabel: Record<string, string> = {
  PENDING: "待解析",
  SUCCESS: "已解析",
  FAILED: "解析失败",
};

const textPreview = (text: string) =>
  text.length > 500 ? `${text.slice(0, 500)}...` : text;

function parseJsonValue<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseDiagnosisIssues(value: string) {
  const parsed = parseJsonValue<Partial<DiagnosisIssues>>(value, {});

  return {
    keyIssues: Array.isArray(parsed.keyIssues)
      ? parsed.keyIssues.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function parseDiagnosisRisks(value: string) {
  const parsed = parseJsonValue<unknown>(value, []);

  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

function parseDiagnosisSuggestions(value: string) {
  const parsed = parseJsonValue<Partial<DiagnosisSuggestions>>(value, {});

  return {
    priorityActions: Array.isArray(parsed.priorityActions)
      ? parsed.priorityActions.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
    source: typeof parsed.source === "string" ? parsed.source : undefined,
  };
}

function parseScoreDetail(value: string): ScoreDetail {
  const parsed = parseJsonValue<Partial<ScoreDetail>>(value, {});

  return {
    categoryScores: Array.isArray(parsed.categoryScores)
      ? parsed.categoryScores.filter(
          (item): item is ScoreDetail["categoryScores"][number] =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof item.category === "string" &&
            typeof item.maxScore === "number" &&
            typeof item.score === "number" &&
            typeof item.reason === "string",
        )
      : [],
    scoreItems: Array.isArray(parsed.scoreItems)
      ? parsed.scoreItems.filter(
          (item): item is ScoreDetail["scoreItems"][number] =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof item.category === "string" &&
            typeof item.criterion === "string" &&
            typeof item.maxScore === "number" &&
            typeof item.score === "number" &&
            typeof item.reason === "string" &&
            typeof item.deductionReason === "string" &&
            typeof item.suggestion === "string",
        ).map((item) => ({
          ...item,
          evidence:
            item.evidence &&
            typeof item.evidence === "object" &&
            typeof item.evidence.evidenceText === "string"
              ? {
                  evidenceText: item.evidence.evidenceText,
                  evidenceLocation:
                    typeof item.evidence.evidenceLocation === "string"
                      ? item.evidence.evidenceLocation
                      : "",
                }
              : undefined,
        }))
      : [],
    scoreWarnings: Array.isArray(parsed.scoreWarnings)
      ? parsed.scoreWarnings.filter((item): item is string => typeof item === "string")
      : [],
  };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const {
    uploadError,
    uploadStatus,
    parseError,
    parseStatus,
    contextError,
    contextStatus,
    diagnosisError,
    diagnosisStatus,
    scoringError,
    scoringStatus,
    questionError,
    questionStatus,
  } = await searchParams;
  const project = await prisma.project.findUnique({
    where: {
      id,
    },
    include: {
      fileAssets: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          originalName: true,
          fileType: true,
          fileSize: true,
          extractedText: true,
          parseStatus: true,
          parseError: true,
          includeInAIContext: true,
          createdAt: true,
        },
      },
      diagnoses: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          summary: true,
          completeness: true,
          issues: true,
          risks: true,
          suggestions: true,
          createdAt: true,
        },
      },
      scoreResults: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          totalScore: true,
          scoreDetail: true,
          comments: true,
          createdAt: true,
          rule: {
            select: {
              name: true,
              version: true,
            },
          },
        },
      },
      questions: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          type: true,
          perspective: true,
          content: true,
          focus: true,
          suggestedDirection: true,
          evidenceText: true,
          evidenceLocation: true,
          factCheckNote: true,
          createdAt: true,
        },
      },
      trainingSessions: {
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        select: {
          id: true,
          status: true,
          pitchDurationSec: true,
          currentPageIndex: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          fileAssets: true,
          diagnoses: true,
          scoreResults: true,
          questions: true,
          reports: true,
        },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const stats = [
    { label: "上传文件", value: project._count.fileAssets },
    { label: "材料诊断", value: project._count.diagnoses },
    { label: "评分结果", value: project._count.scoreResults },
    { label: "模拟问题", value: project._count.questions },
    { label: "综合报告", value: project._count.reports },
  ];
  const latestDiagnosis = project.diagnoses[0];
  const latestDiagnosisIssues = latestDiagnosis
    ? parseDiagnosisIssues(latestDiagnosis.issues)
    : null;
  const latestDiagnosisRisks = latestDiagnosis
    ? parseDiagnosisRisks(latestDiagnosis.risks)
    : [];
  const latestDiagnosisSuggestions = latestDiagnosis
    ? parseDiagnosisSuggestions(latestDiagnosis.suggestions)
    : null;
  const latestScoreResult = project.scoreResults[0];
  const latestScoreDetail = latestScoreResult
    ? parseScoreDetail(latestScoreResult.scoreDetail)
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 sm:px-8 lg:px-10">
      <PageHeader
        title={project.name}
        description="查看项目完整基础信息、训练数据统计和已上传材料。"
      />

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/projects"
          className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          返回项目列表
        </Link>
        <Link
          href={`/projects/${project.id}/edit`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          编辑项目
        </Link>
        <Link
          href={`/projects/${project.id}/ai-context`}
          target="_blank"
          className="inline-flex h-10 items-center justify-center rounded-md border border-teal-200 bg-teal-50 px-4 text-sm font-medium text-teal-800 transition-colors hover:bg-teal-100"
        >
          查看 AI 上下文
        </Link>
        <form
          action={`/projects/${project.id}/training-sessions?redirect=1`}
          method="post"
        >
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            开始路演训练
          </button>
        </form>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">
              {item.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 pb-5">
          <h2 className="text-base font-semibold text-slate-950">训练记录</h2>
          <p className="text-sm text-slate-600">
            查看最近几次路演训练场次，继续回看训练状态、用时和当前页码。
          </p>
        </div>

        {project.trainingSessions.length > 0 ? (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                    创建时间
                  </th>
                  <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                    状态
                  </th>
                  <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                    路演用时
                  </th>
                  <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                    当前页码
                  </th>
                  <th className="border-b border-slate-200 py-2 font-medium">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {project.trainingSessions.map((session) => (
                  <tr key={session.id} className="align-middle">
                    <td className="border-b border-slate-100 py-3 pr-4 text-slate-700">
                      {formatDateTime(session.createdAt)}
                    </td>
                    <td className="border-b border-slate-100 py-3 pr-4 text-slate-700">
                      {trainingStatusLabel[session.status] ?? session.status}
                    </td>
                    <td className="border-b border-slate-100 py-3 pr-4 text-slate-700">
                      {formatDurationSec(session.pitchDurationSec)}
                    </td>
                    <td className="border-b border-slate-100 py-3 pr-4 text-slate-700">
                      {session.currentPageIndex + 1}
                    </td>
                    <td className="border-b border-slate-100 py-3">
                      <Link
                        href={`/training/${session.id}`}
                        className="text-sm font-medium text-teal-700 hover:text-teal-900"
                      >
                        查看训练
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              暂无训练记录
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              点击“开始路演训练”创建第一条训练场次。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">AI 评分</h2>
            <p className="mt-2 text-sm text-slate-600">
              严格依据路演大赛真实评审规则的 12 条指标评分，只使用已纳入 AI 分析的解析文本。
            </p>
          </div>
          <form action={`/projects/${project.id}/scoring`} method="post">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              生成 AI 评分
            </button>
          </form>
        </div>

        {scoringStatus === "success" ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            AI 评分已生成。
          </p>
        ) : null}

        {scoringError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {scoringError}
          </p>
        ) : null}

        {latestScoreResult && latestScoreDetail ? (
          <div className="mt-5 grid gap-5">
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">
                    最近一次评分
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {latestScoreResult.rule
                      ? `${latestScoreResult.rule.name} ${latestScoreResult.rule.version}`
                      : "未关联评审规则"}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-3xl font-semibold text-slate-950">
                    {latestScoreResult.totalScore}
                    <span className="text-base font-medium text-slate-500">
                      /100
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(latestScoreResult.createdAt)}
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {latestScoreDetail.categoryScores.map((item) => (
                  <div
                    key={item.category}
                    className="rounded-md border border-slate-200 bg-white p-3"
                  >
                    <p className="text-xs font-medium text-slate-500">
                      {item.category}
                    </p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">
                      {item.score}
                      <span className="text-sm font-medium text-slate-500">
                        /{item.maxScore}
                      </span>
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {item.reason}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <p className="text-xs font-medium text-slate-500">综合评价</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                  {latestScoreResult.comments}
                </p>
              </div>

              {latestScoreDetail.scoreWarnings.length ? (
                <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-800">评分提醒</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-amber-900">
                    {latestScoreDetail.scoreWarnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                        一级指标
                      </th>
                      <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                        二级指标
                      </th>
                      <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                        得分
                      </th>
                      <th className="border-b border-slate-200 py-2 pr-4 font-medium">
                        主要扣分原因
                      </th>
                      <th className="border-b border-slate-200 py-2 font-medium">
                        修改建议
                      </th>
                      <th className="border-b border-slate-200 py-2 pl-4 font-medium">
                        证据摘录
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestScoreDetail.scoreItems.map((item) => (
                      <tr key={item.criterion} className="align-top">
                        <td className="border-b border-slate-100 py-3 pr-4 text-slate-600">
                          {item.category}
                        </td>
                        <td className="border-b border-slate-100 py-3 pr-4 font-medium text-slate-900">
                          {item.criterion}
                        </td>
                        <td className="whitespace-nowrap border-b border-slate-100 py-3 pr-4 text-slate-900">
                          {item.score}/{item.maxScore}
                        </td>
                        <td className="border-b border-slate-100 py-3 pr-4 leading-6 text-slate-700">
                          {item.deductionReason || item.reason}
                        </td>
                        <td className="border-b border-slate-100 py-3 pr-4 leading-6 text-slate-700">
                          {item.suggestion}
                        </td>
                        <td className="min-w-64 border-b border-slate-100 py-3 pl-4 leading-6 text-slate-700">
                          <p className="text-xs text-slate-500">
                            {item.evidence?.evidenceLocation || "证据位置未提供"}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm">
                            {item.evidence?.evidenceText || "暂无证据摘录"}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            {project.scoreResults.length > 1 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">历史评分</p>
                <div className="mt-2 grid gap-2">
                  {project.scoreResults.slice(1).map((scoreResult) => (
                    <div
                      key={scoreResult.id}
                      className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <p className="text-sm font-medium text-slate-900">
                        {scoreResult.totalScore}/100
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(scoreResult.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              暂无 AI 评分
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              生成评分前，请确认至少有一个文件已解析成功并纳入 AI 分析。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              模拟评委问题
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              基于项目材料、真实评审规则、专家评语、历史问题、最近一次材料诊断和 AI 评分生成 10 个答辩训练问题。
            </p>
          </div>
          <form action={`/projects/${project.id}/questions/generate`} method="post">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              生成模拟评委问题
            </button>
          </form>
        </div>

        {questionStatus === "success" ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            模拟评委问题已生成。
          </p>
        ) : null}

        {questionError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {questionError}
          </p>
        ) : null}

        {!latestDiagnosis ? (
          <p className="mt-5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            当前项目尚未生成材料诊断，问题主要基于项目材料和评分结果生成，建议先生成材料诊断后重新生成问题。
          </p>
        ) : null}

        {project.questions.length > 0 ? (
          <div className="mt-5 grid gap-4">
            {project.questions.map((question) => (
              <article
                key={question.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                      {question.perspective}
                    </span>
                    <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-800">
                      {question.type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(question.createdAt)}
                  </p>
                </div>

                <div className="mt-4 grid gap-4">
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      问题内容
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-900">
                      {question.content}
                    </p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        考察重点
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {question.focus}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        建议回答方向
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                        {question.suggestedDirection}
                      </p>
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-white p-3">
                    <p className="text-xs font-medium text-slate-500">
                      证据摘录
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {question.evidenceText || "暂无证据摘录"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {question.evidenceLocation || "证据位置未提供"}
                    </p>
                    {question.factCheckNote ? (
                      <p className="mt-2 text-xs leading-5 text-amber-700">
                        事实校验：{question.factCheckNote}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              暂无模拟评委问题
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              生成问题前，请确认至少有一个文件已解析成功并纳入 AI 分析；如已有诊断和评分，问题会更贴近当前短板。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">材料诊断</h2>
            <p className="mt-2 text-sm text-slate-600">
              基于项目基础信息、已纳入 AI 分析的解析文本、真实评审规则、专家评语和历史问题生成材料诊断。
            </p>
          </div>
          <form action={`/projects/${project.id}/diagnosis`} method="post">
            <button
              type="submit"
              className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            >
              生成材料诊断
            </button>
          </form>
        </div>

        {diagnosisStatus === "success" ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            材料诊断已生成。
          </p>
        ) : null}

        {diagnosisError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {diagnosisError}
          </p>
        ) : null}

        {latestDiagnosis ? (
          <div className="mt-5 grid gap-4">
            <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-950">
                    最近一次诊断
                  </h3>
                  {latestDiagnosisSuggestions?.source === "mock" ? (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Mock 诊断
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  {formatDateTime(latestDiagnosis.createdAt)}
                </p>
              </div>

              <div className="mt-4 grid gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">项目摘要</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {latestDiagnosis.summary}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">
                    材料完整度
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                    {latestDiagnosis.completeness}
                  </p>
                </div>

                {latestDiagnosisIssues?.keyIssues.length ? (
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      核心问题
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
                      {latestDiagnosisIssues.keyIssues.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {latestDiagnosisRisks.length ? (
                  <div>
                    <p className="text-xs font-medium text-slate-500">风险点</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
                      {latestDiagnosisRisks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {latestDiagnosisSuggestions?.priorityActions.length ? (
                  <div>
                    <p className="text-xs font-medium text-slate-500">
                      优先修改建议
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">
                      {latestDiagnosisSuggestions.priorityActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </article>

            {project.diagnoses.length > 1 ? (
              <div>
                <p className="text-xs font-medium text-slate-500">历史诊断</p>
                <div className="mt-2 grid gap-2">
                  {project.diagnoses.slice(1).map((diagnosis) => {
                    const diagnosisSuggestions = parseDiagnosisSuggestions(
                      diagnosis.suggestions,
                    );

                    return (
                      <div
                        key={diagnosis.id}
                        className="rounded-md border border-slate-200 bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs text-slate-500">
                            {formatDateTime(diagnosis.createdAt)}
                          </p>
                          {diagnosisSuggestions.source === "mock" ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Mock 诊断
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-800">
                          {diagnosis.summary}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              暂无材料诊断
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              生成诊断前，请确认至少有一个文件已解析成功并纳入 AI 分析。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 pb-5">
          <h2 className="text-base font-semibold text-slate-950">项目材料</h2>
          <p className="text-sm text-slate-600">
            支持上传并解析 PDF、PPTX、DOCX、TXT，单个文件最大 30MB。当前仅提取主要文字，不做 OCR 或复杂版式识别。
          </p>
        </div>

        {uploadStatus === "success" ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            文件上传成功。
          </p>
        ) : null}

        {parseStatus === "success" ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            文件解析成功。
          </p>
        ) : null}

        {contextStatus ? (
          <p className="mt-5 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            {contextStatus === "included"
              ? "文件已纳入 AI 分析。"
              : "文件已排除出 AI 分析。"}
          </p>
        ) : null}

        {uploadError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {uploadError}
          </p>
        ) : null}

        {parseError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {parseError}
          </p>
        ) : null}

        {contextError ? (
          <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {contextError}
          </p>
        ) : null}

        <form
          action={`/projects/${project.id}/files`}
          method="post"
          encType="multipart/form-data"
          className="mt-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center"
        >
          <input
            type="file"
            name="file"
            accept=".pdf,.pptx,.docx,.txt"
            className="block w-full text-sm text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-md bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            上传材料
          </button>
        </form>

        {project.fileAssets.length > 0 ? (
          <div className="mt-6 grid gap-4">
            {project.fileAssets.map((file) => (
              <article
                key={file.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-slate-950">
                      {file.originalName}
                    </h3>
                    <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <dt className="text-xs text-slate-500">文件类型</dt>
                        <dd className="mt-1 uppercase">{file.fileType}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">文件大小</dt>
                        <dd className="mt-1">{formatFileSize(file.fileSize)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">解析状态</dt>
                        <dd className="mt-1">
                          {parseStatusLabel[file.parseStatus] ??
                            file.parseStatus}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">上传时间</dt>
                        <dd className="mt-1">{formatDateTime(file.createdAt)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">AI 分析</dt>
                        <dd
                          className={
                            file.includeInAIContext
                              ? "mt-1 text-teal-700"
                              : "mt-1 text-slate-500"
                          }
                        >
                          {file.includeInAIContext
                            ? "纳入 AI 分析"
                            : "不纳入 AI 分析"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <form
                      action={`/projects/${project.id}/files/${file.id}/parse`}
                      method="post"
                    >
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        解析
                      </button>
                    </form>
                    <form
                      action={`/projects/${project.id}/files/${file.id}/toggle-context`}
                      method="post"
                    >
                      <button
                        type="submit"
                        disabled={file.parseStatus !== "SUCCESS"}
                        className="inline-flex h-9 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {file.includeInAIContext ? "排除分析" : "纳入分析"}
                      </button>
                    </form>
                  </div>
                </div>

                {file.extractedText ? (
                  <div className="mt-4 rounded-md bg-slate-50 p-4">
                    <p className="text-xs font-medium text-slate-500">
                      文本预览（前 500 字）
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                      {textPreview(file.extractedText)}
                    </p>
                  </div>
                ) : null}

                {file.parseStatus === "FAILED" && file.parseError ? (
                  <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="text-xs font-medium text-red-700">
                      解析失败原因
                    </p>
                    <p className="mt-2 text-sm leading-6 text-red-700">
                      {file.parseError}
                    </p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-6 text-center">
            <h3 className="text-sm font-semibold text-slate-950">
              暂无上传材料
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              上传路演稿、商业计划书或项目说明文档后，会在这里显示文件记录。
            </p>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">项目基础信息</h2>
        <dl className="mt-5 grid gap-5">
          {projectFields.map((field) => (
            <div
              key={field.key}
              className="grid gap-2 border-b border-slate-100 pb-5 last:border-b-0 last:pb-0 md:grid-cols-[160px_1fr]"
            >
              <dt className="text-sm font-medium text-slate-500">
                {field.label}
              </dt>
              <dd className="whitespace-pre-wrap text-sm leading-6 text-slate-900">
                {project[field.key] || "暂无"}
              </dd>
            </div>
          ))}
          <div className="grid gap-2 border-b border-slate-100 pb-5 md:grid-cols-[160px_1fr]">
            <dt className="text-sm font-medium text-slate-500">创建时间</dt>
            <dd className="text-sm text-slate-900">
              {formatDateTime(project.createdAt)}
            </dd>
          </div>
          <div className="grid gap-2 md:grid-cols-[160px_1fr]">
            <dt className="text-sm font-medium text-slate-500">更新时间</dt>
            <dd className="text-sm text-slate-900">
              {formatDateTime(project.updatedAt)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
