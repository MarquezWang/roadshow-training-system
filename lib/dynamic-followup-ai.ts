import { callAI } from "@/lib/ai";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import type { ProjectAIContext } from "@/lib/project-context";

const DYNAMIC_FOLLOWUP_SYSTEM_PROMPT =
  "你是一名专业路演答辩评委，只输出一个问题。";
const DYNAMIC_FOLLOWUP_OR_EMPTY_SYSTEM_PROMPT =
  "你是一名专业路演答辩评委，只输出一个问题或 NO_DYNAMIC_FOLLOWUP。";

export async function callMainDynamicFollowup({
  userId,
  transcript,
  aiContext,
  existingQuestions,
}: {
  userId: string;
  transcript: string;
  aiContext: ProjectAIContext | null;
  existingQuestions: string;
}) {
  const followupTemplate = await loadPromptTemplate("dynamic-followup");

  const followupPrompt = renderPrompt(followupTemplate, {
    transcript,
    project: aiContext?.project ?? null,
    files: aiContext?.files ?? [],
    evaluationRule: aiContext?.evaluationRule ?? null,
    criteria: aiContext?.criteria ?? [],
    existingQuestions,
  });

  return callAI({
    task: "dynamicFollowup",
    userId,
    projectId: aiContext?.project.id,
    systemPrompt: DYNAMIC_FOLLOWUP_SYSTEM_PROMPT,
    userPrompt: followupPrompt,
    temperature: 0.3,
    maxOutputTokens: 500,
  });
}

export async function callMismatchDynamicFollowup({
  userId,
  projectId,
  projectTitle,
  projectContext,
  pitchTranscript,
}: {
  userId: string;
  projectId: string;
  projectTitle: string;
  projectContext: string;
  pitchTranscript: string;
}) {
  const mismatchTemplate = await loadPromptTemplate(
    "dynamic-followup-mismatch",
  );
  const mismatchPrompt = renderPrompt(mismatchTemplate, {
    projectTitle,
    projectContext,
    pitchTranscript,
  });

  return callAI({
    task: "dynamicFollowup",
    userId,
    projectId,
    systemPrompt: DYNAMIC_FOLLOWUP_OR_EMPTY_SYSTEM_PROMPT,
    userPrompt: mismatchPrompt,
    temperature: 0.3,
    maxOutputTokens: 500,
  });
}

export async function callContentDynamicFollowup({
  userId,
  projectId,
  projectTitle,
  projectContext,
  pitchTranscript,
  existingQuestions,
}: {
  userId: string;
  projectId: string;
  projectTitle: string;
  projectContext: string;
  pitchTranscript: string;
  existingQuestions: string;
}) {
  const contentTemplate = await loadPromptTemplate("dynamic-followup-content");
  const contentPrompt = renderPrompt(contentTemplate, {
    projectTitle,
    projectContext,
    pitchTranscript,
    existingQuestions,
  });

  return callAI({
    task: "dynamicFollowup",
    userId,
    projectId,
    systemPrompt: DYNAMIC_FOLLOWUP_SYSTEM_PROMPT,
    userPrompt: contentPrompt,
    temperature: 0.3,
    maxOutputTokens: 500,
  });
}
