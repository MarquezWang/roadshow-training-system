# Scoring v2 Phase 1 Audit

本阶段只做评分口径审计、稳定性测量和材料评分 evidence mapper 接入，不改数据库 schema，不改 UI 文案，不继续拆报告页组件。

## 分数口径

- `materialScore`：项目材料基础分，来自 `ScoreResult.totalScore`。当前正式口径为 evidence mapper 分：AI 只负责输出 12 条评分项的证据强度、风险等级、证据文本和理由，后端用确定性 mapper 生成 `scoreItems[].score`、`categoryScores` 和 `totalScore`。
- `performanceScore`：本轮路演/答辩表现分，当前对应 `TrainingAnalysis.overallScore`。它由 `prompts/pitch-performance-analysis.md` 的路演表现分析 AI 调用生成。
- `compositeScore`：真正综合评分，本阶段只通过 `lib/scoring-v2.ts` 的 `deriveCompositeScore()` 派生，不入库。默认公式为 `materialScore * 0.7 + performanceScore * 0.3`，权重可配置。

## 当前评分链路

### `ScoreResult.totalScore`

- 生成入口：`app/projects/[id]/scoring/route.ts`。
- Prompt：`prompts/scoring.md`。
- 上下文：`lib/project-context.ts` 组装项目基础信息、纳入 AI 上下文的材料文本、评审规则、评分指标、专家评语和历史问题。
- 校验/映射：`lib/scoring-validator.ts` 的 `validateScoreResult()` 校验证据结构完整性，不信任 AI 输出的正式分数；`lib/scoring-v2.ts` 的 `deriveDeterministicMaterialScore()` 根据 `evidenceStrength`、`riskLevel` 和指标权重生成正式 mapped score，并要求 `totalScore` 等于全部 `scoreItems[].score` 之和。
- 存储：`prisma/schema.prisma` 的 `ScoreResult.totalScore`、`ScoreResult.scoreDetail`、`ScoreResult.comments`。
- 展示/引用：README 描述 AI 评分链路；`app/projects/[id]/questions/generate/route.ts` 读取最近一次 `ScoreResult.totalScore` 作为生成模拟评委问题的上下文；项目详情页当前主要展示训练趋势，没有直接展示最近材料总分。

### `scoreItems[].score` 的 12 条评分项

- 定义源：数据库 `EvaluationCriterion` 表；导入源通常是 `data/knowledge/rules/roadshow-review-rule-100.json`。
- 导入脚本：`scripts/import-review-rule.mjs` 校验 `totalScore = 100`，并写入 `EvaluationRule` 和 `EvaluationCriterion`。
- 当前规则：`路演大赛真实评审规则`，版本 `2026-v1`，共 12 条指标。
- 一级维度：项目团队、科技含量、市场机会。
- 存储结果：每次材料评分的 12 条 mapped 分数保存在 `ScoreResult.scoreDetail` JSON 的 `scoreItems` 中；`scoreDetail.scoringMethod = "evidence_mapper_v2"`。`aiSuggestedScore` 可保留为审计字段，但不参与正式 `totalScore`。

### `TrainingAnalysis.overallScore`

- 生成入口：`app/training/[sessionId]/analysis/route.ts`。
- Prompt：`prompts/pitch-performance-analysis.md`。
- 语义：prompt 明确写明 `overallScore` 是 0 到 100 的整数，表示本轮路演表达表现分，不是项目材料基础分。
- 输入：训练场次、翻页事件、路演转写、常规 QA 数据、动态追问数据、项目上下文、评审规则和材料。
- 降级路径：当没有可分析文本或 AI JSON 修复失败时，route 会生成 fallback 分数，目前 `FALLBACK_ANALYSIS_SCORE = 15`。
- 存储：`prisma/schema.prisma` 的 `TrainingAnalysis.overallScore`；完整 AI 结构存在 `TrainingAnalysis.rawResultJson`。
- 下游引用：训练页、报告页、项目详情页训练趋势、QA 题目生成接口都会读取该字段。

## 发现的口径问题

- `prompts/pitch-performance-analysis.md` 和 README 已经把 `overallScore` 定义为路演表达表现分，但 UI 中仍有“综合评分”或“总体评分”文案。
- `app/training/[sessionId]/report/report-overview-summary.tsx` 把 `analysis.overallScore` 展示为“综合评分”，应改为“本轮表现分”或改用未来的 `compositeScore`。
- `app/training/[sessionId]/report/use-report-analysis-summary.ts` 复制摘要中输出“综合评分：${overallScore}/100”，应改为“本轮表现分”或改用未来的 `compositeScore`。
- `app/training/[sessionId]/training-session-client.tsx` 把 `analysis.overallScore` 展示为“总体评分”，应改为“路演表现分”或“本轮表现分”。
- `app/projects/[id]/page.tsx` 的训练进步趋势使用 `overallScore`，文案为“最近一次评分”“最近得分走势”。虽然没有直接写“综合评分”，但容易被理解成综合分，建议改为“最近一次表现分”“表现分走势”。
- `app/training/[sessionId]/report/report-pitch.tsx` 位于“路演表现分析”区块中直接显示 `overallScore`，语境基本正确，但建议补充标签“本轮表现分”。
- `app/training/[sessionId]/pitch/page.tsx`、`app/training/[sessionId]/report/report-page-data.ts`、`app/training/[sessionId]/report/report-analysis-normalizers.ts`、`lib/use-pitch-analysis.ts` 属于数据传递或页面初始化引用，不构成文案问题。
- `app/training/[sessionId]/qa/questions/generate/route.ts` 把最近路演表现分析传给 QA 题目生成 prompt，这是上下文引用，不构成展示口径问题。
- `app/admin/prompts/page.tsx` 只列出 prompt 资产，未展示训练分数。

## 测量脚本

脚本：`scripts/measure-scoring-stability.mjs`

用途：

- 固定同一项目材料、同一份 Pitch 转写、同一组 QA 数据。
- 连续调用材料评分 prompt 和路演表现分析 prompt。
- 记录 `ScoreResult.totalScore` 等价的材料总分、12 条 `scoreItems[].score`、`TrainingAnalysis.overallScore` 等价的表现分、QA 的 `GOOD/PARTIAL/WEAK`、生成时间、模型、prompt 文件 hash 和渲染后 prompt hash。
- 输出最小值、最大值、波动范围、平均值、标准差。
- 不写入数据库，不保存完整 AI 原文。

运行方式：

```bash
node scripts/measure-scoring-stability.mjs --list-candidates
node scripts/measure-scoring-stability.mjs --session-id <sessionId> --runs 5
node scripts/measure-scoring-stability.mjs --project-id <projectId> --session-id <sessionId> --runs 10
```

默认输出目录：`tmp/scoring-v2-stability/`。

## 第一阶段边界

- 不覆盖 `TrainingAnalysis.overallScore`。
- 不新增数据库字段。
- 不迁移历史数据。
- 不调整报告页 UI。
- 不把 `compositeScore` 作为唯一突出分数；后续 UI 应同时展示项目基础分、本轮表现分、综合评分/路演准备度。

## 本地测量复核

- 候选样本查询通过，当前可用样本包括项目 `cmr265doy0001fifwrfrs7sbk`、训练场次 `cmr6dqivp0001a5uzh29x6fc4`，该样本有 1 份纳入 AI 上下文的材料、1 份 Pitch 转写、3 条常规 QA 回答和 1 条动态追问。
- 已执行 `npm run scoring-v2:measure -- --session-id cmr6dqivp0001a5uzh29x6fc4 --runs 5`。
- 当前冻结版本测量结果：`validMappedMaterialScore` count 5，range 3，standardDeviation 1.02，`invalidMaterialRuns=[]`。
- 正式材料评分 route 已写入 `scoreDetail.scoringMethod = "evidence_mapper_v2"`；一次手动触发确认 `ScoreResult.totalScore` 等于 `scoreItems[].score` 之和，且不同于 `aiSuggestedScore` 合计。
- 材料评分 v2 一阶段可作为稳定版本冻结；后续只在新增规则、mapper 权重或证据 schema 时复跑同一测量脚本。

## 第二阶段建议

材料评分 v2 测试补齐并提交后，再另起 performance-v2。第二阶段再拆表现分子项：内容覆盖、证据充分性、时间控制、翻页节奏、QA 回答质量，由 AI 输出证据和定性标签，代码做映射和加权。
