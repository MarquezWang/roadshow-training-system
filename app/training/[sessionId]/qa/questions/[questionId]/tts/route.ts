import { NextResponse } from "next/server";
import { isSessionOwnedByCurrentUser } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { synthesizeTencentTts } from "@/lib/tencent-tts";

export const runtime = "nodejs";

type QuestionTtsContext = Readonly<{
  params: Promise<{
    sessionId: string;
    questionId: string;
  }>;
}>;

const qaVoiceTypes = [
  { name: "智柯", voiceType: 101030 },
  { name: "智瑞", voiceType: 101021 },
  { name: "智梅", voiceType: 101027 },
] as const;

const dynamicFollowupVoice = {
  name: "智希",
  voiceType: 101026,
} as const;

function getQuestionVoice(question: { orderIndex: number; source: string }) {
  if (question.source === "DYNAMIC_FOLLOWUP") {
    return dynamicFollowupVoice;
  }

  return qaVoiceTypes[(Math.max(1, question.orderIndex) - 1) % qaVoiceTypes.length];
}

export async function GET(
  _request: Request,
  context: QuestionTtsContext,
) {
  const { sessionId, questionId } = await context.params;

  if (!(await isSessionOwnedByCurrentUser(sessionId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const question = await prisma.trainingQuestion.findFirst({
    where: {
      id: questionId,
      sessionId,
    },
    select: {
      id: true,
      orderIndex: true,
      source: true,
      questionText: true,
    },
  });

  if (!question) {
    return NextResponse.json({ error: "答辩问题不存在。" }, { status: 404 });
  }

  const text = question.questionText.trim();

  if (!text) {
    return NextResponse.json({ error: "答辩问题文本为空。" }, { status: 400 });
  }

  try {
    const voice = getQuestionVoice(question);
    const result = await synthesizeTencentTts({
      text,
      voiceType: voice.voiceType,
      sessionId: `${sessionId}-${questionId}`,
    });

    return new Response(new Uint8Array(result.audioBuffer), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=300",
        "X-QA-TTS-Provider": "tencent",
        "X-QA-TTS-Voice-Name": encodeURIComponent(voice.name),
        "X-QA-TTS-Voice-Type": String(voice.voiceType),
      },
    });
  } catch (error) {
    console.error("[qa-tts] synthesize failed", {
      sessionId,
      questionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: "评委语音生成失败，已回退到浏览器语音。" },
      { status: 502 },
    );
  }
}
