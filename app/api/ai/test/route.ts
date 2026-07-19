import { NextResponse } from "next/server";
import { callAI } from "@/lib/ai";
import { createAIResourceLimitResponse } from "@/lib/ai-http-response";
import { loadPromptTemplate } from "@/lib/prompt-loader";
import { renderPrompt } from "@/lib/prompt-renderer";
import { isAuthEnabled } from "@/lib/auth";
import { getCurrentAuthUser } from "@/lib/auth-server";

export const runtime = "nodejs";

export async function GET() {
  const isProduction = process.env.NODE_ENV === "production";
  const user = await getCurrentAuthUser();

  if (isProduction) {
    // 生产环境仅作为管理员诊断入口：未登录、未开启鉴权或非管理员一律返回 404，
    // 与 /admin 系列页面的 requireAdminUser() 行为保持一致，不额外暴露"存在该接口"的信息。
    if (!isAuthEnabled() || !user || user.role !== "ADMIN") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  } else if (isAuthEnabled() && !user) {
    // 开发环境仍允许本地联调，但如果本地也开了 AUTH_ENABLED，登录态要求保持一致。
    return NextResponse.json(
      { error: "请先登录后再使用该接口。" },
      { status: 401 },
    );
  }

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
      task: "aiConnectivityTest",
      userId: user?.id,
      systemPrompt:
        "你是路演培训系统的开发测试助手。请严格遵守用户 Prompt 的 JSON 输出要求。",
      userPrompt,
      temperature: 0.2,
    });

    return NextResponse.json({
      text: result.text,
    });
  } catch (error) {
    const resourceLimitResponse = createAIResourceLimitResponse(error);
    if (resourceLimitResponse) return resourceLimitResponse;

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
