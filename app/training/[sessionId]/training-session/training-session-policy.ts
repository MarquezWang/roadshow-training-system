import type { RecordingStatus } from "@/lib/use-pitch-recording";

export const PITCH_LIMIT_SEC = 9 * 60;

const trainingStatusLabels: Record<string, string> = {
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

const recordingStatusLabels: Record<RecordingStatus, string> = {
  UNDECIDED: "未选择是否录音",
  READY_TO_RECORD: "麦克风已就绪",
  OPTED_OUT: "本轮未启用录音",
  RECORDING: "录音中",
  SAVING: "录音保存中",
  SAVED: "录音已保存",
  FAILED: "录音失败",
  UNSUPPORTED: "浏览器不支持录音",
  PERMISSION_DENIED: "麦克风权限未开启",
};

export function getPitchElapsedSec(
  startedAt: string | null,
  fallback: number,
  nowMs = Date.now(),
) {
  if (!startedAt) {
    return fallback;
  }

  return Math.max(
    0,
    Math.floor((nowMs - new Date(startedAt).getTime()) / 1000),
  );
}

export function getPitchTiming(
  startedAt: string | null,
  fallback: number,
  nowMs = Date.now(),
) {
  const elapsedSec = getPitchElapsedSec(startedAt, fallback, nowMs);

  return {
    elapsedSec,
    remainingSec: Math.max(0, PITCH_LIMIT_SEC - elapsedSec),
  };
}

export function isPitchEndedStatus(status: string) {
  return status === "PITCH_ENDED" || status === "FINISHED";
}

export function getTrainingStatusLabel(status: string) {
  return trainingStatusLabels[status] ?? status;
}

export function getTrainingStatusHint(status: string) {
  if (status === "CREATED") {
    return "预览中，开始路演后将自动从第 1 页计时。";
  }

  if (status === "PITCHING") {
    return "路演中";
  }

  if (isPitchEndedStatus(status)) {
    return "路演已结束";
  }

  return getTrainingStatusLabel(status);
}

export function getRecordingStatusLabel(status: RecordingStatus) {
  return recordingStatusLabels[status];
}

type BuildEndPitchRequestOptions = {
  fileId: string | null;
  pageIndex: number;
  pitchDurationSec: number;
};

export function buildEndPitchRequestBody({
  fileId,
  pageIndex,
  pitchDurationSec,
}: BuildEndPitchRequestOptions) {
  return {
    pitchDurationSec,
    pageIndex,
    fileId,
  };
}

export function getQaPreparePath(
  sessionId: string,
  recordingId: string | undefined,
) {
  const basePath = `/training/${sessionId}/qa-prepare`;

  return recordingId
    ? `${basePath}?recordingId=${encodeURIComponent(recordingId)}`
    : basePath;
}
