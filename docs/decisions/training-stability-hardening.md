# Training Stability Hardening Notes

## 背景

训练主链路覆盖 prepare、pitch、QA、转写、analysis 和 report。随着动态追问、自动转写和 AI 报告逐步接入，外部服务波动、重复请求、页面刷新及晚到请求可能放大为状态回退、报告永久等待或错误内容进入答辩等问题。

近期稳定性工作以小范围保护为主，不改变基础三问、评分主逻辑和数据库结构。目标不是完全杜绝所有异常，而是降低风险、增加兜底，并避免单个可恢复错误中断整条训练流程。

## 修复目标

1. 保持 Q1-Q3 基础答辩流程稳定。
2. 将 Q4 动态追问作为可选增强，不让生成失败阻塞答辩。
3. 对 ASR 和 AI 输出的临时性错误增加重试或降级路径。
4. 防止重复请求、晚到请求和阶段不匹配请求污染训练状态。
5. 报告生成失败时优先提供可用的降级报告，而不是直接展示失败页。
6. 保持旧训练记录和无 Q4 记录的兼容性。

## 已完成修复清单

| 范围 | 原风险 | 当前保护 | 处理类型 |
| --- | --- | --- | --- |
| Dynamic follow-up | 替换 Q1 导致题目时序和页面状态不一致 | Q4 独立追加，Q1-Q3 保持不变 | 结构调整 |
| Dynamic follow-up | 离题、空项目、过短 Pitch 仍生成幻觉问题 | preflight 和输出校验不通过时不创建 Q4 | 跳过 |
| Dynamic follow-up | AI 空返回或异常导致接口 500 | 返回 skipped/no dynamic follow-up | 降级 |
| Q4 报告 | Q4 混入常规答辩评分 | Q4 单独进入 `dynamicFollowupReview`，暂不计入总分 | 隔离 |
| ASR | 外部服务临时失败导致转写链路中断 | 有限重试并保留最终失败状态 | 重试/降级 |
| ASR 可观测性 | 轮询状态不透明，难以定位长时间未完成 | `XFYUN_DEBUG` 输出关键状态字段 | 诊断增强 |
| Analysis | AI 偶发输出非法 JSON 导致报告失败 | main parse、repair、fallback 三层保护 | 修复/降级 |
| Analysis 并发 | 重复生成报告、重复调用 AI、产生多条记录或状态不稳定 | 未超时 `PROCESSING` 直接复用，`COMPLETED` 未 stale 直接返回，`FAILED` 允许重试，超时 `PROCESSING` 可接管 | 幂等/轻量锁 |
| 状态机 | 重复 end-pitch 将后续或终态拉回 `QA_READY` | 仅允许合法状态转换，重复请求幂等处理 | 硬阻断/幂等 |
| Report status | 已答题但无录音时永久等待 | 缺录音或 transcript 的已答题可降级生成报告 | 降级 |
| Answer 保存 | 弱重复请求覆盖有效录音或文本 | 只增强、不降级地合并 answer | 幂等合并 |
| Recording 上传 | 终态或阶段不匹配时仍创建录音 | 按 phase 和 session status 校验 | 硬阻断 |

## 状态机保护

### End Pitch

原先重复调用 end-pitch 可能覆盖 `pitchEndedAt`、重复写入 END 事件，并将 `ABORTED`、`QAING` 或 `FINISHED` 等状态重新写成 `QA_READY`。

当前保护如下：

- 只有 `PITCHING` 可以执行正式结束逻辑并转换为 `QA_READY`。
- 已结束 Pitch 或已进入后续阶段时返回幂等结果，不重复写 END 事件，不覆盖结束时间，也不回退状态。
- `ABORTED`、尚未开始 Pitch 或未知状态不允许结束 Pitch。
- 状态转换使用条件更新和事务；只有成功取得状态转换的请求可以创建 END 事件。

这类非法状态转换采用硬阻断；合法的重复结束请求采用幂等跳过。

### Recording Upload

录音上传按 phase 校验训练状态：

- QA 录音只允许在 `QAING` 上传。
- Pitch 录音允许在 `PITCHING` 上传。
- 由于当前前端先结束 Pitch、再上传刚停止的录音，`QA_READY` 保留 60 秒 Pitch 录音上传窗口。
- 终止、完成、分析中或其它阶段不匹配的请求返回 409，不创建 recording，也不改变 session 状态。

该保护减少晚到录音影响 transcript 选择、answer 关联和报告输入的风险。60 秒窗口是现有前端调用顺序的兼容措施，不代表后续阶段可以持续补传 Pitch 录音。

## Q4 动态追问保护

Q4 已从“替换 Q1”调整为独立追加：

- `orderIndex = 4`
- `source = DYNAMIC_FOLLOWUP`
- `questionType = FOLLOWUP`
- Q1-Q3 的题目、计时和答题流程保持不变。
- Q4 独立限时 1 分钟。
- Q4 当前不计入总分。

生成链路保留 main、fallback 和 retry，但所有正式入库问题都需要经过质量校验。以下情况优先跳过 Q4：

- 项目资料为空或极少，且 Pitch 缺少足够项目内容。
- Pitch 明显离题、过短、仅有口号或公共宣传内容。
- AI 输出为空、调用异常或无法形成可靠追问。
- 输出包含材料与 Pitch 的错配质疑、上下文泄漏、多题粘连或 transcript 未支持的事实。

跳过 Q4 不会阻塞 Q1-Q3。成功生成的 Q4 在报告中单独形成 `dynamicFollowupReview`，不进入常规 `qaReviews`，也不影响 `overallScore`。无 Q4 或 Q4 未回答时，报告不展示该模块。

## ASR 转写保护

讯飞转写调用已增加有限自动重试，用于处理网络波动、超时、provider 临时错误和空返回等可恢复问题。重试次数有限，不会无限占用请求。

转写状态保护包括：

- 已有完成 transcript 时直接复用，避免重复转写。
- 中间尝试失败不立即写死最终错误。
- 全部尝试失败后才标记 `FAILED`，允许后续流程按失败终态降级。
- 不可重试的文件、参数和路径错误直接返回，不进入 ASR 重试。

启用 `XFYUN_DEBUG` 后，可观察轮询中的 `status`、`failType`、`orderResultLen`、`taskEstimateTime` 等字段，用于判断订单仍在处理、provider 失败或结果尚未生成。调试日志不应输出 API key、完整 authorization 或敏感环境变量。

ASR 重试用于降低偶发失败概率，不保证外部 provider 始终成功。最终失败仍通过明确终态交给报告和页面降级处理。

## 报告生成保护

Analysis 的结构化输出采用三层保护：

1. 正常解析 AI 返回的 JSON。
2. 首次解析失败时，使用严格 repair prompt 修复完整 JSON。
3. main parse 和 repair 均失败时，在本地构造最小 fallback analysis。

repair prompt 已修复 `qaReviews` 后缺少逗号的问题，并明确禁止 Markdown、代码块、解释和 schema 外字段。无法恢复的字段使用安全默认值补齐。

fallback analysis 不再调用 AI，并且必须先通过现有 validator。验证通过后写入 `COMPLETED`，清除 `errorMessage`，避免用户因一次非法 JSON 看到报告失败页。降级报告会说明结构化生成失败，其内容完整度可能低于正常 AI 报告，但仍提供基础复盘和可执行建议。

Analysis POST 已增加轻量并发保护，同一 session 在单实例内尽量只保留一个 active generation。未超过 5 分钟的 `PROCESSING` 记录直接复用，不重复调用 AI；超过 5 分钟的 `PROCESSING` 允许接管生成。`COMPLETED` 且未 stale 时直接返回，`FAILED` 则允许重新生成。该保护用于降低单实例重复调用风险，不是数据库级强锁；多实例部署前仍需补充数据库级幂等或唯一约束。

报告状态判断也已调整：

- `PENDING`、`PROCESSING` transcript 继续等待。
- `COMPLETED`、`FAILED` 视为终态。
- 已有 answer 但没有录音或 transcript 时视为可降级完成，不再永久阻塞 analysis。
- 真正未回答的基础问题仍然阻塞报告生成。

## 答辩提交与录音上传幂等保护

### Answer 重复提交

重复提交采用“只增强、不降级”的合并规则：

- 已有 `recordingId` 不会被 null 或不同 recording 覆盖。
- 已有有效文本不会被空文本或更短文本覆盖。
- 现有 answer 无录音时，可以补充有效 recording。
- 新文本非空且更完整时，可以补充 answerText。
- `revealedQuestionText` 只允许从 false 提升为 true。
- 已保存的开始、结束和用时信息不会因普通重试被重置。
- 响应返回最终合并后的 answer，便于调用方获得实际保存结果。

如果 recording 已有 transcript 或正在处理，由于关联不会被重复请求解绑，转写链路可以继续使用原 recording。

### 上传阶段保护

phase 与 session status 不匹配时采用硬阻断，不写文件记录。正常 Pitch 和 QA 上传保持兼容；无录音、麦克风不可用或上传失败时，QA answer 仍可保存，报告随后走无录音降级路径。

## 已验证场景

当前已覆盖或确认以下行为：

1. Q4 成功时作为第四题追加，不替换 Q1-Q3。
2. 空项目、明显离题和有效内容不足时不创建 Q4。
3. Dynamic follow-up AI 空返回或异常时返回 skipped，不阻塞答辩。
4. Q4 报告内容单独展示，暂不参与总分。
5. ASR 临时性错误进入有限重试，最终失败具有明确状态。
6. Analysis 非法 JSON 会进入 repair，repair 仍失败时生成 validator 可接受的 fallback。
7. 重复 end-pitch 不再覆盖后续或终态 session。
8. QA 已答但无录音时，report/status 允许降级生成 analysis。
9. 重复 answer 请求不会用弱数据清空已有录音或有效文本。
10. 阶段不匹配的 recording 上传被拒绝，正常 Pitch 结束后的即时上传仍可完成。

这些结果主要证明保护路径已建立，仍需要持续观察真实环境中的浏览器差异、网络延迟和外部服务行为。

## 仍待观察的问题

以下 P2/P3 项目仍需继续观察或后续增强：

- 常规问题生成使用进程内锁，多实例部署时仍需数据库级幂等保护。
- Analysis 当前已有单实例轻量保护，多实例部署前仍需数据库级强幂等。
- 文件 preview 当前缺少面向多用户场景的资源权限隔离。
- 录音播放仍可能整文件读入内存，后续可改为流式 range 读取。
- 外部 ASR 的长轮询、provider 延迟和状态字段变化仍需通过 `XFYUN_DEBUG` 持续观察。
- 降级 analysis 的内容质量低于正常 AI 输出，需要区分“流程可用”和“分析质量稳定”。

这些问题当前不应与主链路修复混合进行大规模重构，应结合部署形态、监控数据和复现证据逐项处理。

## 后续建议

1. 为状态接口和写接口增加覆盖重复请求、晚到请求与并发请求的集成测试。
2. 持续记录 ASR attempt、最终状态和耗时分布，确认重试窗口是否匹配真实 provider 延迟。
3. 监控 dynamic follow-up 的 skipped reason，区分内容不足、转写未就绪和 AI 失败。
4. 监控 analysis 正常解析、repair 成功和 fallback 使用比例，避免 fallback 长期掩盖 prompt 或模型问题。
5. 在多实例部署前处理问题生成锁和 analysis 并发幂等。
6. 在引入账号或项目权限前补齐文件 preview 授权校验。
7. 保持 Q4 暂不计分，待专项评价稳定并完成评分验证后再评估是否纳入答辩表现。
