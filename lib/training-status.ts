export const abortableTrainingStatuses = [
  "CREATED",
  "PITCH_READY",
  "PITCHING",
  "PITCH_ENDED",
  "QA_READY",
  "QAING",
] as const;

export const pitchStartableTrainingStatuses = ["CREATED", "PITCH_READY"] as const;
export const qaStartableTrainingStatuses = ["PITCH_ENDED", "QA_READY"] as const;
export const dynamicQuestionTrainingStatuses = ["QA_READY", "QAING"] as const;

export const terminalTrainingStatuses = [
  "QA_ENDED",
  "REPORT_READY",
  "FINISHED",
  "ABORTED",
] as const;

export function isAbortableTrainingStatus(status: string) {
  return abortableTrainingStatuses.includes(
    status as (typeof abortableTrainingStatuses)[number],
  );
}

export function isTerminalTrainingStatus(status: string) {
  return terminalTrainingStatuses.includes(
    status as (typeof terminalTrainingStatuses)[number],
  );
}

export function getTrainingFlowPath(sessionId: string, status: string) {
  if (status === "PITCHING") {
    return `/training/${sessionId}/pitch`;
  }

  if (status === "PITCH_ENDED" || status === "QA_READY") {
    return `/training/${sessionId}/qa-prepare`;
  }

  if (status === "QAING") {
    return `/training/${sessionId}/qa`;
  }

  if (
    status === "QA_ENDED" ||
    status === "REPORT_READY" ||
    status === "FINISHED" ||
    status === "ABORTED"
  ) {
    return `/training/${sessionId}/report`;
  }

  return `/training/${sessionId}/prepare`;
}

export const trainingStatusLabel: Record<string, string> = {
  CREATED: "待开始",
  PITCH_READY: "路演准备中",
  PITCHING: "路演中",
  PITCH_ENDED: "路演已结束",
  QA_READY: "答辩准备中",
  QAING: "答辩中",
  QA_ENDED: "答辩已完成",
  REPORT_READY: "报告准备中",
  FINISHED: "已完成",
  ABORTED: "已中止",
};
