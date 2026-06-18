# Stability HTTP Tests

该目录存放不依赖 Jest、Vitest 或 Playwright 的最小 HTTP 集成测试。测试通过 Node 20 内置 `node:test` 调用已经运行的本地 Next 服务，并使用 Prisma Client 准备和清理独立 fixture。

## End Pitch Guard

测试覆盖 `PITCHING`、`QA_READY`、`QAING`、`FINISHED`、`ABORTED` 和 `CREATED`：

- 只有 `PITCHING` 可以转换为 `QA_READY`；
- 非法状态不会变化，也不会新增 END 事件；
- 已结束状态重复调用保持幂等；
- `PITCHING` 正常结束只新增一个 END 事件。

## Report Status Guard

测试覆盖报告生成前的 QA 转写状态判断：

- 三道基础题已回答但没有录音时允许降级生成报告；
- 仍有基础题未回答时继续阻塞；
- 未回答的 Q4 动态追问不阻塞基础报告。

## QA Answer Idempotency

测试覆盖 QA answer 重复提交时的只增强合并规则：

- 空请求不清空已有 recording 或有效文本；
- 较短文本不覆盖较长文本；
- 更长的有效文本可以补充；
- 不同 recording 不替换已有 recording；
- 重复请求不重置已保存的答题时间和时长。

## 安全要求

测试不会使用默认开发数据库。必须显式提供 `STABILITY_TEST_DATABASE_URL`，且 URL：

- 必须为 SQLite `file:` URL；
- 必须包含 `test` 或 `stability`；
- 不能指向 `dev.db` 或 `prod.db`。

未满足要求时测试会显示原因并跳过。测试只按本次运行生成的唯一 ID 清理 fixture，不删除其它数据。

## 运行方式

先为专用数据库创建现有 schema。以下命令会写入专用测试数据库，不能将 URL 改为开发数据库：

```powershell
$env:STABILITY_TEST_DATABASE_URL="file:./stability-test.db"
$env:DATABASE_URL=$env:STABILITY_TEST_DATABASE_URL
npx prisma db push
```

使用同一数据库环境启动本地服务：

```powershell
$env:DATABASE_URL=$env:STABILITY_TEST_DATABASE_URL
npm run dev
```

在另一个终端运行测试：

```powershell
$env:STABILITY_TEST_DATABASE_URL="file:./stability-test.db"
$env:STABILITY_TEST_BASE_URL="http://localhost:3000"
npm run test:stability
```

`npm run test:stability` 会一次运行当前全部 stability HTTP tests。定位单项失败时可分别运行：

```powershell
npm run test:stability:end-pitch
npm run test:stability:report-status
npm run test:stability:qa-answer
```

如果本地服务没有连接同一个测试数据库，测试会因找不到 fixture 而明确失败。测试不调用 AI、ASR，也不上传文件。
