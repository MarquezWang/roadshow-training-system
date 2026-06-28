import { NextResponse } from "next/server";
import { isProjectOwnedByCurrentUser } from "@/lib/auth-server";
import {
  buildProjectAIContext,
  ProjectContextNotFoundError,
} from "@/lib/project-context";

type AIContextRouteContext = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export async function GET(_request: Request, context: AIContextRouteContext) {
  const { id } = await context.params;

  try {
    if (!(await isProjectOwnedByCurrentUser(id))) {
      return NextResponse.json({ error: "项目不存在。" }, { status: 404 });
    }

    const aiContext = await buildProjectAIContext(id);

    return NextResponse.json(aiContext);
  } catch (error) {
    if (error instanceof ProjectContextNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "AI 上下文组装失败。" },
      { status: 500 },
    );
  }
}
