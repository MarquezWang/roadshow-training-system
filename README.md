# Roadshow Training System

路演培训系统，基于 Next.js、TypeScript、Tailwind CSS、Prisma 和 SQLite 搭建。

## 本地启动

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看首页。

## 数据库初始化

项目使用 Prisma + SQLite，数据库连接配置在 `.env`：

```bash
DATABASE_URL="file:./dev.db"
```

首次初始化数据库：

```bash
npx prisma format
npx prisma migrate dev
npm run prisma:seed
```

查看数据：

```bash
npx prisma studio
```

## 项目材料上传与解析

项目详情页支持上传 `.pdf`、`.pptx`、`.docx`、`.txt`，单个文件最大 30MB。文件保存到本地：

```text
uploads/projects/{projectId}/{timestamp}-{safeFileName}
```

真实上传文件不会提交到 git，仅保留 `uploads/.gitkeep` 和 `uploads/projects/.gitkeep`。

文件解析支持：

- `.txt`：直接读取文本内容。
- `.pdf`：使用 `pdf-parse` 提取 PDF 文本。
- `.docx`：使用 `mammoth` 提取 Word 文本。
- `.pptx`：使用 `jszip` 读取幻灯片 XML 中的文本节点。

解析状态：

- `PENDING`：文件已上传，尚未解析。
- `SUCCESS`：文本解析成功，`extractedText` 已写入。
- `FAILED`：解析失败，`parseError` 会记录失败原因。

材料上下文控制：

- `FileAsset.includeInAIContext` 表示文件是否允许进入 AI 上下文，默认 `true`。
- 项目详情页的文件列表会显示“纳入 AI 分析 / 不纳入 AI 分析”状态。
- 解析成功的文件可以通过“纳入分析 / 排除分析”按钮切换状态。
- 被排除的文件仍保留文件记录、上传文件和解析结果，只是不进入后续 AI 上下文。

当前不支持 OCR、图片文字识别、复杂表格结构识别、PPT 版式还原，也不会调用 AI API。

## Prompt 模板

Prompt 模板位于 `prompts/`：

- `project-summary.md`：根据项目基础信息和材料文本生成项目摘要。
- `material-diagnosis.md`：诊断路演材料完整性、逻辑性、表达问题和转化风险。
- `scoring.md`：根据评审规则和评分指标生成分项评分。
- `question-generation.md`：根据项目材料、专家评语和历史问题生成模拟评委问题。
- `training-qa-question-generation.md`：根据训练场次、项目材料、路演转写和路演表现分析生成本轮答辩问题。
- `answer-feedback.md`：根据评委问题和用户回答生成答辩反馈。
- `final-report.md`：生成综合训练报告。

每个模板都包含角色定位、输入说明、分析任务、JSON 输出格式、中文正式表达要求，以及不得编造事实的约束。

## AI 上下文组装

`lib/project-context.ts` 提供：

```ts
buildProjectAIContext(projectId: string)
```

返回内容包括：

- `project`：项目基础信息。
- `files`：已成功解析、`extractedText` 不为空且 `includeInAIContext = true` 的文件文本。
- `evaluationRule`：评审规则，优先读取“路演大赛真实评审规则”。
- `criteria`：默认评审规则下的评分指标。
- `expertComments`：专家评语，优先读取与项目赛道相关的记录。
- `historicalQuestions`：历史评委问题，优先读取与项目赛道相关的记录。
- `limits`：上下文长度限制。
- `truncated`：是否发生截断。

上下文长度限制：

- 单个文件 `extractedText` 最多取前 20000 字符。
- 所有文件合并文本最多 60000 字符。
- 专家评语最多 20 条。
- 历史问题最多 20 条。
- 超出部分会截断，并在 `truncated` 中记录。

文件材料不会全量进入上下文。`buildProjectAIContext` 只读取：

- `parseStatus = SUCCESS`
- `extractedText` 不为空
- `includeInAIContext = true`

如需排除测试材料、旧版本材料或错误上传材料，可在项目详情页点击对应文件的“排除分析”。

明显测试文件也可以用脚本批量排除：

```bash
node scripts/exclude-test-files-from-context.mjs
```

该脚本只会将匹配到的测试文件 `includeInAIContext` 设置为 `false`，不会删除文件或清空解析结果。当前会排除文件名中包含 `parse-check`、`upload-check` 的文件，以及明确命名为 `demo.txt`、`mode.txt` 的测试文件。

专家评语不会全量进入上下文。`buildProjectAIContext` 会按项目领域、评语质量和评分维度进行筛选，最多返回 20 条：

- 优先选择 `projectField` 与项目 `field` 完全匹配的评语。
- 其次选择 `projectField = null` 的通用评语。
- 不足时再用其他领域评语补充。
- 会过滤空评语、过短评语和明显无意义内容。
- 会把历史维度归一到“项目团队”“科技含量”“市场机会”“路演表达”“其他”等调试维度。
- 会控制长评语数量，避免上下文被少数长文本占满。

历史评委问题同样最多返回 20 条，会优先匹配项目领域，同时尽量覆盖技术专家、产业方、投资机构、知识产权专家、成果转化专家、合作对接方等不同视角。

`/projects/{projectId}/ai-context` 返回的 `debug` 字段用于开发阶段查看筛选情况：

- `debug.fileSelection`：文件总数、解析成功文件数、纳入文件数、排除文件数。
- `debug.expertCommentSelection`：专家评语可用数量、已选数量、按归一维度统计和是否截断。
- `debug.historicalQuestionSelection`：历史问题可用数量、已选数量、按提问视角统计和是否截断。

该筛选过程只读取数据库，不调用 AI API。

## 材料诊断

项目详情页提供“材料诊断”区域，可以点击“生成材料诊断”触发 AI 诊断。该功能只开发材料诊断，不生成评分、模拟问题、答辩反馈或综合报告。

诊断依赖以下上下文：

- 项目基础信息。
- `includeInAIContext = true`、`parseStatus = SUCCESS` 且 `extractedText` 不为空的文件文本。
- “路演大赛真实评审规则”和 12 条评分指标。
- 筛选后的专家评语。
- 历史评委问题。

诊断流程：

1. 调用 `buildProjectAIContext(projectId)` 组装文本上下文。
2. 加载 `prompts/material-diagnosis.md`。
3. 通过 `lib/prompt-renderer.ts` 渲染 Prompt。
4. 通过 `lib/ai.ts` 的 `callAI()` 调用模型。
5. 使用 `parseAIJson()` 解析 AI 返回 JSON。
6. 将结果写入 `Diagnosis` 表。

`Diagnosis` 入库规则：

- `summary` 保存 `projectSummary`。
- `completeness` 保存 `materialCompleteness`。
- `issues` 保存 `criterionAnalysis` 和 `keyIssues` 的 JSON 字符串。
- `risks` 保存 `riskPoints` 的 JSON 字符串。
- `suggestions` 保存 `slideSuggestions`、`pitchSuggestions`、`priorityActions` 的 JSON 字符串。

如果未配置 `AI_API_KEY` 或 `AI_MODEL`，页面会显示明确错误，不会崩溃。AI 返回 JSON 解析失败时，不会写入错误诊断。

AI 环境变量配置示例：

```bash
AI_PROVIDER=openai
AI_API_KEY=your_api_key_here
AI_BASE_URL=
AI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=3000
DIAGNOSIS_MOCK_MODE=false
```

触发方式：

```text
打开 /projects/{projectId}
点击“生成材料诊断”
```

诊断接口：

```text
POST /projects/{projectId}/diagnosis
```

诊断会把项目基础信息和已纳入上下文的解析文本发送给配置的大模型服务。不要上传涉密、未公开、敏感项目资料；如需处理真实项目资料，应确认模型服务的数据保留、训练、删除和私有化部署策略。

### 材料诊断稳定性建议

长 PDF 或页数较多的路演材料会增加模型输出长度和响应时间。材料诊断已经做了输出压缩，并会在第一次 JSON 解析失败时自动尝试 1 次 JSON 修复。

建议配置：

```bash
AI_TIMEOUT_MS=120000
AI_MAX_OUTPUT_TOKENS=5000
```

如模型支持更长输出，也可以将 `AI_MAX_OUTPUT_TOKENS` 设置为 `6000`。

常见失败原因：

- `Unterminated string in JSON`：通常是模型输出 JSON 字符串未闭合，或输出被截断。
- `AI 调用超时`：通常是材料较长、模型响应较慢，或服务端超时设置偏低。

处理方式：

- 系统会自动尝试 1 次 JSON 修复，修复成功后正常写入 `Diagnosis`。
- 如果仍失败，可以重试生成。
- 如果频繁超时，建议提高 `AI_TIMEOUT_MS` 到 `120000`。
- 如果频繁 JSON 截断，建议将 `AI_MAX_OUTPUT_TOKENS` 设置到 `5000` 到 `6000`，或减少纳入 AI 上下文的材料长度。

### 材料诊断 Mock 模式

开发验收时可以开启 Mock 模式，在不配置 `AI_API_KEY` 和 `AI_MODEL` 的情况下生成一条结构合法的模拟诊断结果：

```bash
DIAGNOSIS_MOCK_MODE=true
```

说明：

- `DIAGNOSIS_MOCK_MODE=false`：默认行为，正常通过 `lib/ai.ts` 调用 AI。
- `DIAGNOSIS_MOCK_MODE=true`：使用 `lib/mock-diagnosis.ts` 本地生成模拟诊断，不调用 AI API。
- Mock 诊断会按当前 `buildProjectAIContext` 返回的评分指标生成 `criterionAnalysis`，数量应等于真实评审规则的 12 条指标。
- Mock 诊断仅用于开发验收，不代表真实 AI 诊断质量。
- 页面会显示“Mock 诊断”标签。
- 正式测试前应关闭 Mock 模式，并配置 `AI_API_KEY` 和 `AI_MODEL`。

## AI 评分

项目详情页提供“AI 评分”区域，可以点击“生成 AI 评分”触发评分。该功能只生成评分结果，不生成模拟问题、答辩反馈或综合报告。

证据链是指模型在给出评分、扣分或追问时，同时给出来自项目材料的短句依据和材料位置。它用于降低数字、年份、金额、比例、专利数量、客户数量等事实被误读或编造的风险。

评分依据：

- “路演大赛真实评审规则”。
- 12 条 `EvaluationCriterion`，包括一级指标 `category`、二级指标 `name` 和分值 `weight`。
- `includeInAIContext = true`、`parseStatus = SUCCESS` 且 `extractedText` 不为空的项目材料。
- 筛选后的专家评语。
- 历史评委问题。

评分接口：

```text
POST /projects/{projectId}/scoring
```

评分流程：

1. 调用 `buildProjectAIContext(projectId)` 组装文本上下文。
2. 加载 `prompts/scoring.md`。
3. 通过 `lib/prompt-renderer.ts` 渲染 Prompt。
4. 通过 `lib/ai.ts` 的 `callAI()` 调用模型。
5. 使用 `parseAIJson()` 解析 AI 返回 JSON。
6. 使用 `validateScoreResult()` 校验评分结构、分值范围、总分和一级指标汇总。
7. 将结果写入 `ScoreResult` 表。

`ScoreResult` 入库规则：

- `projectId` 保存当前项目。
- `ruleId` 保存当前 `evaluationRule.id`。
- `totalScore` 保存 AI 输出总分。
- `scoreDetail` 保存 `{ categoryScores, scoreItems, scoreWarnings }` 的 JSON 字符串，其中每个 `scoreItems[]` 会包含 `evidence.evidenceText` 和 `evidence.evidenceLocation`。
- `comments` 保存 `overallComment`。

评分校验要求：

- `scoreItems` 必须有且仅有 12 条，对应真实评审规则的 12 条指标。
- 每项 `maxScore` 必须等于对应 `EvaluationCriterion.weight`。
- 每项 `score` 必须是 0 到 `maxScore` 之间的整数。
- `totalScore` 必须等于 12 条 `scoreItems.score` 之和。
- `categoryScores` 必须按一级指标汇总：项目团队 `/20`、科技含量 `/30`、市场机会 `/50`。
- 每个 `scoreItems[]` 必须包含证据摘录。
- 涉及数字、年份、金额、比例、专利数量、客户数量等事实时，证据摘录必须能提供材料依据。
- 校验失败时不会写入 `ScoreResult`。

触发方式：

```text
打开 /projects/{projectId}
点击“生成 AI 评分”
```

如果未配置 `AI_API_KEY` 或 `AI_MODEL`，页面会显示明确错误，不会崩溃。

AI 评分会把项目基础信息和已纳入上下文的解析文本发送给配置的大模型服务。不要上传涉密、未公开、敏感项目资料；如需处理真实项目资料，应确认模型服务的数据保留、训练、删除和私有化部署策略。

## 模拟评委问题

项目详情页提供“模拟评委问题”区域，可以点击“生成模拟评委问题”触发问题生成。该功能只生成问题，不开发答辩反馈或综合报告。

模拟问题同样会记录证据链。问题生成不等于事实审计，模型仍可能误读 PDF 中的数字、表格或跨页信息，重要结论需要人工复核。

问题生成依据：

- 项目基础信息。
- `includeInAIContext = true`、`parseStatus = SUCCESS` 且 `extractedText` 不为空的项目材料。
- “路演大赛真实评审规则”和 12 条 `EvaluationCriterion`。
- 筛选后的专家评语。
- 历史评委问题。
- 最近一次材料诊断。
- 最近一次 AI 评分结果。

问题生成接口：

```text
POST /projects/{projectId}/questions/generate
```

生成流程：

1. 调用 `buildProjectAIContext(projectId)` 组装文本上下文。
2. 读取当前项目最近一次 `Diagnosis` 和最近一次 `ScoreResult`。
3. 加载 `prompts/question-generation.md`。
4. 通过 `lib/prompt-renderer.ts` 渲染 Prompt。
5. 通过 `lib/ai.ts` 的 `callAI()` 调用模型。
6. 使用 `parseAIJson()` 解析 AI 返回 JSON。
7. 使用 `validateGeneratedQuestions()` 校验问题结构和视角数量。
8. 校验通过后写入 `Question` 表。

`Question` 入库结构：

- `projectId` 保存当前项目。
- `type` 保存问题类型，例如技术验证、市场验证、团队能力、知识产权、转化落地、融资计划。
- `perspective` 保存评审视角，例如技术专家、产业方、投资机构、知识产权专家、成果转化专家、合作对接方。
- `content` 保存问题内容。
- `focus` 保存考察重点。
- `suggestedDirection` 保存建议回答方向。
- `evidenceText` 保存支撑该问题的材料证据短句。
- `evidenceLocation` 保存证据位置，例如页码、章节、文件名或材料位置。
- `factCheckNote` 保存事实校验说明，例如“来自材料原文”“需人工复核”或“口径可能不一致”。

校验要求：

- AI 必须返回合法 JSON。
- `questions` 必须正好 10 条。
- 视角分布必须为：技术专家 2 条、产业方 2 条、投资机构 2 条、知识产权专家 1 条、成果转化专家 2 条、合作对接方 1 条。
- 每条问题必须包含 `type`、`perspective`、`content`、`focus`、`suggestedDirection`。
- 每条问题必须包含证据摘录。
- 如果问题内容出现数字、年份、金额、比例、专利数量、客户数量、销售区域或营收预测，必须有材料证据，不能用“材料未提供相关证据”替代。
- 如果问题涉及具体事实，`factCheckNote` 应说明依据来自材料原文或需要人工复核。
- 校验失败时不会写入 `Question`。

触发方式：

```text
打开 /projects/{projectId}
点击“生成模拟评委问题”
```

如果未配置 `AI_API_KEY` 或 `AI_MODEL`，页面会显示明确错误，不会崩溃。

模拟评委问题生成会把项目基础信息、已纳入上下文的解析文本、诊断摘要和评分结果发送给配置的大模型服务。不要上传涉密、未公开、敏感项目资料；如需处理真实项目资料，应确认模型服务的数据保留、训练、删除和私有化部署策略。

涉及真实项目材料时，仍需确认模型服务的数据保留、训练、删除和私有化部署策略。证据链只能降低事实幻觉风险，不能替代人工核验。

## AI 上下文调试接口

开发阶段可访问：

```text
/projects/{projectId}/ai-context
```

该接口只返回 JSON，用于检查上下文是否正确组装，不会调用 AI API。

项目详情页提供“查看 AI 上下文”入口。

## 当前功能阶段说明

当前已完成 Prompt 模板、AI 上下文组装、统一 AI 调用封装、材料诊断、AI 评分和模拟评委问题生成。系统仍未生成答辩反馈或综合报告。

后续 Prompt 将继续用于：

- 模拟评委提问
- 答辩反馈
- 综合训练报告生成

## AI 调用配置

统一 AI 调用封装位于 `lib/ai.ts`，所有模型调用都应通过 `callAI()` 进入。当前只支持 `AI_PROVIDER=openai`，使用 OpenAI 官方 Node SDK，非流式返回。

`.env.example` 提供了配置模板：

```bash
AI_PROVIDER=openai
AI_API_KEY=
AI_BASE_URL=
AI_MODEL=
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=3000
```

`.env.local` 示例：

```bash
AI_PROVIDER=openai
AI_API_KEY=your_api_key_here
AI_BASE_URL=
AI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=60000
AI_MAX_OUTPUT_TOKENS=3000
```

说明：

- `AI_API_KEY` 不得写死在代码中。
- `AI_BASE_URL` 可为空；为空时使用 SDK 默认配置。
- `AI_MODEL` 必须配置。
- 缺少 `AI_API_KEY` 或 `AI_MODEL` 时会返回明确错误。
- 错误信息不会主动输出 API Key。

## Prompt 渲染

`lib/prompt-renderer.ts` 提供：

```ts
renderPrompt(template, variables)
```

支持 `{{projectName}}`、`{{project.name}}` 这类简单变量替换。对象和数组会以格式化 JSON 插入模板。变量不存在时保留原占位符。

## AI 测试接口

开发测试接口：

```text
/api/ai/test
```

该接口会读取 `prompts/project-summary.md`，构造一段不包含真实上传文件的测试输入，并调用 `callAI()` 返回模型文本。

如果未配置 `AI_API_KEY` 或 `AI_MODEL`，接口会返回明确错误 JSON。

## 数据安全提醒

- 测试阶段不要上传涉密、未公开、敏感项目资料。
- 当前 AI 调用会把文本 Prompt 发送给配置的大模型服务。
- 如涉及真实项目资料，需确认模型服务的数据保留、训练、删除和私有化部署策略。
- 当前测试接口不会读取真实上传文件，也不会自动分析项目材料。

## 核心数据表用途

- `User`：系统用户，暂时支持 `ADMIN`、`TEAM`、`COACH` 三类角色。
- `Project`：路演项目基础信息，包括赛道、阶段、简介、技术、场景、商业模式和合作诉求。
- `FileAsset`：项目上传材料，记录文件路径、类型、大小、解析文本、解析状态和是否纳入 AI 上下文。
- `Diagnosis`：材料诊断结果，保存项目摘要、完整度、核心问题、风险点和修改建议。
- `ScoreResult`：评分结果，记录总分、分项评分 JSON、综合评价，并可关联评审规则。
- `Question`：模拟评委问题，记录问题类型、评审视角、考察重点和建议回答方向。
- `Answer`：用户对模拟评委问题的回答。
- `Feedback`：答辩反馈，记录回答评价、遗漏点、风险点和建议回答版本。
- `Report`：综合训练报告，可保存 Markdown 或 HTML 正文。
- `TrainingQuestion`：训练场次内的模拟答辩问题，记录问题顺序、类型、来源和提问依据。
- `TrainingAnswer`：训练场次内每题答辩回答，记录回答文本、是否查看过问题文字、开始时间、结束时间和本题用时。
- `EvaluationRule`：大赛评审规则，支持不同大赛和不同版本。
- `EvaluationCriterion`：评分指标，用于拆解评审规则中的一级指标、具体维度、分值和评分参考。
- `ExpertComment`：往期专家评语样本，用于后续材料诊断、模拟提问和答辩反馈。
- `HistoricalQuestion`：历史评委问题样本，用于后续模拟评委问题生成。
- `KnowledgeSource`：知识来源材料，记录评审规则、专家评语、历史问题、优秀案例等来源和处理状态。

## 真实评审规则与专家语料整理

本阶段只整理真实评审规则、专家评语样例和导入准备，不调用 AI API，不开发材料诊断、评分或模拟问答功能。

### 真实评审规则

真实路演大赛评审规则文件位于：

```text
data/knowledge/rules/roadshow-review-rule-100.json
```

该规则采用“一级指标、二级指标、评价标准、最高分值”的结构：

- `EvaluationRule` 保存规则名称、大赛名称、版本、总分、说明和原始规则文本。
- `EvaluationCriterion` 保存具体评分指标。
- `EvaluationCriterion.category` 表示一级指标，例如“项目团队”“科技含量”“市场机会”，该字段可为空，以兼容已有 seed 数据。
- `EvaluationCriterion.name` 表示二级指标。
- `EvaluationCriterion.description` 表示评价标准。
- `EvaluationCriterion.weight` 表示最高分值或权重。

导入真实评审规则：

```bash
node scripts/import-review-rule.mjs
```

脚本会校验 JSON 格式、`totalScore = 100`、评分指标 `weight` 总和为 100。若数据库中已存在同 `name + version` 的规则，会更新该规则并重建该规则下的评分指标，避免重复创建。

查看导入结果：

```bash
npx prisma studio
```

打开 `EvaluationRule`、`EvaluationCriterion`、`KnowledgeSource` 表，确认“路演大赛真实评审规则”及其 12 条评分指标已写入。

`buildProjectAIContext` 读取评审规则时会优先使用“路演大赛真实评审规则”；如果不存在，再使用“路演大赛通用评审规则”；如果仍不存在，则读取第一条评审规则。返回的 `criteria` 会包含 `category` 字段，便于后续按一级指标汇总。

### 知识数据样例

脱敏虚构样例位于：

```text
data/knowledge-samples/evaluation-rules.sample.json
data/knowledge-samples/expert-comments.sample.json
data/knowledge-samples/historical-questions.sample.json
```

这些样例字段与当前 Prisma 模型保持对应，可作为后续清洗真实资料时的参考格式。

### 原始专家评语 TSV

原始 TSV、Excel、Word 等资料可以临时放在：

```text
data/raw/
```

专家评语 TSV 默认文件名：

```text
data/raw/export-evaluate-content2026-03-04_20-23-03.tsv
```

TSV 需要包含字段：

- `achievement_name`
- `evaluate_content`

`data/raw/*` 默认会被 Git 忽略，只保留 `data/raw/.gitkeep` 和 `data/raw/README.md`。

### 专家评语导入脚本

导入脚本草稿位于：

```text
scripts/import-expert-comments.mjs
```

手动运行：

```bash
node scripts/import-expert-comments.mjs
```

导入前建议先 dry-run：

```bash
node scripts/import-expert-comments.mjs --dry-run
```

dry-run 不会写入数据库，会输出总行数、有效评语数、唯一评语数、已存在数量、文件内重复数量、分类统计，以及前 5 条解析样例。可以用它确认中文是否正常、字段是否解析正确。

正式导入：

```bash
node scripts/import-expert-comments.mjs
```

脚本行为：

- 读取 `data/raw/export-evaluate-content2026-03-04_20-23-03.tsv`。
- 解析 `achievement_name` 和 `evaluate_content`。
- 如果某行超过 2 列，会将第一列作为 `achievement_name`，其余列重新用 tab 拼接为 `evaluate_content`，避免评语中包含制表符导致内容丢失。
- 跳过空评语和少于 5 个字的过短评语。
- 对评语执行 trim 和空白归一化。
- 根据关键词粗略分类 `dimension`。
- 写入 `ExpertComment` 表。
- 通过 `commentText` 去重，避免重复导入。
- 在 `KnowledgeSource` 中创建或更新一条来源记录。
- 如果 TSV 文件不存在，会输出明确提示，不会调用 AI。

查看导入数量：

```bash
npx prisma studio
```

打开 `ExpertComment` 表查看总数和导入记录；也可以查看 `KnowledgeSource` 表中标题为“路演大赛历史专家评语 TSV”的记录，`rawText` 会保存最近一次导入统计摘要。

如果终端出现中文乱码，优先确认 TSV 文件本身是 UTF-8 编码。PowerShell 中查看中文时可以使用：

```powershell
Get-Content data\raw\export-evaluate-content2026-03-04_20-23-03.tsv -TotalCount 5 -Encoding UTF8
```

脚本本身使用 UTF-8 读取，不会调用 AI API。

### 知识库质量检查

运行：

```bash
node scripts/analyze-knowledge-base.mjs
```

该脚本只读取数据库，不写入数据，不调用 AI API。输出 JSON 格式统计，包括：

- `EvaluationRule` 总数、每套规则的指标数量、权重总和和一级指标分值汇总。
- `ExpertComment` 总数、按大赛和评价维度统计、过短记录数量、重复评语数量、`projectField` 为空数量，以及每个维度最多 3 条样例。
- `HistoricalQuestion` 总数和按提问视角统计。
- `KnowledgeSource` 总数、状态统计和来源列表。

### 数据安全注意事项

- 真实资料必须先脱敏。
- 不要上传、提交或导入涉密、未公开、敏感项目资料。
- 原始资料默认不建议提交到 Git。
- 本阶段不会调用 AI API；后续如果把真实文本发送给模型服务，需要先确认数据保留、训练、删除和私有化部署策略。

## 路演表现分析基础版

训练页 `/training/{sessionId}` 已支持在路演结束并保存手动转写文本后生成“路演表现分析”。本功能只分析本轮路演表达表现，不开发自动 ASR、不开发答辩反馈、不生成综合报告。

接口：

```text
POST /training/{sessionId}/analysis
GET /training/{sessionId}/analysis
```

分析输入包括：

- `TrainingSession`：路演状态、开始时间、结束时间、路演时长、当前页码。
- `SlideEvent`：START、NEXT、PREV、JUMP、END、pageIndex、elapsedSec。
- `TrainingTranscript`：优先读取该 session 下已完成的转写文本；没有转写文本时不会生成分析。
- `buildProjectAIContext`：项目基本信息、纳入 AI 上下文的解析材料、真实评审规则、评分指标、专家评语和历史问题。

生成前置条件：

- 路演必须已经结束，否则返回“请先结束路演后再分析”。
- 必须已经保存转写文本，否则返回“请先保存转写文本后再分析”。
- AI 调用仍统一通过 `lib/ai.ts`，只发送文本上下文和转写文本，不上传原始 PDF、录音或其他文件。

分析结果写入 `TrainingAnalysis`，当前 `analysisType` 为 `PITCH`，状态包括 `PENDING`、`PROCESSING`、`COMPLETED`、`FAILED`。结果维度包括：

- 总体评分 `overallScore`：0 到 100，表示本轮路演表达表现分，不是项目材料基础分。
- 总体评价 `summary`。
- 优点 `strengthsJson`。
- 问题 `weaknessesJson`。
- 改进建议 `suggestionsJson`。
- 内容覆盖情况 `coverageJson`：项目背景、痛点问题、技术方案、核心创新、应用场景、市场空间、商业模式、团队能力、融资/合作需求。
- 时间节奏 `timingJson`。
- 翻页节奏 `slideSyncJson`。
- 可能被追问的问题 `riskQuestionsJson`。
- AI 原始结构化结果 `rawResultJson`。

训练页刷新后会读取最近一次 `TrainingAnalysis` 并展示；已有结果时可以点击“重新生成分析”更新结果。

注意：

- 当前没有接入真实 ASR，不会自动把录音转成文字。
- 手动转写文本质量会直接影响分析质量。
- 如果使用外部模型服务，真实项目资料发送前仍需确认数据保留、训练、删除和私有化部署策略。

## 训练流程重构基础版

训练流程已从单页堆叠调整为分阶段路由：

```text
/training/{sessionId}/prepare
/training/{sessionId}/pitch
/training/{sessionId}/qa
/training/{sessionId}/report
```

`/training/{sessionId}` 作为入口页，会根据 `TrainingSession.status` 自动跳转：

- `CREATED`、`PITCH_READY`：进入准备页。
- `PITCHING`：进入正式路演页。
- `PITCH_ENDED`、`QA_READY`、`QAING`：进入答辩准备页。
- `QA_ENDED`、`REPORT_READY`、`FINISHED`：进入报告页。

准备页负责：

- 展示项目名称、路演规则和材料预览入口。
- 要求用户明确选择“开启麦克风并准备训练”或“暂不录音，继续训练”。
- 麦克风授权和测试在准备页完成，正式进入路演页后不再首次弹出麦克风权限确认。
- 准备完成后状态可推进到 `PITCH_READY`。

路演页负责：

- PDF 标准预览和兼容预览。
- 大屏/全屏模式。
- 9 分钟倒计时。
- 翻页和 `SlideEvent` 记录。
- 根据准备页选择的策略开始录音或跳过录音。
- 主动结束或倒计时结束后写入 END 事件，并推进到 `QA_READY`。
- 路演结束后跳转答辩准备页。
- 不再直接展示完整路演表现分析长结果。

答辩页当前支持“语音评委答辩舱”基础流程：

- 左侧为大尺寸材料参考区，右侧为答辩控制区。
- 答辩阶段可翻阅材料，但翻页不写入路演 `SlideEvent`，不参与路演节奏分析。
- 可点击“生成答辩问题”，通过 `POST /training/{sessionId}/qa/questions/generate` 生成 3 个本轮答辩问题。
- 问题生成会读取项目上下文、纳入 AI 上下文的材料文本、路演转写文本和路演表现分析；AI 调用仍统一通过 `lib/ai.ts`，不会上传原始文件。
- 如本轮已生成问题，接口默认返回已有问题，不重复生成。
- 开始答辩前只显示已生成问题数量和答辩规则，不默认展示全部问题正文。
- 点击“开始答辩”后通过 `POST /training/{sessionId}/qa/start` 将状态推进到 `QAING`，记录 `qaStartedAt`。
- 每道题进入时使用浏览器本地 `speechSynthesis` 播报评委问题，不接入外部 TTS API。
- 语音选择会优先尝试中文男声，例如 `Yunxi`、`Kangkang`、`Male`、`男` 等本地 voice；找不到时使用任意 `zh-CN` 语音，再找不到则使用浏览器默认语音。语音质量受本机系统 voices 限制。
- 播报语速略快，约 `rate = 1.15`，音高略低，约 `pitch = 0.92`。
- 如果浏览器不支持语音提问，或 `speechSynthesis.onend` 未正常触发，会自动切换或超时进入后续流程，不影响答辩。
- 问题文字默认隐藏；用户可点击“查看问题文字”，该行为会记录到 `TrainingAnswer.revealedQuestionText`。
- 语音提问结束后显示 3、2、1，再进入回答状态。
- 总答题时间为 3 分钟；评委提问和 3、2、1 期间暂停答题倒计时，回答期间倒计时继续减少。
- 答辩录音使用每题一段录音方案，每题在 3、2、1 结束后开始录音，进入下一题或完成答辩时停止并上传。
- 每段答辩录音保存为 `TrainingRecording.phase = QA`，并通过 `TrainingAnswer.recordingId` 关联到对应题目。
- 麦克风不可用时允许继续答辩，仅记录题目和时间，并显示“本题未启用录音”。
- 答辩阶段不再提供文字记录框，`answerText` 可为空，后续由 ASR 或人工转写补充。
- 每题点击“回答完毕，进入下一题”会写入 `TrainingAnswer`，包括 `recordingId`、`revealedQuestionText`、`startedAt`、`endedAt` 和 `durationSec`。
- 非最后一题主按钮为“回答完毕，进入下一题”；最后一题为“完成答辩”；剩余时间不足 30 秒时为“保存本题并完成答辩”。
- 答完所有题、主动结束或倒计时结束时，通过 `POST /training/{sessionId}/qa/end` 或答题接口完成答辩，状态推进到 `QA_ENDED`，并跳转报告页。

报告页当前仍是综合报告占位流程：

- 显示本轮训练已完成。
- 保留路演录音回放、手动转写文本保存和编辑。
- 展示路演表现分析的简要状态，并可生成或重新生成路演表现分析。
- 如果答辩已完成，展示 `TrainingQuestion` 和 `TrainingAnswer` 的问题、回答用时、是否查看过问题文字和回答摘要。
- 如果存在 QA 录音，按每个问题分别展示对应录音回放控件。
- 如果某题没有录音，显示“本题未保存录音”。
- 如果本题没有文字回答，显示“语音回答已记录，待转写”。
- 暂不生成完整综合报告、答辩评分、答辩分析、雷达图。

当前没有接入真实 ASR。录音不会自动转写，仍需手动保存转写文本。
当前没有开发答辩 AI 评分或最终综合报告生成，也没有接入外部 TTS API。
