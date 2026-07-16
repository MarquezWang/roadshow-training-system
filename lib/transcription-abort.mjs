export class TranscriptionTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`ASR request timed out after ${timeoutMs}ms`);
    this.name = "TranscriptionTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class TranscriptionAbortedError extends Error {
  constructor(reason) {
    super(
      reason instanceof Error
        ? `ASR request aborted: ${reason.message}`
        : "ASR request aborted",
    );
    this.name = "TranscriptionAbortedError";
  }
}

export function throwIfTranscriptionAborted(signal) {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof TranscriptionTimeoutError) throw reason;
  if (reason instanceof TranscriptionAbortedError) throw reason;
  throw new TranscriptionAbortedError(reason);
}

export function abortableTranscriptionDelay(ms, signal) {
  throwIfTranscriptionAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      try {
        throwIfTranscriptionAborted(signal);
      } catch (error) {
        reject(error);
      }
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWithTranscriptionAbort(options, operation) {
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs));
  const controller = new AbortController();
  const externalSignal = options.signal;
  const onExternalAbort = () => {
    controller.abort(
      externalSignal?.reason ?? new TranscriptionAbortedError(),
    );
  };

  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort(new TranscriptionTimeoutError(timeoutMs));
  }, timeoutMs);

  let removeAbortListener = () => {};
  const aborted = new Promise((_, reject) => {
    const onAbort = () => {
      try {
        throwIfTranscriptionAborted(controller.signal);
      } catch (error) {
        reject(error);
      }
    };
    removeAbortListener = () =>
      controller.signal.removeEventListener("abort", onAbort);
    controller.signal.addEventListener("abort", onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    removeAbortListener();
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
