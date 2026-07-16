import { createHash } from "node:crypto";
import {
  buildProjectAIContext,
  type ProjectAIContext,
} from "@/lib/project-context";

export function calculateProjectContextHash(context: ProjectAIContext) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

export async function calculateCurrentProjectContextHash(projectId: string) {
  return calculateProjectContextHash(await buildProjectAIContext(projectId));
}
