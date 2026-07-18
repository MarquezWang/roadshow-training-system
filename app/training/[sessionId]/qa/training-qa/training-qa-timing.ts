import type { QaPhase } from "./training-qa-types";

export const QA_LIMIT_SEC = 3 * 60;
export const DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC = 60;

export function getInitialUsedAnswerSec(initialRemainingSec: number) {
  return Math.max(
    0,
    QA_LIMIT_SEC - Math.min(initialRemainingSec, QA_LIMIT_SEC),
  );
}

export function getCurrentQuestionTiming(
  isDynamicFollowup: boolean,
  usedAnswerSec: number,
  dynamicFollowupUsedSec: number,
) {
  const limitSec = isDynamicFollowup
    ? DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC
    : QA_LIMIT_SEC;
  const usedSec = isDynamicFollowup
    ? dynamicFollowupUsedSec
    : usedAnswerSec;

  return {
    limitSec,
    remainingSec: Math.max(0, limitSec - usedSec),
    usedSec,
  };
}

type CurrentUsedAnswerOptions = {
  isDynamicFollowup: boolean;
  qaPhase: QaPhase;
  phaseStartedMs: number | null;
  elapsedBeforePhaseSec: number;
  usedAnswerSec: number;
  dynamicFollowupUsedSec: number;
  nowMs: number;
};

export function getCurrentUsedAnswerSec({
  isDynamicFollowup,
  qaPhase,
  phaseStartedMs,
  elapsedBeforePhaseSec,
  usedAnswerSec,
  dynamicFollowupUsedSec,
  nowMs,
}: CurrentUsedAnswerOptions) {
  if (qaPhase !== "ANSWERING" || phaseStartedMs === null) {
    return isDynamicFollowup ? dynamicFollowupUsedSec : usedAnswerSec;
  }

  const elapsedInPhase = Math.max(
    0,
    Math.floor((nowMs - phaseStartedMs) / 1000),
  );

  if (isDynamicFollowup) {
    return Math.min(DYNAMIC_FOLLOWUP_ANSWER_LIMIT_SEC, elapsedInPhase);
  }

  return Math.min(QA_LIMIT_SEC, elapsedBeforePhaseSec + elapsedInPhase);
}

export function getSessionQaDurationSec(
  isDynamicFollowup: boolean,
  usedAnswerSec: number,
  currentUsedAnswerSec: number,
) {
  if (!isDynamicFollowup) {
    return currentUsedAnswerSec;
  }

  return Math.min(QA_LIMIT_SEC, usedAnswerSec) + currentUsedAnswerSec;
}
