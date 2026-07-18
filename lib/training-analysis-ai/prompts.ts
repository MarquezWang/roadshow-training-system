import type { ProjectAIContext } from "@/lib/project-context";
import { renderPrompt } from "@/lib/prompt-renderer";

import { getJsonParseFailureDetails } from "./debug";

const CONTEXT_EXPERT_COMMENT_LIMIT = 10;
const CONTEXT_HISTORICAL_QUESTION_LIMIT = 10;

export function buildTrainingAnalysisPrompt(
  context: ProjectAIContext,
  template: string,
  input: {
    session: unknown;
    slideEvents: unknown;
    transcript: unknown;
    qaData: unknown;
    dynamicFollowupData: unknown;
  },
) {
  return renderPrompt(template, {
    session: input.session,
    slideEvents: input.slideEvents,
    transcript: input.transcript,
    qaData: input.qaData,
    dynamicFollowupData: input.dynamicFollowupData,
    project: context.project,
    files: context.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      fileType: file.fileType,
      extractedText: file.extractedText,
      truncated: file.truncated,
    })),
    evaluationRule: context.evaluationRule,
    criteria: context.criteria,
    expertComments: context.expertComments.slice(0, CONTEXT_EXPERT_COMMENT_LIMIT),
    historicalQuestions: context.historicalQuestions.slice(
      0,
      CONTEXT_HISTORICAL_QUESTION_LIMIT,
    ),
  });
}

export function buildRepairPrompt(rawText: string, error: unknown) {
  const details = getJsonParseFailureDetails(error);
  return renderPrompt(
    [
      "请修复下面这段 AI 输出，使其成为一个合法 JSON 对象。",
      "只输出修复后的 JSON，不要输出 Markdown、代码块或解释文字。",
      "必须返回完整 JSON object，不能省略字段。",
      "输出结构必须符合 TrainingAnalysisResult。",
      "不能新增 schema 外字段。",
      "不要新增事实，不要补充转写文本中没有的表达。",
      "如果原文被截断或字段不完整，请在保持结构合法的前提下，用短句补齐未闭合的字符串、数组和对象。",
      "所有字符串必须闭合，所有数组和对象必须闭合。",
      "所有字符串必须是合法 JSON string，不能包含未转义换行或未转义双引号。",
      "如果某字段无法修复，用空字符串、空数组、false、null 或安全默认值补齐。",
      "必须保留原始内容中可恢复的信息。",
      "",
      "解析错误：{{parseError}}",
      "原始返回长度：{{originalLength}}",
      "截取后长度：{{extractedLength}}",
      "解析失败位置：{{parsePosition}}",
      "",
      "目标 JSON 结构：",
      "{",
      '  "overallScore": 0,',
      '  "summary": "",',
      '  "strengths": [],',
      '  "weaknesses": [],',
      '  "suggestions": [],',
      '  "onePageSummary": {',
      '    "conclusion": "",',
      '    "strongestPoint": "",',
      '    "biggestWeakness": "",',
      '    "nextTrainingFocus": "",',
      '    "readinessAdvice": ""',
      "  },",
      '  "diagnostics": {',
      '    "content": [],',
      '    "delivery": [],',
      '    "qa": []',
      "  },",
      '  "actionItems": [',
      "    {",
      '      "issue": "",',
      '      "whyItMatters": "",',
      '      "howToFix": "",',
      '      "sampleWording": ""',
      "    }",
      "  ],",
      '  "nextTrainingTasks": [],',
      '  "contentCoverage": [',
      "    {",
      '      "item": "",',
      '      "covered": "true",',
      '      "evidence": "",',
      '      "suggestion": ""',
      "    }",
      "  ],",
      '  "timing": {',
      '    "durationSec": 0,',
      '    "targetDurationSec": 540,',
      '    "assessment": "",',
      '    "opening": "",',
      '    "middle": "",',
      '    "ending": "",',
      '    "suggestion": ""',
      "  },",
      '  "slideSync": {',
      '    "slideEventCount": 0,',
      '    "pageCount": 0,',
      '    "assessment": "",',
      '    "frequentFlipRisk": "",',
      '    "longStayRisk": "",',
      '    "suggestion": ""',
      "  },",
      '  "riskQuestions": [],',
      '  "qaReviews": [],',
      '  "dynamicFollowupReview": null',
      "}",
      "",
      "需要修复的原始返回：",
      "{{rawText}}",
    ].join("\n"),
    {
      parseError: details.message,
      originalLength: details.originalLength ?? "unknown",
      extractedLength: details.extractedLength ?? "unknown",
      parsePosition: details.parsePosition ?? "unknown",
      rawText,
    },
  );
}
