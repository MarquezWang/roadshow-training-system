export type PromptModel = "fast" | "strong" | "待确认";
export type PromptRisk = "高" | "中" | "低" | "待确认";
export type PromptStatus = "已接入" | "未接入";

export type PromptAsset = {
  file: string;
  task: string;
  route: string;
  model: PromptModel;
  risk: PromptRisk;
  output: string;
  status: PromptStatus;
};

export type PromptRow = PromptAsset & {
  size: number;
  updatedAt: Date;
};

export type PromptTestSuite = {
  name: string;
  count: number;
};
