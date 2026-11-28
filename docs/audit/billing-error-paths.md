# 计费错误吞咽全仓清扫（billing error paths）

- 仓库：`daniei-chen/zhijing-gateway`，main = `5600095a7`（2026-11-28 02:00Z 左右检出，树干净）
- 范围：所有"取成本 / 取价目 / 记流水 / 扣额度"的调用点，含任何返回 `*CostBreakdown` 的函数
- 方法：`grep -n` 全仓定位（命令见 §5），逐点读实现判类；行号以 `5600095a7` 为准
- 本文只做清单，不改代码。修复由各自线程做。

## 0. 四类的判定口径

| 类别 | 含义 | 判定标准 |
|---|---|---|
| 1 吞掉 | 错误不改变成交结果 | 返回 `*CostBreakdown{ActualCost: 0}` / `_ = err` / `if err == nil` 被强行满足后继续走另一条计价；**不留 billing_failures** |
| 2 降级但记录 | 有留痕，且该笔不按失败价成交 | 写 billing_failures 行，或 error/warn 日志 + 计数器；不写 `actual_cost=0` 的 usage_log |
| 3 正确失败关闭 | 错误交给调用方 | 返回 err / 事务回滚 / 请求拒绝（400/402/503），不扣费也不落零成本流水 |
| 4 不可失败 | 纯内存计算，无 I/O、无 error 返回 | 无错误路径；但可能因"未配置"返回 $0，需在后果列写明 |

一个刻意的排除：`simple mode 下 $0` 记为类别 1，但后果列写明它是设计语义——`run_mode` 是部署级配置（`config.go:2213` 默认 `standard`），请求无法切换，简易模式从不扣费。

## 1. 前置闸现状（开关名 / 查询点 / 默认值 / 默认值来源 commit）

默认值会漂，所以每个闸都标到具体行与 commit，并给出"默认配置下这条路通不通"。

| 闸 | 开关与查询点 | 默认值（`5600095a7`） | 默认值来源 | 默认配置下这条路 |
|---|---|---|---|---|
| 在途预留总开关 | `billing.inflight_reservation.enabled`；`BillingCacheService.InflightReservationEnabled()` `service/billing_inflight_reservation.go:225-228` | **true**（`config.go:2315`）；简易模式强制关闭（`:225` 处 `RunMode == RunModeSimple` → false） | 自 `e5247df77`（0.2.20 回灌）以来未翻转；`git log -S` 只命中回灌/重编码提交 | **通**：预留生效 |
| 无价拒绝（核心闸） | `billing.inflight_reservation.fail_closed_on_unpriced`；`InflightReservationFailClosedOnUnpriced()` `service/billing_inflight_reservation.go:231-234`，判定点 `handler/gateway_inflight_reservation.go:82` | **true**（`config.go:2321`）；历史上是 false（`52c779a0b:2319` = false） | **`cce3fa083`（#34）把 false→true**，已确认是 `5600095a7` 的祖先 | 文本/语音/视频**无价请求在派发前 400 `model_pricing_unavailable`**（`handler/gateway_handler.go:2497-2505`）。**图片例外，见下一行** |
| 图片"无价"（实际不存在） | 同一闸，但图片估算走 `CalculateImageCost` → `getImageUnitPrice` → `getDefaultImagePrice` | 无价图片模型**永远有价**：硬编码 `defaultImageGenerationPrice = 0.134`（`billing_service.go:2192`，用于 `:2447`） | 硬编码常量，非开关 | **不通**：图片请求不会因无价被 400；闸开着也拦不住图片，因为估算器总能拿到默认 $0.134/张。图片风险是"按默认价成交（可能少收）"，不是"$0 成交" |
| 计费任务溢出策略 | `gateway.usage_record.overflow_policy`；`UsageRecordWorkerPool.Submit` `service/usage_record_worker_pool.go:155-190` | **sync**（`config.go:2774`）：溢出时内联执行，不丢任务 | 自 `e5247df77` 以来未翻转 | **通**：默认不丢计费任务；配成 `drop`/`sample` 才会丢（见 §2 B 组） |
| 运行模式 | `run_mode`；`simpleModeKeyRateLimitBillingEnabled` `service/gateway_usage_billing.go:95-97` | **standard**（`config.go:2213`） | 部署级配置 | **通**：走完整扣费管道 |

结论口径：**闸开着不等于这条路被挡住**。图片闸就是反例——开关为 true，但图片估算器用硬编码默认价满足了"有价"，闸从不触发。

## 2. 全量清单（按文件分组）

"测试"列：`有` = 有直接断言该分支的用例；`间接` = 只覆盖到调用它的上游/计算器；`无` = 未找到。

### A. `internal/service/gateway_usage_billing.go`（Anthropic 系主计费管道）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `gateway_usage_billing.go:931-944` | `recordUsageCore` 算价失败（非简易模式） | 3 | 写 billing_failures(pending) 并把 err 交还调用方；不写 usage_log、不扣费。调用方是异步 worker 时只落 error 日志（B 组），DB 里留下欠款凭据 | 有 `TestGatewayServiceRecordUsage_BillingErrorWritesNoZeroCostUsageLog`（`gateway_record_usage_test.go:672`） |
| `gateway_usage_billing.go:934-937` | 简易模式分支：`cost = &CostBreakdown{}` | 1 | 按 $0 落 usage_log 并返回成功；简易模式本就不扣费，金额与设计一致 | 有 `TestSimpleModeRecordUsageWindowOptIn`、`gateway_usage_billing_simple_mode_test.go` |
| `gateway_usage_billing.go:939-942` | `recordUsagePricingFailure` + `return costErr` | 3 | 同上（失败关闭的实现点） | 同上 |
| `gateway_usage_billing.go:956-958` | response_model 重算：`responseErr == nil && adoptable` | 1 | 重算失败时静默沿用基线价成交，金额正确、无漏收、无 billing_failures | 间接 `response_model_billing_test.go`（覆盖采纳条件，不覆盖重算失败） |
| `gateway_usage_billing.go:1175-1184` | 语音按次：渠道价 `CalculateCostUnified`，`err == nil` 才返回 | 1 | 静默回落 `CalculateAudioCost` 的分组/默认语音价成交；金额可能与渠道价不同，无日志、无账单凭据 | 间接 `billing_search_audio_cost_test.go` |
| `gateway_usage_billing.go:1186` | `CalculateAudioCost` 回退 | 4 | 纯内存；mode 未知或单价 ≤0 时返回 $0 → 该笔语音免费 | 有 `billing_search_audio_cost_test.go` |
| `gateway_usage_billing.go:1195-1198` | token 计价 `calculateTokenCost` 失败 | 3 | 返回 err → 上行到 :939 失败关闭（billing_failures + 不写 usage_log） | 间接（只覆盖扣费事务失败） |
| `gateway_usage_billing.go:1205-1212` | `CalculateSearchCost` 叠加搜索费 | 4 | 纯内存；未配置用默认 $10/1k，显式 0 则免费 | 有 `billing_search_audio_cost_test.go` |
| `gateway_usage_billing.go:1321-1329` | 分组图片价 `CalculateCostUnified`，`err == nil` 才返回 | 1 | 静默落到 `CalculateImageCost` 的分组图价/默认图价（≥$0.134/张）成交，无日志 | 无（全仓无 `calculateImageCost` 的用例） |
| `gateway_usage_billing.go:1333` | 分组显式图价 `CalculateImageCost` | 4 | 纯内存；分组显式 0 即免费 | 有 `billing_service_image_test.go` |
| `gateway_usage_billing.go:1346-1362` | 渠道按次/图片模式失败 → `return &CostBreakdown{ActualCost: 0}` | 1 | **按 $0 成交并返回成功**（有 error 日志，无 billing_failures）。**当前不可达**：`calculatePerRequestCost` 恒返回 nil 错误（`billing_service.go:1891-1925`），留着是未来改错价表的陷阱 | 无 |
| `gateway_usage_billing.go:1367-1383` | 渠道 token 模式失败 → `return &CostBreakdown{ActualCost: 0}` | 1 | **按 $0 成交并返回成功**。可达：渠道 token 价无区间命中时 `calculateTokenCost` 返回 `ErrModelPricingUnavailable` | 无 |
| `gateway_usage_billing.go:1389` | 默认图价 `CalculateImageCost` | 4 | 纯内存，无任何价源时也返回 ≥$0.134/张（2K ×1.5、4K ×2） | 有 `TestCalculateImageCost_DefaultPricing` |
| `gateway_usage_billing.go:1418-1420` | `CalculateTokenCostForRequest` 失败 | 3 | 返回 `nil, err` → 上行失败关闭 | 间接 |
| `gateway_usage_billing.go:147` / `:369` | `postUsageBilling` legacy 兜底（repo 为 nil 时） | 1 | 扣款失败只 `slog.Error`，函数无返回值，`applyUsageBilling` 仍返回 `true, nil`；账上当成功。仅在 repo 不可用的测试/降级路径进入 | 无 |
| `gateway_usage_billing.go:157` | legacy：订阅用量 `IncrementUsage` 失败 | 1 | 只 slog.Error；订阅用量少记一截，账上当成功 | 无 |
| `gateway_usage_billing.go:163` | legacy：`DeductBalance` 失败 | 1 | 只 slog.Error；余额未扣、无重试、无 billing_failures | 无 |
| `gateway_usage_billing.go:174` | legacy：API Key `UpdateQuotaUsed` 失败 | 1 | 只 slog.Error；Key 额度计数少记 | 无 |
| `gateway_usage_billing.go:180` | legacy：`UpdateRateLimitUsage` 失败 | 1 | 只 slog.Error；限速窗口计数少记 | 无 |
| `gateway_usage_billing.go:187` | legacy：账号 `IncrementQuotaUsed` 失败 | 1 | 只 slog.Error；上游账号额度统计少记 | 无 |
| `gateway_usage_billing.go:200-206` | 平台配额 Redis + DB 直写失败 | 2 | `ALERT` 日志 + `userPlatformQuotaDBIncrLegacyErrorTotal` 计数；Redis 增量已写，DB 由 flusher 兜底 | 间接 `billing_cache_service_user_platform_quota_test.go` |
| `gateway_usage_billing.go:357-378` | `applyUsageBilling` 事务最终失败 | 3 | `recordUsageBillingFailure` 写 billing_failures 后返回 err；不写 usage_log、不扣费 | 有 `TestGatewayServiceRecordUsage_BillingErrorWritesNoZeroCostUsageLog` |
| `gateway_usage_billing.go:446-455` | `recordUsageBillingFailure` 自身写失败 | 2 | 记 warning；该笔漏收只剩日志、无 DB 凭据（留痕不可靠时不会反向阻断错误传播） | 间接 |
| `gateway_usage_billing.go:461-502` | `recordUsagePricingFailure` 自身写失败 | 2 | 记 warning；价格失败漏收只剩日志 | 间接 |
| `gateway_usage_billing.go:504-631` | `finalizePostUsageBilling` → `syncBalanceCacheAfterDeduction` 失败 | 2 | warning + `QueueDeductBalance` 排队；DB 已扣，缓存最终一致（`BackfillBalanceIfAbsent` 先兜底） | 有 `TestSyncBalanceCacheAfterDeduction_SynchronousWhenInflightEnabled` |
| `gateway_usage_billing.go:746-777`（实现），调用点 `:1001`/`:1038` | `writeUsageLogBestEffort` 写 usage_log 失败 | 2 | 记日志并同步兜底重试一次；扣费已完成，只少一条流水 | 有 `TestGatewayServiceRecordUsage_DroppedUsageLogFallsBackToSyncCreate` |
| `gateway_usage_billing.go:1271-1275` | `hasResolvableTokenPricing` 的 `_, err := GetModelPricing` | 1 | 错误吞成布尔 false，只影响计费模型回退选择；真无价仍由 :1195 失败关闭 | 有 `TestHasResolvableTokenPricing`（`gateway_usage_billing_fallback_test.go:62`） |
| `gateway_usage_billing.go:1087-1108` | `cacheStoragePrice` / `cacheStorageCost` 无存储单价 | 4 | 无价即按 $0 计——显式缓存存储时长免费，无错误可见 | 无 |

### B. `internal/handler/*`（异步记账与错误映射）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `gateway_handler.go:2573-2603` | `submitUsageRecordTask`（溢出策略 drop/sample 时丢弃） | 1 | 任务被丢弃：不扣费、不写 billing_failures、不写 usage_log，只有 `DroppedTasks` 计数器 + 节流日志。默认 `sync` 不会走到 | 有 `TestUsageRecordWorkerPool_OverflowDrop`/`_OverflowSample`（`usage_record_worker_pool_test.go:41`/`:121`） |
| `service/usage_record_worker_pool.go:155-190` | `UsageRecordWorkerPool.Submit`（丢弃实现点） | 1 | 同上；`droppedQueueFull` 计数 + 5s 节流日志 | 同上 |
| `gateway_handler.go:2605-2630`；`openai_gateway_handler.go:3578-3600` | `submitMandatoryUsageRecordTask` | 3 | 池停止时降级同步执行，任务必达（媒体/搜索/语音走这里） | 有 `TestUsageRecordWorkerPool_SubmitAfterStop`、`usage_record_submit_task_test.go:155` |
| `openai_gateway_handler.go:3563-3575` | `submitOpenAIUsageRecordTask` 按结果类型选路 | 3 | 媒体/搜索/语音强制走 mandatory，不会因溢出丢弃 | 有 `usage_record_submit_task_test.go:185`/`:215` |
| `gateway_handler.go:603`、`gateway_handler.go:967`、`gateway_handler_chat_completions.go:337`、`gateway_handler_responses.go:319`、`gateway_systemone.go:265`、`gateway_web_search.go:243`、`gemini_cached_contents_handler.go:693`、`gemini_v1beta_handler.go:834`、`grok_audio.go:357`、`grok_media.go:761`、`openai_alpha_search.go:298`、`openai_chat_completions.go:302`、`openai_embeddings.go:275`、`openai_gateway_handler.go:873`/`:1474`/`:3265`、`openai_images.go:413` | `RecordUsage` 异步闭包（17 处）：err → error 日志 | 2 | 响应已发出，无法失败关闭；该笔不扣费，billing_failures 留 pending 凭据，日志里带 user/key/account/model | 间接 `usage_record_async_boundary_test.go`（结构性约束，不逐点断言） |
| `gateway_handler.go:2497-2505` | `billingErrorDetails`：`ErrModelPricingUnavailable` 映射 | 3 | 400 `model_pricing_unavailable`，调用方停止重试（与 429/503 区分） | 有 `TestBillingErrorDetails_ModelPricingUnavailableMapsTo400` |

### C. 在途预留（`handler/gateway_inflight_reservation.go` + `service/billing_inflight_reservation.go`）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `handler/gateway_inflight_reservation.go:82-84` | 无价 → `ErrModelPricingUnavailable` | 3 | 默认配置（`fail_closed_on_unpriced=true`）下 400，请求不派发、不产生成本 | 有 `gateway_inflight_reservation_test.go:85`（用例名有误导，见 §6） |
| `handler/gateway_inflight_reservation.go:91-98` | `ReserveInflight` 返回 err | 3 | 交还 handler → `billingErrorDetails`（余额不足/限流码），请求拒绝 | 有 `billing_inflight_reservation_test.go` |
| `handler/gateway_inflight_reservation.go:46`/`:67` + 17 个调用点（`gateway_handler.go:277`、`gateway_handler_chat_completions.go:158`、`gateway_handler_responses.go:162`、`gateway_systemone.go:112`、`gateway_web_search.go:92`、`gemini_cached_contents_handler.go:150`、`gemini_v1beta_handler.go:452`、`grok_audio.go:53`/`:237`、`grok_media.go:177`、`openai_alpha_search.go:113`、`openai_chat_completions.go:156`、`openai_embeddings.go:112`、`openai_gateway_handler.go:646`/`:1318`/`:2769`、`openai_images.go:147`） | `reserveInflightBalance` / `…Ctx` 入口 | 3 | 错误一律转成 4xx/5xx 响应，请求不派发 | 有 `gateway_inflight_reservation_test.go` |
| `service/billing_inflight_reservation.go:283-318` | Redis 余额读取/预留执行失败 | 2 | warning + **fail-open**（不预留、照常放行）；并发透支窗口重新打开，但每笔仍有事后扣费 | 有 `TestReserveInflightBalance_NoReservationCacheFailsOpen` |
| `service/billing_inflight_reservation.go:574` | 估算取价 `pricing, _ = d.billing.GetModelPricing(model)` | 1 | 错误被吞成 `pricing=nil` → `priced=false` → 交给 :82 的闸；闸开=400，闸关=放行 | 有 `TestInflightEstimate_UnpricedIsReportedAndNonMeteredIsNot` |
| `service/billing_inflight_reservation.go:713-730` | `EstimateInflightReservationCost` 取价失败 | 1 | 返回 `(0,false)`，调用方按闸决定 400/放行 | 有 `TestEstimateInflightReservationCost` |
| `service/billing_inflight_reservation.go:585-600` | 图片估算循环 `CalculateImageCost` × 3 档 | 4 | 纯内存；恒有价（默认 $0.134/张），所以图片请求几乎不触发无价闸 | 有 `TestInflightEstimate_MediaKinds`（`:146`） |
| `service/billing_inflight_reservation.go:605`/`:618`/`:635` | 视频/语音/搜索估算 | 4 | 纯内存 | 有 `TestInflightEstimate_MediaKinds` |
| `service/billing_inflight_reservation.go:700-703` | `logInflightUnpriced` + `return 0,false` | 2 | 每分钟一条 warning；准入结果由闸决定 | 同上 |
| `service/billing_inflight_reservation.go:230-234` | `InflightReservationFailClosedOnUnpriced` 读配置 | 3 | 读配置决定闸；**注释写"默认 false"与 `config.go:2321` 的 true 不一致（注释过期）** | 同上 |

### D. `internal/service/openai_gateway_usage.go`（OpenAI 系主计费管道）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `openai_gateway_usage.go:258-264` | 简易模式 + 无价：`cost = &CostBreakdown{BillingMode: token}`、`err = nil` | 1 | 按 $0 落账，设计语义（简易模式从不扣费） | 间接 `gateway_usage_billing_simple_mode_test.go` |
| `openai_gateway_usage.go:266-283` | 无价失败关闭 | 3 | warn + billing_failures + return err；不扣费、不写 usage_log | 有 `openai_gateway_record_usage_test.go:377`/`:1999`/`:3257`、`openai_gateway_cn_fixes_test.go:70` |
| `openai_gateway_usage.go:298-310` | response_model 重算 `responseErr == nil` | 1 | 静默沿用基线价成交，无漏收 | 间接 `response_model_billing_test.go` |
| `openai_gateway_usage.go:334-341` | Standard 档重算失败（无价） | 2 | 保留有效的 Fast 档价成交，金额正确；无日志（注释说明是有意为之） | 无 |
| `openai_gateway_usage.go:614` | `CalculateWebSearchCost` | 4 | 纯内存；默认 $0.01/次 | 有 `openai_alpha_search_billing_test.go` |
| `openai_gateway_usage.go:625` | 语音渠道按次 `CalculateCostUnified` | 3 | 直接把 err 交给主流程 → :266 失败关闭 | 间接 |
| `openai_gateway_usage.go:633` | `CalculateAudioCost` 回退 | 4 | 纯内存 | 间接 |
| `openai_gateway_usage.go:688` | `CalculateSearchCost` | 4 | 纯内存 | 有 `openai_gateway_grok_search_billing_test.go` |
| `openai_gateway_usage.go:765-773` | token 计费候选循环 | 3 | 逐候选试价；全失败 → `lastErr` → :266 失败关闭 | 有 `openai_gateway_record_usage_test.go` |
| `openai_gateway_usage.go:794-802` | 分组图片价 `err == nil` | 1 | 静默落到默认/分组图价成交，无日志 | 无 |
| `openai_gateway_usage.go:806`/`:812`/`:836` | `CalculateImageCost` | 4 | 纯内存，恒有价 | 有 `billing_service_image_test.go` |
| `openai_gateway_usage.go:818-833` | 渠道图价失败：error 日志 + 落默认图价 | 1 | 有 error 日志但**按默认图价成交并返回成功**，无 billing_failures；失败价的差额永久丢失且不可对账 | 无 |
| `openai_gateway_usage.go:855-863` | 分组视频价 `err == nil` | 1 | 静默落到默认视频价成交 | 无 |
| `openai_gateway_usage.go:884-901` | 渠道视频价失败：error 日志 + 落默认视频价 | 1 | 同 :818——有日志、按默认价成交、无账单凭据 | 间接 `video_billing_test.go` |
| `openai_gateway_usage.go:904` | `CalculateVideoCost` | 4 | 纯内存；默认价按 2K 图价折算 | 有 `video_billing_test.go` |
| `openai_gateway_usage.go:94-110` | `RecordCyberPolicyUsageLog` 失败 | 2 | 记日志；cyber 拒单路径的 token 费用可能漏收 | 间接 `usage_log_cyber_test.go` |
| `openai_gateway_usage.go:512`/`:544` | `writeUsageLogBestEffort` | 2 | 记日志；扣费已完成，只少流水 | 间接 |

### E. `internal/service/billing_service.go`（算价/取价实现）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `billing_service.go:1417-1419` | `GetModelPricing` | 3 | 无价返回 `ErrModelPricingUnavailable` | 有 `billing_service_test.go:1331`、`pricing_service_test.go:448` |
| `billing_service.go:1435-1494` | `getModelPricingAt` | 3 | 同上；命中硬编码兜底价时每模型打一条 warning | 有 |
| `billing_service.go:1498-1513` | `GetModelPricingWithChannel` | 3 | 透传 `GetModelPricing` 错误 | 间接 |
| `billing_service.go:1595-1645` | `CalculateCostUnified` | 3 | 无 Resolver → 走 `GetModelPricing`（失败即 err）；有 Resolver 时 token 无区间价 → err；按次/媒体分支恒 nil err | 有 `billing_service_unified_test.go` |
| `billing_service.go:1602` | 无 Resolver 回退 `GetModelPricing` | 3 | 透传错误 | 有 |
| `billing_service.go:1630` | `calculatePerRequestCost` 分发 | 4 | 恒 nil err | 间接 |
| `billing_service.go:1664-1668` | `calculateTokenCost` 无区间价 | 3 | `ErrModelPricingUnavailable` | 有 |
| `billing_service.go:1891-1925` | `calculatePerRequestCost` | 4 | 纯内存、无错误路径；尺寸/上下文档未命中时回落默认按次价，仍为 0 则按次免费 | 间接 |
| `billing_service.go:1927-1943` | `CalculateCost` / `CalculateCostWithServiceTier` / `calculateCostWithServiceTierPolicy` | 3 | 透传 `GetModelPricing` 错误 | 间接 |
| `billing_service.go:1945-1970` | `calculateCostInternal(WithPolicy)`：`GetModelPricingWithChannel`/`GetModelPricing` | 3 | 无价 → err，不产生成本对象 | 间接 |
| `billing_service.go:2111-2118` | `CalculateCostWithConfig` | 3 | 透传 | 无 |
| `billing_service.go:2140-2150` | `GetEstimatedCost` | 3 | 返回 err（前端估价） | 无 |
| `billing_service.go:2192`/`:2445-2448` | `defaultImageGenerationPrice = 0.134` 兜底 | 4 | 无价图片模型按 $0.134/张成交（2K ×1.5、4K ×2）——不是 $0，但会少收或错收，且让"无价闸"对图片失效 | 有 `TestCalculateImageCost_DefaultPricing` |
| `billing_service.go:2225-2246` | `CalculateWebSearchCost` | 4 | 纯内存 | 有 `billing_search_audio_cost_test.go` |
| `billing_service.go:2248-2279` | `CalculateSearchCost` | 4 | 纯内存；负价 → $0 | 有 |
| `billing_service.go:2282-2324` | `CalculateAudioCost` | 4 | 纯内存；未知 mode 或单价 ≤0 → $0 | 有 |
| `billing_service.go:2326-2356` | `CalculateImageCost` | 4 | 纯内存，恒有价（除分组显式 0） | 有 `billing_service_image_test.go` |
| `billing_service.go:2358-2380` | `CalculateVideoCost` | 4 | 纯内存，恒有价 | 有 `video_billing_test.go` |
| `billing_service.go:2427-2455` | `getDefaultImagePrice` → `pricingService.GetModelPricing` | 4 | 该接口无 error；无条目即回落默认价 | 有 |

### F. `billing_token_cost_request.go` / `billing_context_schedule.go` / `model_pricing_resolver.go`

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `billing_token_cost_request.go:29-41` | `CalculateTokenCostForRequest` | 3 | 透传三个 `CalculateCostUnified` 分支与 `CalculateCost` 的错误 | 有 `billing_token_cost_request_test.go` |
| `billing_token_cost_request.go:32`/`:35`/`:38` | `CalculateCostUnified` 三个分支 | 3 | 透传 | 有 |
| `billing_token_cost_request.go:40` | `CalculateCost` 最终回退 | 3 | 透传 `ErrModelPricingUnavailable` | 有 |
| `billing_context_schedule.go:101` | `resolved == nil` → `ErrModelPricingUnavailable` | 3 | 函数返回 err；两个调用方（`model_plaza_service.go:249`、`:375`）都把它吞成"无阶梯展示"，只影响展示 | 有 `billing_context_schedule_test.go` |
| `billing_context_schedule.go:118` | probe → `CalculateTokenCostForRequest` err | 3 | 返回 `nil, err` | 有 |
| `billing_context_schedule.go:275-322`/`:324-360` | `probeContextTier` / `probeComponentPrice` | 3 | 返回 err（仅展示路径，不扣费） | 有 |
| `model_pricing_resolver.go:72-129` | `Resolve` | 2 | **永不返回错误**；缺价时 `BasePricing=nil`，错误降级为"无价"，由 `calculateTokenCost:1664` 必然失败关闭 | 间接 |
| `model_pricing_resolver.go:171-179` | `resolveBasePricing`：`GetModelPricing` err → `slog.Debug` + nil | 2 | 错误被降级为空价（Debug 级，不算留痕），下游必然 `ErrModelPricingUnavailable`；不构成漏收，但排查缺价时日志几乎看不见 | 间接 |
| `model_pricing_resolver.go:305-320` | `GetIntervalPricing` | 4 | 返回 nil 表示无价，由上层判定 | 间接 |
| `model_pricing_resolver.go:388-404` | `GetRequestTierPrice(ByContext)` | 4 | 未命中返回 0 → 按次价 $0（按次模式无价即免费），无错误可见 | 间接 |

### G. `internal/repository/usage_billing_repo.go`（扣额度事务）

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `usage_billing_repo.go:23-72` | `Apply` 事务 | 3 | 任一步失败回滚并返回 err → 上行 :357 失败关闭 | 有 `usage_billing_repo_unit_test.go` |
| `usage_billing_repo.go:52-58`/`:112-148` | `claimUsageBillingRequest` 去重/冲突 | 3 | `ErrUsageBillingRequestConflict` 不重试 → 上行记 billing_failures | 间接 |
| `usage_billing_repo.go:213-226` | `applyUsageBillingEffects` | 3 | 任一扣减失败整笔回滚；API Key/账号已删除则跳过该项（余额仍扣） | 有 `TestApplyUsageBillingEffects_*` |
| `usage_billing_repo.go:253-288` | `deductUsageBillingBalance` 余额不足 | 2 | 余额扣到 0，差额写 billing_failures(pending, `#balance-shortfall`)；`BalanceOverdrafted=true` | 有 `TestDeductUsageBillingBalance_ClampsAtZeroAndRecordsShortfall` |
| `usage_billing_repo.go:290-317` | `recordUsageBillingBalanceShortfall` | 2 | 写失败 → 整个事务回滚并返回 err（不会静默吞掉差额） | 有 |
| `usage_billing_repo.go:692-710` | `RecordFailure` | 2 | 由调用方记 warning；写失败不反向影响计费错误传播 | 有 |

### H. 其它计费/额度触点

| 文件:行 | 调用点 | 类别 | 失败时账上会发生什么 | 测试 |
|---|---|---|---|---|
| `api_key_service.go:1159-1211` | `UpdateQuotaUsed`（非 `quotaStateReader` 分支） | 1 | `quota_used` 已原子递增；随后 `GetByID`/`Update` 失败 `return nil`（吞），只少一次"额度耗尽"状态翻转 | 无 |
| `openai_live.go:820-856` | `finalizeLiveCall` 写 $0 usage 行（TODO(billing)） | 1 | **Live 会话全程不计费**：`TotalCost/ActualCost` 恒 0，绕过 `recordUsageCore`/`applyUsageBilling`；余额 0 也能反复开最长 `liveMaxSessionDuration` 会话 | 有 `TestFinalizeLiveCallIsIdempotentAndWritesZeroUsage`（锁定零值行为） |
| `account_stats_pricing.go:90-107` | `tryModelFilePricing` 的 `CalculateCostUnified` | 1 | 算价失败 → 账号统计成本置空 → 成本统计回落 `total_cost`；不影响用户扣费 | 间接 `TestGatewayServiceRecordUsage_DeepSeekAccountStats…` |
| `batch_image_public.go:644-646` | `BatchImageUnitPrice` err → `continue` | 1 | 跳过该模型（列表展示），不影响计费 | 间接 |
| `batch_image_public.go:1052-1056` | 定价缺失 | 3 | `ErrBatchImageSettlementPricingMissing` → 请求拒绝 | 有 `batch_image_settlement_test.go` |
| `batch_image_settlement.go:33-55` | `BatchImageModelPricingResolver.BatchImageUnitPrice` | 3 | 无价 → `ErrBatchImageSettlementPricingMissing` | 有 |
| `batch_image_settlement.go:128-140` | `settlementUnitPrice` 失败 | 3 | `recordSettlementFailure` + 返回 err（重试；耗尽则释放冻结并转 failed） | 有 |
| `batch_image_settlement.go:152-161` | `captureBatchImageBalanceHold` 失败 | 3 | `recordSettlementFailure` + 返回 err；冻结余额在耗尽出口释放 | 有 |
| `batch_image_settlement.go:252-284` | `recordUsageLog` → `writeUsageLogBestEffort` | 2 | 记日志；扣费已完成，只少流水 | 间接 |
| `model_plaza_service.go:361-370` | `GetModelPricing` err → 官方参考价 nil | 1 | 展示价缺失，不影响计费 | 无 |
| `handler/admin/channel_handler.go:615-619` | `GetModelPricing` err → `found:false` | 1 | 管理端显示"无默认价"，不影响计费 | 无 |
| `channel_available.go:128-131` | `pricingService.GetModelPricing` | 4 | 无 error 接口；nil 即跳过填充（展示） | 无 |
| `billing_notification_worker.go:80-97` | `submitUsageNotifications` | 2 | 通知丢失（队列不可用时 5s 节流 warning）；与计费持久化无关 | 有 `billing_notification_worker_test.go` |

## 3. 类别 1 逐点修法（不改代码）

| 文件:行 | 修法 | 理由 |
|---|---|---|
| `gateway_usage_billing.go:934-937`（简易模式 $0） + `openai_gateway_usage.go:258-264`（同语义） | **零值语义确实正确**，保持 | `run_mode` 是部署级配置（`config.go:2213` 默认 standard），请求无法切换；简易模式从不扣费，失败关闭只会丢掉 usage 记录 |
| `gateway_usage_billing.go:956-958` + `openai_gateway_usage.go:298-310`（response_model 重算） | 保持，建议加 debug 日志 | 失败时沿用基线价，金额正确，无漏收 |
| `gateway_usage_billing.go:1175-1184`（语音渠道价失败） | 应记 warn（含渠道/模型/请求号）后按回退价成交 | 回退价是有效价，不必失败关闭；但差额不可对账，至少要能查到 |
| `gateway_usage_billing.go:1321-1329`（分组图片价失败） | 应记 warn；若分组卡是唯一授权售价则**应返回 err** | 静默换价源会让分组定价失效而无人知晓 |
| `gateway_usage_billing.go:1346-1362`（图片按次 $0） | **应返回 err**（图片/按次分支无条件失败关闭，不看全局开关） | 虽当前不可达，但 `$0` 语义一旦被未来改动激活就是永久漏收（HOME-50 修法同此） |
| `gateway_usage_billing.go:1367-1383`（图片 token 分支 $0） | **应返回 err** | 可达路径：渠道 token 价无区间命中 → 当前按 $0 成交 |
| `gateway_usage_billing.go:147`/`157`/`163`/`174`/`180`/`187`（legacy 兜底） | **应记 billing_failures 后返回 err**（把 `postUsageBilling` 改成返回 error，`applyUsageBilling` 透传） | 现在扣款失败只写日志且上层收到 `true, nil`；仅 repo 为 nil 时进入，但正是降级场景最需要凭据 |
| `gateway_usage_billing.go:1271`（`hasResolvableTokenPricing`） | **零值语义确实正确**（布尔探测），建议注释写明"错误等价于不可解析" | 只用于选计费模型，真无价由 :1195 失败关闭 |
| `service/usage_record_worker_pool.go:155` / `gateway_handler.go:2573`（溢出丢弃） | 对计费关键任务应走 `submitMandatory`；若保留 `drop`/`sample`，至少写一条 billing_failures 占位或提高日志级别 | 丢弃时无扣费、无凭据，只有计数器；默认 sync 安全，配置漂移即静默漏收 |
| `service/billing_inflight_reservation.go:574` / `:713`（估算取价） | **零值语义确实正确**：`priced=false` 就是闸的输入；建议把 `_` 改成显式判断以保留 debug 日志 | 结论由闸决定，不是成交价 |
| `api_key_service.go:1159`（`UpdateQuotaUsed` 状态翻转） | 应返回 err 或至少记 error 日志 | `quota_used` 已递增，只有状态翻转丢失；但 Key 不会及时被标记耗尽 |
| `openai_live.go:838`（Live 不计费） | **应接计费管道**（按时长或 token），否则删除 TODO 并显式声明免费 | 目前是唯一一条"整类请求永远 $0"的路径，且 `TestFinalizeLiveCall…WritesZeroUsage` 把零值锁死 |
| `account_stats_pricing.go:90` / `batch_image_public.go:644` / `model_plaza_service.go:361` / `admin/channel_handler.go:615` | **零值语义确实正确**，保持 | 全部只影响统计或展示，不参与用户扣费 |

## 4. 汇总

- 命中点总数：**109 行**（§2 表格数据行，`grep -c '^| \`'` 复核，见 §5）
- 类别 1（吞掉）：**29**
- 类别 2（降级但记录）：**18**
- 类别 3（正确失败关闭）：**38**
- 类别 4（不可失败/纯内存）：**24**

其中"会改变成交价且不留 billing_failures"的类别 1 共 **18 条**：A 组 10（`:1175`、`:1321`、`:1361`、`:1382`、legacy 六处 `:147`/`:157`/`:163`/`:174`/`:180`/`:187`）、D 组 4（`:794`、`:818`、`:855`、`:884`）、B 组 2（`gateway_handler.go:2573`、`usage_record_worker_pool.go:155`）、H 组 2（`openai_live.go:838`、`api_key_service.go:1159`）。

### 4.1 最危险的三条

1. **`openai_live.go:838-856`** — Real‑time Live 会话整类请求永远不计费（`TotalCost/ActualCost` 恒 0，绕过 `recordUsageCore`/`applyUsageBilling`），零余额账号也能反复开最长 `liveMaxSessionDuration` 的会话；这是唯一"整类请求永久 $0"的路径，且被 `TestFinalizeLiveCallIsIdempotentAndWritesZeroUsage` 锁定。
2. **`gateway_usage_billing.go:1367-1383`** — 图片请求在渠道 token 定价下算价失败时 `return &CostBreakdown{ActualCost: 0}`，按 $0 成交并返回成功（可达：渠道 token 价无区间命中即报 `ErrModelPricingUnavailable`）。同函数 `:1346-1362` 是同类 $0，但当前不可达。
3. **`service/usage_record_worker_pool.go:155-190` + `gateway_handler.go:2573-2603`** — `gateway.usage_record.overflow_policy` 一旦不是默认 `sync`（drop/sample），队列满时计费任务被静默丢弃：不扣费、不写 billing_failures、不写 usage_log，只剩一个计数器。默认安全，但这条是"配置漂移即静默漏收"。

## 5. 复核命令（行号可重跑）

```sh
cd backend

# 算价入口
grep -rn "CalculateCostUnified(" --include=*.go . | grep -v _test.go
grep -rn "CalculateImageCost(" --include=*.go . | grep -v _test.go
grep -rn "CalculateTokenCost[A-Za-z]*(" --include=*.go . | grep -v _test.go
grep -rn "calculatePerRequestCost" --include=*.go . | grep -v _test.go

# 取价目
grep -rn "\.GetModelPricing(\|GetModelPricingWithChannel\|getModelPricingAt(" --include=*.go . | grep -v _test.go

# 记流水 / 扣额度
grep -rn "recordUsagePricingFailure\|recordUsageBillingFailure\|postUsageBilling(\|applyUsageBilling(" --include=*.go . | grep -v _test.go
grep -rn "submitUsageRecordTask\|submitMandatoryUsageRecordTask\|submitOpenAIUsageRecordTask" --include=*.go internal/handler | grep -v _test.go
grep -rn "reserveInflightBalance" --include=*.go internal/handler | grep -v _test.go
grep -rn "DeductBalance(\|IncrementUsage(\|IncrementQuotaUsed(\|UpdateQuotaUsed(\|UpdateRateLimitUsage(" --include=*.go . | grep -v _test.go

# 返回 *CostBreakdown 的函数
grep -rn "func .*) \*CostBreakdown" --include=*.go . | grep -v _test.go

# 前置闸默认值与翻转 commit
grep -n "fail_closed_on_unpriced\|inflight_reservation.enabled\|usage_record.overflow_policy" internal/config/config.go
git show 52c779a0b:backend/internal/config/config.go | grep -n "fail_closed_on_unpriced"   # 2319: false
git rev-parse --short HEAD                                                                  # 5600095a7
git merge-base --is-ancestor cce3fa083 HEAD && echo "flip commit is ancestor"
```

## 6. 注意事项（读本文前先知道）

1. **图片闸是"开着但拦不住"**：`fail_closed_on_unpriced=true`（`config.go:2321`），但图片估算走 `CalculateImageCost` → 硬编码默认价 $0.134/张（`billing_service.go:2192`），`priced` 恒为 true。所以图片请求不会被 400 拦住，风险是**按默认价成交**（可能少收），而非 $0。唯一的例外：分组图片倍率为 0 且模型无 token 价时，估算可能落到 `priced=false`。
2. **`:1361` 目前不可达**：`calculatePerRequestCost`（`billing_service.go:1891-1925`）没有错误返回路径，所以按次/图片模式的 `if err != nil` 分支走不到。可达的是 `:1382`（token 分支）。两处都应删掉 $0 语义，但排优先级时别把 :1361 当成当前在漏。
3. **两条注释已过期，别拿它们当依据**：`service/billing_inflight_reservation.go:230` 写"默认 false = fail-open"，实际 `config.go:2321` 是 true；`EstimateInflightReservationCost:712` 写"调用方应 fail-open"，实际由闸决定。
4. **用例名有误导**：`TestReserveInflightBalance_UnpricedFailOpenByDefaultFailClosedOptIn`（`handler/gateway_inflight_reservation_test.go:85`）直接构造 `config.Config{}` 零值（`FailClosedOnUnpriced=false`）当"默认"，不是 viper 默认值。它测的是"显式关/开"，不代表生产默认。
5. **`account_stats_pricing` 的类别 1 不影响用户扣费**：它算的是上游账号成本统计，失败回落到 `total_cost`。
6. 本文不覆盖：上游 provider 用量解析失败（`openai_ws_v2/metrics.go:19` 只加计数器）、通知类失败、admin 展示类 API。
