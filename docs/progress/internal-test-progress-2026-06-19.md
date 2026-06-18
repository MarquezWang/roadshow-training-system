# Internal Test 阶段进度记录（2026-06-19）

## 1. 当前分支与最新提交

- 当前分支：`internal-test`
- 最新提交：`3ef215d test: add dynamic follow-up preflight stability test`
- 当前分支已推送并与 `origin/internal-test` 同步。

## 2. 本阶段已完成事项

### 2.1 训练状态与刷新中止保护

- 路演和答辩进行中刷新或离开页面时，会按现有保护逻辑标记训练中止。
- `ABORTED` 状态统一进入报告页，避免继续回到训练流程。
- end-pitch 增加状态守卫，仅允许 `PITCHING` 转为 `QA_READY`。
- 已结束或后续状态重复调用 end-pitch 时保持幂等，避免状态回退和重复 END 事件。

### 2.2 自动转写与 ASR 保护

- 正式评分以自动转写结果作为主要依据。
- 讯飞 ASR 增强调试日志，可观察订单状态、失败类型、结果长度和预估时间等字段。
- 转写失败提供明确状态和友好提示，不将中间失败过早写成最终失败。
- 最终转写失败或 QA 已答但无录音时，基础报告可走降级路径，避免永久等待。

### 2.3 动态追问 Q4

- 动态追问作为 Q4 追加，不替换 Q1-Q3。
- Q4 基于本轮 Pitch 自动转写生成，并使用独立 1 分钟回答时间。
- 内容过短、明显离题、项目语境不足或输出不可靠时跳过 Q4，不阻塞基础三问。
- Q4 当前暂不计入总分。
- 报告中通过 `dynamicFollowupReview` 单独展示动态追问表现。

### 2.4 报告生成稳定性

- AI 返回非法 JSON 时先执行 repair。
- repair 仍失败时生成并校验 fallback analysis，避免直接进入报告失败页。
- Analysis POST 已增加单实例轻量并发保护，复用未超时的 `PROCESSING` 记录，超时后允许接管。
- 已完成 analysis 会检查 transcript 是否更新，仅 stale 时重新生成。
- QA transcript 仍在处理时继续等待；超过等待窗口后可基于已有内容降级生成。

### 2.5 答辩答案与录音幂等

- QA answer 重复提交采用“只增强、不降级”合并规则。
- 已有 recording 不会被空请求或不同 recording 覆盖，有效文本不会被空文本或更短文本覆盖。
- Recording 上传按训练阶段守卫，非法阶段不创建记录。
- Pitch 录音允许在 `PITCHING` 上传，并为进入 `QA_READY` 后的正常晚到上传保留短暂窗口。
- QA 录音只允许在 `QAING` 阶段上传。

### 2.6 稳定性测试体系

当前已有以下 HTTP 集成测试：

- end-pitch guard
- report/status guard
- QA answer idempotency
- dynamic follow-up preflight

测试使用 Node 20 内置 `node:test` 和 `assert`，不依赖 Jest、Vitest 或 Playwright。测试通过 `STABILITY_TEST_DATABASE_URL` 使用独立 SQLite 测试库，总入口为：

```powershell
npm run test:stability
```

## 3. 已验证场景

- `npm run lint` 已通过。
- `npm run test:stability` 已通过。
- 最近一次稳定性测试结果：20 tests、20 pass、0 fail、0 skipped。
- Dynamic follow-up 单项测试结果：4 pass、0 fail、0 skipped。

上述结果表示当前覆盖用例通过，不代表所有浏览器、网络和外部服务场景均已验证。

## 4. 当前暂存但不开发的产品想法

### 4.1 通用训练模板化

以下内容仅作为产品方向记录，暂不进入开发：

- 系统未来不只服务路演大赛，路演大赛可作为一个专题模板。
- 后续可扩展熠星大赛、高创杯、融资路演、技术成果转化汇报和自定义训练等模板。
- 每个模板可配置评分标准、路演时长、答辩题数、单题答题时长、是否启用动态追问、Q4 是否计分和报告结构。
- 后续用户可能自行设置路演和答辩时间。
- 该方向尚未完全梳理，当前不开发。
- 开发前应先只读盘点现有写死项和评分规则结构。

## 5. 当前仍需复查的问题

- prepare / QA 刷新中止后的前端提示体验是否足够清楚。
- report 页中止态展示是否需要优化。
- 文件预览和翻页体验是否稳定。
- QA 总时长耗尽场景已有代码保护，后续可补专项测试。
- 多实例部署前，analysis 并发保护仍需数据库级强幂等。
- 用户自定义评分和时长暂不开发。

## 6. 下一步建议

1. 先做一次真实页面流程复查。
2. 再处理刷新中止后的提示体验。
3. 再复查 report 中止态展示。
4. 最后考虑补 QA 总时长耗尽专项测试。
5. 暂不做训练模板化和自定义评分/时长。

## 7. 常用检查命令

```powershell
npm run lint
npm run test:stability
git status -sb
git log --oneline -12
```
