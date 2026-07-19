"use client";

import { useRef, useState } from "react";
import { isDynamicFollowupQuestion } from "./training-qa-flow";
import { getInitialUsedAnswerSec } from "./training-qa-timing";
import type { QaPhase, TrainingQaQuestion } from "./training-qa-types";

type UseTrainingQaStateOptions = {
  initialQuestionIndex: number;
  initialQuestions: TrainingQaQuestion[];
  initialRemainingSec: number;
  initialStatus: string;
};

export function useTrainingQaState({
  initialQuestionIndex,
  initialQuestions,
  initialRemainingSec,
  initialStatus,
}: UseTrainingQaStateOptions) {
  const initialUsedAnswerSec = getInitialUsedAnswerSec(initialRemainingSec);
  const [status, setStatus] = useState(initialStatus);
  const [qaPhase, setQaPhase] = useState<QaPhase>(
    initialStatus === "QAING" ? "ASKING" : "READY",
  );
  const [questions, setQuestions] =
    useState<TrainingQaQuestion[]>(initialQuestions);
  const [currentQuestionIndex, setCurrentQuestionIndex] =
    useState(initialQuestionIndex);
  const [revealedQuestionIds, setRevealedQuestionIds] = useState<Set<string>>(
    () =>
      new Set(
        initialQuestions
          .filter((question) => question.answer?.revealedQuestionText)
          .map((question) => question.id),
      ),
  );
  const [usedAnswerSec, setUsedAnswerSec] = useState(initialUsedAnswerSec);
  const [dynamicFollowupUsedSec, setDynamicFollowupUsedSec] = useState(0);
  const [message, setMessage] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [preAnswerOverlay, setPreAnswerOverlay] = useState<number | null>(null);
  const [dynamicFollowupIntroQuestion, setDynamicFollowupIntroQuestion] =
    useState<TrainingQaQuestion | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const answerPhaseStartedMsRef = useRef<number | null>(null);
  const answerElapsedBeforePhaseRef = useRef(initialUsedAnswerSec);
  const countdownIntervalRef = useRef<number | null>(null);
  const dynamicFollowupIntroTimerRef = useRef<number | null>(null);
  const beginJudgeQuestionRef = useRef<
    ((questionIndex: number) => void) | null
  >(null);
  const beginPreAnswerCountdownRef = useRef<(() => void) | null>(null);
  const dynamicFollowupIntroShownQuestionIdsRef = useRef<Set<string>>(
    new Set(
      initialStatus === "QAING" &&
        isDynamicFollowupQuestion(
          initialQuestions[initialQuestionIndex] ?? null,
        )
        ? [initialQuestions[initialQuestionIndex]!.id]
        : [],
    ),
  );
  const hasAutoEndedRef = useRef(false);
  const hasResumedQaingRef = useRef(false);
  const isCompletingNormallyRef = useRef(false);

  return {
    answerElapsedBeforePhaseRef,
    answerPhaseStartedMsRef,
    beginJudgeQuestionRef,
    beginPreAnswerCountdownRef,
    countdownIntervalRef,
    currentQuestionIndex,
    dynamicFollowupIntroQuestion,
    dynamicFollowupIntroShownQuestionIdsRef,
    dynamicFollowupIntroTimerRef,
    dynamicFollowupUsedSec,
    hasAutoEndedRef,
    hasResumedQaingRef,
    isCompletingNormallyRef,
    isSaving,
    isStarting,
    message,
    preAnswerOverlay,
    qaPhase,
    questions,
    revealedQuestionIds,
    setCurrentQuestionIndex,
    setDynamicFollowupIntroQuestion,
    setDynamicFollowupUsedSec,
    setIsSaving,
    setIsStarting,
    setMessage,
    setPreAnswerOverlay,
    setQaPhase,
    setQuestions,
    setRevealedQuestionIds,
    setStatus,
    setUsedAnswerSec,
    status,
    usedAnswerSec,
  };
}

export type TrainingQaState = ReturnType<typeof useTrainingQaState>;
