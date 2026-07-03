# 认证与权限边界说明

本文档记录当前系统的登录开关、页面保护、API 保护和管理员诊断入口规则，用于后续开发时避免误删或放松权限边界。

## 基本原则

当前系统通过 `AUTH_ENABLED` 控制是否启用登录保护：

- `AUTH_ENABLED=true`：项目页、训练页、后台页和关键 API 需要登录。
- `AUTH_ENABLED=false`：主要用于本地快速开发调试，登录保护会被跳过，顶部登录/退出等用户态展示也可能不同。

除非是在明确的本地开发场景，不建议关闭 `AUTH_ENABLED`。

## 页面保护边界

启用认证后，以下页面必须要求登录：

- `/projects`
- `/projects/*`
- `/training`
- `/training/*`
- `/admin`
- `/admin/*`

其中 `/admin` 和 `/admin/*` 还需要 ADMIN 权限。普通用户不应进入后台管理页。

## API 保护边界

启用认证后，以下 API 命名空间必须要求登录：

- `/api/files/*`
- `/api/projects/*`
- `/api/admin/*`

这里特别需要注意 `/api/projects/*`：

- `/api/projects/material-parse` 会解析上传材料。
- `/api/projects/profile-recognition` 会触发 AI 项目档案识别。

这两个接口涉及文件处理和 AI 调用成本，不能允许匿名用户直接访问。

## AI 连通性测试接口

`/api/ai/test` 仅用于系统状态页的 AI 连通性诊断。

当前规则：

- 开发环境：允许本地联调；如果 `AUTH_ENABLED=true`，仍要求登录。
- 生产环境：仅 ADMIN 可以访问。
- 生产环境下未登录、非 ADMIN 或未开启认证时，对外返回 404，避免暴露诊断接口存在。

后台系统状态页的“测试 AI”按钮依赖该接口，因此不能简单地在生产环境无差别关闭。

## 用户数据隔离

普通用户只能看到自己的项目和训练记录。

ADMIN 用户可以看到所有项目和训练记录，并可在后台进行用户管理。

历史项目账号 `team@roadshow.local` 作为历史数据归属账号保留，不建议作为真实登录账号使用。

## 回归测试

权限边界由以下脚本做轻量回归：

```bash
npm run test:auth
```

该测试当前覆盖：

- `proxy.ts` 必须保护 `/api/projects/*`
- `proxy.ts` 必须保护 `/api/admin/*`
- `proxy.ts` matcher 必须包含 `/api/projects/:path*`
- `proxy.ts` matcher 必须包含 `/api/admin/:path*`
- `/api/ai/test` 在生产环境必须限制为 ADMIN 诊断入口

CI 已接入该测试。后续如果新增敏感 API，应同步检查是否需要加入 proxy matcher 或 route 内部权限校验。

## 开发注意事项

- 不要只保护单个 API 文件，应优先保护整个敏感命名空间。
- 不要把 `.patch`、本地密钥、上传材料或诊断日志提交到仓库。
- 修改认证逻辑后，至少运行：

```bash
npm run test:auth
npm run lint
npm run build
```

