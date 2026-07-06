# Prompt 变更记录

本文件记录 Prompt 的产品级改动。只要修改 `prompts/*.md` 中的业务语义，就应记录。

## 记录模板

```md
## YYYY-MM-DD prompt-name

改动：
- 

原因：
- 

预期影响：
- 

验证样本：
- 

回滚方式：
- 恢复到 commit `<hash>` 中的 `prompts/prompt-name.md`
```

## 2026-07-06 dynamic-followup

改动：
- 在 `dynamic-followup.md` 中补充禁止引入 Pitch 原文没有出现的行业场景、客户类型、试点地点、线路、天气条件、识别准确率等具体细节。
- 在 `dynamic-followup-content.md` 中替换电力供电所示例，改为 AI 路演训练系统自身场景，避免模型照搬无关行业样例。

原因：
- 动态追问可能把 Prompt 示例中的电力行业细节带入当前项目，形成转写文本不支持的追问。

预期影响：
- 动态追问会更依赖当前 Pitch 原文，只追问已被现场表达支撑的细节或明确要求补充指标。
- 降低无关行业场景、客户类型、试点地点和指标被误带入输出的概率。

验证样本：
- `npm run test:stability`

回滚方式：
- 恢复到 commit `<hash>` 中的 `prompts/dynamic-followup.md` 和 `prompts/dynamic-followup-content.md`

## 2026-06-30 prompt-management

改动：
- 新增 Prompt 管理说明、资产清单、变更记录模板和测试样本目录。
- 未修改任何现有 Prompt 内容。

原因：
- 将 Prompt 作为产品资产管理，避免散落修改和不可追踪退化。

预期影响：
- 不影响线上 AI 输出。
- 后续修改 Prompt 时有固定入口和记录方式。

验证样本：
- 暂无业务 Prompt 改动，无需回归样本。

回滚方式：
- 删除本次新增的 Prompt 管理文档和 `prompt-tests/` 样本目录。
