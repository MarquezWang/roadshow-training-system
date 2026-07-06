export const MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH = 10;
export const MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH = 200;

export type DynamicFollowupRegularQuestion = {
  questionText: string;
};

type ValidateFollowupTextParams = {
  text: string;
  transcriptText: string;
  regularQuestions: DynamicFollowupRegularQuestion[];
};

function validateQuestionText(text: string): string | null {
  if (!text) return "output_empty";
  if (text.length < MIN_DYNAMIC_FOLLOWUP_QUESTION_LENGTH) {
    return "output_too_short";
  }
  if (text.length > MAX_DYNAMIC_FOLLOWUP_QUESTION_LENGTH) {
    return "output_too_long";
  }
  if (!text.includes("?") && !text.includes("？")) return "output_not_question";
  return null;
}

function isMismatchStyleQuestion(text: string) {
  const normalizedText = text.replace(/\s+/g, "");
  const mismatchMarkers = [
    "材料里写",
    "材料里写的是",
    "材料中写",
    "材料中写的是",
    "材料显示",
    "项目材料显示",
    "项目材料里",
    "刚才主要讲",
    "刚才主要讲的是",
    "刚才讲的是",
    "主要讲到了",
    "这两者之间有什么关联",
    "两者之间有什么关联",
    "两者有什么关联",
    "项目定位发生了调整",
    "定位发生了调整",
    "偏离了提交项目",
    "本轮路演内容",
    "现场讲述和项目材料",
    "智能咖啡机",
  ];

  return (
    mismatchMarkers.some((marker) => normalizedText.includes(marker)) ||
    ((normalizedText.includes("材料") || normalizedText.includes("提交")) &&
      (normalizedText.includes("刚才") ||
        normalizedText.includes("现场") ||
        normalizedText.includes("Pitch"))) ||
    (normalizedText.includes("两者") && normalizedText.includes("关联")) ||
    (normalizedText.includes("材料") &&
      normalizedText.includes("项目定位"))
  );
}

function countQuestionMarks(text: string) {
  return (text.match(/[?？]/g) ?? []).length;
}

function hasContextLeak(text: string) {
  const upperText = text.toUpperCase();
  const contextLeakMarkers = [
    "Project:",
    "已有问题",
    "-- 1 of",
    "输出要求",
    "Pitch 转写",
  ];

  return (
    upperText.includes("TRAINING SYSTEM") ||
    contextLeakMarkers.some((marker) => text.includes(marker))
  );
}

function normalizeQuestionForOverlap(text: string) {
  return text
    .trim()
    .replace(/\s+/g, "")
    .replace(/[?？。,.，、：:；;"“”'‘’]/g, "");
}

function duplicatesRegularQuestion(
  text: string,
  regularQuestions: DynamicFollowupRegularQuestion[],
) {
  const normalizedText = normalizeQuestionForOverlap(text);

  if (!normalizedText) {
    return false;
  }

  return regularQuestions.some((question) => {
    const normalizedQuestion = normalizeQuestionForOverlap(
      question.questionText,
    );

    if (!normalizedQuestion) {
      return false;
    }

    const prefix = normalizedQuestion.slice(0, 20);

    return (
      normalizedText.includes(normalizedQuestion) ||
      normalizedQuestion.includes(normalizedText) ||
      (prefix.length >= 12 && normalizedText.includes(prefix))
    );
  });
}

function hasUnsupportedTranscriptClaim(text: string, transcriptText: string) {
  const claimGroups = [
    {
      outputMarkers: ["小范围试点", "试点阶段", "进入试点"],
      transcriptMarkers: ["小范围试点", "试点阶段", "试点"],
    },
    {
      outputMarkers: ["有效数据"],
      transcriptMarkers: ["有效数据"],
    },
    {
      outputMarkers: ["规模化复制", "规模化复制条件"],
      transcriptMarkers: ["规模化", "复制"],
    },
    {
      outputMarkers: ["客户反馈"],
      transcriptMarkers: ["客户反馈"],
    },
    {
      outputMarkers: ["付费客户"],
      transcriptMarkers: ["付费客户"],
    },
    {
      outputMarkers: ["数据指标"],
      transcriptMarkers: ["数据指标"],
    },
  ];

  return claimGroups.some(
    ({ outputMarkers, transcriptMarkers }) =>
      outputMarkers.some((marker) => text.includes(marker)) &&
      !transcriptMarkers.some((marker) => transcriptText.includes(marker)),
  );
}

const unsupportedExampleLeakMarkers = [
  "供电所",
  "线路",
  "运维人员",
  "故障点",
  "天气条件",
  "识别准确率",
  "两个县区",
  "县区",
] as const;

function hasUnsupportedExampleLeak(text: string, transcriptText: string) {
  return unsupportedExampleLeakMarkers.some(
    (marker) => text.includes(marker) && !transcriptText.includes(marker),
  );
}

export function validateMainFollowupText({
  text,
  transcriptText,
  regularQuestions,
}: ValidateFollowupTextParams) {
  if (isMismatchStyleQuestion(text)) return "main_output_mismatch_style";
  if (text.length > 180) return "main_output_too_long";
  if (hasContextLeak(text)) return "main_output_context_leak";
  if (countQuestionMarks(text) > 1) return "main_output_multiple_questions";
  if (hasUnsupportedTranscriptClaim(text, transcriptText)) {
    return "main_output_unsupported_transcript_claim";
  }
  if (hasUnsupportedExampleLeak(text, transcriptText)) {
    return "main_output_unsupported_example_leak";
  }
  if (duplicatesRegularQuestion(text, regularQuestions)) {
    return "main_output_duplicate_regular_question";
  }

  return validateQuestionText(text);
}

export function validateFallbackFollowupText({
  text,
  transcriptText,
  regularQuestions,
}: ValidateFollowupTextParams) {
  if (isMismatchStyleQuestion(text)) return "fallback_output_mismatch_style";
  if (hasContextLeak(text)) return "fallback_output_context_leak";
  if (countQuestionMarks(text) > 1) {
    return "fallback_output_multiple_questions";
  }
  if (hasUnsupportedTranscriptClaim(text, transcriptText)) {
    return "fallback_output_unsupported_transcript_claim";
  }
  if (hasUnsupportedExampleLeak(text, transcriptText)) {
    return "fallback_output_unsupported_example_leak";
  }
  if (duplicatesRegularQuestion(text, regularQuestions)) {
    return "fallback_output_duplicate_regular_question";
  }

  return validateQuestionText(text);
}

export function normalizeMainMultipleQuestionText(text: string) {
  if (countQuestionMarks(text) !== 2) {
    return null;
  }
  if (
    isMismatchStyleQuestion(text) ||
    hasContextLeak(text) ||
    text.length > 180
  ) {
    return null;
  }

  const questionMarks = Array.from(text.matchAll(/[?？]/g));
  if (questionMarks.length !== 2) {
    return null;
  }

  const firstQuestionMarkIndex = questionMarks[0].index;
  const lastQuestionMarkIndex = questionMarks[1].index;
  if (
    firstQuestionMarkIndex === undefined ||
    lastQuestionMarkIndex === undefined
  ) {
    return null;
  }

  const firstPart = text
    .slice(0, firstQuestionMarkIndex)
    .trim()
    .replace(/^请问/, "请说明");
  const secondPart = text
    .slice(firstQuestionMarkIndex + 1, lastQuestionMarkIndex)
    .trim()
    .replace(/^(并且|同时|另外|还有|具体|请问)/, "")
    .trim();
  const trailingText = text.slice(lastQuestionMarkIndex + 1).trim();

  if (!firstPart || !secondPart || trailingText) {
    return null;
  }

  return `${firstPart}，以及${secondPart}？`;
}
