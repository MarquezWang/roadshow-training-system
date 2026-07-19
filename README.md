# Roadshow Training System

面向科技项目路演与答辩训练的内部系统。技术栈为 Next.js 16、React 19、TypeScript、Prisma 和 SQLite。

系统目前支持：

- 项目档案创建、编辑、所有权隔离和删除；
- PDF、PPTX、DOCX、TXT 材料上传、解析及 PPT 预览；
- 材料诊断、确定性规则评分、模拟评委问题和动态追问；
- 路演计时、翻页轨迹、答辩、录音、自动转写及人工修订；
- 版本化训练分析和综合报告，失败时保留上一版成功报告；
- 管理员用户、Prompt、系统配置和上传目录维护页面。

## 当前部署边界

当前实现使用 SQLite 和本地上传目录，适合固定服务器、持久磁盘、单个 Web 实例和内部低并发使用。开发环境默认由 Web 进程执行报告、转写恢复和维护任务；生产环境支持并要求把这些后台工作放到独立 Worker 进程。

不要直接部署到无状态 Serverless 或多应用实例。正式多实例部署仍需完成：

- PostgreSQL/MySQL 等服务型数据库迁移；
- S3、腾讯 COS、MinIO 等对象存储接入；
- 把当前数据库任务队列替换为适合多实例和跨主机消费的队列基础设施；
- 数据备份、保留、删除和敏感材料治理制度。

当前独立 Worker 与 Web 进程必须在同一台主机上访问同一 SQLite 文件和上传目录。它解决进程职责和重启恢复问题，不等同于已经支持跨主机水平扩容。

## 本地启动

要求 Node.js 20，并安装项目所需的 ffmpeg、ffprobe 和 LibreOffice。

```bash
npm ci
```

复制 `.env.example` 为 `.env`，至少配置数据库、认证、AI 和选定的 ASR 服务商。随后执行：

```bash
npx prisma migrate dev
npm run dev
```

默认地址为 [http://localhost:3000](http://localhost:3000)。

生产或固定测试环境应使用：

```bash
npx prisma migrate deploy
npm run build
# 使用仓库内 PM2 配置启动或平滑重载 Web 与独立 Worker：
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

# Worker 写入首个心跳后执行：
npm run check:prod
```

`ecosystem.config.cjs` 会为两个进程设置 `NODE_ENV=production`、`BACKGROUND_TASK_MODE=external` 和 `UPLOAD_MAINTENANCE_ENABLED=true`。Web 与 Worker 必须使用相同工作目录、环境变量、数据库和上传磁盘；如果改用 systemd 等其他进程管理器，也必须显式设置这些值并同时托管两个进程。`check:prod` 会检查认证密钥、AI/ASR 数值范围、ffmpeg/ffprobe、LibreOffice、上传目录写入能力、磁盘空间、自动维护配置，以及独立 Worker 的有效数据库心跳与能力声明。

## 认证与用户

本地开发可以设置：

```dotenv
AUTH_ENABLED=false
```

生产环境必须设置 `AUTH_ENABLED=true`，并提供至少 32 字符、独立随机生成的 `AUTH_SECRET`。

登录限流默认设置 `TRUSTED_PROXY_HOPS=0`，此时会忽略可由客户端伪造的
`X-Forwarded-For` 和 `X-Real-IP`。只有在部署层已阻断应用直连，并确认每一跳
反向代理都会覆盖或追加转发地址时，才按实际拓扑设置可信代理跳数；系统会从
右向左取可信链之前的地址，不会信任请求者提供的最左侧地址。

创建或重置用户时，密码默认通过终端隐藏输入：

```bash
npm run user:create -- --email user@example.com --name 用户名 --role USER
```

自动化环境应从密钥管理器通过标准输入传递密码：

```bash
secret-manager-command | npm run user:create -- --email user@example.com --password-stdin --role USER
```

不再支持 `--password <明文>`，以免密码进入 shell history、进程列表或运维日志。

## 项目材料

新建项目的首份材料仅接受一个 PDF 或 PPTX，最大 50MB。流程为：

```text
浏览器流式上传一次
  → 服务端暂存并校验文件签名
  → 文档工作进程解析一次
  → 返回短期 materialToken
  → 档案识别、TRL 和最终建档引用同一令牌
```

材料正文不会返回浏览器，也不会在最终建档时再次上传或解析。暂存材料默认保留 2 小时，可通过 `PROJECT_MATERIAL_RETENTION_HOURS` 调整。

项目建成后可继续上传 PDF、PPTX、DOCX 或 TXT，每个文件最大 50MB。文档解析运行在受限子进程中，具有并发、排队、超时、内存、输出大小和压缩包安全边界。

## AI 功能

所有模型调用通过 `lib/ai.ts` 进入。主要任务包括：

- 项目档案与 TRL 识别；
- 材料诊断；
- AI 评分证据判断；
- 模拟评委问题；
- 动态追问；
- 路演与答辩综合分析。

上传材料和转写文本统一作为不可信数据封装，不能覆盖 system prompt 或改变输出协议。

AI 资源保护包括：

- 每用户每分钟请求上限；
- 每用户、项目和任务类型并发锁；
- 全局并发上限；
- 数据库持久化的每日请求和 Token 预算；
- 供应商连续失败退避；
- AI 超时和最大输出 Token 的严格范围校验。

相关配置参见 `.env.example` 中的 `AI_*` 项。

材料诊断、材料评分和训练分析都会保存输入哈希、Prompt 版本、结果 Schema
版本、实际模型版本和评审规则版本。诊断、评分、项目上下文快照及转写分段的
JSON 读取均保留旧版兼容路径，未知的未来 Schema 不会被当前代码误读。

## 评分、证据与评审规则

评分模型主要判断证据强弱和风险，最终分值由服务端确定性规则映射，不直接信任模型自由输出的总分。

涉及数字或具体事实的问题必须携带真实材料摘录。校验器会统一处理“未提供、未提及、未明确说明”等缺失证据表达，并验证证据文本确实来自项目材料。

真实评审规则文件位于：

```text
data/knowledge/rules/roadshow-review-rule-100.json
```

导入命令：

```bash
npm run import:review-rule
```

导入会验证总分、正整数权重、重复名称和重复排序，并在一个数据库事务中更新规则、指标和知识源。

## 录音与 ASR

原始录音采用流式落盘，最大 100MB。支持的服务商：

```dotenv
TRANSCRIPTION_PROVIDER=openai
TRANSCRIPTION_PROVIDER=xfyun
TRANSCRIPTION_PROVIDER=tencent
TRANSCRIPTION_PROVIDER=tencent_flash
```

每次供应商调用前都会通过 ffprobe 验证音频大小和时长。默认边界为 100MB、120 分钟、单进程 2 个并发任务和 30 秒排队时间。

讯飞与腾讯极速版上传使用文件流，不会把最高 100MB 的音频整体读入内存。腾讯普通版因 API 要求使用 Base64，但在读取前受更小的直传上限约束。

转写任务具有持久化租约、重试退避、过期任务接管和人工修订优先策略。迟到的 ASR 结果不会覆盖用户已经保存的人工文本。

本地开发默认使用：

```dotenv
BACKGROUND_TASK_MODE=embedded
```

生产环境改为 `external` 后，Web 请求只创建持久化转写任务，不直接调用 ASR；独立进程轮询到期任务、领取数据库租约并执行转写：

```dotenv
BACKGROUND_TASK_MODE=external
BACKGROUND_WORKER_POLL_INTERVAL_MS=5000
BACKGROUND_WORKER_HEARTBEAT_INTERVAL_MS=5000
BACKGROUND_WORKER_HEARTBEAT_TTL_MS=30000
```

```bash
npm run worker:start
```

Worker 会把短期心跳和 `TRAINING_TRANSCRIPTION`、`TRAINING_ANALYSIS`、`UPLOAD_MAINTENANCE` 能力写入数据库。管理后台和 `check:prod` 都会验证心跳是否仍在有效期内。在 external 模式下，训练报告请求只持久化入队；Worker 通过租约领取任务，失败时按上限退避重试，并继续保留上一版成功报告。

## 训练报告

训练报告会组合项目档案、材料、路演转写、翻页事件、答辩问题及回答。报告生成采用：

- 输入哈希和生成前后复核；
- Prompt、Schema、模型和规则版本记录；
- 多版本分析记录；
- 成功后原子切换当前报告；
- 新版本失败时保留旧成功报告；
- 降级报告显式标记，且不冒充正式 AI 总分。

## 文件与任务维护

生产环境应启用：

```dotenv
UPLOAD_MAINTENANCE_ENABLED=true
```

维护任务使用数据库租约防止重复执行，并按配置清理过期孤儿文件、临时文件、失败尝试目录、回收站和过期项目材料。仍被数据库引用的文件不会因年龄被删除。在 `external` 模式下，只有独立 Worker 启动维护定时器，Web 进程不会重复运行。

管理员可在系统页面执行只读扫描或手动维护。

## 数据安全

- 不要把真实密钥提交到仓库；
- 不要在未确认模型服务数据政策时上传涉密或未公开项目材料；
- 生产环境必须启用认证并限制调试接口；
- AI 上下文完整调试接口仅开发环境或管理员可用；
- 用户角色与训练、录音、转写、分析和异步任务状态在 SQLite 层有 `CHECK` 约束；
- 本地磁盘、SQLite 文件及备份应使用操作系统权限和磁盘加密保护；
- 多实例或云部署前仍须完成服务型数据库、对象存储和分布式队列迁移；当前独立 Worker 只支持共享本机 SQLite 与上传磁盘的固定服务器拓扑。

## 测试

```bash
npm run lint
npm run build
npm run test:auth
npm run test:auth:e2e:local
npm run test:worker:local
npm run test:prod-guard
npm run test:files
npm run test:scoring-v2
npm run test:review-fixes
npm run test:stability:local
npm run test:trl
```

`test:stability:local` 会创建专用 SQLite 测试库、应用全部迁移、启动隔离的 Next.js 服务并执行状态机、事务、幂等、删除一致性、材料流式上传和异步任务测试，不会写入开发数据库。

`test:auth:e2e:local` 会在另一个专用数据库中真正启用 `AUTH_ENABLED=true`，验证两个普通用户的项目隔离、跨用户写入拒绝、管理员边界以及 Cookie 版本和账号停用后的会话失效。

`test:worker:local` 会创建专用数据库、启动真实的独立 Worker 进程，并确认它发布了包含转写与报告生成能力的有效心跳。
