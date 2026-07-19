import type {
  PitchReplaySegment,
  ReplayPageControlItem,
  ReplaySlideEvent,
  ReplayTranscriptExcerpt,
  TranscriptSegment,
} from "./training-replay-types";

export function formatReplayTime(totalSec: number) {
  const safeTotal = Number.isFinite(totalSec)
    ? Math.max(0, Math.floor(totalSec))
    : 0;
  const minutes = Math.floor(safeTotal / 60);
  const seconds = safeTotal % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

export function getReplayPageControlItems(
  total: number,
  currentIndex: number,
): ReplayPageControlItem[] {
  if (total <= 9) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const fixedIndexes = new Set<number>([
    0,
    1,
    total - 2,
    total - 1,
    currentIndex - 2,
    currentIndex - 1,
    currentIndex,
    currentIndex + 1,
    currentIndex + 2,
  ]);

  const indexes = Array.from(fixedIndexes)
    .filter((index) => index >= 0 && index < total)
    .sort((left, right) => left - right);
  const items: ReplayPageControlItem[] = [];

  indexes.forEach((index) => {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && index - previous > 1) {
      items.push("ellipsis");
    }
    items.push(index);
  });

  return items;
}

export function buildPitchReplaySegments(
  events: ReplaySlideEvent[],
  fallbackDurationSec: number | null,
): PitchReplaySegment[] {
  const orderedEvents = events
    .filter(
      (event) =>
        Number.isFinite(event.elapsedSec) &&
        Number.isFinite(event.pageIndex) &&
        event.pageIndex > 0,
    )
    .sort((a, b) => {
      if (a.elapsedSec !== b.elapsedSec) {
        return a.elapsedSec - b.elapsedSec;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
  const maxEventSec = orderedEvents.reduce(
    (max, event) => Math.max(max, event.elapsedSec),
    0,
  );
  const totalDurationSec = Math.max(fallbackDurationSec ?? 0, maxEventSec);

  if (orderedEvents.length === 0) {
    return totalDurationSec > 0
      ? [
          {
            pageIndex: 1,
            startSec: 0,
            endSec: totalDurationSec,
            durationSec: totalDurationSec,
            ranges: [{ startSec: 0, endSec: totalDurationSec }],
          },
        ]
      : [];
  }

  const pageRanges = new Map<
    number,
    Array<{ startSec: number; endSec: number }>
  >();

  orderedEvents.forEach((event, index) => {
    if (event.eventType === "END") {
      return;
    }

    const startSec = Math.max(0, event.elapsedSec);
    const nextEvent = orderedEvents
      .slice(index + 1)
      .find((item) => item.elapsedSec >= startSec);
    const endSec = nextEvent ? nextEvent.elapsedSec : totalDurationSec;

    if (endSec <= startSec) {
      return;
    }

    const ranges = pageRanges.get(event.pageIndex) ?? [];
    ranges.push({ startSec, endSec });
    pageRanges.set(event.pageIndex, ranges);
  });

  return Array.from(pageRanges.entries())
    .map(([pageIndex, ranges]) => {
      const durationSec = ranges.reduce(
        (total, range) => total + Math.max(0, range.endSec - range.startSec),
        0,
      );
      return {
        pageIndex,
        startSec: ranges[0]?.startSec ?? 0,
        endSec: ranges[0]?.endSec ?? 0,
        durationSec,
        ranges,
      };
    })
    .filter((segment) => segment.durationSec > 0)
    .sort((a, b) => a.pageIndex - b.pageIndex);
}

export function parseTranscriptSegments(
  value: string | null | undefined,
  schemaVersion?: string,
): TranscriptSegment[] {
  if (!value) {
    return [];
  }

  const normalizedVersion =
    schemaVersion?.trim() || "training-transcript-segments:legacy-v0";
  if (
    normalizedVersion !== "training-transcript-segments:legacy-v0" &&
    normalizedVersion !== "training-transcript-segments:2026-07-19.1"
  ) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const segments: TranscriptSegment[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      const startMs = Number(record.startMs);
      const endMs = Number(record.endMs);
      const segmentText =
        typeof record.text === "string" ? record.text.trim() : "";

      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        endMs <= startMs ||
        !segmentText
      ) {
        continue;
      }

      segments.push({
        startMs,
        endMs,
        text: segmentText,
        speakerId:
          typeof record.speakerId === "string" ? record.speakerId : null,
      });
    }

    return segments.sort((left, right) => left.startMs - right.startMs);
  } catch {
    return [];
  }
}

function trimTranscriptSegmentToWindow(
  segment: TranscriptSegment,
  windowStartMs: number,
  windowEndMs: number,
) {
  const segmentDurationMs = segment.endMs - segment.startMs;

  if (segmentDurationMs <= 0) {
    return "";
  }

  const characters = Array.from(segment.text);
  let startIndex = 0;
  let endIndex = characters.length;
  const crossesStart = segment.startMs < windowStartMs;
  const crossesEnd = segment.endMs > windowEndMs;

  if (crossesStart) {
    const startRatio = Math.min(
      1,
      Math.max(0, (windowStartMs - segment.startMs) / segmentDurationMs),
    );
    startIndex = Math.min(
      characters.length,
      Math.floor(characters.length * startRatio),
    );
  }

  if (crossesEnd) {
    const endRatio = Math.min(
      1,
      Math.max(0, (windowEndMs - segment.startMs) / segmentDurationMs),
    );
    endIndex = Math.max(startIndex, Math.ceil(characters.length * endRatio));
  }

  let text = characters.slice(startIndex, endIndex).join("").trim();

  if (crossesStart) {
    text = text.replace(/^[，。！？；、,.!?;\s]+/, "");
    const firstSentenceEnd = text.search(/[。！？?]/);

    if (firstSentenceEnd >= 0 && firstSentenceEnd <= 18) {
      text = text.slice(firstSentenceEnd + 1).trim();
    }
  }

  if (crossesEnd) {
    text = text.replace(/[，。！？；、,.!?;\s]+$/, "");
  }

  return text;
}

function getPreciseTranscriptExcerpt(
  segments: TranscriptSegment[],
  segment: PitchReplaySegment | null,
) {
  if (!segment || segments.length === 0) {
    return "";
  }

  const startMs = segment.startSec * 1000;
  const endMs = segment.endSec * 1000;

  return segments
    .filter((item) => item.endMs > startMs && item.startMs < endMs)
    .map((item) => trimTranscriptSegmentToWindow(item, startMs, endMs))
    .filter(Boolean)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function getTranscriptExcerptForSegment(
  text: string,
  segmentsJson: string | null | undefined,
  segment: PitchReplaySegment | null,
  totalDurationSec: number,
  segmentsSchemaVersion?: string,
): ReplayTranscriptExcerpt {
  const segments = parseTranscriptSegments(
    segmentsJson,
    segmentsSchemaVersion,
  );
  const preciseText = getPreciseTranscriptExcerpt(segments, segment);

  if (preciseText) {
    return {
      text: preciseText,
      matchType: "precise",
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText || !segment || totalDurationSec <= 0) {
    return {
      text: "",
      matchType: "none",
    };
  }

  const startRatio = Math.min(
    1,
    Math.max(0, segment.startSec / totalDurationSec),
  );
  const endRatio = Math.min(
    1,
    Math.max(startRatio, segment.endSec / totalDurationSec),
  );
  const startIndex = Math.floor(trimmedText.length * startRatio);
  const endIndex = Math.max(
    startIndex + 1,
    Math.ceil(trimmedText.length * endRatio),
  );

  return {
    text: trimmedText.slice(startIndex, endIndex).trim(),
    matchType: "estimated",
  };
}
