# 管理员敏感操作的强制 step-up（DAN-48）

`IsStepUpEnabled` 默认 false（`backend/internal/service/setting_features.go:256`），而
`StepUpAuthMiddleware` 是按这个全局开关放行的 —— 开关一关，挂它的管理端点直接通过。
本文件记录：哪些管理端点**不受全局开关影响**、为什么、以及升级会打到什么。

代码侧只有一句话：这些端点挂 `middleware.NewForcedStepUpAuthMiddleware`（判定与软门共用
`enforceStepUpWithReason`，只把 settings 固定为 nil = fail-closed），其余端点仍由全局开关决定。
逐条判定表在 `backend/internal/server/routes/admin_step_up_coverage_test.go` 的
`adminStepUpClassification`；注册处新增管理端点而未判定即测试失败，本文件的清单与它由
`admin_step_up_doc_test.go` 对账（数量、条目、分组计数任何一处漂移都会红）。

## 判据

一次调用即可造成下列之一 → 强制：

- **S1 服务替换/代码执行**：替换或重启运行中的服务，或装入可执行的本地插件代码。
- **S2 凭据/数据外泄**：取出或改写上游、代理凭据原文，整库备份，卡密原文；或改写数据外泄目标。
- **S3 权限提升**：取得或授出管理员权限、接管登录身份、签发管理凭证。
- **S4 资金损失**：让资金、配额或定价离开或偏离账目。
- **S5 证据销毁**：不可逆销毁审计、计费或备份证据。

不拦：只读查询；可回滚的业务对象 CRUD；上游账号/代理的运维动作；连通性探测；策略调参；
以及 TOTP 引导通道（见下）。

## 强制清单（121 条）

按「改配置 / 读数据 / 写数据 / 导出」分组呈现，每条给一行判据（对应上面哪一类在括号外不重复写）。

#### 改配置（70）

| 端点 | 判据 |
| --- | --- |
| `DELETE /api/v1/admin/channels/:id` | 渠道=计费定价源，改价即改用户账单 |
| `DELETE /api/v1/admin/groups/:id/rate-multipliers` | 分组倍率=计费价格，改完直接影响收入 |
| `DELETE /api/v1/admin/payment/plans/:id` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `DELETE /api/v1/admin/payment/providers/:id` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `DELETE /api/v1/admin/plugins/:id` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `DELETE /api/v1/admin/settings/admin-api-key` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `DELETE /api/v1/admin/settings/admin-api-keys/:id` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `DELETE /api/v1/admin/settings/admin-api-keys/:id/record` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `POST /api/v1/admin/accounts` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/:id/apply-oauth-credentials` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/:id/duplicate` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/:id/shadow` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/batch` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/batch-update-credentials` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/bulk-update` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/cookie-auth` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/data` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/exchange-code` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/exchange-setup-token-code` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/generate-auth-url` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/generate-setup-token-url` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/import/codex-session` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/setup-token-cookie-auth` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/accounts/sync/crs` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/antigravity/oauth/auth-url` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/antigravity/oauth/exchange-code` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/antigravity/oauth/refresh-token` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/channels` | 渠道=计费定价源，改价即改用户账单 |
| `POST /api/v1/admin/data-management/s3/profiles` | 改写同步目标存储，数据可被导向外部账号 |
| `POST /api/v1/admin/data-management/s3/profiles/:profile_id/activate` | 改写同步目标存储，数据可被导向外部账号 |
| `POST /api/v1/admin/gemini/oauth/auth-url` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/gemini/oauth/exchange-code` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/auth-url` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/create-from-oauth` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/exchange-code` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/password` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/refresh-token` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/oauth/sso-token` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/grok/sso-to-oauth` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/openai/create-from-codex-pat` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/openai/create-from-oauth` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/openai/exchange-code` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/openai/generate-auth-url` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/openai/refresh-token` | OAuth 换取/刷新上游凭据，等于把账号凭据交给调用方或写进池子 |
| `POST /api/v1/admin/payment/plans` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `POST /api/v1/admin/payment/providers` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `POST /api/v1/admin/plugins/:id/disable` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `POST /api/v1/admin/plugins/:id/enable` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `POST /api/v1/admin/plugins/:id/test` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `POST /api/v1/admin/plugins/upload` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `POST /api/v1/admin/proxies` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/proxies/batch` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/proxies/data` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `POST /api/v1/admin/settings/admin-api-key/regenerate` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `POST /api/v1/admin/settings/admin-api-keys` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `POST /api/v1/admin/settings/admin-api-keys/:id/rotate` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |
| `POST /api/v1/admin/system/restart` | 替换/回滚/重启运行中的服务（≈主机代码执行） |
| `POST /api/v1/admin/system/rollback` | 替换/回滚/重启运行中的服务（≈主机代码执行） |
| `PUT /api/v1/admin/accounts/:id` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `PUT /api/v1/admin/backups/image-storage` | 改写备份/图片对象存储目标=把数据导向外部账号 |
| `PUT /api/v1/admin/backups/s3-config` | 改写备份/图片对象存储目标=把数据导向外部账号 |
| `PUT /api/v1/admin/channels/:id` | 渠道=计费定价源，改价即改用户账单 |
| `PUT /api/v1/admin/data-management/s3/profiles/:profile_id` | 改写同步目标存储，数据可被导向外部账号 |
| `PUT /api/v1/admin/groups/:id/rate-multipliers` | 分组倍率=计费价格，改完直接影响收入 |
| `PUT /api/v1/admin/payment/config` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `PUT /api/v1/admin/payment/plans/:id` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `PUT /api/v1/admin/payment/providers/:id` | 支付渠道/套餐/服务商配置，决定钱进谁的账户 |
| `PUT /api/v1/admin/plugins/:id/config` | 本地进程插件可执行代码：上传/启停/改配置/试跑 |
| `PUT /api/v1/admin/proxies/:id` | 写入/改写上游账号或代理凭据，可把流量导向攻击者基础设施 |
| `PUT /api/v1/admin/settings/admin-api-keys/:id` | 签发、轮换或吊销管理员凭证，等于发放管理员身份 |

#### 读数据（0）

无 —— 强制名单里没有纯查询端点；所有会返回数据副本的读接口都归入「导出」。


#### 写数据（47）

| 端点 | 判据 |
| --- | --- |
| `DELETE /api/v1/admin/accounts/:id` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `DELETE /api/v1/admin/affiliates/users/:user_id` | 返利提现/批量改返利比例，直接动钱 |
| `DELETE /api/v1/admin/backups/:id` | 删除备份，不可逆丢数据 |
| `DELETE /api/v1/admin/promo-codes/:id` | 优惠码决定折扣力度，可用来白拿服务 |
| `DELETE /api/v1/admin/prompt-audit/events/:id` | 删除提示词审计事件，销毁入侵证据且不可逆 |
| `DELETE /api/v1/admin/proxies/:id` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `DELETE /api/v1/admin/redeem-codes/:id` | 生成/作废/删除卡密，都是资金凭证的增删 |
| `DELETE /api/v1/admin/risk-control/hashes/all` | 清空风控命中记录，销毁证据 |
| `DELETE /api/v1/admin/subscriptions/:id` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `DELETE /api/v1/admin/users/:id` | 创建/改写用户：请求体含 role、password、balance |
| `POST /api/v1/admin/accounts/batch-delete` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `POST /api/v1/admin/affiliates/users/:user_id/withdraw` | 返利提现/批量改返利比例，直接动钱 |
| `POST /api/v1/admin/affiliates/users/batch-rate` | 返利提现/批量改返利比例，直接动钱 |
| `POST /api/v1/admin/backups` | 创建整库备份，可随即经下载直链取走 |
| `POST /api/v1/admin/backups/:id/restore` | 整库覆盖：可回滚安全设置（含 step-up 开关本身） |
| `POST /api/v1/admin/data-management/backups` | 创建整库备份，可随即经下载直链取走 |
| `POST /api/v1/admin/ops/system-logs/cleanup` | 清理系统日志，销毁证据 |
| `POST /api/v1/admin/payment/orders/:id/cancel` | 退款/重试履约/取消订单，直接动钱 |
| `POST /api/v1/admin/payment/orders/:id/refund` | 退款/重试履约/取消订单，直接动钱 |
| `POST /api/v1/admin/payment/orders/:id/refund/query` | 退款/重试履约/取消订单，直接动钱 |
| `POST /api/v1/admin/payment/orders/:id/retry` | 退款/重试履约/取消订单，直接动钱 |
| `POST /api/v1/admin/promo-codes` | 优惠码决定折扣力度，可用来白拿服务 |
| `POST /api/v1/admin/prompt-audit/events/batch-delete` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `POST /api/v1/admin/prompt-audit/events/delete-by-filter` | 删除提示词审计事件，销毁入侵证据且不可逆 |
| `POST /api/v1/admin/proxies/batch-delete` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `POST /api/v1/admin/redeem-codes/:id/expire` | 生成/作废/删除卡密，都是资金凭证的增删 |
| `POST /api/v1/admin/redeem-codes/batch-delete` | 批量/单条删除上游账号或代理，凭据不可恢复 |
| `POST /api/v1/admin/redeem-codes/batch-update` | 生成/作废/删除卡密，都是资金凭证的增删 |
| `POST /api/v1/admin/redeem-codes/create-and-redeem` | 生成/作废/删除卡密，都是资金凭证的增删 |
| `POST /api/v1/admin/redeem-codes/generate` | 生成/作废/删除卡密，都是资金凭证的增删 |
| `POST /api/v1/admin/subscriptions/:id/extend` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/:id/extend/replay` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/:id/reset-quota` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/:id/restore` | 整库覆盖：可回滚安全设置（含 step-up 开关本身） |
| `POST /api/v1/admin/subscriptions/:id/revoke` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/assign` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/bulk-action` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/bulk-action/replay` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/subscriptions/bulk-assign` | 分配/延长/重置/撤销订阅=发放或收回已付费服务 |
| `POST /api/v1/admin/usage/cleanup-tasks` | 创建使用记录清理任务，销毁计费/审计依据 |
| `POST /api/v1/admin/users` | 创建/改写用户：请求体含 role、password、balance |
| `POST /api/v1/admin/users/:id/auth-identities` | 绑定登录身份=接管该账号的登录路径 |
| `POST /api/v1/admin/users/:id/balance` | 直接改用户余额，等于凭空造钱/扣钱 |
| `POST /api/v1/admin/users/:id/balance/replay` | 直接改用户余额，等于凭空造钱/扣钱 |
| `PUT /api/v1/admin/affiliates/users/:user_id` | 返利提现/批量改返利比例，直接动钱 |
| `PUT /api/v1/admin/promo-codes/:id` | 优惠码决定折扣力度，可用来白拿服务 |
| `PUT /api/v1/admin/users/:id` | 创建/改写用户：请求体含 role、password、balance |

#### 导出（4）

| 端点 | 判据 |
| --- | --- |
| `GET /api/v1/admin/accounts/data` | 返回上游账号/代理凭据原文 |
| `GET /api/v1/admin/backups/:id/download-url` | 整库备份下载直链，取到即拿走全部数据 |
| `GET /api/v1/admin/proxies/data` | 返回上游账号/代理凭据原文 |
| `GET /api/v1/admin/redeem-codes/export` | 卡密原文=可直接变现的资金凭证 |

## 刻意不拦（333 条）

逐条在 `admin_step_up_classification` 测试表里；按类别汇总如下。**带「残留」的两行是已知缺口，
不是判为安全**：

| 类别 | 条数 | 说明 |
| --- | --- | --- |
| 只读查询 | 185 | 185 条：列表/详情/统计/趋势，不返回凭据原文、不改状态 |
| 可回滚业务 CRUD | 61 | 公告、分组元数据、渠道监控与模板、用户属性、错误透传、TLS 指纹、定时测试计划 |
| 上游账号/代理运维 | 38 | 刷新、清错误、额度、用量、统计、复制、探测；可重试可回滚 |
| 连通性探测 | 13 | test/probe/preview/quality-check，只回报结果 |
| 策略调参 | 29 | 限流、告警、日志级别、冷却窗口；不改凭据、不迁资金、不销毁证据 |
| TOTP 引导通道 | 1 | `PUT /admin/settings`（见下） |
| 独立硬门 | 2 | `/audit-logs/clear` 走 handler 内现场 TOTP；`/system/update` 走 #27 三重门 |
| 证据削弱（残留） | 4 | 风控/审计开关、单条误报清理；削弱采集但不销毁已有证据 |

### `/system/update` 与 `/audit-logs/clear` 为什么不在此表

两者已被更严的门挡住：`/system/update` 走 #27 的三重硬门（enabled + 对端 CIDR + 强制 step-up，
不读全局开关），`/audit-logs/clear` 在 handler 内做现场 TOTP 校验（不复用 sudo 窗口）。本 PR 不改这两道门。

### 为什么 `PUT /admin/settings` 不拦

`totp_enabled` 默认 false。若把总面板也拦死，一个从未绑定 TOTP 的部署**没有任何端点**能打开 TOTP
功能 → 无人可管，这是死锁而不是加固。它保留在全局开关下，并保留 handler 内既有的条件强制
（关闭 step-up 开关本身走 `EnforceStepUpAlways`）。

代价是它能改 SMTP、支付、风控、审计开关。因此**每次设置写入都会在审计里留下
`settings_write_without_step_up` 标记**（无 step-up 授权时才写），事后可区分「sudo 窗口内改设置」
与「仅凭管理员会话改设置」。按字段粒度的条件强制是后续工作。

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

用 **admin API key** 调上面 121 个端点会得到 `403 STEP_UP_ADMIN_API_KEY_FORBIDDEN`：机器凭证
无法完成 step-up，这是刻意的（#27 对 `/system/update` 已是这个行为）。脚本侧三条路：

- 把脚本降级到不在清单里的端点（例如账号刷新、用量统计、探测都还在全局开关下）；
- 改由**浏览器会话 + TOTP step-up** 执行：先 `POST /api/v1/user/totp/step-up` 拿到 sudo 窗口
  （窗口内可连续操作），再用该会话调这些端点；
- 需要长期无人值守的，改走「人工确认 + 脚本执行」两段式，不要试图绕过门。

**没有配置开关可以关掉这道门**。这是有意的：能关掉的强制门等于没有。

### 3. MCP 管理面

MCP 管理工具复用同一套管理路由，`auth_method=mcp_oauth` 属机器凭证，因此上述端点通过 MCP
调用同样返回 403。MCP 侧应只承担只读与运维类操作。

### 4. 前端

`api/client.ts` 认 `STEP_UP_REQUIRED`：弹一次全局 `TotpStepUpDialog`（挂在 `App.vue`），成功后重试
一次；用户取消或 `STEP_UP_TOTP_NOT_ENABLED` 不重试，按后端文案提示。管理面 sudo 窗口是会话级的，
所以一次验证覆盖整段会话。原先逐页面接 `useStepUp` 的 7 处保持不变。

### 5. 审计

每次判定都写 `forced_step_up_result`（allowed/denied）与 `forced_step_up_reason`
（`STEP_UP_REQUIRED` / `STEP_UP_TOTP_NOT_ENABLED` / `STEP_UP_ADMIN_API_KEY_FORBIDDEN` /
`STEP_UP_MCP_OAUTH_FORBIDDEN` / `STEP_UP_UNAVAILABLE`），拒绝同时写一行 warn 进程日志。
变更类请求本来就会入审计（403 也入），这里补的是**为什么**被拒。

## 回滚

没有运行时开关。回滚 = revert 本 PR。若只想临时放开某个端点，改它的路由行（把
`gin.HandlerFunc(forcedStepUpAuth)` 去掉）并同步改分类表与本文，不要加全局旁路。

## 残留风险（本 PR 明确不覆盖）

1. `PUT /admin/settings` 总面板（SMTP、支付、风控、审计开关）—— 见上文死锁论证，需按字段做条件强制。
2. `PUT /admin/risk-control/config`、`PUT /admin/prompt-audit/config`、`DELETE /admin/risk-control/hashes`、
   `POST /admin/risk-control/users/:user_id/unban` —— 削弱证据采集，不销毁已有证据。
3. `POST /admin/plugins/:id/ui-session` —— 插件 UI 能力 URL，作用域限于单插件自身接口。
4. 相邻但不在本 PR 范围：DAN-59（`trust=true` 时不校验代理 + `CF-Connecting-IP` 优先）。

## 上游关系

`internal/server/middleware/step_up.go`、`internal/server/routes/admin.go` 上游同样存在
（`Wei-Shaw/sub2api` 的 `StepUpAuthMiddleware` 同样按全局开关放行，同样默认 false），
**上游同病**：最小回灌是 `NewForcedStepUpAuthMiddleware` + `enforceStepUpWithReason` 两个函数，
端点清单要按上游自己的路由重做（本地有 payment/affiliate/plugin 等上游可能没有的分组）。
`deploy/ADMIN_STEP_UP.md` 本地独有。
