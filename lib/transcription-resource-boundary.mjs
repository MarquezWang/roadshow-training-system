const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

export class TranscriptionResourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TranscriptionResourceError";
    this.code = code;
  }
}

export function createTranscriptionLimiter(maxConcurrency) {
  const limit = positiveInteger(maxConcurrency, DEFAULT_MAX_CONCURRENCY, 16);
  let active = 0;
  const queue = [];

  function dispatch() {
    while (active < limit && queue.length > 0) {
      const waiter = queue.shift();
      if (waiter.cancelled) continue;
      active += 1;
      waiter.resolve(() => {
        if (waiter.released) return;
        waiter.released = true;
        active = Math.max(0, active - 1);
        dispatch();
      });
    }
  }

  function acquire({ signal, timeoutMs = DEFAULT_QUEUE_TIMEOUT_MS } = {}) {
    if (signal?.aborted) {
      return Promise.reject(
        new TranscriptionResourceError("ABORTED", "转写任务已取消。"),
      );
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        cancelled: false,
        released: false,
        resolve: null,
      };
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId !== null) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
      };
      const cancel = (error) => {
        if (waiter.cancelled || waiter.released) return;
        waiter.cancelled = true;
        cleanup();
        reject(error);
      };
      const onAbort = () =>
        cancel(new TranscriptionResourceError("ABORTED", "转写任务已取消。"));

      waiter.resolve = (release) => {
        cleanup();
        resolve(release);
      };
      timeoutId = setTimeout(
        () =>
          cancel(
            new TranscriptionResourceError(
              "QUEUE_TIMEOUT",
              "转写任务队列拥堵，请稍后重试。",
            ),
          ),
        positiveInteger(timeoutMs, DEFAULT_QUEUE_TIMEOUT_MS, 10 * 60_000),
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
      dispatch();
    });
  }

  return {
    acquire,
    get activeCount() {
      return active;
    },
    get pendingCount() {
      return queue.filter((waiter) => !waiter.cancelled).length;
    },
  };
}

const globalForLimiter = globalThis;

export function getGlobalTranscriptionLimiter() {
  if (!globalForLimiter.__roadshowTranscriptionLimiter) {
    globalForLimiter.__roadshowTranscriptionLimiter = createTranscriptionLimiter(
      positiveInteger(
        process.env.TRANSCRIPTION_MAX_CONCURRENCY,
        DEFAULT_MAX_CONCURRENCY,
        16,
      ),
    );
  }

  return globalForLimiter.__roadshowTranscriptionLimiter;
}

export function getTranscriptionQueueTimeoutMs() {
  return positiveInteger(
    process.env.TRANSCRIPTION_QUEUE_TIMEOUT_MS,
    DEFAULT_QUEUE_TIMEOUT_MS,
    10 * 60_000,
  );
}
