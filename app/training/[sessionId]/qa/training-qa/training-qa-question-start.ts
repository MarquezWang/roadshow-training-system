export type QuestionStartRequester = (questionId: string) => Promise<void>;

export function createQuestionStartCoordinator(
  requestQuestionStart: QuestionStartRequester,
) {
  const starts = new Map<string, Promise<void>>();

  return {
    ensureStarted(questionId: string) {
      const existing = starts.get(questionId);
      if (existing) return existing;

      const pending = (async () => {
        await requestQuestionStart(questionId);
      })();
      starts.set(questionId, pending);
      void pending.catch(() => {
        if (starts.get(questionId) === pending) {
          starts.delete(questionId);
        }
      });
      return pending;
    },
  };
}
