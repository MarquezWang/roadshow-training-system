# 知识数据整理指南

本目录说明真实评审规则、专家评语、历史评委问题等知识数据的整理方式。所有真实资料进入系统前必须先脱敏，不要上传、提交或导入涉密、未公开、敏感项目资料。

## 评审规则整理

评审规则建议整理为 JSON 文件，放在 `data/knowledge/rules/`。每套规则对应一个 `EvaluationRule`，包含规则名称、大赛名称、版本、总分、说明和评分指标列表。

评分指标对应 `EvaluationCriterion`，建议保留：

- `category`：一级指标，例如项目团队、科技含量、市场机会。
- `name`：二级指标名称。
- `description`：评价标准。
- `weight`：最高分值或权重。
- `scoringGuide`：评分参考，可为空。
- `sortOrder`：展示和评分排序。

## 专家评语整理

专家评语对应 `ExpertComment`。建议每条评语至少保留评价维度和原始评语：

- `contestName`：来源大赛，可为空。
- `projectField`：项目领域，可为空，无法判断时留空作为通用语料。
- `dimension`：评价维度，例如项目团队、科技含量、市场机会、知识产权、转化落地、商业模式、路演表达。
- `commentText`：脱敏后的专家原始评语。
- `problemType`、`suggestionType`、`scoreRange`：后续可逐步补充。

## 历史评委问题整理

历史问题对应 `HistoricalQuestion`。建议保留：

- `contestName`：来源大赛，可为空。
- `projectField`：项目领域，可为空。
- `perspective`：提问视角，例如技术专家、产业方、投资机构、知识产权专家、成果转化专家。
- `questionText`：问题内容。
- `focus`：考察重点，可为空。

## TSV 原始评语处理

原始 TSV、Excel、Word 等资料可以先放在 `data/raw/`，但默认不建议提交到 Git。TSV 评语文件建议包含：

- `achievement_name`：成果或项目名称，仅用于辅助判断，导入前应脱敏。
- `evaluate_content`：专家评语正文。

当前导入脚本草稿会读取 `data/raw/export-evaluate-content2026-03-04_20-23-03.tsv`，跳过空评语和过短评语，并按关键词粗略分类评价维度。分类结果只是导入准备，后续仍需要人工复核。

## 安全要求

- 真实资料必须先脱敏。
- 不要把涉密、未公开、敏感项目资料放入仓库。
- 不要提交原始 TSV、Excel、Word 等资料。
- 本阶段只做语料整理和导入准备，不调用 AI API。
