# 管理员敏感操作的强制 step-up（DAN-48）

`IsStepUpEnabled` 默认 false（`backend/internal/service/setting_features.go:256`），而
`StepUpAuthMiddleware` 是按这个全局开关放行的 —— 开关一关，所有挂它的管理端点直接通过。
本文件记录：哪些管理端点**不受全局开关影响**、为什么、以及升级会打到什么。

代码侧只有一句话：这些端点挂 `middleware.NewForcedStepUpAuthMiddleware`（判定与软门共用
`enforceStepUpWithReason`，只把 settings 固定为 nil = fail-closed），其余端点仍由全局开关决定。
逐条判定表在 `backend/internal/server/routes/admin_step_up_coverage_test.go` 的
`adminStepUpClassification`，注册处新增管理端点而未判定即 CI 红。

## 判据

一次调用即可造成下列之一 → 强制：

- **S1 服务替换/代码执行**：替换或重启运行中的服务，或装入可执行的本地插件代码。
- **S2 凭据/数据外泄**：取出或改写上游、代理凭据原文，整库备份，卡密原文；或改写数据外泄目标。
- **S3 权限提升**：取得或授出管理员权限、接管登录身份、签发管理凭证。
- **S4 资金损失**：让资金、配额或定价离开或偏离账目。
- **S5 证据销毁**：不可逆销毁审计、计费或备份证据。

不拦：只读查询；可回滚的业务对象 CRUD；上游账号/代理的运维动作；连通性探测；策略调参；
以及 TOTP 引导通道（见下）。

## 强制清单（82 条）

### S1 服务替换/代码执行（8）
- `DELETE /api/v1/admin/plugins/:id`
- `POST /api/v1/admin/plugins/:id/disable`
- `POST /api/v1/admin/plugins/:id/enable`
- `POST /api/v1/admin/plugins/:id/test`
- `POST /api/v1/admin/plugins/upload`
- `POST /api/v1/admin/system/restart`
- `POST /api/v1/admin/system/rollback`
- `PUT /api/v1/admin/plugins/:id/config`

`POST /api/v1/admin/system/update` 不在此表：它已由 #27 的三重硬门（enabled + 对端 CIDR + 强制
step-up）拦下，本 PR 不改那道门。

### S2 凭据/数据外泄（14）
- `GET /api/v1/admin/accounts/data`
- `GET /api/v1/admin/backups/:id/download-url`
- `GET /api/v1/admin/proxies/data`
- `POST /api/v1/admin/accounts/batch-update-credentials`
- `POST /api/v1/admin/accounts/data`
- `POST /api/v1/admin/backups`
- `POST /api/v1/admin/backups/:id/restore`
- `POST /api/v1/admin/data-management/backups`
- `POST /api/v1/admin/data-management/s3/profiles`
- `POST /api/v1/admin/data-management/s3/profiles/:profile_id/activate`
- `POST /api/v1/admin/proxies/data`
- `PUT /api/v1/admin/backups/image-storage`
- `PUT /api/v1/admin/backups/s3-config`
- `PUT /api/v1/admin/data-management/s3/profiles/:profile_id`

`POST /admin/accounts/data` 与 `POST /admin/proxies/data` 是补对称：导出早就要 step-up，导入反而没有，
导入可把全部上游凭据换成攻击者的。

### S3 权限提升（11）
- `DELETE /api/v1/admin/settings/admin-api-key`
- `DELETE /api/v1/admin/settings/admin-api-keys/:id`
- `DELETE /api/v1/admin/settings/admin-api-keys/:id/record`
- `DELETE /api/v1/admin/users/:id`
- `POST /api/v1/admin/settings/admin-api-key/regenerate`
- `POST /api/v1/admin/settings/admin-api-keys`
- `POST /api/v1/admin/settings/admin-api-keys/:id/rotate`
- `POST /api/v1/admin/users`
- `POST /api/v1/admin/users/:id/auth-identities`
- `PUT /api/v1/admin/settings/admin-api-keys/:id`
- `PUT /api/v1/admin/users/:id`

`PUT /admin/users/:id` 的请求体同时接受 `role`、`password`、`balance`（`user_handler.go:77`），
一条请求就能把攻击者账号提成管理员或改掉受害者的密码。

### S4 资金损失（42）
- `DELETE /api/v1/admin/affiliates/users/:user_id`
- `DELETE /api/v1/admin/channels/:id`
- `DELETE /api/v1/admin/groups/:id/rate-multipliers`
- `DELETE /api/v1/admin/payment/plans/:id`
- `DELETE /api/v1/admin/payment/providers/:id`
- `DELETE /api/v1/admin/promo-codes/:id`
- `DELETE /api/v1/admin/redeem-codes/:id`
- `DELETE /api/v1/admin/subscriptions/:id`
- `GET /api/v1/admin/redeem-codes/export`
- `POST /api/v1/admin/affiliates/users/:user_id/withdraw`
- `POST /api/v1/admin/affiliates/users/batch-rate`
- `POST /api/v1/admin/channels`
- `POST /api/v1/admin/payment/orders/:id/cancel`
- `POST /api/v1/admin/payment/orders/:id/refund`
- `POST /api/v1/admin/payment/orders/:id/refund/query`
- `POST /api/v1/admin/payment/orders/:id/retry`
- `POST /api/v1/admin/payment/plans`
- `POST /api/v1/admin/payment/providers`
- `POST /api/v1/admin/promo-codes`
- `POST /api/v1/admin/redeem-codes/:id/expire`
- `POST /api/v1/admin/redeem-codes/batch-delete`
- `POST /api/v1/admin/redeem-codes/batch-update`
- `POST /api/v1/admin/redeem-codes/create-and-redeem`
- `POST /api/v1/admin/redeem-codes/generate`
- `POST /api/v1/admin/subscriptions/:id/extend`
- `POST /api/v1/admin/subscriptions/:id/extend/replay`
- `POST /api/v1/admin/subscriptions/:id/reset-quota`
- `POST /api/v1/admin/subscriptions/:id/restore`
- `POST /api/v1/admin/subscriptions/:id/revoke`
- `POST /api/v1/admin/subscriptions/assign`
- `POST /api/v1/admin/subscriptions/bulk-action`
- `POST /api/v1/admin/subscriptions/bulk-action/replay`
- `POST /api/v1/admin/subscriptions/bulk-assign`
- `POST /api/v1/admin/users/:id/balance`
- `POST /api/v1/admin/users/:id/balance/replay`
- `PUT /api/v1/admin/affiliates/users/:user_id`
- `PUT /api/v1/admin/channels/:id`
- `PUT /api/v1/admin/groups/:id/rate-multipliers`
- `PUT /api/v1/admin/payment/config`
- `PUT /api/v1/admin/payment/plans/:id`
- `PUT /api/v1/admin/payment/providers/:id`
- `PUT /api/v1/admin/promo-codes/:id`

### S5 证据销毁（7）
- `DELETE /api/v1/admin/backups/:id`
- `DELETE /api/v1/admin/prompt-audit/events/:id`
- `DELETE /api/v1/admin/risk-control/hashes/all`
- `POST /api/v1/admin/ops/system-logs/cleanup`
- `POST /api/v1/admin/prompt-audit/events/batch-delete`
- `POST /api/v1/admin/prompt-audit/events/delete-by-filter`
- `POST /api/v1/admin/usage/cleanup-tasks`

`POST /admin/audit-logs/clear` 不在此表：它已在 handler 内做现场 TOTP 校验（不复用 sudo 窗口）。

## 刻意不拦（372 条，逐条在测试表里）

| 类别 | 条数 | 理由 |
| --- | --- | --- |
| 只读查询 | 185 | 不返回凭据原文、不改状态 |
| 可回滚业务 CRUD | 61 | 公告、分组元数据、渠道监控、模板、用户属性、错误透传、TLS 指纹、定时测试计划 |
| 上游账号/代理运维 | 38 | 刷新、清错误、额度、用量、统计、复制；可重试可回滚 |
| 上游账号/代理写入 | 39 | **残留风险**：写入攻击者上游/代理要再配合分组调度才能改变流量走向，本 PR 未纳入，见「残留风险」 |
| 连通性探测 | 13 | 只回报结果 |
| 策略调参 | 29 | 限流/告警/日志级别/冷却窗口；不改凭据、不迁资金、不销毁证据 |
| TOTP 引导通道 | 1 | `PUT /admin/settings` |
| 独立硬门 | 2 | `/audit-logs/clear`（handler 内现场 TOTP）、`/system/update`（#27 三重门，已合入 main；本 PR 不改那道门） |
| 证据削弱 | 4 | **残留风险**：风控/审计开关、单条误报清理 |

### 为什么 `PUT /admin/settings` 不拦

`totp_enabled` 默认 false。若把总面板也拦死，一个从未绑定 TOTP 的部署**没有任何端点**能打开 TOTP
功能 → 无人可管，这是死锁而不是加固。它保留在全局开关下，并保留 handler 内既有的条件强制
（关闭 step-up 开关本身走 `EnforceStepUpAlways`）。
代价是它能改 SMTP、支付、风控、审计开关 —— 属残留风险，需要按请求体做条件强制，另开 issue。

## 升级影响（必读）

### 1. 前置条件：先开 TOTP，再升级

强制门要求「本人已启用 TOTP + 本会话完成过 step-up」。默认部署 `totp_enabled` 也是 false，
所以**默认配置下这些端点会返回 `STEP_UP_TOTP_NOT_ENABLED`**，等于新装部署一升级就失去这些功能。
升级顺序必须是：

1. 在系统设置里打开 TOTP 功能（`PUT /admin/settings`，此端点不受强制门影响）；
2. 给每个需要这些权限的管理员绑定 TOTP；
3. 再升级到本版本。

不按这个顺序升级不会丢数据，但管理员会被 403 挡住，直到补齐第 1、2 步。

### 2. 管理员自动化脚本

用 **admin API key** 调上面 82 个端点会得到 `403 STEP_UP_ADMIN_API_KEY_FORBIDDEN`：机器凭证
无法完成 step-up，这是刻意的（#27 对 `/system/update` 已是这个行为）。脚本侧三条路：

- 把脚本降级到不在清单里的端点（例如账号刷新、用量统计、探测都还在全局开关下）；
- 改由**浏览器会话 + TOTP step-up** 执行：先 `POST /api/v1/user/totp/step-up` 拿到 sudo 窗口
  （默认窗口内可连续操作），再用该会话调这些端点；
- 需要长期无人值守的，改走「人工确认 + 脚本执行」两段式，不要试图绕过门。

**没有配置开关可以关掉这道门**。这是有意的：能关掉的强制门等于没有。

### 3. MCP 管理面

MCP 管理工具复用同一套管理路由，`auth_method=mcp_oauth` 属机器凭证，因此上述端点通过 MCP
调用同样返回 403。MCP 侧应只承担只读与运维类操作。

### 4. 前端

目前只有用户创建/编辑弹窗、账号导出、备份、插件、管理密钥页面接了 `useStepUp`。
新拦的端点（资金、订阅、支付、卡密、渠道定价等）会直接显示后端英文文案
「This operation requires recent two-factor verification」。前端接 `useStepUp` 是后续工作，
不影响安全语义；管理员在任一接了 step-up 的页面完成一次验证后，sudo 窗口对整个会话有效。

### 5. 审计

每次判定都写 `forced_step_up_result`（allowed/denied）与 `forced_step_up_reason`
（`STEP_UP_REQUIRED` / `STEP_UP_TOTP_NOT_ENABLED` / `STEP_UP_ADMIN_API_KEY_FORBIDDEN` /
`STEP_UP_MCP_OAUTH_FORBIDDEN` / `STEP_UP_UNAVAILABLE`），拒绝同时写一行 warn 进程日志。
变更类请求本来就会入审计（403 也入），这里补的是**为什么**被拒。

## 回滚

没有运行时开关。回滚 = revert 本 PR。若只想临时放开某个端点，改它的路由行（把
`gin.HandlerFunc(forcedStepUpAuth)` 去掉）并同步改分类表，不要加全局旁路。

## 残留风险（本 PR 明确不覆盖）

1. `PUT /admin/settings` 总面板（含 SMTP、支付、风控、审计开关）—— 见上文死锁论证，需 body 级条件强制。
2. 上游账号/代理的创建与凭据改写（39 条）—— 两步才能改变流量走向，但一步就能把攻击者上游塞进池子；
   待 owner 决定是否纳入。
3. `PUT /admin/risk-control/config`、`PUT /admin/prompt-audit/config`、`DELETE /admin/risk-control/hashes`、
   `POST /admin/risk-control/users/:user_id/unban` —— 削弱证据采集，不销毁已有证据。
4. `POST /admin/plugins/:id/ui-session` —— 插件 UI 能力 URL，作用域限于单个插件自身接口。

## 上游关系

`internal/server/middleware/step_up.go`、`internal/server/routes/admin.go` 上游同样存在
（`Wei-Shaw/sub2api` 的 `StepUpAuthMiddleware` 同样按全局开关放行，同样默认 false），
**上游同病**：最小回灌是 `NewForcedStepUpAuthMiddleware` + `enforceStepUpWithReason` 两个函数，
端点清单要按上游自己的路由重做（本地有 payment/affiliate/plugin 等上游可能没有的分组）。
`deploy/ADMIN_STEP_UP.md` 本地独有。
