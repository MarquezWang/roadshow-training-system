export type ProjectAIContext = {
  project: {
    id: string;
    name: string;
    field: string;
    stage: string;
    summary: string;
    coreTechnology: string;
    applicationScenario: string;
    businessModel: string;
    cooperationDemand: string;
    productForm: string;
    trlBasis: string;
    teamInfo: string;
    cooperationDemandDetail: string;
  };
  files: Array<{
    id: string;
    originalName: string;
    fileType: string;
    includeInAIContext: boolean;
    extractedText: string;
    truncated: boolean;
  }>;
  evaluationRule: {
    id: string;
    name: string;
    contestName: string;
    version: string;
    totalScore: number;
    description: string | null;
    rawText: string | null;
  } | null;
  criteria: Array<{
    id: string;
    category: string | null;
    name: string;
    weight: number;
    description: string;
    scoringGuide: string | null;
    sortOrder: number;
  }>;
  expertComments: Array<{
    id: string;
    contestName: string | null;
    projectField: string | null;
    dimension: string;
    normalizedDimension: string;
    commentText: string;
    problemType: string | null;
    suggestionType: string | null;
    scoreRange: string | null;
    relevanceReason: string;
  }>;
  historicalQuestions: Array<{
    id: string;
    contestName: string | null;
    projectField: string | null;
    perspective: string;
    questionText: string;
    focus: string | null;
  }>;
  limits: {
    maxSingleFileTextLength: number;
    maxAllFilesTextLength: number;
    maxExpertComments: number;
    maxHistoricalQuestions: number;
  };
  truncated: {
    any: boolean;
    files: boolean;
    allFilesText: boolean;
    expertComments: boolean;
    historicalQuestions: boolean;
  };
  debug: {
    fileSelection: {
      totalFiles: number;
      parsedSuccessFiles: number;
      includedFiles: number;
      excludedFiles: number;
    };
    expertCommentSelection: {
      totalAvailable: number;
      selected: number;
      byNormalizedDimension: Record<string, number>;
      truncated: boolean;
    };
    historicalQuestionSelection: {
      totalAvailable: number;
      selected: number;
      byPerspective: Record<string, number>;
      truncated: boolean;
    };
  };
};
