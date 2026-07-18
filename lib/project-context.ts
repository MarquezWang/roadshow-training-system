import {
  MAX_ALL_FILES_TEXT_LENGTH,
  MAX_SINGLE_FILE_TEXT_LENGTH,
  takeProjectContextFileTexts,
} from "./project-context/files";
import { MAX_EXPERT_COMMENTS } from "./project-context/expert-comments";
import { MAX_HISTORICAL_QUESTIONS } from "./project-context/historical-questions";
import {
  countProjectContextFiles,
  findEvaluationRule,
  findExpertComments,
  findHistoricalQuestions,
  findProjectContextProject,
} from "./project-context/repository";
import type { ProjectAIContext } from "./project-context/types";

export { normalizeCommentDimension } from "./project-context/expert-comments";
export { parseProjectAIContextSnapshot } from "./project-context/snapshot";
export type { ProjectAIContext } from "./project-context/types";

export class ProjectContextNotFoundError extends Error {
  constructor(projectId: string) {
    super(`项目不存在：${projectId}`);
    this.name = "ProjectContextNotFoundError";
  }
}

export async function buildProjectAIContext(
  projectId: string,
): Promise<ProjectAIContext> {
  const project = await findProjectContextProject(projectId);

  if (!project) {
    throw new ProjectContextNotFoundError(projectId);
  }

  const [rule, expertCommentSelection, historicalQuestionSelection] =
    await Promise.all([
      findEvaluationRule(),
      findExpertComments(project.field),
      findHistoricalQuestions(project.field),
    ]);

  const fileTextResult = takeProjectContextFileTexts(project.fileAssets);
  const [parsedSuccessFiles, excludedFiles] = await countProjectContextFiles(
    project.id,
  );

  const truncated = {
    files: fileTextResult.filesTruncated,
    allFilesText: fileTextResult.allFilesTextTruncated,
    expertComments: expertCommentSelection.debug.truncated,
    historicalQuestions: historicalQuestionSelection.debug.truncated,
  };

  return {
    project: {
      id: project.id,
      name: project.name,
      field: project.field,
      stage: project.stage,
      summary: project.summary,
      coreTechnology: project.coreTechnology,
      applicationScenario: project.applicationScenario,
      businessModel: project.businessModel,
      cooperationDemand: project.cooperationDemand,
      productForm: project.productForm,
      trlBasis: project.trlBasis,
      teamInfo: project.teamInfo,
      cooperationDemandDetail: project.cooperationDemandDetail,
    },
    files: fileTextResult.files,
    evaluationRule: rule
      ? {
          id: rule.id,
          name: rule.name,
          contestName: rule.contestName,
          version: rule.version,
          totalScore: rule.totalScore,
          description: rule.description,
          rawText: rule.rawText,
        }
      : null,
    criteria:
      rule?.criteria.map((criterion) => ({
        id: criterion.id,
        category: criterion.category,
        name: criterion.name,
        weight: criterion.weight,
        description: criterion.description,
        scoringGuide: criterion.scoringGuide,
        sortOrder: criterion.sortOrder,
      })) ?? [],
    expertComments: expertCommentSelection.comments.map((item) => ({
      id: item.id,
      contestName: item.contestName,
      projectField: item.projectField,
      dimension: item.dimension,
      normalizedDimension: item.normalizedDimension,
      commentText: item.commentText,
      problemType: item.problemType,
      suggestionType: item.suggestionType,
      scoreRange: item.scoreRange,
      relevanceReason: item.relevanceReason,
    })),
    historicalQuestions: historicalQuestionSelection.questions.map((item) => ({
      id: item.id,
      contestName: item.contestName,
      projectField: item.projectField,
      perspective: item.perspective,
      questionText: item.questionText,
      focus: item.focus,
    })),
    limits: {
      maxSingleFileTextLength: MAX_SINGLE_FILE_TEXT_LENGTH,
      maxAllFilesTextLength: MAX_ALL_FILES_TEXT_LENGTH,
      maxExpertComments: MAX_EXPERT_COMMENTS,
      maxHistoricalQuestions: MAX_HISTORICAL_QUESTIONS,
    },
    truncated: {
      any: Object.values(truncated).some(Boolean),
      ...truncated,
    },
    debug: {
      fileSelection: {
        totalFiles: project._count.fileAssets,
        parsedSuccessFiles,
        includedFiles: fileTextResult.files.length,
        excludedFiles,
      },
      expertCommentSelection: expertCommentSelection.debug,
      historicalQuestionSelection: historicalQuestionSelection.debug,
    },
  };
}
