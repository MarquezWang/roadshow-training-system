# 腾讯云 ASR 接入预检查与迁移方案

本文档用于评估将 `roadshow-training-system` 的语音识别切换到腾讯云 ASR 的可行性和推荐路径。本文只描述方案，不包含代码改动。

参考文档：

- 腾讯云 ASR SDK 概览：https://cloud.tencent.com/document/product/1093/52554
- 腾讯云 ASR API 概览：https://cloud.tencent.com/document/product/1093/35637
- 录音文件识别请求 `CreateRecTask`：https://cloud.tencent.com/document/product/1093/37823
- 录音文件识别结果查询 `DescribeTaskStatus`：https://cloud.tencent.com/document/product/1093/37822

## 1. 当前转写链路现状

### 1.1 当前统一转写入口

当前统一入口是：

```text
lib/transcription.ts
```

核心函数：

```ts
transcribeAudio(filePath, mimeType)
```

当前支持的 provider：

```text
openai
xfyun
```

选择方式：

```env
TRANSCRIPTION_PROVIDER=openai
```

当前 `TRANSCRIPTION_PROVIDER` 不支持 `tencent`，如直接配置会报“不支持的转写服务商”。

### 1.2 当前后台转写任务

训练录音转写由以下文件驱动：

```text
lib/training-transcribe-task.ts
```

关键链路：

1. 根据 `sessionId` 和 `recordingId` 找到录音记录。
2. 校验录音阶段必须是 `PITCH` 或 `QA`。
3. 读取录音文件绝对路径和 `mimeType`。
4. 将 transcript 标记为 `PROCESSING`。
5. 调用：

   ```ts
   transcribeAudio(target.absolutePath, target.mimeType)
   ```

6. 成功后写入 `TrainingTranscript.text`，状态改为 `COMPLETED`。
7. 失败后写入友好错误，状态改为 `FAILED`。
8. 当前已有同一 `recordingId` 的后台任务锁，避免重复转写。

这说明腾讯云 ASR 最适合接入在 `lib/transcription.ts` 的 provider 分支中，不需要改 Pitch、QA、报告页主流程。

### 1.3 Pitch / QA 调用转写的位置

Pitch 阶段：

- 前端录音组件：`app/training/[sessionId]/training-session-client.tsx`
- 上传录音：`POST /training/[sessionId]/recordings`
- 触发转写：`/training/[sessionId]/recordings/[recordingId]/transcribe/start`
- 后台最终进入 `lib/training-transcribe-task.ts`

QA 阶段：

- 前端录音组件：`app/training/[sessionId]/qa/training-qa-client.tsx`
- 上传录音：`POST /training/[sessionId]/recordings`
- 触发转写：`/training/[sessionId]/recordings/[recordingId]/transcribe`
- 后台最终进入 `lib/training-transcribe-task.ts`

### 1.4 录音文件保存位置

录音上传处理在：

```text
app/training/[sessionId]/recordings/route.ts
```

保存路径模式：

```text
uploads/training/{sessionId}/recordings/{uuid}.{ext}
```

数据库记录：

- 表：`TrainingRecording`
- 字段：
  - `filePath`
  - `mimeType`
  - `sizeBytes`
  - `durationSec`
  - `phase`

当前单个录音上传大小限制：

```text
100MB
```

### 1.5 当前浏览器录音 mimeType

Pitch 和 QA 都使用浏览器 `MediaRecorder`。

候选格式顺序：

```ts
[
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]
```

实际常见结果：

```text
audio/webm;codecs=opus
audio/webm
```

服务端保存时会把 mimeType 归一化，当前允许：

```text
audio/webm -> webm
audio/mp4  -> m4a
audio/mpeg -> mp3
audio/wav  -> wav
audio/x-wav -> wav
```

### 1.6 是否已有音频转码逻辑

已有。

当前讯飞 provider 位于：

```text
lib/transcription/xfyun.ts
```

其中已经实现：

- `ffprobe` 探测音频时长、编码、采样率、声道；
- `ffmpeg` 将 WebM 转为 16k 单声道 PCM WAV；
- 转换后上传到讯飞；
- 轮询讯飞结果；
- debug 日志和临时 wav 保留开关。

相关环境变量：

```env
XFYUN_DEBUG=false
XFYUN_KEEP_TEMP_AUDIO=false
```

### 1.7 是否依赖 ffmpeg

当前 OpenAI provider 不依赖 ffmpeg。

当前讯飞 provider 在 WebM 场景下依赖：

```text
ffmpeg
ffprobe
```

如果浏览器录音为 WebM，讯飞 provider 会要求转码为 WAV。腾讯云接入也建议复用这条转码思路，因为腾讯云录音文件识别支持 `ogg-opus`，但当前浏览器保存的是 `webm/opus`，不是明确支持的 `ogg-opus`。

## 2. 腾讯云接入推荐方式

### 2.1 推荐接口能力

推荐使用腾讯云“录音文件识别”：

```text
CreateRecTask + DescribeTaskStatus
```

原因：

- 当前 Pitch 最长约 9 分钟，QA 也可能有多段录音；
- 录音文件识别适合异步处理较长音频；
- 当前项目已有后台转写任务和轮询报告状态，不需要同步阻塞前端；
- 腾讯云官方说明录音文件识别可通过轮询或回调获取结果。

### 2.2 推荐数据流

推荐第一阶段采用：

```text
本地录音文件
  -> 必要时转码为腾讯云支持格式
  -> 上传 COS
  -> 生成 COS 预签名 URL
  -> CreateRecTask(SourceType=0, Url=...)
  -> 轮询 DescribeTaskStatus
  -> 取 Result 或 ResultDetail
  -> 返回纯文本给 training-transcribe-task
```

### 2.3 不建议直接使用本地 base64 作为主方案

腾讯云 `CreateRecTask` 支持：

- 音频 URL；
- 本地音频数据。

但官方限制：

- URL 方式：最长 5 小时，文件大小不超过 1GB；
- 本地音频文件：不大于 5MB。

当前系统 Pitch 录音最长约 9 分钟，WebM 或转码后文件很容易超过 5MB。因此不建议用 base64 作为主路径。

## 3. SDK vs API 对比

### 3.1 SDK 接入

优点：

- 不需要自己实现腾讯云 API 3.0 签名；
- `CreateRecTask` / `DescribeTaskStatus` 调用更直接；
- 错误对象和返回结构更规范；
- 腾讯云 SDK 概览明确支持 Node.js 的录音文件识别、语音流异步识别、一句话识别；
- 后续扩展热词、自学习、实时识别更方便。

缺点：

- 需要新增依赖；
- `package.json` / `package-lock.json` 会变化；
- SDK 包体和版本升级需要维护；
- 如果只用两个接口，SDK 相比手写 API 更重。

适用判断：

```text
推荐正式实现时优先 SDK。
```

理由是鉴权、签名、错误处理是云厂商 API 接入最容易出问题的部分，SDK 能降低实现和维护风险。

### 3.2 API 直接接入

优点：

- 不新增 SDK 依赖；
- 只需实现两个接口：
  - `CreateRecTask`
  - `DescribeTaskStatus`
- 包体更轻；
- 控制粒度更高。

缺点：

- 需要自己实现 TC3-HMAC-SHA256 签名；
- 签名错误排查成本较高；
- 时间戳、canonical request、payload hash、header 都必须严格正确；
- 后续维护成本高于 SDK。

适用判断：

```text
仅在明确不允许新增依赖时考虑 API 直连。
```

## 4. 是否建议使用 COS

建议使用 COS。

原因：

1. 腾讯云官方推荐使用 COS 存储、生成 URL 并提交识别任务。
2. URL 方式支持更长音频和更大文件。
3. 可避免本地 base64 5MB 限制。
4. 后续生产环境横向扩容时，本地文件路径不适合作为云服务可访问地址。
5. COS 预签名 URL 可以控制有效期，降低公开暴露风险。

如果不使用 COS，会遇到：

- Pitch 音频可能超过 5MB，无法走本地音频数据方式；
- 需要让腾讯云 ASR 能访问应用服务器上的录音文件，这通常意味着要暴露下载 URL；
- 暴露下载 URL 需要鉴权、有效期和防泄漏设计；
- 内网部署时腾讯云无法下载本地文件；
- 长音频稳定性差。

结论：

```text
第一阶段推荐接 COS；如果为了快速验证，也可以先做 QA 短音频 base64 PoC，但不建议作为正式路线。
```

## 5. 当前音频格式是否需要转码

建议保留转码能力。

原因：

- 当前浏览器优先产出 `audio/webm;codecs=opus` 或 `audio/webm`；
- 腾讯云录音文件识别支持的格式包括 `wav、mp3、m4a、flv、mp4、wma、3gp、amr、aac、ogg-opus、flac`；
- `webm` 不在明确支持列表中；
- 直接提交 WebM 有失败风险。

推荐第一阶段转码目标：

```text
wav，16k，单声道，pcm_s16le
```

当前讯飞 provider 已经有 WebM -> WAV 的 ffmpeg 转码逻辑，可以作为腾讯云 provider 的实现参考。为了避免复制大量代码，正式实现时可以考虑抽出通用音频工具：

```text
lib/transcription/audio-utils.ts
```

但第一版也可以先在腾讯云 provider 内部实现最小转码，避免重构范围过大。

## 6. 推荐环境变量

建议新增：

```env
# 音频转写 provider
TRANSCRIPTION_PROVIDER=tencent

# 腾讯云 ASR
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_ASR_REGION=ap-shanghai
TENCENT_ASR_ENGINE_MODEL_TYPE=16k_zh
TENCENT_ASR_RES_TEXT_FORMAT=0
TENCENT_ASR_POLL_INTERVAL_MS=5000
TENCENT_ASR_MAX_POLL_COUNT=60

# 腾讯云 COS，用于生成可供 ASR 下载的音频 URL
TENCENT_COS_REGION=ap-shanghai
TENCENT_COS_BUCKET=
TENCENT_COS_PREFIX=roadshow-asr/
TENCENT_COS_SIGNED_URL_EXPIRES_SEC=3600

# 调试与临时文件
TENCENT_ASR_DEBUG=false
TENCENT_ASR_KEEP_TEMP_AUDIO=false
```

说明：

- `TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY` 不应打印到日志。
- `TENCENT_ASR_ENGINE_MODEL_TYPE` 第一版建议 `16k_zh`；如果中英文混合较多，可评估 `16k_zh_en`。
- `TENCENT_ASR_RES_TEXT_FORMAT=0` 第一版只取纯文本即可；后续如要时间戳，可调整结果格式并保存结构化结果。

## 7. 第一阶段最小改动范围

第一阶段目标：

```text
在不改训练流程和数据库 schema 的前提下，新增 TRANSCRIPTION_PROVIDER=tencent。
```

建议改动文件：

```text
lib/transcription.ts
lib/transcription/tencent.ts
.env.example
README.md 或 docs 部署说明
```

如果使用 COS，还需要新增一个 COS 工具文件，例如：

```text
lib/transcription/tencent-cos.ts
```

第一阶段不建议修改：

- Pitch 页面；
- QA 页面；
- 报告页；
- `TrainingTranscript` schema；
- 训练状态流转；
- AI 分析逻辑。

第一阶段内部流程：

1. `lib/transcription.ts` 支持 provider `tencent`。
2. `transcribeWithTencent(filePath, mimeType)` 接收本地录音路径。
3. 检查文件是否存在。
4. 必要时转码为腾讯云支持格式。
5. 上传 COS 并生成预签名 URL。
6. 调用 `CreateRecTask`。
7. 轮询 `DescribeTaskStatus`。
8. `success` 时取 `Result`，必要时清理时间戳格式。
9. `failed` 时抛出用户友好错误。
10. 超时或网络错误进入现有 `training-transcribe-task` 重试机制。

推荐日志：

```text
[tencent-asr] task created taskId=xxx audioSize=123456 durationSec=...
[tencent-asr] poll status=waiting taskId=xxx
[tencent-asr] poll status=doing taskId=xxx
[tencent-asr] completed taskId=xxx elapsedMs=...
[tencent-asr] failed taskId=xxx reason="..."
```

日志不要打印：

- SecretId；
- SecretKey；
- COS 签名完整 URL；
- 用户音频正文；
- 完整转写文本。

## 8. 第二阶段可选增强

### 8.1 热词

可以将项目名称、技术关键词、产品名、行业术语加入热词表，提高专有名词识别质量。

适用场景：

- 技术项目名；
- 医疗、材料、芯片、机器人等专业术语；
- 英文缩写；
- 企业名和产品名。

### 8.2 分段时间戳

腾讯云 `DescribeTaskStatus` 可返回 `ResultDetail`，包含句子时间范围、词信息等。

后续可用于：

- 路演发言节奏分析；
- 字幕；
- 与 PPT 翻页事件对齐；
- 自动定位某段回答。

第一阶段不建议入库复杂结构，避免 schema 改动。可后续再评估是否写入 `segmentsJson`。

### 8.3 实时识别

如果未来希望 Pitch 时实时显示字幕，可以评估腾讯云实时语音识别。

当前不建议第一阶段做实时识别，因为：

- 会改变前端录音和传输模型；
- 需要 WebSocket 或流式上传；
- 对训练主流程影响更大。

### 8.4 回调模式

腾讯云支持通过回调获取识别结果。

当前不建议第一阶段做回调，因为：

- 需要公网回调地址；
- 需要鉴权、防重放和幂等；
- 当前项目已经有后台任务和轮询机制，轮询接入更小。

## 9. 回滚方案

保留当前 provider 结构，不删除讯飞实现。

如果腾讯云接入出现问题，回滚只需要修改环境变量：

```env
TRANSCRIPTION_PROVIDER=xfyun
```

并确保讯飞相关配置仍保留：

```env
XFYUN_APP_ID=
XFYUN_SECRET_KEY=
XFYUN_LANGUAGE=cn
```

如果要切回 OpenAI：

```env
TRANSCRIPTION_PROVIDER=openai
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_BASE_URL=
TRANSCRIPTION_MODEL=whisper-1
```

推荐上线策略：

1. 先在测试环境配置 `TRANSCRIPTION_PROVIDER=tencent`。
2. 用内部测试清单跑完整 Pitch / QA / Report。
3. 检查腾讯云 ASR 日志、COS 文件清理、转写失败提示。
4. 通过后再切生产。
5. 生产保留 `xfyun` 配置，作为快速回滚路径。

## 10. 结论

可以接入腾讯云 ASR。

推荐路线：

```text
新增 tencent provider
优先 SDK
优先 COS URL 模式
保留 ffmpeg 转码
不改训练流程
不改数据库 schema
保留 xfyun 作为回滚 provider
```

不推荐路线：

```text
直接替换掉 xfyun
只做 base64 本地音频方式作为正式方案
第一阶段接实时识别
第一阶段改数据库 schema 保存腾讯云任务结构
```
