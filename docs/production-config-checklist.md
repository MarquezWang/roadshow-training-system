# 生产配置核对清单

本文档用于本地开发、腾讯云轻量服务器部署和后续交接时核对关键环境变量。不要在本文档中记录真实密钥。

## 部署基准

当前推荐部署方式：

- 使用腾讯云轻量应用服务器长期运行 Next.js 应用。
- 使用 PM2 管理 Node 进程。
- 使用 SQLite 和本地 `uploads/` 文件目录保存数据与上传材料。
- 不建议直接部署到无状态 Serverless 环境，除非先替换数据库和文件存储。

服务器代码目录：

```bash
/var/www/roadshow-training-system
```

PM2 应用名：

```bash
roadshow-training-system
```

## 必填配置

生产环境至少需要确认以下配置。

### 认证

```env
AUTH_ENABLED=true
AUTH_SECRET=<随机长字符串>
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<管理员密码 SHA-256>
```

说明：

- `AUTH_ENABLED=true` 后，项目页、训练页、后台页和关键 API 都会要求登录。
- `AUTH_ENABLED=false` 只建议用于本地临时调试。
- 管理员密码当前使用 SHA-256 哈希，生成方式：

```bash
node -e "const crypto=require('crypto');console.log(crypto.createHash('sha256').update('your-password').digest('hex'))"
```

### 数据库

```env
DATABASE_URL="file:./dev.db"
```

说明：

- 当前生产部署仍使用 SQLite。
- 数据库文件会落在 Prisma 相对路径下，部署前后不要随意删除。
- 生产环境升级前建议备份数据库文件。

### AI 模型

```env
AI_PROVIDER=openai
AI_API_KEY=<兼容 OpenAI 协议的模型服务密钥>
AI_BASE_URL=<模型服务 Base URL>
AI_MODEL_FAST=deepseek-v4-flash
AI_MODEL_STRONG=deepseek-v4-pro
AI_TIMEOUT_MS=120000
AI_MAX_OUTPUT_TOKENS=6000
```

说明：

- `AI_MODEL_FAST` 用于轻量任务，例如 AI 连通性测试。
- `AI_MODEL_STRONG` 用于关键任务，例如项目档案识别、TRL 判断、评委问题生成、动态追问和报告生成。
- 如果只配置旧变量 `AI_MODEL`，系统会作为 fallback 使用，但生产环境建议显式配置 fast / strong。

### 语音转写

当前推荐：

```env
TRANSCRIPTION_PROVIDER=tencent_flash
TENCENT_SECRET_ID=<腾讯云 SecretId>
TENCENT_SECRET_KEY=<腾讯云 SecretKey>
TENCENT_APP_ID=<腾讯云账号 AppID>
TENCENT_ASR_FLASH_ENGINE_TYPE=16k_zh
TENCENT_ASR_FLASH_VOICE_FORMAT=mp3
TENCENT_ASR_FLASH_WORD_INFO=3
TENCENT_ASR_FLASH_TIMEOUT_MS=120000
```

说明：

- `tencent_flash` 是腾讯云录音文件识别极速版，当前用于降低训练后等待转写的时间。
- `TENCENT_APP_ID` 是极速版需要的账号 AppID，不是 SecretId。
- `TENCENT_ASR_FLASH_WORD_INFO=3` 用于返回分段时间信息，报告页按页匹配转写会依赖该能力。

如果切回普通腾讯云录音文件识别：

```env
TRANSCRIPTION_PROVIDER=tencent
TENCENT_SECRET_ID=<腾讯云 SecretId>
TENCENT_SECRET_KEY=<腾讯云 SecretKey>
TENCENT_ASR_REGION=ap-guangzhou
TENCENT_ASR_ENGINE_MODEL_TYPE=16k_zh
TENCENT_ASR_POLL_INTERVAL_MS=3000
TENCENT_ASR_MAX_POLL_COUNT=120
```

如果临时回滚到讯飞：

```env
TRANSCRIPTION_PROVIDER=xfyun
XFYUN_APP_ID=<讯飞 AppId>
XFYUN_SECRET_KEY=<讯飞 SecretKey>
XFYUN_LANGUAGE=cn
XFYUN_DEBUG=false
XFYUN_KEEP_TEMP_AUDIO=false
```

### PPT / PPTX 转 PDF 预览

Linux 服务器通常使用：

```env
LIBREOFFICE_PATH=
```

并确保命令可用：

```bash
libreoffice --version || soffice --version
```

Windows 本地开发通常使用：

```env
LIBREOFFICE_PATH="C:\Program Files\LibreOffice\program\soffice.com"
```

说明：

- LibreOffice 不可用时，PDF 预览不受影响。
- PPT/PPTX 仍可上传和用于 AI 解析，但不会生成展示 PDF。
- 服务器应能在 PM2 日志中看到 `[PPT_PREVIEW]` 诊断日志。

## 可选配置

### 动态追问

```env
DYNAMIC_FOLLOWUP_EXPERIMENT=true
```

说明：

- 开启后，QA 阶段在满足条件时可生成动态追问。
- 若不希望实验性追问影响训练流程，可设为 `false`。

### 材料诊断模拟模式

```env
DIAGNOSIS_MOCK_MODE=false
```

说明：

- 仅用于开发或演示。
- 生产环境建议保持 `false`。

## 本地与服务器差异

常见差异是正常的：

- 本地可能使用 Windows LibreOffice 路径，服务器使用 `libreoffice` 命令。
- 本地可以临时设置 `AUTH_ENABLED=false`，服务器应保持 `AUTH_ENABLED=true`。
- 本地 `.env.local` 可能只覆盖少量变量；服务器主要看 `.env` 和 PM2 启动时注入的环境。
- 修改服务器 `.env` 后，需要重启 PM2 并使用 `--update-env`。

服务器更新环境变量后执行：

```bash
pm2 restart roadshow-training-system --update-env
pm2 save
```

## 部署后快速检查

```bash
cd /var/www/roadshow-training-system
git status -sb
git branch --show-current
pm2 status
```

AI 连通性：

```bash
curl -s http://127.0.0.1:3000/api/ai/test | head -c 500
```

注意：

- 生产环境下 `/api/ai/test` 仅 ADMIN 可用。
- 未登录直接 curl 可能返回 404，这是预期行为。
- 更推荐在后台 `/admin/system` 页面点击“测试 AI”。

ASR / AI / PPT 日志：

```bash
pm2 logs roadshow-training-system --lines 80 --nostream | grep "\[AI\]" | tail -n 10
pm2 logs roadshow-training-system --lines 120 --nostream | grep "\[ASR\]" | tail -n 20
pm2 logs roadshow-training-system --lines 120 --nostream | grep "\[PPT_PREVIEW\]" | tail -n 20
```

LibreOffice：

```bash
libreoffice --version || soffice --version
```

## 后台系统状态页

生产环境建议用 ADMIN 登录后访问：

```text
/admin/system
```

该页面用于查看：

- AI 模型与调用配置
- 转写 provider 与密钥是否配置
- LibreOffice 是否可用
- 数据库连接是否可用
- 上传目录是否可写
- 最近诊断事件

注意：该页面只显示是否配置，不应显示真实密钥内容。

## 修改配置后的验证命令

本地或服务器代码更新后建议运行：

```bash
npm run test:auth
npm run lint
npm run build
```

如果改动涉及 TRL：

```bash
npm run test:trl
```

如果改动涉及训练流程稳定性：

```bash
npm run test:stability
```

## 不应提交到仓库的内容

不要提交：

- `.env`
- `.env.local`
- 真实 API Key
- 上传材料
- 真实训练录音
- SQLite 生产数据库
- 临时补丁文件 `*.patch`
- 本地诊断日志 `data/diagnostics.jsonl`

