import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";

export const runtime = "nodejs";

export async function GET() {
  try {
    const template = await loadPromptTemplate("project-summary");
    const userPrompt = renderPrompt(template, {
      projectName: "AI 调用连通性测试项目",
      project: {
        name: "AI 调用连通性测试项目",
        field: "测试赛道",
        stage: "开发测试",
        summary: "用于验证统一 AI 调用封装是否能返回文本。",
        coreTechnology: "无真实项目技术，仅用于接口测试。",
        applicationScenario: "开发环境连通性验证。",
        businessModel: "材料未提供。",
        cooperationDemand: "材料未提供。",
      },
      files: [
        {
          originalName: "test.txt",
          fileType: "txt",
          extractedText:
            "这是开发测试输入，不包含真实上传文件或敏感项目信息。",
        },
      ],
    });

    const result = await callAI({
      systemPrompt:
        "你是路演培训系统的开发测试助手。请严格遵守用户 Prompt 的 JSON 输出要求。",
      userPrompt,
      temperature: 0.2,
    });

    return NextResponse.json({
      text: result.text,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI 测试接口调用失败。";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
