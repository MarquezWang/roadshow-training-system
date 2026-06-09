import { access, readFile } from "fs/promises";
import path from "path";

const PROMPTS_DIRECTORY = path.resolve(process.cwd(), "prompts");
const PROMPT_NAME_PATTERN = /^[a-z0-9-]+$/;

export async function loadPromptTemplate(name: string) {
  if (!PROMPT_NAME_PATTERN.test(name)) {
    throw new Error("Prompt 模板名称只能包含小写字母、数字和连字符。");
  }

  const filePath = path.resolve(PROMPTS_DIRECTORY, `${name}.md`);
  const relativePath = path.relative(PROMPTS_DIRECTORY, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Prompt 模板路径不在 prompts 目录下。");
  }

  try {
    await access(filePath);
  } catch {
    throw new Error(`Prompt 模板不存在：${name}`);
  }

  return readFile(filePath, "utf8");
}
