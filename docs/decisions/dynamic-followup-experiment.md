# Dynamic Follow-up 实验阶段记录

## 当前阶段结论

dynamic-followup 后端独立接口已完成并通过核心验证，当前形成三层链路：

1. main prompt：prompts/dynamic-followup.md
   用于正常动态追问生成。

2. mismatch fallback：prompts/dynamic-followup-mismatch.md
   用于处理"项目材料与路演内容明显不一致"的情况。
   例如：项目材料是 AI 路演训练系统，但路演内容讲成饮料配料表，系统应生成一致性质疑追问。

3. content fallback：prompts/dynamic-followup-content.md
   用于处理正常 Pitch 内容下，主 prompt 过度保守返回 NO_DYNAMIC_FOLLOWUP 的情况。
   例如：路演中提到动态追问、自动转写、模拟答辩、训练报告、没讲透、证据支撑等内容时，系统应生成基于 Pitch 的正常追问。

## 已验证结果

### 1. 材料与 Pitch 不一致场景已跑通

当项目材料为"AI 路演训练系统"，而 Pitch 内容为"饮料配料表"时，系统能够生成类似问题：

"你们材料里写的是 AI 路演训练系统，但刚才主要讲的是饮料配料表。这个跨度有点大，请说明两者之间有什么关联，还是本轮路演内容偏离了提交项目？"

### 2. 正常 Pitch 动态追问已跑通

当 Pitch 正常介绍"AI 路演训练系统"，并提到动态追问、没讲透、证据支撑等内容时，系统能够生成类似问题：

"你刚才提到系统要判断哪些内容没有讲透，并生成动态追问。请说明目前系统如何识别'没讲透'的内容，以及用什么指标验证追问是否准确？"

### 3. debug 能力已完善

debug=true 时，接口可返回：

- 当前项目上下文是否存在；
- 项目标题；
- 项目材料摘要预览；
- Pitch 文本长度与预览；
- 常规问题列表；
- targetQuestionText；
- otherQuestionsPreview；
- main prompt 输出；
- mismatch fallback 输出；
- content fallback 输出；
- usedStage；
- fallbackUsed；
- contentFallbackUsed；
- hasPitchProjectContent；
- pitchProjectContentMatchedKeywords。

## 当前重要技术判断

当前不是屎山代码，但已经进入实验功能堆叠期。

目前可以接受的原因：

1. 常规问题生成与 dynamic-followup 已经分离；
2. dynamic-followup 是独立接口；
3. mismatch fallback 与 content fallback 职责相对清楚；
4. 没有改 Prisma schema；
5. 没有乱改前端 QA 状态机；
6. 没有影响转写和 report 主流程。

但已经出现技术债苗头：

1. dynamic-followup route 中开始包含 AI 调度、fallback、debug、校验、数据库更新等多类逻辑；
2. Prompt 数量增加，存在规则互相影响的风险；
3. 当前 main → mismatch fallback → content fallback 的三层结构，如果继续堆新 fallback，会快速变复杂；
4. 后续若再加入商业模式、技术指标、团队能力等专门 fallback，容易变成难维护的 AI 接力链。

## 后续必须标记的重构任务

等以下能力稳定后，必须进行 dynamic-followup 模块收口重构：

1. 正常 Pitch 动态追问稳定；
2. 材料与 Pitch 不一致追问稳定；
3. 前端答辩准备页自动调用稳定；
4. 已展示/已回答问题保护逻辑稳定。

建议重构方向：

```
lib/dynamic-followup/
  generateDynamicFollowup.ts
  classifyFollowupScenario.ts
  validateFollowupQuestion.ts
  dynamicFollowupFallbacks.ts
  types.ts
prompts/
  default.md
  mismatch.md
  content.md
```

最终 route 只负责：

接收请求 → 查询 session/project/questions → 调用 service → 更新问题 → 返回结果

service 负责：

判断场景 → 调 prompt → fallback → 校验 → 返回可替换问题

## 下一步任务

下一步可以进入前端自动调用，但必须小步推进。

建议任务范围：

1. 在 QA 页 PREPARING 阶段调用 dynamic-followup 接口；
2. 成功时更新前端 questions state；
3. 失败时静默使用常规问题；
4. 不阻塞答辩准备页倒计时；
5. 不改变 QA 状态机；
6. 不修改转写、report、Prisma schema；
7. 不替换已展示或已回答的问题。

注意：前端接入后，要重点验证"数据库已替换，但前端 state 未更新"的问题是否解决。