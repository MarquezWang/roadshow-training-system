import type { QaPhase } from "./training-qa-types";

export function formatQaDuration(totalSec: number) {
  const normalizedSec = Math.max(0, totalSec);
  const minutes = Math.floor(normalizedSec / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (normalizedSec % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function getQaPhaseLabel(phase: QaPhase) {
  const labels: Record<QaPhase, string> = {
    READY: "答辩准备",
    ASKING: "评委正在提问",
    COUNTDOWN: "准备回答",
    ANSWERING: "回答中",
    SAVING: "保存当前题",
    DONE: "答辩已完成",
  };

  return labels[phase];
}
