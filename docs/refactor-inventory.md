# 结构重构清单

本清单用于记录当前仍然偏大的文件，以及后续拆分优先级。目标是降低主流程页面的维护成本，不改变运行时行为。

## 2026-07-02 当前大文件

| 文件 | 当前行数 | 说明 | 建议优先级 |
| --- | ---: | --- | --- |
| `app/training/[sessionId]/report/training-report-client.tsx` | 2190 | 报告总览、路演表现、答辩表现和报告状态展示仍集中在一个客户端文件中。 | 高 |
| `app/training/[sessionId]/training-session-client.tsx` | 1550 | 路演页已完成 PDF、全屏、录音、转写、分析 hook 拆分，但主状态机和页面渲染仍较重。 | 中 |
| `app/training/[sessionId]/qa/questions/dynamic-followup/route.ts` | 1043 | 动态追问已抽出问题查询、序列化、幂等创建、项目上下文组装和 Pitch 预检模块；prompt 渲染、AI 调用、结果校验和 fallback 逻辑仍集中在 route 中，适合继续拆 service。 | 高 |
| `app/training/[sessionId]/qa/training-qa-client.tsx` | 950 | QA 页已完成语音、录音、问题生成、材料预览和页面守卫 hook 拆分；剩余为答辩推进状态机和渲染。 | 中 |

## 下一轮建议

1. 优先拆 `dynamic-followup/route.ts`
   - 理由：这是后端 AI 核心链路，文件仍超过 1000 行，且逻辑复杂。
   - 建议拆分方向：上下文准备、prompt 输入构造、AI 响应解析、结果落库。
   - 风险：中。只做函数搬迁，不改 prompt 和判断规则。

2. 再拆 `training-report-client.tsx`
   - 理由：报告页是用户最终交付物页面，体积最大，后续会继续迭代。
   - 建议拆分方向：总览、路演表现、答辩表现、报告等待态、音频/转写展示组件。
   - 风险：中到高。报告页 UI 面较大，需拆一块测一块。

3. 暂缓继续拆 QA 答辩推进状态机
   - 理由：这部分直接控制答辩计时、题目推进、自动结束和保存，行为风险较高。
   - 如果继续拆，必须单独做完整 QA 手动回归。
