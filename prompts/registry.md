# Prompt 资产清单

> 说明：这里记录 Prompt 的用途、调用位置、模型档位和风险点。元信息单独维护在本文件中，不直接写入 Prompt 文件，避免改变模型输入。

## 核心 Prompt

| Prompt 文件 | 任务 | 主要调用位置 | 模型档位 | 主要输入 | 主要输出 | 风险点 |
| --- | --- | --- | --- | --- | --- | --- |
| `project-profile-recognition.md` | 新建项目基础档案识别 | `app/api/projects/profile-recognition/route.ts` | strong | 材料文本、文件名 | 项目名称、简介、领域、应用场景、关键词、产品形态 | JSON 结构不完整、字段缺失、领域映射不稳定 |
| `project-trl-evidence-recognition.md` | TRL 证据提取 | `app/api/projects/profile-recognition/route.ts` | strong | 材料全文证据片段、基础信息 | 交付物类型、证据矩阵、缺失证据、置信度 | 高等级证据误判、证据结构缺失、过度保守 |
| `training-qa-question-generation.md` | 训练流程内评委问题生成 | `app/training/[sessionId]/qa/questions/generate/route.ts` | strong | 项目档案、材料上下文、路演转写 | Q1/Q2/Q3 问题 | 问题重复、过泛、JSON 不合法 |
| `dynamic-followup.md` | 动态追问主 Prompt | `app/training/[sessionId]/qa/questions/dynamic-followup/route.ts` | strong | 项目上下文、路演转写、已答问题 | 一个追问或 `NO_DYNAMIC_FOLLOWUP` | 过度保守、不够贴合回答、过早暴露问题文本 |
| `dynamic-followup-mismatch.md` | 动态追问兜底：上下文不匹配 | `app/training/[sessionId]/qa/questions/dynamic-followup/route.ts` | strong | 项目上下文、路演转写 | 一个追问或 `NO_DYNAMIC_FOLLOWUP` | 当前兜底开关较保守，需谨慎启用 |
| `dynamic-followup-content.md` | 动态追问兜底：内容充足但主 Prompt 未生成 | `app/training/[sessionId]/qa/questions/dynamic-followup/route.ts` | strong | 项目上下文、路演转写、已有问题 | 一个追问 | 可能生成与已问问题重复的追问 |
| `pitch-performance-analysis.md` | 训练报告 / 路演表现分析 | `app/training/[sessionId]/analysis/route.ts` | strong | 项目档案、材料、路演转写、QA 记录 | 评分、结论、优势、短板、改进建议 | 报告泛化、建议不可执行、证据不足时幻觉 |
| `question-generation.md` | 项目详情页模拟评委问题生成 | `app/projects/[id]/questions/generate/route.ts` | strong | 项目 AI 上下文 | 模拟评委问题 | 和训练问题体系不一致 |
| `material-diagnosis.md` | 材料诊断 | `app/projects/[id]/diagnosis/route.ts` | strong | 项目材料上下文 | 材料问题、优化建议 | 建议过泛、材料证据引用不足 |
| `scoring.md` | 评分规则生成/评分辅助 | `app/projects/[id]/scoring/route.ts` | strong | 项目上下文 | 评分维度或评分建议 | 与训练报告评分口径不一致 |

## 辅助 Prompt

| Prompt 文件 | 任务 | 主要调用位置 | 模型档位 | 备注 |
| --- | --- | --- | --- | --- |
| `project-summary.md` | AI 连通性测试 / 轻量摘要 | `app/api/ai/test/route.ts` | fast | 用于快速验证 AI 通道 |
| `answer-feedback.md` | 答案反馈 | 当前未发现主要调用 | strong/待确认 | 保留，后续确认是否仍使用 |
| `final-report.md` | 旧报告模板 | 当前未发现主要调用 | strong/待确认 | 保留，后续确认是否废弃 |

## 修改优先级

1. 高优先级：`pitch-performance-analysis.md`、`dynamic-followup.md`、`training-qa-question-generation.md`
2. 中优先级：`project-profile-recognition.md`、`project-trl-evidence-recognition.md`
3. 低优先级：`material-diagnosis.md`、`question-generation.md`、`scoring.md`

## 修改前检查项

- 是否会改变 JSON 输出结构？
- 是否需要同步修改解析/校验代码？
- 是否会增加 token 消耗？
- 是否会导致模型更容易虚构？
- 是否有至少 2 个样本可验证修改效果？
- 是否记录在 `prompts/changelog.md`？

