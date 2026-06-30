# Prompt 管理说明

本目录用于集中管理系统内可版本化的 AI Prompt 模板。Prompt 是产品资产，修改前应先明确目标、影响范围和验收样本。

## 当前原则

1. 不在业务代码里随手新增大段 Prompt。
2. 新增或调整 Prompt 前，先查看 `prompts/registry.md` 确认用途和调用位置。
3. 每次有意调整 Prompt，都在 `prompts/changelog.md` 记录原因、改动、影响和回滚方式。
4. 关键 Prompt 修改后，使用 `prompt-tests/` 中的样本做人工回归检查。
5. 现有 `loadPromptTemplate()` 会读取整个 Markdown 文件内容作为模型输入，因此不要在已有 Prompt 文件顶部直接添加 frontmatter 元信息，避免改变模型输入。

## 建议维护流程

1. 明确问题：例如“报告建议太泛”“动态追问不够尖锐”“TRL 判断过度保守”。
2. 找到 Prompt：从 `prompts/registry.md` 查看对应文件和调用 route。
3. 小步修改：一次只改一个目标，避免多个变量同时变化。
4. 记录变更：在 `prompts/changelog.md` 写明改动和预期影响。
5. 样本验证：使用 `prompt-tests/` 中的样本检查是否退化。
6. 再上线观察：结合 `[AI] task=... elapsedMs=...` 日志和用户反馈判断效果。

## Prompt 文件命名

使用小写字母、数字和连字符：

```text
project-profile-recognition.md
project-trl-evidence-recognition.md
training-qa-question-generation.md
dynamic-followup.md
pitch-performance-analysis.md
```

命名应表达任务，不使用“new”“final2”“test”这类临时名称。

