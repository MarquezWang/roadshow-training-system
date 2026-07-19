import { createHash } from "node:crypto";

export const LEGACY_PROVENANCE_VERSION = "legacy-unknown";

export function calculatePromptVersion(name: string, template: string) {
  const digest = createHash("sha256").update(template).digest("hex");
  return `${name}:sha256:${digest}`;
}
