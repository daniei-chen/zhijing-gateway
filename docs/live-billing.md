# Live 会话：计费现状、部署开关与按时长计费方案

- 仓库：`daniei-chen/zhijing-gateway`，基线 main = `5600095a7`（2026-11-28 检出）。
- 本文对应"Live 默认关闭"这个 PR：新增 `gateway.live.enabled`（默认 false）与路由守卫。行号以 `5600095a7` 加本 PR 为准。
- 第 3 节只是计费方案，本 PR 不实现，也不改任何计费逻辑。

## 1. 现状

### 1.1 默认关闭（本 PR 之后）

`gateway.live.enabled` 是 bool，默认 `false`：

- 结构体字段：`backend/internal/config/config.go:1333-1340`
- 默认值：`backend/internal/config/config.go:2629`，紧挨 `gateway.live.max_session_duration_seconds` 的 3600（`:2630`）

关闭时，四条 Live 注册全部在 handler 之前被 `middleware.LiveEnabledGuard`（`backend/internal/server/middleware/live_enabled.go`）拦下，挂载点见 `backend/internal/server/routes/gateway.go:57`：

| 方法 / 路径 | 注册位置 | handler |
|---|---|---|
| `POST /v1/live` | `gateway.go:239` | `OpenAIGateway.Live` |
| `GET /v1/live/:call_id` | `gateway.go:240` | `OpenAIGateway.LiveSideband` |
| `POST /backend-api/codex/realtime/calls` | `gateway.go:419` | `OpenAIGateway.Live` |
| `GET /backend-api/codex/:call_id` | `gateway.go:420` | `OpenAIGateway.LiveSideband` |

后两条是同一个 handler 的 Codex 直连入口，只在 `/v1/live` 上装闸门等于没关，所以一并挂上。

关闭时的响应固定为：

```
HTTP/1.1 404 Not Found
{"error":{"type":"not_found_error","message":"Live is not enabled"}}
```

请求不进 handler：不解析请求体、不取用户/账号并发槽位（lease）、不建立上游会话。用 404 而不是 403，因为这是"本部署没有这个能力"，与分组未开通 Live 的 403 `permission_error` 区分开，也不向未授权客户端透露部署配置。

开启时守卫是纯放行，路径、鉴权、分组 `allow_live` 校验与 handler 行为和本 PR 之前一致（测试 `TestGatewayRoutesLiveEnabledKeepsHandlerBehavior` 断言 handler 自己的响应原样返回）。

### 1.2 此前：默认开启，且完全不计费

本 PR 之前没有 `gateway.live.enabled`，上述四条路由无条件注册（`5600095a7` 上的 `gateway.go:236-237`、`:416-417`），任何持有 Key 的人都能开 Live 会话。

计费缺口有作者自己标注的 TODO，原文（`backend/internal/service/openai_live.go:830-834`）：

> TODO(billing): Live 会话目前不计费：TotalCost/ActualCost 恒为 0，完全绕过
> recordUsageCore/applyUsageBilling，余额模式下极低余额也能反复开启最长
> liveMaxSessionDuration 的会话。若确认按时长计费，应在此接入计费管道；
> 若确认有意免费，删除本注释即可（零值行为由
> TestFinalizeLiveCallIsIdempotentAndWritesZeroUsage 锁定）。

具体行为（`openai_live.go:800-857`）：会话结束时 `finalizeLiveCall` 直接 `writeUsageLogBestEffort` 落一行 `usage_logs`，`RequestType=live`、`DurationMs=会话时长`、`InboundEndpoint=/v1/live`、`RateMultiplier=1`，但不设置 `TotalCost` / `ActualCost`（零值），也不写 `usage_billing_dedup`。零值行为有测试锁定：`internal/service/openai_live_lifecycle_test.go:268`（`TestFinalizeLiveCallIsIdempotentAndWritesZeroUsage`）。

单会话时长上限 `gateway.live.max_session_duration_seconds` 默认 3600 秒，单次封顶，但可以无限次重开——余额模式下余额再低也拦不住。

对账侧：`internal/repository/ops_repo_billing.go:42-46` 的 `billing_dedup_gap_count` 查询显式排除 `/v1/live`，理由是 Live 行永远没有 dedup 键，不排除会让该指标 100% 误报。本 PR 只把这条注释改成 TODO 标记（Live 接上计费后必须删掉这个排除，否则指标会漏算 `/v1/live` 的行而长期失真），SQL 逻辑未改。

## 2. 运维影响

- **升级后 Live 默认不可用。** `/v1/live`、`/v1/live/:call_id`、`/backend-api/codex/realtime/calls`、`/backend-api/codex/:call_id` 一律返回 404 `not_found_error` / `Live is not enabled`。这适用于所有分组：即使分组开了 `allow_live`，部署开关关闭时仍然 404。
- **恢复方式**（二者等价，环境变量优先）：
  - `config.yaml`：`gateway.live.enabled: true`
  - 环境变量：`GATEWAY_LIVE_ENABLED=true`
  改完需要重启进程（配置在启动时加载）。恢复后仍需分组层面开 `allow_live`，两级开关同时为真 Live 才可用。
- **打开即自行承担未计费的上游成本。** 这个开关不是"经济上安全"的：恢复 Live 等于恢复 `TODO(billing)` 描述的状态——每个会话最长 3600 秒、`TotalCost`/`ActualCost` 恒为 0、不写 dedup 键，上游成本落在部署方的上游账号上，客户端侧免费且可反复开启。只应在受信任的内部部署或明确补贴的场景打开；打开期间这部分的成本只能靠上游账单，网关指标里看不到。
- 打开期间的 `billing_dedup_gap_count` 指标依赖 `ops_repo_billing.go` 的 `/v1/live` 排除来避免误报——这也是第 3 节要求"接上计费后再删排除"的原因。
- 迁移/回滚：本 PR 没有 schema 变化、没有迁移；回滚只需回退代码，配置文件里的 `gateway.live.enabled` 会被旧版本忽略（旧版本没有这个键）。

## 3. 待办：按时长计费的方案（只设计，不实现）

前置确认：**上游对 Live 的计费口径**（按分钟、按会话、还是按媒体流计费）决定下面所有公式。先拿一张上游账单核对，再定单价与计量单位。

### 3.1 计量口径

- 计量对象：会话时长，秒级记录（`LiveCallRecord.CreatedAt` → 结束时间；`DurationMs` 已经在 `usage_logs` 行里落库）。对外计价按分钟向上取整，最少 1 分钟，避免秒级尾差在账单上抖动。
- 计价维度：模型（`record.Model`）× 分组倍率。现有价目表是 token 价格，不能直接复用；需要一条"每分钟"单价（或在价目表里增加 `billing_mode=duration` 的单价），按现有 `billing.inflight_reservation.fail_closed_on_unpriced` 的口径：取不到单价就拒绝创建，绝不退化成免费。
- 落账字段：`TotalCost = ceil(duration/60) × 每分钟单价`；`ActualCost = TotalCost × RateMultiplier`（现在 Live 行的 `RateMultiplier` 恒为 1）；`BillingMode` 记 `duration`、`BillingTier` 记 `live`，方便对账按这两列筛。
- 结算时机：会话关闭是唯一往 `usage_logs` 落行的点（`finalizeLiveCall`），计费必须挂在同一处，否则会出现"有 usage 行、无扣费"的第二种形态。

### 3.2 与对账窗口如何对齐

现状是三个时间点错位：

1. `usage_logs.created_at` = 会话开始时间；
2. 行在会话结束（最长 3600 秒后）才写入；
3. 对账任务按 `created_at` 扫 5–60 分钟窗口。

结果：一个跨窗口的长会话，在开始后的那轮对账里查不到行（漏报），结束后又落在一个已经扫过的窗口里（迟报）。两种可选方案：

- **A（推荐，不动 schema）**：保留 `created_at` 语义，对账扫描区间向前多覆盖一个 `liveMaxSessionDuration`，靠 `request_id` 去重。改动小，代价是每次多扫一小时的窗口。
- **B（更准，需要迁移）**：给 `usage_logs` 增加"结束时间/计费时间"列，对账按该列扫描。语义最干净，但要新迁移，且所有对账查询都要改。

无论 A/B，接上计费后都必须：

- 在和 `recordUsageCore` 同一条路径写 `usage_billing_dedup`（键 = `CallHash`），否则 dedup 缺口指标还是误报；
- 删掉 `ops_repo_billing.go` 的 `/v1/live` 排除（本 PR 已留 TODO），否则指标会长期漏算这部分行；
- 明确落账失败语义：`writeUsageLogBestEffort` 是会话唯一一次落库机会，失败即永久丢失。接计费后"丢失 = 免费会话"，必须与计费失败关闭策略对齐（重试、告警、或按预扣金额结算）。

### 3.3 余额模式预扣

现状：余额只在创建前由 `CheckBillingEligibility` 检查一次，会话最长 1 小时且不计费，所以 0 余额也能反复开启。

方案：

- **创建时预扣最坏情况金额**：`每分钟单价 × ceil(max_session_duration/60) × 分组倍率`。与并发槽位获取放在同一临界区：先拿用户槽位，预扣失败就释放槽位并拒绝创建（402/400，按现有计费错误映射）。
- **关闭时按实际时长结算**：实收 = 实际分钟数 × 单价 × 倍率，差额退回；创建阶段失败（上游拒绝、会话未建立）全额退回。结算键 = `CallHash`，保证 `finalizeLiveCall` 重入幂等。
- **预扣必须可回收**：进程崩溃或会话丢失时，预扣不能永久占着余额。需要一条超时回收路径（按最坏情况结算或全额退回，二选一写死），并用同一张预扣流水表审计。
- **订阅模式**：等价地预占额度，或按"剩余额度 ÷ 每分钟单价"压低 `max_session_duration`，避免超出套餐；不能只检查一次剩余额度就放行一小时会话。
- **无价即拒**：算不出每分钟单价（新模型未配价）时拒绝创建，不要回退成免费会话。

### 3.4 落地顺序

1. 确认上游计费口径与单价来源（外部事实，先做）；
2. 价目表增加按时长单价（新迁移）；
3. 3.1 计量 + 3.2 对账对齐 + dedup 键；
4. 3.3 预扣与结算（先余额模式，再订阅模式）；
5. 删除 `ops_repo_billing.go` 的 `/v1/live` 排除，并把本文 1.2 的"不计费"描述删掉。

在此之前，`gateway.live.enabled` 保持默认 `false` 是唯一能防止"未计费上游成本"被任意放大的手段。
