# 上游差异清单（fork divergence manifest）

> 一句话：这张表回答「回灌时这个文件听谁的」。每条给出我们的处理、为什么、回灌时的动作，动作只有三档：**取上游**、**保留本地**、**取并集**。

这是 `docs/audit/backport-shards.md` §4 的落地版本。分片表要求每片回灌 PR 带一节「fork mechanisms preserved」——那一节直接引用本表的行，不另写一套说法。

## 一、读表前必须知道的四件事

1. **`git merge upstream/main` 在任何时候都是错的。** 本仓库与上游没有共同祖先，合并等于用上游整棵树覆盖本地，本表里的每一条都会静默消失，git 还不报冲突。证据链与可复现命令在 `docs/audit/upstream-baseline.md`。
2. **四个 sha 各管一段**：回灌起点 `530c5e3a4`、回灌终点 `4233cc3`、声明基线 `10ba8f9b4`（v0.2.21，只用于对照）、导入指纹参照 `d851a384`（只给 `local-v002-baseline.json` 用）。用法固定在 `docs/audit/backport-shards.md` §5。
3. **目录归属按 `docs/UPSTREAM.md` §三判定**（上游拥有 / 本地扩展 / 混合）。本表不重复那张目录表，只列**我们已经改过、或明确决定过怎么处理**的条目。
4. **三档动作的判据**：
   - **取上游**：本地改动没有独立价值，或已被上游更好的实现取代，逐字采纳上游。
   - **保留本地**：上游没有这个机制，采纳上游等于删掉我们的安全边界。
   - **取并集**：两边在同方向改、机制不冲突，机械叠加并保留双方的测试。

判错的代价不对称：把「保留本地」误判成「取上游」是静默删掉一道门禁，CI 大概率不红；反过来只是多留一段本地代码，读得出来。**不确定时先写「保留本地」，并在 PR 里标成待决。**

## 二、身份与基线

| 文件 / 目录 | 我们的处理 | 为什么 | 回灌时的动作 |
|---|---|---|---|
| 全仓品牌字符串（1,778 文件） | 机械改名 sub2api → zhijing；Go module 改为 `github.com/daniei-chen/zhijing-gateway`（`backend/go.mod:1`） | 产品身份。改名是机械的，上游内容做同样替换后与本仓库逐字节相同（`docs/UPSTREAM.md:19`） | **保留本地**。回灌时先把上游内容做同样替换再比对，这部分不进冲突判断（`docs/audit/backport-shards.md:61`） |
| `local-v002-baseline.json` | 导入时 78 个文件的 sha256 指纹，`upstream` 字段 = `d851a384` | 三方合并的参照物，**不是**上游基线。把它当基线用会让参照物错两周（`docs/AUDIT-2026-11-28.md:472-474`） | **保留本地**，且**不参与回灌计算**；回灌只认分片表 §5 的起点/终点 |
| `docs/UPSTREAM.md`、`docs/audit/`、`docs/security/` | 本地文档：声明基线、目录边界、四个 sha、阶段一加固记录 | 上游没有这些文件；它们是回灌判定的依据本身 | **保留本地**（上游若哪天出现同名文件，先比内容再决定，不要直接覆盖） |

## 三、本地硬化（回灌时一律保留）

| 文件 / 目录 | 我们的处理 | 为什么 | 回灌时的动作 |
|---|---|---|---|
| 迁移完整性门禁（hash 锁）`backend/internal/repository/migrations_runner.go:198-222` | 启动时对每个迁移文件算 SHA256，与 `schema_migrations.checksum` 逐行比对，不匹配即拒绝启动；白名单只放行 17 条历史校验和兼容规则（`:79-101`，规则必须同时命中迁移名与两侧校验和） | v0.1.2 / v0.1.3 两次发布就是因为历史 SQL 被品牌替换、启动门禁拦下而没进生产（`AI_HANDOFF_PROTOCOL.md:86`） | **保留本地**。上游若自带 checksum 校验，取并集，但本地这 17 条兼容规则不能删——删了生产库启动不了 |
| 历史迁移文件字节（受保护字节）`backend/migrations/*.sql`（306 个） | 306 个文件保持发布时的原始字节，不在里面做任何品牌替换；表名、迁移文件名、旧用户名一律不动 | `AI_HANDOFF_PROTOCOL.md:93-94` 把它写进「绝对禁止事项」：改已应用迁移的字节等于改已上线的 schema | **保留本地**。上游新增的迁移取上游；这 306 个一个字节都不动 |
| 插件 descriptor 命名空间（受保护字节）`backend/pkg/pluginapi/v1/plugin.pb.go:2033` | `sub2api.plugin.v1` 保留在生成文件的原始字节里，不做纯文本替换 | 改它等于改插件协议；生产插件按这个 namespace 建连（`docs/AUDIT-2026-11-28.md:518`） | **保留本地** |
| `SUB2API_*` 环境变量 | 16 个旧前缀变量名原样保留在代码与配置读取里 | 生产 env-file 正在用这些键名（`docs/AUDIT-2026-11-28.md:518`） | **保留本地** |
| 门禁清单 `deploy/tests/*.sh` | 11 个 shell 门禁，其中 5 个是本地新增：`bind-host-default-test.sh`、`ci-race-job-test.sh`、`verify-sensitive-endpoints-test.sh`、`security-invariants-test.sh`、`phase1-hardening-doc-test.sh`；其余 6 个随初始导入来自上游 | 模板里一条写死的 `true` 能覆盖二进制默认值，Go 测试看不见模板；文档与仓库实际状态会漂移，需要机械看守 | **保留本地**。上游同名脚本取并集，我们这 5 个一个都不删 |
| 发布与部署门禁 `AI_HANDOFF_PROTOCOL.md:168-177`、§5.4 | 建 tag 前六条全绿、发布后核对资产与 OCI revision、无停机发布脚本 `deploy/zhijing/zero-downtime-deploy.sh` | 发布流程本地化，上游只有 tag 触发构建 | **保留本地** |
| 本地扩展目录 `deploy/zhijing/`、`deploy/ops/`、根目录 `AUDIT-*` 等 | 上游不存在这些路径 | 运维产物与审计记录 | **保留本地**（`docs/UPSTREAM.md:57,60`） |

## 四、本轮 S1 落地的决策

| 文件 / 目录 | 我们的处理 | 为什么 | 回灌时的动作 |
|---|---|---|---|
| `backend/internal/server/middleware/request_field_conflict.go` 的**作用域**：`backend/internal/server/routes/gateway.go:204-212` | 中间件本体取上游（GHSA-p3r4-jcm3-2hph 那套：重复字段一律 400）；**挂载位置保留本地**——三条只读路由（`/v1/sub2api/billing`、`/v1/images/batches/replay`、`/v1/images/batches/:id/recovery`）注册在守卫之前，守卫只覆盖其后要计费/转发的路由 | 这三条不产生新的计费事件。守卫挂进这三条后，body 超限会从 handler 按自身协议返回的 400 变成中间件读体后的 413（#34 的实际回归，注释见 `gateway_request_field_conflict_test.go:216-221`） | **取并集**：中间件源码取上游；作用域与 `TestGatewayRoutesRejectConflictingFieldsScopeSkipsReadOnlyRoutes`（`gateway_request_field_conflict_test.go:222`）保留本地 |
| 计费 fail-closed ① 计费事务失败：`backend/internal/service/gateway_usage_billing.go:373-380`、`:1032-1037`，重试在 `:400-432` | 事务最终失败时不写 `usage_log`（写了会是一条 `actual_cost=0` 的免费单）、错误原样上抛、失败落 `billing_failures`；三次有界重试，重试靠 `usage_billing_dedup` 占位幂等 | 一次 DB 抖动或 5s 超时不该变成一笔永久漏收；账本上「看起来本来就免费」比没有记录更难对账 | **保留本地**。这是本地止血实现（`cce3fa083`），不随上游提交进来；上游若也改成失败关闭，取并集但「不写 0 成本 usage_log」这条要保住 |
| 计费 fail-closed ② 算价失败：`backend/internal/service/gateway_usage_billing.go:931-944`，准入侧默认值 `backend/internal/config/config.go:2321` | 算价报错 → 记 `billing_failures`（`:461-502`）并返回错误，请求被拒；simple mode 例外（只记 usage、从不扣费，`:934-937`）；`billing.inflight_reservation.fail_closed_on_unpriced` 默认 `true` | 价格表没跟上新模型时按 $0 成交就是永久漏收；错误码 `model_pricing_unavailable` 故意与余额不足、限速区分开 | **保留本地**。本地止血实现（`cce3fa083` 的准入部分）；上游若也做 fail-closed，取并集但 `model_pricing_unavailable` 错误码与 simple mode 例外要保住 |
| 计费 fail-closed ③ 余额守卫：`backend/internal/repository/usage_billing_repo.go:253-285`，差额登记 `:290-314` | `FOR UPDATE` 子查询把同一用户的并发扣款串行化，`GREATEST(balance - amount, 0)` 钳到 0；扣不满的差额写 `billing_failures`（`status=pending`）作为欠款凭据 | 旧实现守卫落空后会再跑一条无守卫 UPDATE，余额可以被打成负数，且只在内存里留个标记，欠款金额无法对账 | **保留本地** |
| 计费 fail-closed ④ 重复字段拒绝：`backend/internal/pkg/requestmodel/conflict.go`、`backend/internal/server/middleware/request_field_conflict.go:61-72` | 检测规则取上游；本地额外加了 `metrics.ObserveDuplicateBillingKeyRejected()`（`request_field_conflict.go:67-69`） | 上游只有 ingress 拒绝原因，没有 Prometheus 计数；拒绝必须可数，否则没人知道有人在试探解析差异 | **取并集**：检测与拒绝逻辑跟上游，指标保留本地 |
| `deploy/tests/security-invariants-test.sh` | 5 组部署面不变量：示例配置里转发头兼容开关必须显式 `false`（`:32-38`）、可信代理清单不得出现 `0.0.0.0/0` 或 `::/0`（`:40-43`）、`admin_system_update.enabled` 必须是 `false`（`:45-68`）、5 个 compose/.env 模板不得替运维写 `true`（`:70-93`）、两处装配接缝必须存在（`backend/cmd/server/main.go` 的 `config.GetSetupServerAddress()`、`backend/internal/server/routes/admin.go` 的 `UpdateGate()`，`:95-108`） | Go 测试锁二进制里的默认值，锁不住随仓库发给运维的模板；模板里一条写死的 `true` 能同时绕过二进制默认值，而且升级说明之外没人会注意 | **保留本地**。上游改 `deploy/config.example.yaml` 或 compose 模板时，取上游的值、同步改这里的断言 |
| 本地新增 CI job：`.github/workflows/backend-ci.yml` 的 `race` job、shell 门禁步骤 | race 检测单独成 job（`make test-race`）；shell 门禁在 `shell` job 里逐个跑 | 并发回归和部署门禁必须在 CI 上跑，不能靠人记得 | **取并集**。注意 workflow 改动本机推不上去（OAuth App 缺 `workflow` scope，整条 push 会被拒），需要人网页改 |
| `backend/internal/service/content_moderation.go`（S1b 回灌） | 取上游两个修复：Anthropic `{"type":"url"}` 图片来源参与审核（上游 `959d36532`）、异步审核队列惰性分配（上游 `fe72ddf1a`）；保留本地 `LocalPolicyProfile` / `matchGatewayLocalPolicy` / `isContentAuditExempt` / `riskControlLogOnly` | 本地合规策略与上游的通用审核不冲突；本地那套是业务方要求的判定 | **取并集**（提交 `a9d624dcc` 的做法可复用：逐个 `git apply -3`，不 merge） |

## 五、已确认的缺口（不是差异，是待修的洞）

| 位置 | 现状 | 处置 |
|---|---|---|
| `backend/internal/service/gateway_usage_billing.go:1359-1362`、`:1380-1383` | `calculateImageCost` 把 `CalculateCostUnified` 的错误打了日志就返回 `&CostBreakdown{ActualCost: 0}` 且 `err == nil`，因此图片请求在无价或算价失败时按 $0 成功结算，不进入 `:933` 的 fail-closed | 2026-11-28 定为一类漏收：与 #34 立的「没有价格不许编一个 $0 出来成交」直接冲突。**单独一片修**（非简易模式返回 err、简易模式保持 $0、补能证伪的测试），本清单只留记录，修好后删掉本行 |

这一条没有「回灌时听谁的」可判，所以不进上面三张动作表。留在这里是因为 §四 的 fail-closed 四条覆盖的是 token / audio 的后扣链路——图片算价这条**已知不在覆盖内**，读清单的人不该把它当成已修。

## 六、维护契约

1. **改任何一条本地决策，同一个 PR 里改这张表。** 判断变了而表没改，下一个人会按旧结论回灌。
2. **回灌 PR 的「fork mechanisms preserved」一节直接引用本表的行名**（例如「迁移完整性门禁：保留本地，未触碰 `migrations_runner.go`」），不要另起说法。
3. **改判必须单开一个 PR**，写明上游对应提交与为什么本地改动可以放弃。默认永远是保留。
4. 本文件本身是**本地扩展**（上游没有），回灌时永远保留；它的行数不是指标，能让人做对决定才是。

## 七、复核这份表用的命令

```sh
grep -rn 'go version | grep -q' .github/workflows/
ls backend/migrations/*.sql | wc -l
sed -n '/^var migrationChecksumCompatibilityRules = map/,/^}$/p' backend/internal/repository/migrations_runner.go | grep -c 'newMigrationChecksumCompatibilityRule('
ls deploy/tests/*.sh | wc -l
grep -rho 'SUB2API_[A-Z_]*' backend --include='*.go' | sort -u | wc -l
grep -n 'ObserveDuplicateBillingKeyRejected' backend/internal/server/middleware/request_field_conflict.go
grep -n 'gateway.Use(rejectConflictingFields)' backend/internal/server/routes/gateway.go
```

本表的数字都能用上面这几条命令复现；与 `docs/AUDIT-2026-11-28.md` §E 冲突时，以仓库里的实际文件为准，并在本表里写清是哪次合并让数字变的。
