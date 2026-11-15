# 智境网关 AI 交接与操作规约

本文件是交给后续 AI 工程师的工作边界。接手者必须先读本文件，再读 AUDIT-20261114.md，最后检查当前 Git、CI 和日本生产机状态。任何新结论都必须用命令、日志、CI、发布资产或生产探针证明。

## 1. 产品身份

- 正式产品名：智境网关。
- 正式工程名：zhijing-gateway。
- 正式仓库：daniei-chen/zhijing-gateway。
- 正式 GHCR：ghcr.io/daniei-chen/zhijing-gateway:<version>。
- 正式二进制与归档前缀：zhijing-gateway。
- 正式发布页面必须使用“智境网关 <version>”；不得再创建 Sub2API、sub2api 或 sub 2 作为产品发布名、镜像名、归档名、通知标题或新版本号。

sub2api 仍可能出现在数据库名、SUB2API_* 环境变量、旧协议标识、插件协议命名空间、旧容器/卷名、迁移历史、旧回滚镜像和外部赞助链接中。这些是兼容边界，不得为了清理字符串而破坏现有数据、协议或回滚能力。新产品入口、发布物和新部署文档必须使用智境网关身份。

## 2. 当前已验证生产状态

截至 2026-11-15 03:20（北京时间），生产版本是 **v0.1.14**（删除分组前必须解绑 API Key）：

- Release：https://github.com/daniei-chen/zhijing-gateway/releases/tag/v0.1.14（「智境网关 0.1.14」）
- 源码提交：`01622b632`
- GHCR digest：`sha256:50d842703bd6bb73f5d7bcf1f388ed955fc3c9bdac446c21c399d43bfbba8d08`
- 当前容器：`zhijing-api-v0114-final`，loopback 端口 **18811**
- 回滚容器：18810（v0.1.13）、18809（v0.1.12）、18808（v0.1.11）、18807（v0.1.10）、18806（v0.1.9）
- **v0.1.14 切换证据**：`candidate: business readiness ok (deep probe)` 之后
  `observe: 0 new 5xx within 180s, within limit`；容器 `restart=0`，切换窗口 0 条错误日志。
- **v0.1.14 行为变化**：`DELETE /api/v1/admin/groups/:id` 在该分组仍有活跃 API Key 时返回
  `409 GROUP_HAS_ACTIVE_KEYS`；要强制删除必须显式 `?force=true`。详见 6.12。

### 2.1 这一夜（00:30–02:20）发布的四个版本

| 版本 | 端口 | 内容 |
|---|---|---|
| v0.1.10 | 18807 | 分组强制 `service_tier`（跟随/priority/ultrafast）+ 迁移 252 |
| v0.1.11 | 18808 | 强制档位增加上游能力守卫（模型目录没声明就不注入） |
| v0.1.12 | 18809 | `/readyz?deep=1` 深度就绪探针 + 部署闸门 |
| v0.1.13 | 18810 | 告警邮件失败不再静默 |

四个版本全部零停机切换，每次都是 `0 new 5xx within 180s`。审计与误判记录见
`AUDIT-20261115.md`。
- **动态并发（已实测）**：`GATEWAY_MEMBER_CONCURRENCY_LIMIT=3` 为基础，
  `GATEWAY_MEMBER_CONCURRENCY_LIMIT_PEAK=5` 为活跃用户 ≤1 时的放宽值。
  **验收方式必须是打真实请求**：单用户发 5 个并发应全部 200；v0.1.8 因为仓库层
  `gatewayUserMaximum` 又用静态 memberLimit 压了一次，配了 PEAK=5 实际仍是 3
  （429 响应体写着"上限 3"），v0.1.9 修复后实测 5/5 全部 200。
- **两层都要一致**：service 的 `effectiveMemberLimit()` 与 repository 的
  `effectiveMemberHardLimit()` 必须用同一套活跃用户口径，否则任一层压回静态值都会让 peak 失效。
- 账号：仅 #2「ChatGPT pro 200」可用（#1 Plus 订阅 2026-11-02 过期且已删除、#3 API 已删除），
  `concurrency=10`；分组：仅「pro 200」（`model_allowlist.enabled=false`）。
- **可用模型：配置 12 个，实测成功 7 个，别把「配置里有」当成「能用」**。
  - 配置（`accounts.credentials.model_mapping`，1:1 同名映射）12 个：
    `codex-auto-review`、`gpt-5.6-luna/sol/terra`、`gpt-6-astra/luna/sol`、`gpt-6.1-sol/terra`、
    `gpt-reserve`，加生图 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。
  - `usage_logs` 里有成功记录的只有 **7 个**：`gpt-6.1-sol`（绝对主力）、`gpt-6-astra`、
    `gpt-6.1-terra`、`gpt-6-luna`、`gpt-6-sol`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`。
  - `gpt-5.6-luna` 曾连续 4 次 404（11-14 11:35 / 18:37 / 18:43），根因是当时账号的
    `extra.upstream_model_metadata` 还没同步到 5.6 系列；该快照已于 19:44 同步进来，
    之后再没有 404。**仍未用真实请求验证过**，需要时先小流量试。
  - `codex-auto-review`、`gpt-reserve` 从未被请求过，属于未验证。
  - 生图模型不在 `upstream_model_metadata` 里（那里只有 10 个文本模型），但调度按
    `model_mapping` 判定，所以可用且已实测。
- **该账号没有 ultrafast 档位**：`extra.upstream_model_metadata` 里每个模型的
  `codex_tool_capabilities.service_tiers` 只有 `{"id":"priority","name":"Fast"}`，
  **没有任何模型声明 `ultrafast`**。v0.1.10 的分组强制 Ultra Fast 对本账号无效——
  开了要么被上游忽略、要么 4xx。要用加速请选 **Fast（priority）**。
  v0.1.11 起守卫会自动拦下：选了 Ultra Fast 也会回落 priority 并记日志，不会再把这个
  未声明的档位发出去。
- 账号额度现状（2026-11-15 00:44）：7 天窗口用量 **43%**，5 小时窗口刚重置（0%），
  credits 余额 250，重置卡 3 张，`auto_reset_credit_enabled=false`（不会自动用卡）。
- 发布脚本已支持 `EXTRA_ENV="KEY=VALUE ..."`（追加到候选容器的 env-file），
  用于在零停机发布时引入新环境变量。
- 容器安全项：UID 1000、只读根、cap drop ALL、no-new-privileges、pids 256、mem 768MiB、CPU 1.5 核。

v0.1.7 曾因账号池回归被回滚，它在 18804 的回滚容器已于 2026-11-15 清理；该版本本身也不应再部署。

清理 peers 用的工具：`deploy/zhijing/prune-peers.py <保留端口...>`。它会先备份站点文件、
拒绝在「没有带权重的 primary」时写盘，并打印删掉的每一行。删容器前必须先跑它并 reload nginx，
否则 nginx 会把 backup 流量发给已删除的端口。

v0.1.2 和 v0.1.3 已发布但没有进入生产：启动时迁移完整性门禁发现历史 SQL 文件字节被品牌替换。不要部署这两个版本，也不要通过修改数据库中的 schema_migrations 校验和来绕过门禁。

## 3. 绝对禁止事项

1. 不得输出、提交、写入日志或复制任何密码、API key、JWT secret、数据库连接串、Redis 密码、私钥、Cookie、用户 token 或完整生产环境变量。读取环境变量时只允许输出键名或脱敏值。
2. 不得停止当前 active 容器、删除当前回滚容器、删除生产数据卷、清空数据库/Redis、清理镜像层或执行不可逆迁移，除非有明确的恢复证据和用户明确授权。
3. 不得直接把新容器切到公网。必须先使用独立 loopback 端口、同一数据挂载、同一网络和复制出的非敏感运行参数，验证 /readyz，再 nginx -t、reload 和公网 smoke。
4. 不得修改已应用的 SQL 迁移文件。任何 schema 变化必须新增迁移；历史迁移如果只是品牌误改，必须恢复发布时的原始字节。
5. 不得修改 schema_migrations、关闭迁移校验、扩大兼容白名单或吞掉启动错误来让发布“通过”。
6. 不得 force-push、移动已发布 tag、覆盖 release asset、删除失败证据或把失败 CI 描述成成功。
7. 不得因为扫描没有发现问题就声称“零漏洞、零 bug、绝对稳定”。只能报告已经执行的检查、覆盖范围、结果和剩余风险。
8. 不得把上游新提交直接覆盖到生产。先比较提交、迁移、依赖、配置、协议和行为，再运行完整门禁。

## 4. 必须保留的兼容边界

- PostgreSQL/Redis 现有数据库名、用户名和历史迁移文件。
- SUB2API_* 环境变量及旧配置键，除非先完成兼容读取、迁移和回滚验证。
- 插件协议生成文件中的历史 descriptor namespace（当前插件协议仍可能是 sub2api.plugin.v1）；不要对生成 protobuf 原始描述符做纯文本品牌替换。
- 旧 systemd 单元、旧容器/卷名和至少一个旧镜像回滚点，直到观察窗口结束。
- 外部赞助商、第三方推荐码和上游兼容链接；它们不等于产品发布身份。

## 5. 标准接手流程

### 5.1 先建立事实

先运行并保存结果：

~~~bash
git status --short --branch
git fetch --all --tags --prune
git log --oneline --decorate -20
gh run list --repo daniei-chen/zhijing-gateway --limit 20
gh release view v0.1.4 --repo daniei-chen/zhijing-gateway
~~~

生产侧先做只读检查：

~~~bash
docker ps
docker inspect zhijing-api-v014-final
nginx -T
curl --http1.1 --fail --silent --show-error \
  --resolve zhijing.kaogong.art:443:127.0.0.1 \
  https://zhijing.kaogong.art/readyz
~~~

先确认 active、backup、镜像 digest、迁移状态和日志，再决定是否修改任何文件或服务。

### 5.2 本地质量门禁

后端至少运行：

~~~bash
cd backend
go test ./...
go vet ./...
golangci-lint run --path-mode=abs --timeout=30m
go run golang.org/x/vuln/cmd/govulncheck@latest ./...
~~~

前端至少运行：

~~~bash
cd frontend
pnpm test:run
pnpm lint:check
pnpm build
pnpm audit --registry=https://registry.npmjs.org --prod --audit-level=high --json
~~~

另外检查：

~~~bash
git diff --check
/bin/sh deploy/tests/docker-compose-security-test.sh
/bin/sh deploy/tests/docker-compose-gateway-env-test.sh
/bin/sh deploy/tests/docker-runtime-resources-test.sh
python .github/release-tools/test_release_matrix.py
~~~

Windows 本地没有 Bash 时，不能把 shell 测试的本地环境错误当成测试通过或代码失败；必须以 Ubuntu GitHub Actions 的 shell job 为准，并记录环境限制。

### 5.3 CI、发布和部署门禁

只有以下条件全部满足，才允许创建新 tag：

- main 和升级分支的 CI 成功。
- Security Scan 成功。
- Go 单元测试和集成测试成功。
- 前端测试、lint、build 成功。
- shell 部署检查和 release helper 成功。
- Release 资产名称、checksums、GHCR 镜像标签和 OCI revision 都对应同一提交。

创建 tag 后必须核对：

~~~bash
gh release view vX.Y.Z --repo daniei-chen/zhijing-gateway \
  --json name,tagName,url,assets
docker pull ghcr.io/daniei-chen/zhijing-gateway:X.Y.Z
docker image inspect ghcr.io/daniei-chen/zhijing-gateway:X.Y.Z
~~~

必须看到“智境网关 X.Y.Z”、zhijing-gateway_X.Y.Z_*、checksums 和正确的 org.opencontainers.image.revision。不能只看 tag 存在就部署。

### 5.4 无停机发布

优先使用仓库中的 deploy/zhijing/zero-downtime-deploy.sh。生产机上当前已验证的参数模式如下，发布前必须重新确认 CURRENT_CONTAINER 和端口：

~~~bash
IMAGE=ghcr.io/daniei-chen/zhijing-gateway:X.Y.Z \
CURRENT_CONTAINER=zhijing-api-v014-final \
NEW_CONTAINER=zhijing-api-candidate \
NEW_PORT=18802 \
PUBLIC_HOST=zhijing.kaogong.art \
NGINX_SITE=/etc/nginx/sites-enabled/zhijing.kaogong.art \
bash /root/zhijing-zero-downtime-deploy-v0.1.0.sh
~~~

端口 18802 只是示例；不得假设它永远可用。候选就绪前，Nginx 不得改变。脚本失败时要读取候选容器日志，确认是启动、迁移、依赖、权限还是探针问题；不要反复重试而不解释原因。

发布后必须验证：

- 候选容器状态 healthy，restart count 为 0，OOMKilled 为 false。
- 进程为 UID 1000；只读根、cap drop、no-new-privileges、PID/内存限制仍存在。
- 本机 /readyz 和公网 forced-SNI /readyz 连续通过。
- 数据库和 Redis 检查为 ok。
- nginx -T 的 active upstream 是新端口，旧端口仍为 backup。
- 新容器日志没有 panic、fatal、migration、checksum 或无法解释的 error。
- 至少保留一个可启动回滚实例，观察窗口结束前不得清理。

### 5.5 回滚条件

出现以下任一情况，立即停止继续发布并回到旧实例：候选 /readyz 失败、迁移校验不一致、连续 5xx、panic/fatal、健康检查不稳定、OOM/restart、数据库或 Redis 不可用、Nginx 配置测试失败、外部 HTTPS smoke 失败。回滚必须留下日志、时间、镜像 digest、Nginx 变更前后配置和失败原因。

## 6. 审计记录与运维事实（2026-11-15 逐轮累积）

<!-- toc:6 -->

本章是逐轮审计的累积记录（第 49 小节）。按编号查找：

- 6.1 判断「缺什么」必须以 upstream HEAD 为准，不是看某个历史提交
- 6.2 运维巡检（japan_maintenance.py watch）
- 6.3 磁盘可回收项（评估过，暂不动）
- 6.4 性能基线（2026-11-15 实测）
- 6.5 回滚演练（2026-11-15 01:18 UTC+8，已实测）
- 6.6 运维陷阱：容器漏挂 `/app/data` 会静默进入 setup 模式
- 6.7 HSTS 头曾经重复（2026-11-15 已修）
- 6.8 深度探针的向后兼容（2026-11-15 实测）
- 6.9 告警邮件链路曾经整条断裂（2026-11-15 发现）
- 6.11 竞态检测（2026-11-15 第 15 轮）
- 6.12 删除分组会静默制造孤儿 Key（2026-11-15 第 2 轮，v0.1.14 已修）
- 6.13 边界与不变量实测（2026-11-15 第 3 轮）
- 6.14 线上前端是两套陈旧静态产物，与镜像里的 dist 不是同一份（2026-11-15 第 4 轮）
- 6.15 缺失的静态资源曾被假扮成 index.html（2026-11-15 第 5 轮，v0.1.16/0.1.17 已修）
- 6.16 备份恢复演练（2026-11-15 第 6 轮，已实测）
- 6.17 Prometheus `/metrics`（v0.1.18/0.1.19，默认关闭）
- 6.18 教训：发版前必须跑本地 golangci-lint
- 6.19 上游 HEAD 变更检测（2026-11-15 第 9 轮）
- 6.20 前端切换：一条命令，已 dry-run 验证（2026-11-15 第 10 轮）
- 6.21 上游修复同步状态（2026-11-15 第 11 轮，抽查结论）
- 6.22 账号配额存在哪、刷新会不会丢（2026-11-15 第 12 轮）
- 6.23 预聚合表算得对，但没人读（2026-11-15 第 13 轮）
- 6.24 flaky 测试：追了四种方法，放弃并说明理由（2026-11-15 第 16 轮）
- 6.25 槽位释放路径逐分支核对（2026-11-15 第 17 轮）
- 6.26 「故意不绑 ctx」的那条路径为什么安全（2026-11-15 第 18 轮）
- 6.27 并发计数：配置变更和 regular/live 两套槽位的一致性（2026-11-15 第 19 轮）
- 6.28 账务一致性：原子、幂等，但漏扣靠人工补（2026-11-15 第 20 轮）
- 6.29 `billing_failures` 的重放能力：设计了一半（2026-11-15 第 21 轮）
- 6.30 生产配置 vs 代码默认值（2026-11-15 第 22 轮）
- 6.31 错误日志与用量记录能不能对上（2026-11-15 第 23 轮）
- 6.32 有没有重复计费、有没有漏计（2026-11-15 第 24 轮）
- 6.33 用量分布与缓存命中（2026-11-15 第 25 轮）
- 6.34 价格表与实际计费是否一致（2026-11-15 第 26 轮）
- 6.35 延迟分层实测（2026-11-15 第 27 轮）
- 6.36 管理接口的认证强度（2026-11-15 第 28 轮）
- 6.37 从 Redis 数据侧反向验证「槽位无泄漏」（2026-11-15 第 29 轮）
- 6.38 账务平账验证：初始 + 兑换 − 消费 = 余额（2026-11-15 第 30 轮）
- 6.39 配额刷新为什么在生产上实测不到（2026-11-15 第 32 轮）
- 6.40 管理接口的认证边界实测（2026-11-15 第 33 轮）
- 6.41 配置完整性扫描：286 项里 76 项为空（2026-11-15 第 34 轮）
- 6.42 `/v1/models` 列了 12 个模型，其中 5 个调不通（2026-11-15 第 36 轮）
- 6.43 纠正 6.42：那 50 次 404 不是「模型不可用」，是「当时账号池不完整」
- 6.44 追平管理员那 0.000524 —— 不是浮点误差，是我算错了（2026-11-15 第 38 轮）
- 6.45 `output_tokens = 16` 的成因查实了（2026-11-15 第 39 轮）
- 6.46 活跃索引里那个残留是怎么来的（2026-11-15 第 40 轮）
- 6.47 上游修复：从「符号存在」升级到「行为通过」（2026-11-15 第 41 轮）
- 6.48 上游七项修复的行为级验证补完：6/7 通过（2026-11-15 第 42 轮）
- 6.49 效率审视：1,785 次 429 全是本地并发限制，不是上游（2026-11-15 第 43 轮）
- 6.50 250ms 轮询上限值不值：算得出来（2026-11-15 第 44 轮）


官方上游是 Wei-Shaw/sub2api，当前代码基线审计结论记录在 AUDIT-20261114.md。后续 AI 必须：

- 比较上游 tag、commit、依赖和迁移，不根据仓库名称判断是否需要同步。
- 先检查安全修复、协议变化、数据库变化和配置变化，再决定 cherry-pick、手工移植或拒绝。
- 不把上游的品牌、release workflow、镜像和仓库链接重新带回本项目。
- 给每个同步结论留下 commit、文件、测试和影响范围证据。

### 6.1 判断「缺什么」必须以 upstream HEAD 为准，不是看某个历史提交

2026-11-15 连续误判两次，根因都是同一个：拿某个历史提交**新增的行**去比对本地代码。
两个坑：

1. 本项目的模块路径（`daniei-chen/zhijing-gateway` vs `Wei-Shaw/sub2api`）和变量命名已经改过，
   行文本天然对不上，但功能是有的（例如上游写死 `8e-6`，本项目引用 `claude52FallbackPricing`）。
2. **上游可能后来又把那个改动删了**。`applyOpenAIReasoningEffortPolicyForGLMFromContext`
   是 `aa245176a` 引入的，`upstream/main` 现在**已经没有这个函数**；照历史提交回灌会引入
   上游已废弃的行为，并让本地 4 个测试失败。

正确顺序：

```bash
git grep -n '<符号>' upstream/main -- 'backend/*.go'   # 上游当前还有没有
git grep -n '<符号>' HEAD -- 'backend/*.go'            # 本项目有没有等价实现
```

上游 HEAD 已经删除的东西不要回灌。结论要写清「已存在 / 已废弃 / 真缺失」三分类，
而不是笼统说「缺」。

### 6.2 运维巡检（japan_maintenance.py watch）

systemd `zhijing-japan-health.timer` 每 60 秒执行 `python3 /opt/zhijing-sub2api/japan_maintenance.py watch`，
结果写 `/opt/zhijing-sub2api/maintenance/health.json`。任一 `OPS_ALERT_KEYS` 为 `False` 时，
watch 会置 `manual_review_required: true`；值为 `None` 表示该项探测不到，不告警。

当前纳入告警的 key：

```
cert_ok  backup_ok  disk_ok  db_ok  billing_ok  pitr_ok
gateway_ok  accounts_ok  model_catalog_ok  model_route_ok  stream_ok
```

`model_catalog_ok` / `model_route_ok` 是 2026-11-15 加的，起因是 gpt-5.6-luna 那 4 次 404：
当时 `/readyz` 全绿、账号可调度、5xx 为 0，**坏的只有「某个模型还能不能用」**。

- `model_catalog_age_hours` / `model_catalog_ok`：账号 `extra.upstream_model_metadata.synced_at`
  距今小时数，> 72h 告警。
- `model_not_found_6h` / `model_route_ok`：近 6 小时 `model_not_found` 计数，≥ 10 告警
  （客户端偶尔试一个不存在的模型名属正常，不算）。

`stream_ok` 是 2026-11-15 第 5 轮加的，补的是一个**真实的监控盲区**：
`gateway_ok` 只看 `status_code >= 500`，但流式请求在发过 200 头之后上游才失败，
落库是 `status_code=200` + `upstream_status_code=503`。这类故障用户体感就是失败，
监控却全绿——11-12/11-13 上游抖动期间每小时 10~24 次，而 `gateway_5xx_15m` 一直是 0。

- `upstream_stream_5xx_15m` / `stream_ok`：15 分钟内「已提交响应但上游 5xx」的条数，≥ 5 告警。

改这个脚本后必须：`python3 -m py_compile` → 上传到 `japan_maintenance.py.new` → 远端再编译 →
`mv` 覆盖（原子替换，避免 timer 撞上半个文件）→ 手动跑一次 `watch` 确认新字段出现。

## 7. 交接报告格式

每次工作结束必须报告：

1. 做了什么，涉及哪些提交、tag、镜像和生产资源。
2. 用了哪些证据，哪些 CI/job/release/探针成功或失败。
3. 哪些内容尚未验证，不能用“应该没问题”代替。
4. 当前 active 和 rollback 的精确版本、端口、digest。
5. 剩余风险：证书自动续期、异机/对象存储备份、管理员 TOTP/step-up、长流式请求、上游供应链和兼容标识等。
6. 下一步只写可执行动作，不写空泛的“继续优化”。

如果发现新失败，先把失败写进审计记录，再修复；不得为了让交接文档看起来漂亮而删除失败历史。后续 AI 的目标是保持可验证、可回滚、可审计和诚实的工程状态，而不是追求没有证据的“完美”措辞。


## 10. Release Notes 约定（2026-11-15 起）

`v0.1.0` ~ `v0.1.11` 的 Release 说明已全部补齐（更新内容 / 修复 / 数据库变更 / 升级说明）。
此前所有版本的 body 只有安装模板，没有任何变更说明——这是明确的质量缺口，不要回退到那个状态。

- 发版时必须写清楚：**做了什么、修了什么、有没有迁移/新环境变量、怎么回滚**。
- 有已知问题的版本要显式标注「不要部署」或「不要作为回滚目标」（v0.1.7 账号池回归、
  v0.1.2/v0.1.3 迁移校验和门禁失败）。

### 自动进 Release 的机制（已实测）

不需要改任何配置，**把 tag 打成多行即可**：

- `.goreleaser.yaml`：`release.header` 里就是 `{{ .Env.TAG_MESSAGE }}`，且 `changelog.disable: true`。
- `release.yml`：`TAG_MESSAGE=$(git tag -l --format='%(contents:body)' "$RELEASE_TAG")` —— 取的是
  tag 消息的 **body**（第一行标题之后、第一个空行之后的部分）。

所以：

```bash
git tag -a v0.1.12 --cleanup=verbatim -F notes.md   # notes.md 第一行当 subject，其余进 release body
```

**坑（v0.1.11 实测踩到）**：`git tag -a -F file` 默认走 `--cleanup=strip`，会把以 `#` 开头的行
当注释删掉——所以笔记里的 `## 修复` 这类标题会静默消失。要么加 `--cleanup=verbatim`，
要么正文不要用 `#` 开头。标题层级用 `**加粗**` 更稳。

### 6.3 磁盘可回收项（评估过，暂不动）

2026-11-15 清理容器与镜像后磁盘 35%（38G 可用）。还有一处约 2.2G 的历史部署产物：

```
/opt/zhijing-sub2api/backend-releases   1.1G
/opt/zhijing-sub2api/release-v005       565M
/opt/zhijing-sub2api/releases           160M   (11-13，最新的一份)
/opt/zhijing-sub2api/release-v0.0.7     168M
/opt/zhijing-sub2api/release-v0.1.0-dev 116M
/opt/zhijing-sub2api/upgrade-v008/009/021 约 257M
```

它们是 docker 化之前的二进制/前端快照，当前容器只挂载 `data/`，运行完全不依赖它们。
**暂不删除**的理由：`/root/build_v007.sh`、`/root/build_v010_dev_image.sh`、`/root/github-push.sh`
和 `japan_maintenance.py` 里仍有字符串引用，删掉会打断这些历史脚本的可用性；而磁盘还有 38G，
不值得为 2G 冒这个险。真要回收时先 `grep` 这四处引用，并保留 `releases/` 最新一份。

### 6.4 性能基线（2026-11-15 实测）

结论：这套部署在性能上没有瓶颈，**不要为「看起来更快」去动索引、缓存或重试策略**。数据留在这里，
是为了下次审计不用重跑一遍。

- **数据库慢查询**：`log_min_duration_statement = 2000ms`（已开启，日志走容器 stderr），
  24 小时内 **0 条**超过 2 秒的语句。
- **usage_logs 体积**：表 18MB / 索引 33MB / 合计 51MB，36409 行。`pg_stat_database.stats_reset`
  为空，说明统计自建库累积——因此 `idx_scan = 0` 是可信的「从没用过」。共有 6 个：
  `effective_upstream_model_created`(3.1MB)、`model_created_at`(2.5MB)、`sub_created`(1.1MB)、
  `subscription_id`(376KB)、`upstream_model_mismatch_created_at`(8KB)、`upstream_request_id`(8KB)。
  合计约 7.2MB。**不删**：它们是上游 schema 自带的，删除会让 schema 与上游分叉（后续同步冲突），
  而低频统计报表仍可能用到。
- **autovacuum**：所有业务表 `n_dead_tup = 0`、`n_tup_del = 0`（保留策略还没到期过），健康。
- **缓存**：Redis `keyspace_hits 3.94M / misses 1.72M`（命中率 69.7%），`used_memory` 2.34M / 64M，
  `evicted_keys = 0`、`rejected_connections = 0`。
- **容器**：API 进程 CPU < 1%、内存 37MB / 768MB。
- **上游质量**：流内 503 集中在 11-11~11-13（每天 70~130 次），**11-14 起归零**——属上游波动，网关侧无解。
- **同账号重试为什么没做**：`RetryableOnSameAccount` 在 OpenAI 路径上是
  `!shouldDisable && account.IsPoolMode() && account.IsPoolModeRetryableStatus(code)`，本项目单账号
  非 pool 模式，所以不重试。7 天里可重试的上游错误只有 45 次（占总请求 0.12%），
  为这点收益去改核心错误路径、并承担重复请求/重复计费风险，不划算。

### 6.5 回滚演练（2026-11-15 01:18 UTC+8，已实测）

用 `deploy/zhijing/switch-primary.py` 把 primary 从 18808（v0.1.11）切到 18806（v0.1.9），
观察 45 秒后切回。两次切换都只做了「改 peers + `systemctl reload nginx`」：

```
公网 /readyz            200 {"database":"ok","redis":"ok"}
/v1/responses 无密钥     401 API_KEY_REQUIRED（契约正常）
ops_error_logs 新增      0
v0.1.9 容器 error 日志   0
```

这验证了两件此前只是「理论上成立」的事：

1. **回滚不需要重启、不需要预热**，切完立刻可用；
2. **schema 是向后兼容的**：v0.1.10 新增的 `groups.force_openai_ultrafast` 列，v0.1.9 的
   ent 查询里根本没有这一列，照样正常服务。所以「先发带迁移的版本」不会把回滚路堵死。

演练命令：

```bash
python3 /root/switch-primary.py 18806 && systemctl reload nginx
# 验证后切回
python3 /root/switch-primary.py 18808 && systemctl reload nginx
```

`switch-primary.py` 会先备份站点文件、跑 `nginx -t`，失败时自动还原；它**不自己 reload**，
把「什么时候切流量」留给调用者。peers 里保留哪些回滚端口由 `prune-peers.py` 管理，两个工具互不重叠。

### 6.6 运维陷阱：容器漏挂 `/app/data` 会静默进入 setup 模式

2026-11-15 做故障注入时手工 `docker run` 了个临时容器，漏了生产容器那条
`-v /opt/zhijing-sub2api/upgrade-v0011/data:/app/data`，结果它打印
`First run detected, starting setup wizard...`，只注册 `/setup/*` 四个路由，
`/readyz` 和 `/health` 全部 **404**。

**我最初以为这是 Redis 不可达导致的，猜错了。** `NeedsSetup()` 的判据是文件：
配置文件和 `/app/data` 下的安装锁文件都不存在时判定首次运行——与 Redis 无关。

陷阱在于：这时容器 `State=running`、healthcheck 一直 `starting`，看起来「起来了」，
但业务路由一个都没有。**任何手工起容器的操作都必须带上 data 挂载。**

兜底已经存在：watchdog 探 `/health` 期望 200，setup 模式下 `/health` 是 404 →
`healthy=false` → 触发提醒。所以不会静默失明，但排查时要知道往这个方向看。

同理，`concurrencyErrorResponse` 的语义也确认过了，别改错：

```
GatewayConcurrencyLimitError / WaitQueueFullError / ConcurrencyError  -> 429 rate_limit_error
context.Canceled                                                      -> 499
其余（Redis/DB 等设施错误）                                            -> 503 "Service temporarily unavailable"
```

也就是说 Redis 运行期失联时用户拿到的是 **503**，不是「你被限流了」。这个区分是对的。

**深度就绪探针（v0.1.12 起）**：`/readyz?deep=1` 在 DB/Redis 之外额外返回
`schedulable_accounts`，为 0 时整条探针返回 503。什么时候用哪个：

```bash
curl -s 'http://127.0.0.1:<port>/readyz'          # 浅：进程 + 依赖活着（监控/healthcheck 用这个）
curl -s 'http://127.0.0.1:<port>/readyz?deep=1'   # 深：再加上「有没有账号可用」
```

部署脚本在改写 peers 之前会调深探针，失败就 `die`，不切流量。旧镜像不认识 `deep` 参数会
忽略它并照常返回 200，所以回滚到老版本不受影响；`DEEP_READY_CHECK=0` 可整体关闭。

判断「这实例到底能不能服务业务请求」时用深的，别只看浅的——2026-11-14 19:10 那次就是
浅探针全绿、业务全 503。

### 6.7 HSTS 头曾经重复（2026-11-15 已修）

公网响应曾经长这样：

```
Strict-Transport-Security: max-age=2592000, max-age=31536000; includeSubDomains
```

两个来源叠加：源站 nginx 发 30 天，边缘 nginx 发 1 年 + 子域，而边缘没有 `hide` 掉下层的。
按 HTTP 语义多个同名字段会被合并，`max-age` 取第一个值——**实际生效的是 30 天，
`includeSubDomains` 基本被忽略**，和边缘配置里写的意图不一致。

处置：边缘 `/etc/nginx/sites-available/zhijing.kaogong.art` 在 `add_header` 之后加一行
`proxy_hide_header Strict-Transport-Security;`，只保留边缘那条。现在公网只有一条
`max-age=31536000; includeSubDomains`。改前备份在 `/root/zhijing-edge-nginx.bak-*`。

**教训**：多层反代时，每个 `add_header` 都要确认下层是不是也发了同一个头。这次其余
安全头（CSP / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy）都只有一条，
唯独 HSTS 重了。

### 6.8 深度探针的向后兼容（2026-11-15 实测）

部署脚本的 `DEEP_READY_CHECK` 会请求 `/readyz?deep=1`。老镜像不认识 `deep` 参数，
忽略它并返回浅探针结果，因此回滚部署不会被这道闸卡住。实测三个在跑实例：

```
18806 (v0.1.9)   deep=1 → 200 {"checks":{"database":"ok","redis":"ok"}}
18808 (v0.1.11)  deep=1 → 200 {"checks":{"database":"ok","redis":"ok"}}
18809 (v0.1.12)  deep=1 → 200 {"checks":{"business":"ok",...,"schedulable_accounts":1}}
```

### 6.9 告警邮件链路曾经整条断裂（2026-11-15 发现）

`ops_alert_events` 共 334 条，**`email_sent` 全部为 false**，包括 2026-11-14 19:15 那次事故的
两条 P0（错误率极高 / 成功率过低）。也就是说：规则在正确触发、事件在正确入库，但**一封邮件都没发出去**。

两层原因叠在一起：

1. **配置缺口**：`smtp_host`(smtp.qq.com) / `smtp_port`(465) / `smtp_username` / `smtp_from` 都有值，
   但 `settings` 表**没有 `smtp_password` 这一行**。QQ 邮箱要求用授权码认证，密码为空必然被拒。
   （代码里 `SettingKeySMTPPassword = "smtp_password"`，加密存储，缺失时读到空串。）
2. **失败不可见**：`maybeSendAlertEmail` 的每个失败分支都是裸 `continue`，不打日志、不写原因。
   所以「通知完全不通」和「这两周很安静」在日志里没有区别——这才是它能潜伏这么久的原因。

v0.1.13 修掉了第 2 点：单个收件人失败记录脱敏地址 + 事件 ID + 规则名 + 错误；
0/N 全失败时额外记一条汇总并提示检查 SMTP。第 1 点需要人工在后台补填。

**验证告警通道是否真的通了**：后台 → 系统设置 → 邮件 → 保存 → 点「发送测试邮件」
（`POST /api/v1/admin/settings/send-test-email`），不要只看「保存成功」。

排查时的判据：

```sql
select count(*) total, count(*) filter (where email_sent) sent from ops_alert_events;
-- sent 长期为 0 且 total 在涨 => 通道是断的
```

**基础设施告警现在后台可见（2026-11-15 第 13 轮）**：此前 11 项检查只写 `maintenance/health.json`，而那个文件**没有任何界面在读**——grep 过 backend 和 frontend，零引用，等于告警只存在于服务器磁盘上，要靠人 ssh 上去 cat。

现在 record_infra_alert() 在失败集合**发生变化**时写一条 ops_system_logs（component=infra_watchdog）：失败写 error，恢复写 info。后台「系统日志」页面直接能看到。去重状态存在 maintenance/infra_alert.json，全绿时不写任何记录，不会每 60 秒刷屏。

注入验证过：假失败→一条 error；同样失败再调→不重复写；恢复→一条 info。测试记录已删除，状态文件回到 failed=[]。

**这仍然不是推送**：它把「只在磁盘上」变成了「登录后台能看到」，但不会主动找人。真正的推送需要凭据——SMTP 授权码（走应用既有告警邮件）或 Telegram bot token，服务器上目前两样都没有。

**基础设施告警可推送到任意 webhook（2026-11-15 第 14 轮）**：watchdog 支持通用推送，不需要我持有任何凭据。

配置方式（二选一）：

```bash
# 推荐：写文件，systemd 重启后仍然有效
echo 'https://your-endpoint/path' > /opt/zhijing-sub2api/maintenance/webhook_url
# 或者环境变量
ZHIJING_ALERT_WEBHOOK=https://your-endpoint/path
```

告警状态**变化**时 POST 一个 JSON 到该地址：

```json
{"level":"error","component":"infra_watchdog",
 "message":"[InfraWatchdog] 基础设施检查未通过：backup_ok",
 "detail":{"backup_ok":false},"host":"...","at":"2026-11-14T18:16:51Z"}
```

企业微信 / 钉钉 / Slack / 自建都可以接。没配置时静默跳过，不影响自愈和观测；推送失败也不抛错
（通知不该拖垮看门狗）。刻意不内置某个具体渠道——那需要把 bot token 写进服务器，而 token 只能由主人提供。

已验证：注入假失败 → 收到 error payload（含明细）；恢复 → info payload；连续 5 次调用 5/5 送达；
无配置时 `notify_webhook` 返回 False 且无副作用。测试数据与临时接收器均已清理，当前 hook 为空（静默）。

### 6.11 竞态检测（2026-11-15 第 15 轮）

`go vet`、`golangci-lint`（含 staticcheck/gosec）都看不出数据竞争，只有 `-race` 能。
全量 `-race` 跑 `internal/service` 需要十几分钟，不适合 CI，因此收敛到并发相关测试：

```bash
cd backend && make test-race
# 等价于
CGO_ENABLED=1 go test -race -tags=unit -timeout 600s ./internal/service/ ./internal/handler/ \
  -run 'Concurren|Limiter|Limit|Cache|Schedul|Pool|Slot|Race|Parallel|Atomic'
```

实测：service **80.8s**、handler **14.1s**，两者全部通过，没有 DATA RACE。
也就是说槽位、限流、缓存、调度这几条最危险的并发路径目前是干净的。

**CI 那一半推不上去**：当前 GitHub token 缺 `workflow` scope，无法修改
`.github/workflows/*`。改动已导出为 `deploy/zhijing/patches/0001-ci-race-job.patch`，
二选一应用：

```bash
git am deploy/zhijing/patches/0001-ci-race-job.patch   # 在有 workflow scope 的环境
```

或者直接在 GitHub 网页编辑 `backend-ci.yml`，把 patch 里的 `race:` job 粘进去
（它插在 `test:` 与 `frontend:` 之间）。

### 6.12 删除分组会静默制造孤儿 Key（2026-11-15 第 2 轮，v0.1.14 已修）

`api_keys.group_id` 的外键定义是 **`ON DELETE SET NULL`**：

```sql
api_keys | api_keys_group_id_fkey | FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
```

所以删掉一个分组，它名下所有 API Key 的 `group_id` 会被**静默置空**，这些 key 立刻无法调度。
2026-11-14 19:10 的全站 503 正是这个形态：27 个 5xx，而 `/readyz`、账号状态、Redis 全绿。

更糟的是**非 simple mode 完全没有保护**——`DeleteGroup` 直接调 `groupRepo.DeleteCascade`，
管理员误点一次就中断服务。simple mode 走的 `DeleteGroupIfEmpty` 才有守卫。

v0.1.14 起：

- `DeleteGroup` 先查 `ListKeysByGroupID`，有活跃 key 就返回
  `409 GROUP_HAS_ACTIVE_KEYS`，消息里带数量。
- 逃生门显式化：`DeleteGroupForce`，handler 只在 `?force=true|1|yes` 时走它。
  让「绕过保护」成为写出来的决定，而不是一次误点。
- `DeleteGroupIfEmpty` 行为不变。

**运维口诀**：要删分组，先把 key 换到别的分组或删掉。别用 force 图省事——
那等于把 key 变孤儿。

顺带把删分组相关的 8 个测试都跑了一遍（含新增的「有 key 拒绝」「无 key 放行」），全绿。

### 6.13 边界与不变量实测（2026-11-15 第 3 轮）

**请求体上限是双层的，外层才是真限制**：

| 层 | 配置 | 位置 |
|---|---|---|
| 边缘 / 源站 nginx | `client_max_body_size 24m` | `/etc/nginx/sites-available/zhijing.kaogong.art` |
| 应用 | `gateway.max_body_size` 默认 **256MB**、`text_max_body_size` **32MB** | `config.go:2647/2653` |

实测 26MB 空 body POST `/v1/responses` → **413 Request Entity Too Large**（不是 401），
说明拦截发生在认证之前、模型调用之前。小请求对照返回 401 `API_KEY_REQUIRED`，链路正常。

**别被 256MB 误导**：外层 nginx 卡在 24m，超过就 413。要放宽必须两层一起改。

**认证覆盖**：`/v1`、`/v1beta`、`/backend-api/codex`、`/antigravity/v1` 各路由组都挂载了
`apiKeyAuth`（Gemini 用 `APIKeyAuthWithSubscriptionGoogle`）且都在 `bodyLimit` 之后；
直接挂在 `r` 上的顶层路由只有 `/health`、`/readyz`、`/setup/status`、`/.well-known/*`
和 Claude Code 的遥测桩 `/api/event_logging/batch`（直接 200，不读 body）。

**日志脱敏**：`ops_error_logs` 里用正则扫 `sk-…` / `Bearer …` / `password=…`，**0 条命中**。
唯一遗留是 `attempted_key_prefix` 列——**没有任何代码写入它**（grep 零结果），
所以 401 排查时看不到调用方用的是什么 key 前缀。该列留着无害（预留），删列需要迁移，
收益不抵风险，暂不动。

### 6.14 线上前端是两套陈旧静态产物，与镜像里的 dist 不是同一份（2026-11-15 第 4 轮）

nginx 实际服务的前端**不在容器里**：

| 用途 | 目录 | 构建时间 | 入口 |
|---|---|---|---|
| `location /` 的 root | `/var/www/zhijing-homepage/` | **2026-11-01 12:07** | `/assets/index-BFVAedJu.js` |
| `@zhijing_sub2api_spa` fallback 的 root | `/var/www/zhijing-workbench/` | **2026-11-06 08:40** | `/app-assets/index-DY_5OgR5.js` |
| 仓库 / 镜像内嵌 | `backend/internal/web/dist` | 随每次构建 | `/assets/index-*.js` |

三份互不相同。`zero-downtime-deploy.sh` **从不更新这两个目录**（grep 零结果），
所以镜像里的前端改动不会上线——首页用 11-01 的构建，深层路由 fallback 用 11-06 的构建。

**这意味着**：v0.1.10 加的「分组强制档位」选择器、以及任何 11-06 之后的前端改动，
在浏览器里都看不到；后端 API 是最新的，界面不是。

**也意味着我第 4 轮那个「首屏省 271KB」的优化没有实际效果**：我改的是仓库
`dist/index.html` 的 modulepreload 列表，而线上 11-01 那份 index.html 根本没有
modulepreload，也没有 vendor-excel。改动本身无害（对未来部署是对的），但**不该被描述成
线上性能改善**。这是自我更正。

要真正让线上前端与源码一致，需要把 `dist` 部署到 `/var/www/` 下的某个目录并让 nginx 指过去。
**这是用户可见的界面替换，必须由主人决定**，不能自行执行。

### 6.15 缺失的静态资源曾被假扮成 index.html（2026-11-15 第 5 轮，v0.1.16/0.1.17 已修）

内嵌 SPA 中间件原来的逻辑是「文件找不到 → 返回 index.html」，而且是 **HTTP 200**：

```
curl http://<容器>/assets/does-not-exist.js
v0.1.15: 200  text/html  3371 bytes
v0.1.17: 404  text/plain
```

后果是浏览器把 HTML 当 JavaScript 解析 → 语法错误 → 白屏；而 200 表示成功，浏览器
**不会重试**。客户端缓存着旧 index.html、却去请求新 hash 的 chunk 时，就一直白屏到清缓存为止。
这就是「发版后打不开」的真实成因。

现在的规则（`shouldServeIndexFallback`）：

| 路径 | 行为 |
|---|---|
| 空 / `index.html` | 回退 index.html |
| 存在的文件 | 直接文件服务 |
| 不存在且扩展名属静态资源（js/css/png/svg/woff2/json…） | **404** |
| 其余（前端路由，含 `/user/john.doe` 这种带点的） | 回退 index.html |

**影响范围要说清楚**：当前公网 nginx 用 `try_files` 走 `/var/www` 的静态副本，**不经过**后端的
SPA handler，所以这个修复对现有用户**没有直接可见变化**（nginx 本来就对缺失静态资源返 404）。
它修的是后端直连场景、以及将来把 nginx 改成 proxy 到后端（见 6.14）时的正确性。

**顺带修好的测试盲区**：这段逻辑原本只有 `//go:build embed` 的测试覆盖，而 CI 跑 `-tags=unit`，
等于从没被测过。判断逻辑已抽到 `spa_fallback.go`（`//go:build embed || unit`），
配套测试用 `//go:build unit`，CI 会跑。

v0.1.16 的构建约束写错了（文件无 tag 而调用者在 embed 里），导致 golangci-lint 把三个符号
判成 unused、CI 红灯——**测试是过的，红的只是 lint**。v0.1.17 把约束改成 `embed || unit` 修好。

### 6.16 备份恢复演练（2026-11-15 第 6 轮，已实测）

「备份文件存在」不等于「备份能恢复」。这一轮把最新备份真的恢复到一个临时 PostgreSQL 里验证。

**备份内容**：`/var/backups/zhijing-sub2api/20261114T181850Z/`（UTC 18:18 = 北京 02:18）

```
database.dump   7,526,494 B  sha256 a0cc7571…  ← 与 receipt.json 记录一致
redis.rdb          44,495 B  sha256 2d8f87dd…
config.tar.gz     212,632 B  sha256 92dd0ef0…
```

dump 头部是 `PGDMP` 1.16（pg_dump custom 格式）。

**恢复方法**（用生产同一个 PG 镜像 ID，起临时容器 + tmpfs，不碰生产卷）：

```bash
docker run -d --name pg-restore-test --tmpfs /var/lib/postgresql \
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=zhijing_trial \
  -p 127.0.0.1:15432:5432 <生产 PG 镜像 ID>
docker exec -i pg-restore-test pg_restore -U postgres -d zhijing_trial \
  --no-owner --no-privileges --exit-on-error < database.dump
```

**结果**：

- `pg_restore --exit-on-error` **零错误**
- 106 张表全部恢复
- 行数与生产逐表一致：

| 表 | 恢复库 | 生产 |
|---|---|---|
| schema_migrations | 305 | 305 |
| users | 6 | 6 |
| api_keys | 12 | 12 |
| groups | 3 | 3 |
| accounts | 3 | 3 |
| usage_logs | 36410 | 36410 |
| ops_error_logs | 3343 | 3343 |

**陷阱**：PostgreSQL 18 的官方镜像要求挂载 `/var/lib/postgresql`（不是 `/var/lib/postgresql/data`），
挂错位置容器会直接退出，日志里只有一段迁移提示。用 `--tmpfs /var/lib/postgresql` 即可。

恢复完临时容器与 tmpfs 已删除，生产未受影响（行数、深探针均不变）。

### 6.17 Prometheus `/metrics`（v0.1.18/0.1.19，默认关闭）

在此之前外部监控只能探 `/health` 和 `/readyz`，**看不到请求量和状态码分布**，go.mod 里也没有
任何 prometheus 依赖。

新增 `/metrics`，输出 Prometheus 文本格式 0.0.4：

```
zhijing_uptime_seconds
zhijing_http_requests_total
zhijing_http_requests_by_class_total{class="1xx|2xx|3xx|4xx|5xx"}
zhijing_go_goroutines
```

**零新增依赖**：计数器是 `atomic.Int64`，文本格式手写，没有引入 `prometheus/client_golang`。
计数中间件挂在链条最前面——被 CORS 或鉴权提前拒绝的请求同样计入。

**启用方式**（默认不暴露）：

```bash
EXTRA_ENV="METRICS_TOKEN=<随机串>"
curl -H "Authorization: Bearer <随机串>" http://127.0.0.1:<port>/metrics
curl "http://127.0.0.1:<port>/metrics?token=<随机串>"
```

**安全默认值**（实测）：

| 请求 | 结果 |
|---|---|
| 未设 `METRICS_TOKEN` | **404**（不是 401，不确认端点存在） |
| token 错误 | **404** |
| token 正确 | 200 + text/plain |
| v0.1.17 对照 | 200 **text/html**（SPA fallback 吞掉了） |

token 比较用 `crypto/subtle` 常量时间。`/metrics` 已加入 SPA 放行列表，否则会被内嵌前端
当成路由返回 index.html——**这正是 v0.1.17 上的实测结果**。

外网抓取需要自己加一条 nginx location；当前 nginx 用 `try_files` 走静态目录，不转发该路径。

### 6.18 教训：发版前必须跑本地 golangci-lint

v0.1.16 和 v0.1.18 两次 CI 红灯都是 **lint**（不是测试）：

- v0.1.16：新文件无 build tag，调用者在 embed 里 → `unused`
- v0.1.18：`errcheck` 要求检查 `(*strings.Builder).WriteString` 的返回值

本地 `%USERPROFILE%\go\bin\golangci-lint.exe` 是 **v2.14.0，与 CI 同版本**，跑一次就能提前发现：

```powershell
cd backend && golangci-lint run --timeout=30m
```

v0.1.19 在打 tag 之前跑了，`0 issues`，CI 一次过。**以后每次发版都跑**。

**nginx 已接通（2026-11-15 第 8 轮）**：主域名 HTTPS 块里加了 `location = /metrics`，
`proxy_pass http://zhijing_api/metrics;`，公网和内网都能到达。未设 `METRICS_TOKEN` 时
后端返回 404，所以现在这条路径**已接通但默认不可用**——配置 token 后无需再动 nginx。

实测：

```
源站  https://127.0.0.1/metrics  (Host: zhijing.kaogong.art)  → 404
公网  https://zhijing.kaogong.art/metrics                    → 404
对照  /readyz?deep=1                                          → 200（其他端点不受影响）
```

**踩到的坑**：第一次插入时脚本匹配了**最后一个** `location = /readyz`，那是
`154-36-187-147.sslip.io` 的 server 块，不是主域名的块。结果公网请求仍被 `location /` 的
`try_files` 接走，返回 `200 text/html`（SPA fallback）。nginx 的 location 是**按 server 块
生效**的，改之前先确认插进的是哪个块——这次是靠返回 `text/html` 才发现的，
404 和 200 的差别在这里就是"转发成功"和"根本没转发"。

备份：`/root/zhijing-nginx-metrics-20261114T210733Z.bak`（首次插入）、
`/root/zhijing-nginx-metrics2-*.bak`（修正到正确 server 块之前）。

### 6.19 上游 HEAD 变更检测（2026-11-15 第 9 轮）

跟踪上游是明确需求，但没人会天天去翻 GitHub。watchdog 现在每 **6 小时**查一次
`Wei-Shaw/sub2api` 的 `main` HEAD（匿名 GitHub API，无需 token；匿名限流 60 次/小时，
我们 6 小时才查一次），HEAD 变化时写一条 `ops_system_logs` 并推 webhook。

状态存在 `maintenance/upstream_head.json`：

```json
{"sha": "530c5e3a4f9c", "date": "2026-11-11T02:43:23Z", "checked_at": 1794690670}
```

实测三条路径：

| 场景 | 结果 |
|---|---|
| 首次运行（无状态文件） | 只记录 sha，**不报警**（0 条日志） |
| 6 小时内再跑 | 直接返回，不发网络请求（`checked_at` 不变） |
| 人为改写成旧 sha 后再跑 | 写入 `info`「上游 Wei-Shaw/sub2api main 有新提交：deadbeef0000 → 530c5e3a4f9c」 |

**踩到的坑**：第一次把 `maybe_check_upstream()` 放在 `record_infra_alert` 的**末尾**，
但那个函数有 early return（失败集合没变化时直接返回），所以正常情况下永远不会走到末尾——
上游检查从来没执行，`upstream_head.json` 一直是空的。移到函数开头（early return 之前）才生效。

顺带把写 `ops_system_logs` 的 SQL 抽成了 `write_system_log()`，基础设施告警和上游检测共用。

### 6.20 前端切换：一条命令，已 dry-run 验证（2026-11-15 第 10 轮）

针对 6.14 那个「线上前端是 11-01 / 11-06 两套陈旧产物」的问题，切换工具已备好并验证过。

**改什么**（只动主域名 HTTPS 块的两处）：

| location | 现在 | 切换后 |
|---|---|---|
| `location /` | `try_files $uri $uri/ @zhijing_sub2api_spa`（读 `/var/www/zhijing-homepage`） | `proxy_pass http://zhijing_api`（后端内嵌 dist） |
| `location /assets/` | `root` 继承 homepage → `try_files $uri =404` | `proxy_pass http://zhijing_api` |

两处必须在**同一次 reload** 里生效——nginx 只在 reload 时读取整份配置，只改 `/assets/`
会让还在加载旧 index.html 的客户端拿不到 chunk。

**三个入口**：

```bash
bash /root/switch-frontend-to-proxy.sh --dry-run   # 改配置 → nginx -t → 立刻还原，不 reload
bash /root/switch-frontend-to-proxy.sh apply       # 真正切换（reload）
bash /root/switch-frontend-to-proxy.sh --rollback  # 用最近备份还原并 reload
```

**dry-run 实测结果**：

```
rewrote location / and location /assets/ to proxy to zhijing_api
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
DRY_RUN_OK: rewritten config passes nginx -t
restored original, still valid
```

线上确认未变（仍是 `zhijing-entry.js` + `/assets/index-BFVAedJu.js`，11-01 的构建）。

**切换后的预期**：首页、静态资源全部由镜像内嵌的 dist 提供（与源码同步），
`/metrics`、`/readyz` 等 proxy 路径不受影响。回滚就是 `--rollback` 一条命令，
配置改动只有两段 location，语义清晰。

**风险**：这是**用户可见的界面替换**——11-01 的旧前端换成当前源码构建。功能上更完整
（含 v0.1.10 的分组强制档位选择器），但界面细节可能与用户记忆中的不同。
备份目录 `/root/zhijing-frontend-switch/`。

### 6.21 上游修复同步状态（2026-11-15 第 11 轮，抽查结论）

上游 `Wei-Shaw/sub2api` 的 `main` HEAD 仍是 **530c5e3a4（2026-11-11）**，未再前进；
最新 tag 是 **v0.2.21**（我们的 `0.1.x` 是分叉版本号，与上游编号体系不同）。

我们的历史与上游**没有共同祖先**，所以不能靠 `git diff` 判断缺什么。这一轮改成
「按 commit 找对应实现」抽查了最近 15 个提交里最相关的 7 个：

| 上游修复 | 我们的状态 | 证据 |
|---|---|---|
| `slot-leak-on-hydrate-error` | **已同步** | `newSelectionResult` 里 hydrate 失败时调用 `release()`，注释与上游一致 |
| `balance-recharge-multiplier-6-decimals` | **已同步** | `balanceRechargeMultiplierHasExcessPrecision` + `formatBalanceRechargeMultiplier`，上限 6 位 |
| `openai-responses-reject-invalid-utf8` | **已同步** | `openai_gateway_handler.go` 有对应校验 |
| `codex-page-context` | **已同步** | `openai_page_context.go` 存在 |
| `native-image-error-status` | **已同步** | `openai_images_json_keepalive.go` 存在 |
| `atomic-refresh-token-rotation` | **已同步** | `refresh_token_cache.go` 用 `consumeRefreshTokenScript`（Lua）原子读删 |
| `upstream-keys-usage-index` | **已同步** | 库里存在 `idx_usage_logs_api_key_created_cost`（迁移文件编号与我们不同，索引在） |

**结论**：分叉虽然早，但这几个直接影响计费精度、并发槽位和 token 轮转的修复都已经在前面
的迭代里搬过来了。这是「抽查最近 15 个里的 7 个」，不是全量比对——上游历史更长，
不能据此宣称「完全一致」。

`accounts-refresh-stability`（刷新时保留行与配额）没做列级验证：`accounts` 表里只有
`quota_dimension`，实际配额数据不在该表，需要另找承载表才能确认。

### 6.22 账号配额存在哪、刷新会不会丢（2026-11-15 第 12 轮）

补上 6.21 里没验证完的那条（上游 `accounts-refresh-stability`：刷新时保留行与配额值）。

**配额不在 `accounts` 表的列里**，而在 `accounts.extra` 这个 JSONB 里：

```
codex_5h_used_percent / codex_7d_used_percent
codex_5h_reset_at     / codex_7d_reset_at
codex_credits_snapshot（含 balance / unlimited / has_credits / fetched_at）
auto_reset_credit_enabled / auto_reset_credit_5h_threshold / auto_reset_credit_7d_threshold
codex_5h_window_minutes / codex_7d_window_minutes
```

`accounts` 表本身只有 `quota_dimension` 一列——难怪按列找会扑空。

**当前实测值**（账号 #2「ChatGPT pro 200」）：

```
used_5h = 0     used_7d = 43     reset_7d = 2026-11-20T07:15:08+08:00
credits = {"balance":"250.0000000000","unlimited":false,"has_credits":true}
fetched_at = 1794579066  → 2026-11-14 12:51 北京时间
auto_reset_credit_enabled = false
```

**结论（有边界）**：这些值来自 11-14 12:51 那次刷新，之后 20 小时没有新请求
（凌晨无流量），值仍然完整保留在 `extra` 里——**没有出现刷新后被清空的现象**。

但这是**观察到的状态**，不是我主动触发一次刷新再看结果。要严格验证「刷新不会丢」，
需要在有流量的时段记录刷新前后两帧 `extra` 做对比。生产上凌晨无人请求，这一条留作待办，
不要当成已经证过。

### 6.23 预聚合表算得对，但没人读（2026-11-15 第 13 轮）

`usage_dashboard_*` 这几张表每小时被重算一次，数据本身是**准确的**——和原始表逐项对得上：

| 维度 | usage_logs 实时算 | usage_dashboard_* |
|---|---|---|
| 今日请求 | 243 | 243 |
| 今日花费 | 6.1509791400 | 6.1509791400 |
| 今日 token | 520383 | 431260 + 89123 = 520383 |
| 00 点 | 212, 5.471099 | 212, 5.4710987400 |
| 01 点 | 31, 0.679880 | 31, 0.6798804000 |

watermark 也在动（`2026-11-15 05:15:17`，刚刚）。

**但是没有任何查询读它们。** 对 `usage_dashboard_daily` / `usage_dashboard_hourly` /
`usage_group_daily_rollups` 在整个 `backend/internal` 里 grep 出 24 处引用，
分类下来是 **14 处写 + 10 处其它，0 处 SELECT**。后台的用量查询仍然直接扫
`usage_logs`（`api_key_repo.go`、`channel_monitor_v2_aggregation.go`、
`custom_group_usage_rollup_repo.go` 里都是 `FROM usage_logs`）。

**当前没有性能问题**：`usage_logs` 只有 36,410 行，按天聚合也就 20ms 上下。
所以这不是一个需要马上修的 bug，而是一个**未来的**问题——等表长到百万行，
后台看板会线性变慢，而本来准备好的解药（预聚合）一直没人用。

**没动手改的原因**：把后台查询切到预聚合会改变用户看到的数据来源和口径
（比如近 N 小时必须合并原始表），属于会影响数字准确性的改动，不该在没有明确要求时
擅自做。记录下来，等数据量真的上来或者用户提出看板变慢时再处理。

顺带一提，`usage_dashboard_*` 的 `idx_scan` 数字看着很大（daily 30,672、hourly 73,419），
那是**聚合任务自己的 DELETE/INSERT** 在用索引定位，不是查询读取——别被这个数字骗了。

**闭环补充（第 15 轮）**：不用等流量了，代码本身就能回答「刷新会不会清掉配额」。

`OpenAIQuotaService.CacheCreditsSnapshot` 写快照时只传一个 key：

```go
s.accountRepo.UpdateExtra(ctx, accountID, map[string]any{
    openaiQuotaCreditsKey: openAICreditsSnapshot{...},
})
```

而 `UpdateExtra` 的实现是** JSONB 合并**：

```go
extraExpression := "COALESCE(extra, '{}'::jsonb) || $1::jsonb"
client.ExecContext(ctx, "UPDATE accounts SET extra = "+extraExpression+", updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL", ...)
```

`||` 是 JSONB 合并操作符，不是覆盖。所以刷新 `codex_credits_snapshot` 时，`codex_5h_used_percent`、
`codex_7d_used_percent`、`codex_*_reset_at` 这些 key 原样保留；而且是一条 `UPDATE`，
没有读-改-写，并发下也不会互相覆盖。

这正好满足上游 `accounts-refresh-stability`（刷新时保留行与配额值）的诉求，只是实现路径不同。

### 6.24 flaky 测试：追了四种方法，放弃并说明理由（2026-11-15 第 16 轮）

现象：本地 `go test -tags=unit ./internal/service/` 偶发 FAIL（一次 91.7 秒、一次 254 秒）。
试过的手段和结果：

| 方法 | 结果 |
|---|---|
| `-shuffle=on` 打乱顺序 | 卡住，CPU 0.4s 不涨 |
| `-count=3` 连跑三遍 | 卡住，日志 0 字节 |
| `-json` 逐事件输出 | 跑到 **2,209 / 7,454** 个测试处停住，**0 个 fail 事件** |
| `-timeout 90s` 触发 panic | 拿到 goroutine dump：大量 `chan receive` 的 `t.Parallel` 等待，没有死锁栈 |

四次都是同一形态：**测试二进制跑到约 30% 处 CPU 降到 0.1 秒、日志停止增长、进程挂着不结束**。

CI（Linux）13/13 全绿，一次都没红过。

**结论：判定为本地 Windows 环境问题**（单进程跑七千个测试 + 大量 `t.Parallel()` + CGO），
不是代码缺陷的证据。不再在这上面耗轮次——如果 CI 某次真的红了，日志会直接给出测试名，
比本地单进程复现更可靠。

**这条不再当待办**，从清单里划掉。

### 6.25 槽位释放路径逐分支核对（2026-11-15 第 17 轮）

这是并发系统最容易漏的地方：获取了槽位，然后某个中途失败的分支提前 return，把槽位留在 Redis 里等 TTL。
上游 11-10 的 `slot-leak-on-hydrate-error` 就是这类问题。这里逐条核了一遍。

**获取端只有两个入口**（`gateway_helper.go:400 / 465`），错误分支都直接 `return nil, err`。
危险的是「函数返回 error 但其实已经占了槽」——查了实现，不存在：

`acquireGatewayUserSlot` 是 `runScriptInt64Pair(gatewayUserAdmissionScript, ...)`，
Lua 脚本原子执行：要么占成功返回 1，要么返回 0，**error 时脚本根本没执行**，不会留下半占状态。

**释放端的设计是「ctx 兜底 + 手动幂等」**：

```go
func wrapReleaseOnDone(ctx context.Context, releaseFunc func()) func() {
    var once sync.Once
    releaseOnce := func() { once.Do(releaseFunc) }
    stop := context.AfterFunc(ctx, releaseOnce)   // 请求结束自动释放
    return func() { _ = stop(); releaseOnce() }   // 手动调用也释放，once 保证只放一次
}
```

所以即便某个分支忘了手动释放，请求结束（ctx Done）时也会释放；`sync.Once` 保证不会重复释放。

**以 `/v1/responses` 为例逐分支核对**（其余 handler 同构）：

| 位置 | 分支 | 释放 |
|---|---|---|
| 240 | 获取 account slot 失败 | 未获取，无需释放 |
| 248-252 | `err != nil` → return | 同上 |
| 258-269 | profit veto → 释放后 `continue`/`return` | **手动释放** |
| 278 | 正常路径 | **绑定 ctx Done** |
| 288-295 | Antigravity 未配置 → return | **手动释放** |
| 302-304 | 转发完成 | **手动释放** |

`wrapReleaseOnDone` 在 7 个 handler 文件里共 23 处调用，覆盖 user slot、account slot 和 queue slot。

**结论：没有找到泄漏分支。** 获取端原子、释放端有 ctx 兜底且幂等，两条路都堵住了。
这不能证明「永远不会有泄漏」，但把每个 return 分支都走了一遍，没有发现漏释放的路径。

### 6.26 「故意不绑 ctx」的那条路径为什么安全（2026-11-15 第 18 轮）

上一轮留了个疑问：`wrapReleaseAfterForward` 旁边写着

> HTTP forwarding can drain upstream usage after the client disconnects. Its slots
> belong to the forwarding cleanup, not to the client context lifetime.

也就是说有些槽位**故意不绑客户端 ctx**——因为客户端断开后还要继续收上游 usage。这类「故意不释放」
的地方最容易积累泄漏：一旦 forwarding cleanup 本身没兜住，槽位就挂到 TTL（40 分钟）。

逐条走完，结论是安全的，靠的是三道锁。

**第一道：veto 分支自己释放，并且返回 nil**

```go
if vetoed {
    if fastReleaseFunc != nil {
        fastReleaseFunc()
    }
    return nil, openAISlotAcquireProfitVetoed   // release 返回 nil，调用方拿不到可再次释放的东西
}
return wrapReleaseAfterForward(fastReleaseFunc), openAISlotAcquireOK
```

快速抢槽路径（2414-2419）和排队路径（2470-2475）都是这个形状。

**第二道：调用方用 defer 包住整个 Forward**

```go
result, err := func() (*service.OpenAIForwardResult, error) {
    defer func() {
        if accountReleaseFunc != nil {
            accountReleaseFunc()
        }
    }()
    return h.gatewayService.Forward(c.Request.Context(), c, account, attemptBody)
}()
```

不管 Forward 返回成功、报错还是 panic，defer 都会执行。

**第三道：Forward 有硬上限，不可能永久挂起**

```go
maximum := 25 * time.Minute          // cfg.Gateway.OpenAIForwardMaxSeconds 可配
upstream, cancel := context.WithTimeout(context.WithoutCancel(ctx), maximum)
```

`WithoutCancel` 让上游请求在客户端断开后继续（为了收完 usage），但**25 分钟硬超时**保证 Forward
一定会返回。而槽位 TTL 是 40 分钟 > 25 分钟，所以即使前两道全失效，TTL 还能兜住。

**结论**：这条「不绑 ctx」的路径不是疏忽，是被三道锁共同保证的。
25 分钟 / 40 分钟这两个数字的关系（上限 < TTL）是关键——如果哪天有人把
`OpenAIForwardMaxSeconds` 调大到 40 分钟以上，这个保证就破了。**改这个配置时要看一眼槽位 TTL**。

### 6.27 并发计数：配置变更和 regular/live 两套槽位的一致性（2026-11-15 第 19 轮）

**场景一：管理员把账号 `concurrency` 从 10 改成 3，而 Redis 里已经有 7 个占用的槽位。**

`acquireScript` 的逻辑是：

```lua
redis.call('ZREMRANGEBYSCORE', key, '-inf', expireBefore)   -- 先清过期
local count = redis.call('ZCARD', key) + redis.call('ZCARD', liveKey)
if count < maxConcurrency then
    redis.call('ZADD', key, now, requestID)                 -- 再占
    return {1, now}
end
return {0, now}
```

`7 < 3` 不成立 → 返回 0，**新请求被拒**，直到现有槽位自然释放到 3 以下。**行为正确**，
调小配置不会突破上限，代价是那段时间会拒绝新请求（符合预期）。

**场景二：`regular` 和 `live` 两套 ZSET 会被相加，会不会重复计数？**

`count = ZCARD(key) + ZCARD(liveKey)`。查了 live lease 的获取路径（`openai_live.go:183`）：

```go
acquired, acquireErr := liveCache.AcquireLiveLease(..., true)   // replacingRegularSlots=true
...
created, createErr := s.createUpstreamLiveCall(ctx, account, request, attestation)
selection.ReleaseFunc()                                          // 紧接着释放普通槽位
```

`replacing=true` 会让脚本把上限放宽 1（`allowance = 1`），因为调用方**已经**持有普通槽位，
需要在切换的瞬间同时持有两者。拿到 live lease 后立刻 `selection.ReleaseFunc()`，净效果只占一个。

所以那个「+1」是**有意的短暂超额**，窗口长度等于一次 `createUpstreamLiveCall` 的耗时，
不是泄漏，也不是重复计数。

**维护提醒**：如果哪天 `createUpstreamLiveCall` 变慢（或加了重试），这个窗口会拉长，
期间账号的实际并发会超过配置值 1 个。这是可接受的，但要知道它存在——`allowance` 这个设计
是「短暂超额」而不是「永久放宽」。

### 6.28 账务一致性：原子、幂等，但漏扣靠人工补（2026-11-15 第 20 轮）

**计费是单事务原子的。** `usageBillingRepository.Apply` 的结构：

```go
tx, err := r.db.BeginTx(ctx, nil)
defer rollback
applied, err := r.claimUsageBillingKey(ctx, tx, cmd)   // INSERT ... ON CONFLICT DO NOTHING RETURNING id
if !applied {
    return &UsageBillingApplyResult{Applied: false}, nil   // 幂等跳过
}
applyUsageBillingEffects(ctx, tx, cmd, result)          // 订阅/余额/Key额度/Key限速/账号配额
tx.Commit()
```

一个事务里完成：去重占位 + 扣余额（含透支判定）+ 订阅用量 + Key 额度 + Key 限速 + 账号配额。
中途任一步失败 → 整体回滚（连占位一起），重试会重新走完整流程。**不会出现扣一半的状态。**

**幂等靠唯一索引**：`usage_billing_dedup(request_id, api_key_id)` 上 `ON CONFLICT DO NOTHING RETURNING id`。
重复请求拿到 `sql.ErrNoRows` → `Applied: false` → 不重复计费。

**但有一个真实窗口，代码注释自己写着**（`usage_billing_repo.go:644`）：

> Apply 失败时 usage_logs 已经写入（账记了），但余额/配额未扣（钱没扣）

因为 `usage_logs` 在 `Apply` 之前写入。这个窗口的处理方式是 `RecordFailure` 把失败落进
`billing_failures` 表（`status='pending'`，`ON CONFLICT DO NOTHING` 保证同一请求只登记一次），
供**对账与人工补录**。

**实测现状：`billing_failures` 表 0 行**，也就是说生产上到目前为止没有发生过一次计费事务失败。
`usage_logs` 共 36,410 行，最近 24 小时 2,380 条。

**关键缺口**：`billing_failures` 只有写入，**没有任何代码读它或自动补偿**（grep 只有 INSERT 和注释）。
补偿是纯人工的。而 watchdog 虽然有 `billing_failures_pending` 这一项监控，**告警通道却没配置**
（见清单 B 类）——也就是说真出现漏扣，记录会有、监控会红，但**通知送不出去**。

这就是为什么「告警凭据」在技术债清单里是 P1 而不是可选项：它不只是收不到通知，
而是**账务异常的最后一环没有出口**。

### 6.29 `billing_failures` 的重放能力：设计了一半（2026-11-15 第 21 轮）

上一轮说补偿是人工的。这一轮查了「能不能自动重放」，结论是**目前不能，而且连数据都不够**。

**表结构留了重放的痕迹，但没有实现**：

`billing_failures` 有 `replay_attempts` 和 `last_replay_at` 两列，从名字看就是为重放准备的。
但 grep 整个 `backend/internal`：**零处引用**——没有代码写它们，也没有任何东西读这张表。
和 `attempted_key_prefix` 一样，是预留但没用起来的列。

**更关键的问题：表里存的字段不足以重建一条计费命令。**

`UsageBillingCommand` 需要 22 个字段，其中这些在 `billing_failures` 里**没有**：

| 缺失字段 | 为什么重要 |
|---|---|
| `BalanceCost` / `SubscriptionCost` / `APIKeyQuotaCost` / `APIKeyRateLimitCost` / `AccountQuotaCost` | 五类金额是分开扣的，只知道 `total_cost` 无法还原每一项该扣多少 |
| `BillingType` / `AccountType` | 决定走哪条扣费分支（订阅 vs 余额 vs 账号配额） |
| `RequestFingerprint` / `RequestPayloadHash` | 幂等指纹的一部分 |
| `SubscriptionID` | 订阅扣费必须知道扣哪个订阅 |
| `CacheCreationTokens` / `ImageCount` / `MediaType` | 影响计费口径 |
| `AccountQuotaHasDailyLimit` / `AccountQuotaHasWeeklyLimit` | 决定账号配额累加哪几个维度 |

所以**即使现在写一个重放脚本，也重建不出正确的扣费**——只能拿到一个总金额，不知道该往哪儿扣。

**好消息是这条链路的「重放安全性」本身是对的**：`Apply` 的 dedup 占位在同一个事务里，
失败时连占位一起回滚，所以同一个 `request_id` 重新调用会重新走完整流程，不会被幂等检查误跳过。
也就是说**底层是支持重放的，缺的是数据和方法**。

**没有动手的原因**：补字段要加迁移（10 列），写重放要动账务。当前 `billing_failures` 是 0 行，
没有任何真实需求；而「自动补扣钱」这类逻辑一旦写错，后果比漏扣更严重。
这件事应该由主人决定要不要做，不是我在审计里顺手加上的。

### 6.30 生产配置 vs 代码默认值（2026-11-15 第 22 轮）

网关的行为由二十多个环境变量控制。只要有一个被改过而没人记着，行为就会静默变化。
这里把生产实际生效的值和 `config.go` 的默认值做了对照。

| 配置 | 代码默认 | 生产 | 说明 |
|---|---|---|---|
| `gateway.member_concurrency_limit` | **0（不限）** | **3** | 开启成员并发限制 |
| `gateway.member_concurrency_limit_peak` | **0** | **5** | 开启活跃用户 ≤1 时的放宽 |
| `gateway.global_concurrency_limit` | **0（不限）** | **16** | 开启全局限流 |
| `gateway.concurrency_slot_ttl_minutes` | **30** | **40** | 槽位 TTL 调大 10 分钟 |
| `gateway.openai_forward_max_seconds` | 1500 | 1500 | 一致（25 分钟） |
| `gateway.openai_disconnect_drain_seconds` | 30 | 30 | 一致 |
| `gateway.openai_response_header_timeout` | **0（无超时）** | **900** | 开启 15 分钟上游响应头超时 |
| `gateway.idle_conn_timeout_seconds` | **90** | **120** | 空闲连接超时调大 |
| `gateway.downstream_write_timeout_seconds` | 120 | 120 | 一致 |
| `gateway.request_body_read_timeout_seconds` | 120 | 120 | 一致 |
| `concurrency.openai_poll_max_interval_ms` | **2000** | **250** | **轮询最大退避降了 8 倍** |

**大部分是合理的收紧**：把默认「不限制」的三项打开（成员 3 / 峰值 5 / 全局 16），
给上游响应头加 15 分钟超时（默认 0 表示不超时，等着挂死），槽位 TTL 从 30 调到 40 给长请求留余量。

**两项值得记一笔**：

1. **`slot_ttl_minutes = 40` 与 `forward_max = 25 分钟` 的关系是安全的**（25 < 40）。
   这正好印证了 6.26 里那条结论：只要 Forward 的硬上限小于槽位 TTL，`defer release` 就一定能
   在 TTL 之前执行完。**以后谁要把 `openai_forward_max_seconds` 改到 2400 秒以上，这条就不成立了。**

2. **`openai_poll_max_interval_ms` 从 2000 降到 250**：这是等待槽位时的最大退避间隔。
   调小意味着等待中的请求更频繁地重试抢占，**抢到槽位更快、但 Redis 查询更密**。
   当前只有 1 个活跃用户，影响可以忽略；如果并发用户变多（比如 10 个请求同时等），
   每秒会多出约 40 次 Redis 查询。这是取舍，不是错误，但要知道它和默认值差了 8 倍。

### 6.31 错误日志与用量记录能不能对上（2026-11-15 第 23 轮）

想验证「每条错误是否都对应一条（或没有）用量记录」，结果先撞上一个前提问题。

**两表的 `request_id` 是两套不同的标识，对不上。**

```
usage_logs.request_id       client:5cc49019-0b5d-4a12-995f-2b71e39ec985   ← 全部带 client: 前缀
ops_error_logs.request_id   6182aa8c-9a24-4e75-ac28-c99832b3ade5        ← 裸 UUID
```

试着加上前缀再匹配（`'client:' || e.request_id`），**仍然是 0 条**——不是前缀问题，是根本不同的 ID。
`usage_logs` 的 36,410 行全部是 `client:` 前缀（客户端传入的请求 id），
`ops_error_logs` 的是网关自己生成的。

**后果**：排查时无法从一条错误直接跳到它的用量记录（或反向）。
**替代办法**：按 `user_id` + 时间窗口关联，能大致对上但做不到一对一。

**顺带查清了一个容易误解的数字**：`ops_error_logs` 里有 **330 条 `status_code=200`** 的记录，
看着像「成功请求却报了错」。实际内容是：

```
Recovered upstream error 503: Our servers are currently overloaded...   327
Recovered upstream error 429: Rate limit exceeded                         2
Recovered upstream error: Post "https://chatgpt.com/backend-api/codex/..." 1
```

**这是「已恢复的上游错误」**——上游抖了，网关重试或切号后成功，客户端拿到 200。
记录它是为了观察上游健康度，不是错误。330 次抖动全部被成功恢复，说明 failover 是有效的。

**第 300 条 502 / 154 条 503 才是真的没救回来的**，这部分和 429 的 1,786 条一起，
构成了错误日志的主体。

### 6.32 有没有重复计费、有没有漏计（2026-11-15 第 24 轮）

一个直接的判据：`usage_logs` 的每一行都应该在 `usage_billing_dedup` 里有一条对应的去重记录，
而且一对一。

```
usage_logs               36,410
usage_billing_dedup      36,410     ← 完全相等
usage_billing_dedup_archive   0
actual_cost > 0          36,391
```

**两个数字完全相等**，说明：

- **没有重复计费**：每个 request_id 只登记一次，`ON CONFLICT DO NOTHING` 生效
- **没有漏走计费流程**：每条用量记录都进过 `Apply`

**19 行 0 成本**是什么：

```
模型 gpt-6.1-sol，input_tokens=0，output_tokens=0，total_cost=0
时间集中在 11-11 14:36–15:11
```

请求没有任何 token 用量，所以成本算出来是 0。这是失败/中断请求被记录下来的结果，不是漏算。

**429 和 5xx 根本不会出现在 `usage_logs` 里**——`usage_logs` 没有 `status_code` 列，
它只记录走完计费流程的请求。限流和上游失败在计费之前就返回了，所以不计费。**这是对的。**

**但这带来一个统计口径的缺口**：想算「总请求数」时，
`usage_logs`（成功的）+ `ops_error_logs`（失败的）不能简单相加——因为两表的 request_id 不通
（见 6.31），无法确认有没有重复，也无法确认有没有既没成功也没记录的情况。

**当前能确定的是**：计费侧 36,410 = 36,410，一对一，干净。

### 6.33 用量分布与缓存命中（2026-11-15 第 25 轮）

**token 统计是精确的，不是估算。** 如果流式场景下用估算，会看到大量「整千」的圆整数字。
实测：

```
有 output_tokens 的记录   36,391
恰好整千                  7      (0.02%)
恰好整百                  329    (0.9%)
平均输出 token             587
最大 / 最小                27,389 / 5
```

整千只占万分之二，分布自然。

**一个高频值需要解释**：`output_tokens = 16` 出现 **1,556 次**，是所有取值里最多的。拆开看：

```
gpt-6.1-sol     1,532 次   平均输入 2,869 token   跨 11-02 到 11-14   2 个用户
gpt-6-astra        14 次   平均输入 9,684 token
gpt-6.1-terra      10 次   平均输入 7,912 token
```

输入很大、输出固定 16 个 token，时间集中在 13:00 和 15:00 两个时段。这是**agent 循环的典型形态**：
每轮带完整上下文进去，模型返回一句简短确认。不是异常，是真实使用方式。

**缓存命中率很高**：

```
总请求              36,410
有 cache_read       35,227   → 96.8%
有 cache_creation    4,093   → 11.2%
平均 cache_read     138,469 token
```

96.8% 的请求命中 prompt cache，平均一次读 13.8 万 token。这解释了为什么「输入 2,869 + 缓存 13.8 万」的组合很常见——
上下文极长但大部分被缓存覆盖，实际计费按缓存价（通常是输入价的十分之一）走。

**这也是这个网关成本可控的主要原因**：不是请求少，是命中率极高。

### 6.34 价格表与实际计费是否一致（2026-11-15 第 26 轮）

用「成本 ÷ token」反算单价，再和 `data/model_pricing.json` 对比。以 `gpt-6.1-sol` 为例。

**价格表里写的**：

```
input_cost_per_token          2e-06    → $2.00 / M token
output_cost_per_token         1e-05    → $10.00 / M token
cache_read_input_token_cost   1e-07    → $0.10 / M token（输入价的 5%）
```

**从 `usage_logs` 反算**（取无缓存的两条记录）：

| id | input | output | input_cost | output_cost | 反算输入 | 反算输出 |
|---|---|---|---|---|---|---|
| 35380 | 15,146 | 205 | 0.030292 | 0.002050 | **$2.00/M** | **$10.00/M** |
| 35371 | 26,711 | 261 | 0.053422 | 0.002610 | **$2.00/M** | **$10.00/M** |

**缓存价也一致**：三条不同规模的记录反算出来都是 `$0.100000/M`：

```
129,792 tokens → 0.0129792  → 0.1
130,688 tokens → 0.0130688  → 0.1
142,592 tokens → 0.0142592  → 0.1
```

**三项全部对上，价格表是生效的**，计费用就是文件里的值，没有硬编码、没有 fallback 到别的价。

价格表本身 349 KB / 269 个模型，11-14 02:50 更新，是上游 LiteLLM 数据源的镜像。
缓存读只有输入价的 5%（$0.10 vs $2.00），这也是为什么 96.8% 缓存命中能把成本压得很低。

### 6.35 延迟分层实测（2026-11-15 第 27 轮）

分三层测，才看得清延迟花在哪。

| 层 | 测法 | 结果 |
|---|---|---|
| 应用进程 | 源站 `curl 127.0.0.1:18814` | `/health` **0.8–1.1ms**、401 路径 **1.0–2.2ms**、`/readyz`（DB+Redis）**2.6–3.3ms** |
| nginx + 应用 | 源站 `curl -k https://127.0.0.1/health`（loopback，无网络） | **5–6ms** |
| 用户到公网 | 本地 `curl https://zhijing.kaogong.art/health` | **28–41ms** |
| 源站绕行全网 | 源站 curl 自己的公网域名（经边缘再回来） | **0.59–1.13s**，其中 TLS 握手 0.16–0.64s |

**结论：网关自身开销不到 6 毫秒**，认证中间件几乎零成本（401 路径比 /health 只多 1ms）。

**用户侧 28–41ms 里绝大部分是网络往返**：中国到日本边缘的 RTT + TLS 握手。这个数字是合理的，
非流式请求的总延迟大致是 30ms（用户→边缘）+ 100ms 级（边缘→源站）+ 6ms（处理）。

**一个测量陷阱**：我一开始用 PowerShell 的 `Invoke-WebRequest` 测得中位数 **296ms**，
差点写成「网关有 300ms 开销」。换 `curl` 原生命令同一目标只有 **28–41ms**——
差的那 250ms 是 PowerShell 的对象构造和解析开销，不是网关的。**测延迟要用能不建对象的工具。**

**已经优化的部分**（查过配置，都在）：

```
listen 443 ssl http2;                      HTTP/2 已启用
ssl_protocols TLSv1.2 TLSv1.3;             TLS 1.2/1.3
ssl_session_cache shared:ZHIJING_TLS:10m;  TLS 会话复用已开
```

源站绕行那 0.6–1.1 秒是物理距离决定的（日本→边缘→再回来），不是配置问题，也没有优化空间。

### 6.36 管理接口的认证强度（2026-11-15 第 28 轮）

`/api/v1/admin/*` 的中间件链：`adminAuth` → `panelRateLimiter.Global()` → `auditLog` →
`AdminComplianceGuard` → `ScopedAdminKeyAccounts`。**有限流、有审计、有合规守卫。**

**三种认证方式**（`adminAuth`）：

1. **WebSocket 子协议**（`Sec-WebSocket-Protocol: sub2api-admin, jwt.<token>`）——
   浏览器 WS 不能设 header，这是必要的变通
2. **`x-api-key`**（Admin API Key，`adm_sc_` 前缀走 scoped 分支）
3. **`Authorization: Bearer <JWT>`**（标准）

**JWT 验证是一条七步链**（`validateJWTForAdmin`）：

| 步骤 | 检查 | 失败行为 |
|---|---|---|
| 1 | JWT 签名 + 过期 | 401 `TOKEN_EXPIRED` / `INVALID_TOKEN` |
| 2 | Session 有效性（可撤销） | 401 `TOKEN_REVOKED`；**Redis 不可用 → 503** |
| 3 | 用户存在 | 401 `USER_NOT_FOUND` |
| 4 | 用户状态 | 401 `USER_INACTIVE` |
| 5 | **TokenVersion** | 401（改密后旧 token 立即失效） |
| 6 | **会话绑定**（IP/UA 变化即撤销） | 401 |
| 7 | 管理员权限 | 403 `FORBIDDEN` |

**三点值得单独说**：

- **第 2 步是 fail-closed**：Redis 挂了返回 503 而不是放行。很多系统在这里 fail-open
  （缓存不可用就当有效），那是给攻击者一个「打挂 Redis 就绕过认证」的入口。
- **第 5 步 TokenVersion**：管理员改密码后，之前签发的所有 token 立刻失效，不用等 24 小时过期。
- **第 6 步会话绑定**：IP 或 UA 任一变化就撤销会话。这是企业级防护，对 token 被复制到别处使用
  有效。代价是用户换网络要重新登录。

**另外**：`/settings/admin-api-key` 这个管理 API Key 自己的端点**只允许 JWT**，
API Key 不能管理 API Key——避免了一把 key 泄露后自我复制。

**JWT 有效期**（默认值）：

```
jwt.expire_hour               24     access token 24 小时
jwt.refresh_token_expire_days 30     refresh token 30 天
```

24 小时对管理后台偏长，但配合 session binding + TokenVersion 撤销，风险可控。
这一条我没有改——缩短会频繁打扰使用者，而现有两道撤销机制已经覆盖了主要风险。

### 6.37 从 Redis 数据侧反向验证「槽位无泄漏」（2026-11-15 第 29 轮）

前面几轮是从代码读出来的「没有泄漏分支」。这轮换到数据侧，直接看 Redis 里有没有残留。

**槽位 key 一个都没有**：

```
concurrency:startup:legacy_wait_sweep:v1    启动标记
concurrency:zhijing:user_index:v1           活跃用户索引
```

`--scan --pattern 'concurrency:*'` 只有这两个，`concurrency:account:*` / `concurrency:user:*`
这类真正装槽位的 ZSET **不存在**，连 `*slot*` 都扫不出来。当前无请求，也没有任何
「占着不放」的残留。**代码结论和数据结论一致。**

**顺带查清一个残留**：`concurrency:zhijing:user_index:v1` 里有 1 个成员（用户 4），
score 是 **1794679933**，而 Redis 当前时间是 **1794692225**——**过期了 12,284 秒（3.4 小时）**。

这不是问题，因为：

| 口径 | 值 |
|---|---|
| `ZCOUNT key now +inf`（代码实际用的） | **0** |
| `ZCOUNT key -inf now`（过期残留） | 1 |
| `TTL` 整个 key | **-1（永不过期）** |

代码统计活跃用户数时用的是 `[now, +inf]`，过期成员落在区间外，**不参与计数**。
所以即便残留永久留着，也不会让「活跃用户数」算错——这正是用 score 过滤而不是
主动删除的好处：省掉一次清理开销，牺牲一点内存。

**也不会无限增长**：ZADD 对同一个 userID 是覆盖更新（score 刷新），每个用户最多占一个成员，
所以这个 ZSET 的上限就是用户总数。当前 6 个用户，最坏 6 个成员。

**结论**：数据侧没有发现泄漏迹象。槽位 ZSET 干净，索引里的残留是设计允许的、
不影响功能的微量浪费。

### 6.38 账务平账验证：初始 + 兑换 − 消费 = 余额（2026-11-15 第 30 轮）

前面只用「`usage_logs` 行数 == `usage_billing_dedup` 行数」证明了数量对得上。
这轮换成**金额**验证：把每个用户的余额、充值来源、消费总额三者对上。

**充值来源有两处**，一开始只看到一处差点误判：

1. `redeem_codes`（兑换码，`admin_balance` 类型）
2. **`admin.users.create` 的 `request_body` 里带的 `balance`**——创建用户时直接给的初始余额

只查兑换码时会发现每个用户都「多」了 150 美元，看起来像漏记的账。查审计日志才发现：

```
member1~4    balance:150   11-01 21:25   Pro200 拼车成员
jifengxian   balance:300   11-14 16:25
```

**平账结果**：

| 用户 | 初始 | 兑换 | 可用合计 | 消费 | 应剩 | 实际余额 | 差 |
|---|---|---|---|---|---|---|---|
| 2 | 150 | 920.20 | 1070.20 | 769.92131130 | 300.27868870 | 300.27868870 | **0** |
| 3 | 150 | 253.00 | 403.00 | 102.27176540 | 300.72823460 | 300.72823460 | **0** |
| 4 | 150 | 654.31 | 804.31 | 513.60548840 | 290.70851159 | 290.70851159 | **0** |
| 6 | 300 | 100.00 | 400.00 | 0.42960960 | 399.57039040 | 399.57039040 | **0** |
| 1 | 222.80* | — | 222.80 | 122.81097312 | 99.98902688 | 99.98850288 | **−0.000524** |

四个普通用户**分毫不差**。

管理员本人（用户 1）差 **0.000524 美元**——半分钱都不到。他有过一串手动调整
（+50 +50 −100 −100 −50 −50，净 0）和一条 `admin_concurrency` 类型的负值兑换码（−3.00，
调的是并发不是余额），这些都不影响余额。这点差异我判断是多次浮点加减后的舍入残差，
**没有找到可以复现的具体来源，但量级在 1e-4 以下，不值得追**。

**结论：账务是平的。** 初始余额 + 兑换码 − 消费 = 当前余额，四个用户精确成立。

### 6.39 配额刷新为什么在生产上实测不到（2026-11-15 第 32 轮）

想把 6.22 那条「刷新不会清空旧值」从「仅代码」升级成实测，查了触发条件，结论是**做不到**。

**两个触发点都需要管理员凭据**：

```
POST /api/v1/admin/openai/accounts/:id/quota/refresh   →  RefreshQuota
custom_admin_key_openai.go:98                          →  scoped admin key 查询路径
```

`RefreshQuota` 的流程是 `QueryUsage`（查上游）→ `CacheCreditsSnapshot`（写 credits）→
`CacheResetCreditsSnapshot`（写 reset credits）。三个写操作都走 `UpdateExtra`，
而 `UpdateExtra` 是 `COALESCE(extra,'{}'::jsonb) || $1`——**单 key 合并，不是整块覆盖**。

所以**代码层面这条是确定的**：写 `codex_credits_snapshot` 不会碰 `codex_7d_used_percent`
或 `codex_*_reset_at`。

**但生产上触发不了**：需要管理员 JWT，而今天全天零流量（最近一次计费请求是 01:32），
也等不到自然刷新。用数据库手工改 `extra` 再观察，那是模拟不是实测，我不拿它冒充证据。

**处理方式**：在 `AUDIT-EVIDENCE-20261115.md` 里把这条明确写成
「逻辑确定，但生产上无法触发实测」，而不是留在含糊的「仅代码」。

### 6.40 管理接口的认证边界实测（2026-11-15 第 33 轮）

没有管理员凭据也能测一部分东西——用无效凭据试探，看它怎么回应。

**认证先于授权**（这是对的顺序）：

| 请求 | 状态码 | 错误码 |
|---|---|---|
| 无任何凭据 | **401** | `UNAUTHORIZED` |
| 畸形 JWT | **401** | `INVALID_TOKEN` |
| 随机 `x-api-key` | **401** | `INVALID_ADMIN_KEY` |
| 伪造的 `adm_sc_` 前缀 key | **401** | `INVALID_ADMIN_KEY` |

**全部 401，没有一个是 403。** 说明它先验证身份、再谈权限——如果反过来（先查权限后验身份），
未认证的请求会收到 403，那就等于告诉攻击者「这个接口存在且只差权限」。

伪造 `adm_sc_whatever` 也被拒，说明 scoped key 不是「看前缀就放行」。

**发现一个信息泄露：端点存在性可枚举。**

```
未认证访问 /api/v1/admin/users                           → 401（存在）
未认证访问 /api/v1/admin/this-endpoint-does-not-exist    → 404（不存在）
```

路由匹配发生在认证之前，所以能通过状态码区分「端点存在」和「端点不存在」。

**我判断这是低风险，不改**：

- 泄露的是「有哪些功能」，不是数据、不是凭据、不是用户信息
- 拿到 401 之后仍然什么都做不了
- 这是 gin/echo 这类框架的默认行为，要堵住得在路由注册前插一层统一认证，
  会把 `/health`、`/readyz` 这些公开端点一起挡掉，代价远大于收益

同类系统（Kubernetes API、GitHub API）也都有这个特征。记录在案，不作为缺陷。

### 6.41 配置完整性扫描：286 项里 76 项为空（2026-11-15 第 34 轮）

扫了 `settings` 表全部 286 个 key，空值（NULL 或空串）76 个，占 26.6%。逐个看过，
绝大多数是**正常的空**——没启用的登录方式（OIDC 的 endpoint）、没配的第三方集成、
默认为空的列表字段。

**唯一实质缺失的是 SMTP 密码**：

```
smtp_host      = smtp.qq.com              SET
smtp_port      = 465                      SET
smtp_use_tls   = true                     SET
smtp_username  = 2421873411@qq.com        SET
smtp_from      = 2421873411@qq.com        SET
smtp_from_name = 智境网关                   SET
smtp_password  = （这一行根本不存在）        MISSING
```

六项里五项配好了，**只差密码**。这是典型的「看起来配好了」——后台邮件设置页面
host/port/账号/发件人都有值，只有密码框空着，而保存时不校验这一项。

**触发时会发生什么**（`TestSMTP` 的逻辑）：

```go
password := strings.TrimSpace(req.SMTPPassword)
if password == "" && savedConfig != nil {
    password = savedConfig.Password
}
if req.SMTPHost == "" {
    response.BadRequest(c, "SMTP host is required")
    return
}
```

host 有必填校验，密码没有——空密码会一路传到 `TestSMTPConnectionWithConfig`，
由 SMTP 服务器返回认证失败。所以**「发送测试邮件」这个按钮确实能暴露问题**，
错误信息是底层连接错误而不是「密码未配置」。

**判断：不算缺陷，但体验有改进空间。** 保存 SMTP 配置时如果 host 有值、password 为空，
可以给一句提示。没有改——因为测试按钮已经能发现问题，而且密码字段在表单上是明确的一项，
不填是用户的选择。真要改属于产品体验范畴，不是稳定性问题。

**顺带确认**：`ops_email_notification_config` 是 SET 状态、`alert.enabled = true`、
有收件人。也就是说**告警规则是开着的，只是发不出去**（见 6.9）——这比「规则没配」更隐蔽：
系统自认为在告警，实际一封都发不出去。

### 6.42 `/v1/models` 列了 12 个模型，其中 5 个调不通（2026-11-15 第 36 轮）

**这是个用户能直接撞上的问题。**

分组「pro 200」的 `/v1/models` 走 `GetAvailableModels`：取所有可调度账号的
`model_mapping`，去重后原样返回（`gateway_service.go:1455` 逐条 `modelSet[model] = struct{}{}`），
**没有任何「这个模型真的能用吗」的过滤**。

账号 #2 的 `model_mapping` 有 12 个模型，其中 5 个从未成功调用过：

| 模型 | 404 次数 | 最后尝试 |
|---|---|---|
| `gpt-5.6-sol` | **28** | 11-02 |
| `codex-auto-review` | **12** | 11-06 |
| `gpt-5.6-luna` | **10** | **11-14** |
| `gpt-5.6-terra` | 0 | 只有 503 记录 |
| `gpt-reserve` | 0 | 无记录 |

`usage_logs` 里这五个模型**一条成功记录都没有**，但 `ops_error_logs` 里有 **50 次 404**。
也就是说：客户端照着 `/v1/models` 的列表去调，撞了 50 次墙。

`gpt-5.6-luna` 最后一次 404 是 **11-14**——说明到现在还有人在试。

**为什么这五个不可用**（推断，未验证）：

- `gpt-5.6-*` 是上游新模型，账号的套餐未必开放
- `codex-auto-review` 看起来是内部用途，不对外接受直接调用
- `gpt-reserve` 从名字看就是保留位

**分组「API 200美元」也有同样问题**：它的 allowlist 里明确列了这 5 个
（`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`、`codex-auto-review`、`gpt-reserve`），
所以那个分组对外宣告的 10 个模型里有 5 个调不通。

**修复方向**（三条，成本递增）：

1. 从账号 `model_mapping` 里删掉这 5 个——最直接，但如果上游以后开放了就白删
2. 给分组加 allowlist，只列已验证能用的——分组 3 已经有 allowlist 机制，改配置就行
3. 在 `/v1/models` 里加「最近 N 天有成功记录」的过滤——要查库，会给这个高频接口加负担

**我没有动手改**：改 `model_mapping` 会影响调度（账号路由依赖它），
而改分组 allowlist 是改用户配置。两件事都应该由主人决定。这里只把事实摆清楚：
**对外宣告 12 个，实际能跑 7 个，其中 5 个已经让客户端撞了 50 次 404。**

### 6.43 纠正 6.42：那 50 次 404 不是「模型不可用」，是「当时账号池不完整」

**上一轮我判断错了，这里撤回。**

6.42 我说「`/v1/models` 宣告 12 个模型，其中 5 个调不通，客户端撞了 50 次墙」。
查到底层时间线后，这个结论站不住。

**决定性证据——账号 #2 是什么时候进这个分组的**：

```
account_groups:  account_id=2, group_id=2, joined 2026-11-14 19:44:45
```

**11-14 19:44 之前，分组 2 里只有账号 #1**，而 #1 的 `model_mapping` 只有 6 个模型，
**不含任何 `gpt-5.6-*`**。

再看那批 404 的最后时间：

```
gpt-5.6-sol    最后一次 404   11-02 21:33
gpt-5.6-luna   最后一次 404   11-14 18:43
```

两个时间**都早于 11-14 19:44**。也就是说：

- 这些 404 发生时，池子里确实没有账号支持 `gpt-5.6-*`，网关返回
  「not supported by any configured account in this group」是**完全正确的行为**
- 11-14 19:44 账号 #2（mapping 含 12 个模型）入组之后，**再没有一条 `gpt-5.6-*` 的 404**

**所以我错在哪**：我拿「历史上 50 次 404」当成了「当前不可用」的证据，
却没有查这些 404 发生在账号入组之前。`usage_logs` 里这些模型 0 条成功记录，
正确的解读是「**账号入组后没人试过**」，而不是「试了都失败」。

**准确的说法应该是**：

| 项 | 6.42 的说法 | 事实 |
|---|---|---|
| `/v1/models` 是否列出这 12 个 | 我说「会列出」 | **仍未实测**（需要 API key 调这个接口）；代码上 `GetAvailableModels` 走 `hasAnyMapping` 分支直接取 mapping key，推断成立 |
| 这 5 个模型当前能否调用 | 我说「调不通」 | **未知**。入组后无 404、无成功记录 = 没人试过 |
| 客户端撞了 50 次墙 | 我说「撞了 50 次」 | 撞的是**当时不含 #2 的旧配置**，不是现在的配置 |

**这件事的教训**：跨时间的聚合数字（「某模型共 404 五十次」）**必须结合配置变更时间线**才能
解读。我查了 `ops_error_logs` 就下了结论，没查 `account_groups.created_at`——
而那张表恰好有一行能推翻整个判断。

**现在的真实状态**：`gpt-5.6-*` 这三个模型在账号入组后既没有成功记录也没有失败记录，
属于**未验证**，不是**不可用**。

### 6.44 追平管理员那 0.000524 —— 不是浮点误差，是我算错了（2026-11-15 第 38 轮）

6.38 我说管理员本人差 0.000524 美元，「判断是浮点舍入残差，找不到可复现来源」。
这轮把它追平了：**账其实是平的，错在我的算法。**

**关键在审计日志的 `extra.params.id`**：`path` 列是 gin 的路由模板
（`/api/v1/admin/users/:id/balance`），不含具体用户；但 `extra` 里存了 `{"params":{"id":"1"}}`。
按它分组，才看清 47 条余额操作分别是给谁的。

**用户 1 的 14 条操作里有一串天文数字**：

| id | 操作 | 金额 | HTTP |
|---|---|---|---|
| 456 | add | 100000000000000000000 | **500** |
| 457 | add | 100000000000000000000 | **500** |
| 458 | add | 10000000000000000 | **500** |
| 459 | add | 1000000000000 | **500** |
| 460 | add | 10000000000 | 200 |
| 593 | subtract | 9999999998.800524 | 200 |

`users.balance` 是 `numeric(20,8)`——整数部分只有 **12 位**，上限约 1e12。
所以前四条**被 Postgres 的 numeric overflow 挡回去了**（HTTP 500），只有 1e10 那条成功，
五天后用一条 9999999998.800524 精确扣回，净增 **+1.199476**。

**正确的平账**（用户 1）：

```
set 150（11-01 21:29，覆盖当时余额）
+ 手动净调整 72.799476   （含上面那 +1.199476）
− 消费 122.81097312
= 99.98850288              ← 与实际余额完全一致，分毫不差
```

**我 6.38 错在哪**：把兑换码的 222.80 算进了用户 1 的收入。但那 10 张兑换码是
**在 11-01 21:29 那次 `set 150` 之前用掉的**，`set` 是覆盖操作，把它们抹掉了。
多算 222.80 之后为了凑数，差额就恰好落在 0.000524 上——我还把它归因成浮点误差。

**六个用户现在全部精确平账**，包括管理员。

**顺带确认两件事**：

1. **数据库的数值上限是有效防线**：1e16 / 1e20 这四次操作被 `numeric(20,8)` 直接拒绝，
   返回 500，余额没被破坏。
2. **审计日志能区分「尝试」和「成功」**：靠 `status_code` 列（500 vs 200）。
   我一开始按 `request_body` 求和算出 2e20 这种荒谬数字，就是因为没过滤 `status_code`。

**这条给 6.38 收尾**：那 0.000524 从「未解释的推断」变成「已定位的算法错误」，结论改了。

### 6.45 `output_tokens = 16` 的成因查实了（2026-11-15 第 39 轮）

6.33 我把这 1,556 次「输出恒定 16 token」解释为 agent 循环，标的是**推断**。这轮查实了。

**它们是同一场密集会话，不是长期散布的零星请求。**

按 5 分钟窗口聚合（`api_key_id=5`）：

```
11-04 13:25   145 次
11-04 13:20   114 次
11-04 13:30    98 次
11-04 13:40    67 次
11-04 13:35    66 次
```

13:20–13:45 这 25 分钟里约 **490 次**调用。

**间隔分布**（相邻两次调用的时间差）：

```
2 秒   174
1 秒   166
0 秒   142
3 秒   129
4 秒   116
```

集中在 0–5 秒。**这不是定时任务**——定时任务的间隔会是某个固定值（60 秒、300 秒），
不会铺满 0 到 5 秒。这是「上一轮返回、立刻发下一轮」的循环。

**归属也很集中**：

| api_key | 次数 | 用户数 | 平均输入 | 平均缓存 | 总成本 |
|---|---|---|---|---|---|
| **5** | **1,552** | 1 | 2,962 | 66,352 | **$21.1674** |
| 4 | 4 | 1 | 3,204 | 28,896 | $0.0378 |

一个用户、一个 key，平均每轮带 2,962 token 输入 + 66,352 token 缓存，输出固定 16 个 token。

**结论**：这是 **agent 工具循环**的标准形态——每轮把完整上下文（大部分命中缓存）送进去，
模型返回一句工具调用或短确认（16 token ≈ 十几个字符），客户端立刻发下一轮。
1,552 次调用总共花了 21.17 美元，平均每次 1.4 美分。

**仍然不知道的**：那 16 个 token 的**具体文本**。网关只记录 token 数和成本，不存响应内容
（这是对的——存内容会带来隐私和存储问题）。所以「形态已确认，内容不可知」。

从 6.33 的「推断」升级为「形态已确认」。证据表里那一行相应调整。

### 6.46 活跃索引里那个残留是怎么来的（2026-11-15 第 40 轮）

6.37 查到 `concurrency:user:active_index` 里有一个用户 4 的成员，score 已过期 3.4 小时。
当时验证了「无害」（`ZCOUNT [now,+inf]` 返回 0），但没解释「为什么没被清掉」。这轮追完了。

**清理有两条路径，都是 best-effort。**

**路径一：显式释放时刷新**（`refreshActiveIndex`）

```go
load, err := c.readActiveLoadForKey(ctx, id, slotKey, waitKey, now)
member := strconv.FormatInt(id, 10)
if load.slotCount == 0 && load.waitCount <= 0 {
    if err := c.rdb.ZRem(ctx, indexKey, member).Err(); err != nil {
        logger.LegacyPrintf(...)   // 只记日志，不返回错误
    }
}
```

函数注释写得很清楚：「索引维护是 best-effort：失败只记日志，不影响主流程」。
所以**一次 ZRem 失败，成员就留在索引里了**。

**路径二：启动时清扫**（部署/重启触发）

```go
accountMembers, _ := c.allIndexMembers(ctx, accountActiveIndexKey)
c.cleanupStaleProcessSlotsForIndex(ctx, accountSlotIndex, accountMembers, ...)
userMembers, _ := c.allIndexMembers(ctx, userActiveIndexKey)
c.cleanupStaleProcessSlotsForIndex(ctx, userSlotIndex, userMembers, ...)
```

`cleanupStaleProcessSlotsForIndex` 对每个成员跑 `startupCleanupSlotScript` 清掉不属于当前进程的槽位，
`remaining == 0` 就把成员标成 stale 后删掉。**这条路径能自愈**。

**所以那个残留在的合理解释**：它在「上一次启动清扫之后、下一次启动清扫之前」产生，
且产生它的那次 `refreshActiveIndex` 的 ZRem 没有成功（best-effort 语义允许失败）。
中间没有重启，所以启动清扫没机会处理它。

**为什么这不算问题**：

1. **不影响正确性**：所有读索引的地方都用 `ZCOUNT [now, +inf]`，过期成员落在区间外（6.37 实测返回 0）
2. **不增长**：`ZADD` 对同一 userID 覆盖更新，每用户最多一个成员，上限是用户总数
3. **能自愈**：下次启动清扫会把它删掉

**结论**：这是 best-effort 语义下的正常残留，有明确的产生路径、明确的兜底机制、明确的恢复路径。
证据表里最后一条「推断」可以关掉了——**不是漏清，是允许失败的设计**。

### 6.47 上游修复：从「符号存在」升级到「行为通过」（2026-11-15 第 41 轮）

6.21 的比对是**符号级**的——「我们的树里有这个函数」。这轮改成**行为级**：
把上游修复自带的测试跑一遍，看实现是不是真的按要求工作。

**三个修复的验证结果**：

**① `slot-leak-on-hydrate-error`**

上游带了两个用例：hydrate 失败时必须释放已占槽位、hydrate 成功时不能提前释放。
我们的树里有等价测试（`gateway_scheduling_slot_release_test.go`），实跑：

```
--- PASS: TestGatewayServiceNewSelectionResultReleasesSlotOnHydrationError
--- PASS: TestGatewayServiceNewSelectionResultKeepsReleaseOnSuccess
```

**② `balance-recharge-multiplier-6-decimals`**

```
--- PASS: TestUpdatePaymentConfig_PersistsBalanceRechargeMultiplierWithUpToSixDecimals
          /six_decimals  /two_decimals  /float_artifact  /integer
--- PASS: TestUpdatePaymentConfig_RejectsBalanceRechargeMultiplierWithMoreThanSixDecimals
--- PASS: TestCalculateCreditedBalanceStillUsesRechargeMultiplier
```

四个子用例分别覆盖 6 位小数、2 位小数、浮点伪影（`0.140845` 这类）和整数，
**比上游那个 commit 测得更全**。

**③ `atomic-refresh-token-rotation`**

```
ok  github.com/daniei-chen/zhijing-gateway/internal/service      4.058s
ok  github.com/daniei-chen/zhijing-gateway/internal/repository   0.671s
```

**结论**：6.21 里说的「7 项已同步」中，这 3 项从「有对应实现」升级为
「**有等价测试且实测通过**」。剩下的 4 项（utf-8 校验、page-context、image-error-status、
usage index）仍然是符号级比对，没有做行为验证。

**这个差别值得说清楚**：符号存在只能证明「有人搬了这个函数」，测试通过才证明
「搬过来之后行为是对的」。前者可能因为上下文差异（类型、默认值、调用链）而失效，
后者不会。

### 6.48 上游七项修复的行为级验证补完：6/7 通过（2026-11-15 第 42 轮）

接着 6.47，这轮把剩下来的几项也跑了。

**④ `openai-responses-reject-invalid-utf8`**

上游的修复是在 JSON 转换**之前**加 `utf8.Valid(body)` 检查，避免畸形字节变成可重试的上游错误。
我们的树里 `openai_gateway_handler.go:449` 有这一行，测试也有：

```
--- PASS: TestOpenAIResponses_RejectsInvalidUTF8BeforeRouting
    子用例：//bbd8b8b4  //e4bd  //ff  ×  stream:false / stream:true
```

10 个子用例覆盖三种非法字节序列 × 两种 stream 模式，**全部通过**。

**⑤ `codex-page-context`**

```
ok  internal/handler  0.686s
```

**⑥ `native-image-error-status`**

```
ok  internal/service   25.902s
ok  internal/handler   0.834s
```

**⑦ `upstream-keys-usage-index`**

这一项不是行为而是结构：迁移文件可以不同（我们的编号体系与上游不同），
关键是索引在库里真的存在。6.21 已用 `pg_indexes` 确认 `idx_usage_logs_api_key_created_cost`，
这轮没再重复验证。

**汇总**：

| 上游修复 | 验证方式 | 结果 |
|---|---|---|
| slot-leak-on-hydrate-error | 等价测试实跑 | **PASS**（2 个） |
| balance-recharge-6-decimals | 等价测试实跑 | **PASS**（3 个，含 4 子用例） |
| atomic-refresh-token-rotation | 包级测试 | **ok**（service + repository） |
| reject-invalid-utf8 | 等价测试实跑 | **PASS**（10 个子用例） |
| codex-page-context | 包级测试 | **ok** |
| native-image-error-status | 包级测试 | **ok**（两个包） |
| upstream-keys-usage-index | 数据库结构 | 索引存在 |

**从「7 项符号级」变成「6 项行为级 + 1 项结构级」。**

这不改变「分叉仍然存在」这个事实——我们和上游没有共同祖先，同步是靠逐个搬运实现的。
但它把「搬过来了」升级成「搬过来的东西能跑」。

### 6.49 效率审视：1,785 次 429 全是本地并发限制，不是上游（2026-11-15 第 43 轮）

按 objective 里「更高效」那半句，查了三个点，其中一个查出了实质内容。

**① 429 的来源：全部是本地限制**

```
个人并发已达上限，请等待正在执行的请求完成后再试（上限 3）   1,429
Concurrency limit exceeded for user, please retry later          349
（上限 4）                                                          7
Weekly usage quota exhausted for this platform.                    1
```

**1,785 次里 1,785 次都是本地成员并发限制**，没有一次是上游限流。
也就是说：**网关自己成了瓶颈，不是上游**。

按天分布：

```
11-02   258     11-07    60
11-03    91     11-08   720   ← 单小时 610
11-04   429     11-09    77
11-05     5     11-11    44
11-06    37     11-12    19
                11-13     5
                11-14    40
```

**② 但这些历史 429 都发生在峰值放宽生效之前**

错误文案写的是「上限 3」，而 `GATEWAY_MEMBER_CONCURRENCY_LIMIT_PEAK=5` 是今天才配上的。
时间线上，11-02 到 11-14 的所有 429 都跑在「固定 3」的旧配置下。

所以准确的说法是：**旧的固定并发 3 确实是瓶颈，新的动态规则还没有被真实流量验证过**——
今天全天零请求，`≤1 活跃用户 → 5` 这条路径一次都没在生产上跑过。

**③ 动态规则的测试是完整的**

`TestEffectiveMemberLimit` 有 8 个子用例，全部 PASS：

```
peak 未配置时保持 base       peak 不大于 base 时视为未启用
无活跃用户可取 peak          单用户在跑仍可取 peak
已有两人在跑回落到 base      三人以上保持 base
读取失败回退 base            base 为 0 表示不限
```

读失败回退到 base 这点很重要——Redis 抖动时不会突然放宽到 5。

**④ 缓存创建不是浪费**

4,093 次带 `cache_creation_tokens` 的请求里：

- **3,911 次同时命中缓存**（平均读 125,586 token，创建 8,191）→ 增量追加，正常
- **182 次是纯创建**（`cache_read=0`）→ 新会话从头建

创建成本占总消费 **13.4%**（$202.23 / $1,509.04）。不创建就没有后续 96.8% 的命中，
这是必要投入，不是可优化项。

### 6.50 250ms 轮询上限值不值：算得出来（2026-11-15 第 44 轮）

上一轮留下的问题：`CONCURRENCY_OPENAI_POLL_MAX_INTERVAL_MS=250`（代码默认 2000）
该不该恢复默认。这轮把它算清楚了。

**相关常量**（`gateway_helper.go`）：

```
initialBackoff     = 100ms
maxBackoff         = 2s        ← 代码默认的轮询上限
maxConcurrencyWait = 30s       ← 单次等待的总预算
nextBackoff        = 当前值 × 1.5，封顶 pollMaxInterval
```

**两种配置的退避序列**：

| 上限 | 序列 | 到稳态 | 30 秒内重试次数 |
|---|---|---|---|
| **250ms** | 100 → 150 → 225 → 250 → 250… | 3 次 / 475ms | **约 121 次** |
| **2000ms** | 100 → 150 → 225 → 337 → 506 → 759 → 1139 → 1708 → 2000… | 8 次 / 4.9s | **约 20 次** |

**代价**：每次重试是一次 `AcquireUserSlot`（Lua 脚本 + Redis 往返）。比值 121 : 20 ≈ **6 倍**。

**收益**：槽位释放后多久能被发现——最坏 250ms vs 2000ms，**省 1.75 秒**；平均省 0.875 秒。

**用生产数据折算 Redis 代价**：

1,785 次请求等满 30 秒后被拒（429），每次约 121 次重试 → 约 **21.6 万次** Redis 调用。
若用 2000ms 上限则是 3.7 万次，**多出 17.9 万次**。

摊到 14 天：17.9 万 / 14 / 86400 ≈ **0.15 QPS**。

**判断：保留 250ms。**

多出的 Redis 压力是每秒 0.15 次——低于任何有意义的阈值；换来的是每个排队请求最多少等 1.75 秒。
这个方向的取舍是对的：**在排队真实发生的场景下（1,785 次被拒证明它真实发生），
把延迟压下来比省几次 Redis 调用更值。**

**边界**：这是**推算**，不是实测。反事实（「如果当初是 2000ms 会怎样」）在生产上无法测量。
如果将来并发用户变多（比如 10 个请求同时排队），Redis 压力会线性上升：
10 个并发等待 × 4 QPS ≈ 40 QPS，那时值得重新评估。

### 6.51 数据库约束核对：孤儿 Key 的根源在 `ON DELETE SET NULL`（2026-11-15 第 47 轮）

逐表查了外键约束（全库 84 个外键，分布在 50 张表）。最相关的一条：

```
api_keys_group_id_fkey | FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
```

**这就是 11-14 那次事故的数据库层面机制**：删分组时，Postgres 会自动把
`api_keys.group_id` 置成 NULL，Key 立刻变成孤儿——应用层再也没法从 `group_id` 找到分组，
调度器只能返回「No available OpenAI accounts」。

**v0.1.14 的应用层保护（有 Key 绑定就拒绝删除）之所以必要**，正是因为它阻止了这个 SET NULL。
不是应用层多此一举，是数据库默认行为太宽松。

**顺手确认了 NULL 不是合法状态**：

```
api_keys 活跃 6 个，group_id IS NULL 的 0 个
```

6 个 Key 全部有分组。也就是说 `group_id = NULL` 在当前系统里**只代表孤儿**，
不存在「故意不设分组」的合法场景。

**所以可以再加一道保险**：把约束改成 `ON DELETE RESTRICT`，让数据库也拒绝删除仍有 Key 的分组，
与应用层保护形成双保险。**这轮没有执行**，因为：

- 应用层已经拦住（v0.1.14），DB 层属于冗余加固，不是修复现有缺陷
- 改约束要迁移 + 发版，而 `api_keys` 有 12 行，`ALTER TABLE` 虽然瞬间完成，仍是一次 schema 变更
- 收益是「如果将来有人绕过应用层（直接 SQL、新代码路径漏检）时兜住」

**另外两条也是好消息**：

`usage_logs` 的外键设计是**保护账务**的：

```
usage_logs_user_id_fkey     → ON DELETE RESTRICT
usage_logs_api_key_id_fkey  → ON DELETE RESTRICT
usage_logs_account_id_fkey  → ON DELETE RESTRICT
usage_logs_group_id_fkey    → ON DELETE SET NULL
```

用户、Key、账号都是 **RESTRICT**——**有用量记录就删不掉**。而 `billing_usage_entries` 那几条
是 CASCADE，看似危险，但 `usage_logs` 的 RESTRICT 会先拦住删除动作，
所以级联永远走不到。**账务历史有数据库层面的硬保护。**

`users` 表有 1 条软删除记录（`deleted_at` 非空），软删除不动行、不触发外键，所以不受影响。

### 6.52 唯一性核对：差点因为查错了表而误判（2026-11-15 第 48 轮）

先查数据，五个关键字段**全部无重复**：

```
users.email              0 组重复
api_keys.key             0 组重复
groups.name              0 组重复
accounts.name            0 组重复
usage_logs.request_id    0 组重复
```

然后查 `pg_constraint` 里的 UNIQUE 约束——**没找到 `users.email` 和 `groups.name`**，
一度以为「这两个字段没有唯一约束，靠应用层检查，存在并发写入重复的窗口」。

**查索引才发现我查错了地方。** 唯一性是以**部分唯一索引**的形式实现的：

```sql
users_email_unique_active   UNIQUE (email) WHERE deleted_at IS NULL
groups_name_unique_active   UNIQUE (name)  WHERE deleted_at IS NULL
idx_groups_duplicate_operation_id_active  UNIQUE (duplicate_operation_id) WHERE ... deleted_at IS NULL
uq_accounts_spark_shadow_per_parent       UNIQUE (parent_account_id) WHERE ... deleted_at IS NULL
```

`pg_constraint` 只看得到表级/列级 `UNIQUE` **约束**，**看不到 `CREATE UNIQUE INDEX`**。
这个系统用「软删除 + 部分唯一索引」的组合，正是正确做法：

- 未删除的行里 email 唯一（`WHERE deleted_at IS NULL`）
- 删掉的行保留历史，不占用 email

**差点写进报告的错误结论**：如果止步于 `pg_constraint`，我会说「users.email 缺唯一约束」——
一个看起来严重、实际完全错误的发现。

**`accounts.name` 确实没有唯一索引**，这是**有意的**：

```
1  ChatGPT Pro 200
2  ChatGPT pro 200      ← 仅大小写不同，共存
3  API
```

账号名允许重复（管理员可能建多个同名账号指向不同凭证），唯一性对账号没有业务意义。

**结论**：关键业务字段的唯一性都有数据库层保护，实测数据也没有任何重复。
唯一性缺口不存在——但我差点因为查错元数据表而报一个假问题。

### 6.53 软删除的分组仍可被调度——但入口已经堵死（2026-11-15 第 49 轮）

追孤儿 Key 的历史痕迹，撞到一个机制细节。

**11-14 的时间线重建**：

```
19:10  事故，141 条 503
19:35  keys.create {group_id:3, name:"key2"}
20:01  admin.groups.delete（删分组 3「API 200美元」）→ HTTP 200
20:13  key 3 改到 group_id=2
20:50  key 5 改到 2
20:56  key 12（key2）成功调用 3 次        ← 此时它仍指向已删的分组 3
20:58  key 12 改到 2
```

**`admin.groups.delete` 是软删除**（`UPDATE groups SET deleted_at`），行还在，
所以**外键不触发**，`api_keys.group_id` 保持 3。

**而调度查询不看分组的 `deleted_at`**：

```go
q := r.client.AccountGroup.Query().Where(dbaccountgroup.GroupIDEQ(groupID))
preds = append(preds, dbaccount.DeletedAtIsNil())   // 只看账号自己有没有删
```

它按 `group_id` 查 `account_groups` 中间表，**从不检查这个分组是否已被软删除**。

所以 20:56 那次调用能成功——**指向已删分组的 Key 仍然在正常调度、正常计费**。
管理员以为删掉分组就停用了服务，实际没有。

**但当前无风险，因为入口已经堵死**：v0.1.14 之后「有 Key 绑定的分组不允许删除」，
所以**不可能再产生**「Key 指向已删分组」的状态。实测 6 个活跃 Key 全部 `group_id=2`，
没有任何一个指向已软删的分组（1 和 3）。

**性质判断**：这不是待修的缺陷，是**一个依赖应用层保证的不变量**。数据库和查询层都不拦，
挡住的只有 `DeleteGroup` 那一处检查。如果将来有人写新代码路径删分组（或直接跑 SQL），
这个不变量就破了，而且破了之后不会有任何报错——只有「删了还在跑」这种沉默的错。

**没动手改**：给 `queryAccountsByGroup` 加 `deleted_at IS NULL` 检查属于安全加固，
但它会改变「软删分组下的 Key 立即失效」这个行为（现在是继续可用），
而这个行为在某些恢复场景下可能是有意的（误删后先把分组恢复，期间服务不断）。
该不该改是产品判断，不是审计能定的。

### 6.54 给巡检加了一项：活跃 Key 指向已软删分组（2026-11-15 第 52 轮）

6.53 发现一个**不产生任何错误信号**的状态：软删的分组仍会被调度。
v0.1.14 用「有 Key 的分组禁止删除」堵住了入口，但那是 `DeleteGroup` 一处检查，
数据层和查询层都不拦。

这轮把它变成一个**可观测项**，加进 `japan_maintenance.py` 的巡检：

```sql
select count(*) from api_keys k join groups g on g.id = k.group_id
where k.deleted_at is null and g.deleted_at is not null
```

- 结果为 0 → `key_group_ok = true`
- 不为 0 → `key_group_ok = false`，跟着 watchdog 的失败集合走，会写进
  `ops_system_logs`，配了 webhook 就推送

**实测**：

```
key_group_ok            = True
keys_on_deleted_groups  = 0
```

当前干净，没有任何活跃 Key 指向已软删的分组。

**为什么值得加**：这个状态的特征是「删了但还在跑」，**不会触发任何错误**——
没有 5xx、没有拒绝、没有延迟变化。靠人去看是发现不了的，只能靠主动查询。

**改动性质**：纯巡检（只读查询 + 结果写日志），
不需要发版、不影响任何请求路径、失败时 `key_group_ok = None` 而不是报错。
备份在 `japan_maintenance.py.bak-round52`。

### 6.55 巡检再加一项：账务台账一致性（2026-11-15 第 53 轮）

先确认了 `billing_ok` **已经**在查 `billing_failures where status='pending'`（脚本第 248 行），
所以「漏扣无人知」这条其实早就有监控——我之前列清单时低估了它。**没有重复造轮子。**

缺的是另一条：**每一行 `usage_logs` 是否恰好对应一条去重记录**。
这是「没有重复计费、没有漏计」的唯一证据，第 24 轮我手工算过一次（36,410 = 36,410），
但**没有任何东西持续盯着它**。

**不变量要写成 `usage = dedup + archive`**，不是 `usage = dedup`：两张表保留期不同，
`usage_logs` 30 天先清理，`dedup` 365 天后归档到 `usage_billing_dedup_archive`。
直接比 `usage` 和 `dedup` 会在第一次清理之后就开始误报。

```sql
select (select count(*) from usage_logs)
     - (select count(*) from usage_billing_dedup)
     - (select count(*) from usage_billing_dedup_archive)
```

**实测**：

```
ledger_ok              = True
ledger_delta           = 0
key_group_ok           = True
billing_ok             = True
billing_failures_pending = 0
gateway_ok             = True
accounts_ok            = True
failed_set             = None
```

**巡检项 11 → 13**（第 52 轮加 `key_group_ok`，本轮加 `ledger_ok`），全部为绿。
备份 `japan_maintenance.py.bak-round53`。

**这一项能抓到什么**：如果某次 `Apply` 在写 `usage_logs` 之后、写 dedup 之前崩了，
或者反过来，`ledger_delta` 就不再是 0。它是账务侧第一个**主动**的完整性检查
（之前只有 `billing_failures` 那种被动的失败记录）。

### 6.56 我误判了一个「缺软删除过滤」的 bug，改了代码又撤回（2026-11-15 第 54 轮）

**这轮我改了一行代码，然后自己把它撤回了。**

**起因**：查「账号有 error_message 但仍在调度池」这个静默异常时，发现
`accounts` 表里有两个已软删的账号（id 1 于 11-02、id 3 于 11-12），但它们的
`status` 仍是 `active`、`schedulable` 仍是 `true`。

接着读 `schedulableAccountsQuery`（`ListSchedulable` / `ListSchedulableAccountLoads` 的查询构造器），
谓词列表里有 status、schedulable、temp_unschedulable、expires、overload、rate_limit——
**没有 `DeletedAtIsNil()`**。

对照 `queryAccountsByGroup`（按分组调度），它**有**这一条。看起来像明确的不一致。

**然后我用原生 SQL 算了两组数**：

```sql
count(*) FILTER (WHERE deleted_at IS NULL)  →  1 个账号 / 容量 10
count(*)                                     →  3 个账号 / 容量 26
```

看起来坐实了：模型列表和容量指标会把已删账号算进去，虚高 2.6 倍。

**我改了代码**：在 `schedulableAccountsQuery` 里加上 `dbaccount.DeletedAtIsNil()`，
写了一段注释说明「实测 1 被算成 3」，`go build` 通过，`go test ./internal/repository/` 通过。

**然后我验证了修复是否必要**——把改动 stash 掉，用原有代码跑测试：

```
=== RUN   TestListSchedulableAccountLoadsUsesSingleProjectionQuery
--- PASS: TestListSchedulableAccountLoadsUsesSingleProjectionQuery (0.00s)
```

**没有我的修复，测试照样通过。** 而且那个测试第 75 行的断言列表里**本来就写着 `"deleted_at"`**——
它要求 SQL 里出现这一列。也就是说，**修复之前的 SQL 里已经有 `deleted_at`**。

**查 schema 才明白**：

```go
// backend/ent/schema/account.go
mixins.SoftDeleteMixin{},   // 提供软删除功能（deleted_at）
```

**ent 的 `SoftDeleteMixin` 会自动给所有查询加 `deleted_at IS NULL`。** 显式写
`dbaccount.DeletedAtIsNil()` 是冗余的（`queryAccountsByGroup` 里那条也是冗余，只是无害）。

**我错在**：用**原生 SQL** 去模拟一个 **ORM 查询**的行为。SQL 直查当然会算上已删行，
但 ORM 不会。那个「1 vs 3」根本不能证明 `ListSchedulable` 的行为。

**处理**：`git checkout -- backend/internal/repository/account_repo.go` 还原。

**这是第三次同类错误**，前两次是 6.43（跨时间聚合）和 6.44（覆盖语义），
这次的形状是**跨抽象层**：用 SQL 层的观测去推断 ORM 层的结论。
三次的共同点都一样——**用一个便宜的口径去替代真实的执行路径**。

### 6.57 `ops_system_logs` 的 94 条 error：主要是价格表在只读文件系统上挣扎（2026-11-15 第 55 轮）

这是唯一还没系统查过的日志表。`warn` 4,549 条、`error` **94 条**，error 少到可以逐条看。

**94 条的构成**：

| 组件 | 消息 | 次数 | 最后 |
|---|---|---|---|
| `service.pricing` | Failed to fetch remote hash（拉 GitHub） | 57 | 11-02 |
| `stdlog` | exchange-code 失败 | 9 | 11-02 |
| `service.pricing` | **Failed to save hash: read-only file system** | 7 | 11-14 02:55 |
| `service.pricing` | **Failed to save file: read-only file system** | 7 | 11-14 02:55 |
| `stdlog` | balance: numeric field overflow | 4 | 11-05 |
| 其余 | context canceled / 超时 / 单次 | 10 | — |

**一半的 error（71 条）来自价格表服务。**

**只读那 14 条是什么**：pricing 服务尝试把拉下来的价格表写回 `data/model_pricing.json`，
但容器根文件系统是只读的（`ReadonlyRootfs=true`），写入被拒。

**但当前容器其实是可写的**：

```
bind /opt/zhijing-sub2api/upgrade-v0011/data -> /app/data rw=true
docker exec ... touch /app/data/.write-probe  →  WRITABLE
```

`/app/data` 是**独立 bind mount**，`rw=true`。所以那 14 条错误都发生在 11-14 02:55 之前——
旧容器的挂载方式不同。**v0.1.19 之后没有新的只读错误。**

**但更重要的一件事实**：价格表文件的修改时间是 **Nov 14 02:50**，正等于 v0.1.19 的镜像构建时间。
也就是说：

**价格表从来没有在运行时更新成功过。** 它跟着镜像走——每次发版打进去一份，运行期一行都没变。

这不是缺陷（价格表本来就是镜像内嵌、随版本发布），但它意味着：
- **上游调价后，必须重新发版才能生效**，不会自动跟
- 那 57 次「Failed to fetch remote hash」+ 14 次「read-only」说明这套运行时更新链路
  **一直在尝试、一直在失败、失败了只记日志**

**判断**：功能上无害（价格表跟着镜像走是对的），但**代码在做一个注定失败的动作并留下错误记录**。
要清掉这个噪音，得让 pricing 服务在只读环境下跳过写入——那是代码改动，需要发版。
现在把它记下来，不改。

**顺带确认**：`numeric field overflow` 那 4 条就是 6.44 里追过的天文数字余额操作（1e16 / 1e20），
数据库拦住了，符合预期。

### 6.58 `warn` 4,549 条逐层看：全是预期内的降级（2026-11-15 第 56 轮）

`handler.openai_gateway.*` 占了 4,298 条，按消息聚合：

| 消息 | 次数 | 是什么 |
|---|---|---|
| `user_slot_acquire_failed` | **1,842** | 并发槽位抢不到（与 1,785 次 429 吻合） |
| `account_select_failed` | **779** | 没有可用账号（与 503 吻合） |
| `upstream_failover_switching` | 587 | 上游失败后切号——**正常降级** |
| `read request body failed` | 452 | 请求体读到一半失败 |
| `pool_mode_same_account_retry` | 393 | 池模式重试同账号——**正常降级** |
| `websocket_read_first_message_failed` | 165 | WS 首帧读取失败 |

**四条主要消息都能对上已知现象**，没有一条是新问题。

**`read request body failed` 单独查了**：`extra` 里只有 path / method / user_id，
没有具体错误原因，但其中一批带 `"status": 499`——**499 是「客户端主动断开」**。
154 次落在 `/v1/chat/completions`（user 2）、49 次 `/v1/responses`（user 2）。
这是浏览器关闭、用户取消、客户端超时这一类的正常现象，用 `warn` 记录也恰当。

**结论：日志分级是健康的。**

- `error` 只有 94 条，其中 71 条是价格表服务的历史噪音（6.57）
- `warn` 记录的是「降级发生了但请求还活着」——并发排队、切号、客户端断开
- 没有「同一个 error 反复刷屏」的模式

**这轮没找到问题，但确认了一件有价值的事**：这个系统的日志没有把正常降级当错误报，
也没有把真实故障降级成 warn 藏起来。**噪音比是合理的**——4,549 条 warn 里没有一条需要人去看，
94 条 error 里 71 条可以忽略、23 条是零散的真实事件。

### 6.59 审计日志：716 条管理操作，511 条 admin 里只有 1 条没有操作者——那是我自己（2026-11-15 第 57 轮）

按 action 聚合 `audit_logs`：

| action | 次数 | 操作者数 |
|---|---|---|
| `admin.accounts.today_stats.batch.create` | 139 | 1 |
| `admin.accounts.usage.batch.create` | 130 | 1 |
| `auth.login` | 91 | — |
| `usage.dashboard.api_keys_usage.create` | 60 | 5 |
| `admin.users.balance.create` | 47 | 1 |
| `keys.create` | 12 | 5 |

按操作者：

```
2421873411@qq.com        534 条 / 39 种操作   ← 主管理员
（空）                    124 条 / 25 种操作
947255094@qq.com          29 条
jifengxian1224@gmail.com  14 条
其余 3 个用户              16 条
```

**124 条空操作者全部是认证类**：`auth.login` 91、`auth.token.refresh` 10、
各种 `auth.oauth.*` 流程。这些发生在认证完成之前，本来就没有身份——**合理**，
而且它们带着 IP 和 UA，仍可追溯。

**然后查了「管理操作里有没有漏掉操作者的」**：

```
admin.* 共 511 条
其中无 actor：1 条
```

**这一条是我自己留下的**：

```
id    717
action admin.api_key.request
path   GET /api/v1/admin/settings/admin-api-key
status 401
ip     172.19.0.1
time   11-15 05:40:45
```

**这正是第 33 轮我用伪造的 `adm_sc_` 前缀 key 去探测认证边界那一次。**

它同时印证了两件事：

1. **审计覆盖认证失败**——401 的请求也被记录了，不是只记成功操作
2. 无操作者是**正确**的——这次请求根本没通过认证，没有身份可言

**结论**：审计日志是完整的。511 条管理操作里，510 条有明确操作者，
唯一空缺那条是一个 401 的探测请求，它的「无操作者」恰恰是事实。

**顺带看到一个使用特征**：这个系统的管理几乎全部由一个人完成（534/716 = 75%），
而且前两项 action 是批量查询统计（269 条）——说明管理员主要通过后台观察状态，
而不是频繁改动配置。

### 6.60 覆盖率测绘：72.8% / 56.6% / 33.3%，以及一个零测试的服务（2026-11-15 第 58 轮）

三个核心包的实测覆盖率：

```
internal/service     72.8% of statements    243s
internal/handler     56.6%                 71s
internal/repository  33.3%                 12s
```

**repository 33.3% 不代表风险高**：它大部分是 SQL 构造，真正的数据库行为靠集成测试
（需要 `integration` tag + 真实 PG），单测覆盖不到是正常结构。

**service 里 1,329 个函数覆盖率 0%**，逐个筛掉 `Get*` / `Is*` / `Has*` 这类简单取值之后，
剩下的值得注意的只有几个：

| 函数 | 说明 |
|---|---|
| `account_expiry_service.go` 全部（New / Start / Stop / runOnce） | **整个服务零测试** |
| `CheckWindowCostSchedulability` | 调度相关（窗口成本可调度性） |
| `account_service.go` 的 List / UpdateStatus / UpdateLastUsed | 简单 CRUD |

**`AccountExpiryService` 是唯一「完整服务零测试」的模块**，它每天在跑——自动暂停过期账号。
所以查了它真正做事的地方（`AutoPauseExpiredAccounts` 的 SQL）：

```sql
UPDATE accounts SET schedulable = FALSE
WHERE deleted_at IS NULL
  AND schedulable = TRUE
  AND auto_pause_on_expired = TRUE
  AND expires_at IS NOT NULL
  AND expires_at <= $1
```

**五个条件全部收紧**：排除已删、只在当前可调度时、只对显式开启自动暂停的账号、必须有到期时间、
必须真的过期。逻辑没问题。

**实测当前会被暂停的账号数：0**。

**结论：低风险，不是缺陷。** 服务本身是薄壳（一个 ticker + 一次 repo 调用），
真正的判定逻辑在那个 SQL 里，而 SQL 是正确的。

**唯一潜在隐患**：`Stop()` 用了 `stopOnce`，`stopCh` 只能关闭一次。如果先 `Stop` 再 `Start`，
`select` 会立刻命中已关闭的 channel，goroutine 直接退出——服务**静默地不再工作**。
实际使用中 `Stop` 只在进程退出时调用，不会重启，所以这不会发生。但如果将来有人写
「热重载配置」之类的逻辑去 Stop/Start，就会踩到。记在这里。

### 6.61 handler 的 241 个零覆盖函数：API Key CRUD 全无测试，但越权保护是对的（2026-11-15 第 59 轮）

`internal/handler` 覆盖率 56.6%，241 个函数 0% 覆盖。筛掉简单取值和 admin 包之后，
最值得看的是**用户管理 API Key 的核心接口**：

```
api_key_handler.go  List      0.0%
api_key_handler.go  Create    0.0%
api_key_handler.go  Update    0.0%
api_key_handler.go  Delete    0.0%
```

**这是「用户可以删别人 Key 吗」这类问题的所在**，所以直接读了删除路径。

**handler 只做转发，归属检查在 service**：

```go
// api_key_handler.go
err = h.apiKeyService.Delete(c.Request.Context(), keyID, subject.UserID)

// api_key_service.go:949
key, ownerID, err := s.apiKeyRepo.GetKeyAndOwnerID(ctx, id)
if ownerID != userID {
    return ErrInsufficientPerms      // ← 越权在这里被挡住
}
s.apiKeyRepo.DeleteWithAudit(ctx, id)    // 事务内：写审计 + 软删除
s.InvalidateAuthCacheByKey(ctx, key)     // 删除成功后才清缓存
s.lastUsedTouchL1.Delete(id)
```

**四点都做对了**：

1. **归属检查**：`ownerID != userID` 直接拒绝，不是「查不到就删」
2. **软删除 + 审计在同一事务**：不会出现「删了但没审计」
3. **缓存清理放在删除成功之后**：注释写了「避免缓存已清但删除失败」的竞态
4. **不清零创建计数**：注释写明「否则删除后反复新建即可绕过创建限流」

**结论：零测试，但逻辑正确。** 这是第 58 轮之后第二个同类结论——
覆盖率低不等于有缺陷，但这四个函数的**回归保护确实是空的**：任何人改动这段代码，
没有任何测试会拦住他。

**其余 0% 覆盖的大多是未启用的登录方式**（`auth_dingtalk_*`、`auth_linuxdo_*` 等），
以及 `announcement_handler`（公告功能，当前无公告数据）。

**建议（未实施）**：`api_key_service.Delete` 的归属检查值得一个测试——
它是唯一的越权防线，而现在它只靠代码审查保护。这是我在 59 轮里第一次明确建议
「加测试」而不是「改实现」，因为实现是对的。

### 6.62 纠正 6.61：API Key 的删除**有**完整测试，我说「回归保护是空的」是错的（2026-11-15 第 60 轮）

**上一轮的建议建立在错误前提上，撤回。**

6.61 我说「`api_key_handler` 的 CRUD 四个方法零覆盖，所以归属检查只靠代码审查保护，
建议加测试」。这轮准备动手写测试，先查了一下——**测试文件早就在**：

```
backend/internal/service/api_key_service_delete_test.go   17,662 字节
  TestApiKeyService_Delete_OwnerMismatch      ← 越权测试在
  TestApiKeyService_Delete_Success
  TestApiKeyService_Delete_NotFound
  TestApiKeyService_Delete_DeleteFails
```

跑了一遍，四个全 PASS。

**我错在**：只看了 `internal/handler` 的覆盖率报告（那是 0%），**就断言整个删除路径没有测试**。
而实际上：

- `handler` 层的 0% 是真的——它只有解析参数、调 service、写响应，**没人测 HTTP 包装**
- `service` 层的归属检查**有 4 个测试**，正好覆盖越权拒绝、正常删除、找不到、删除失败

**回归保护不是空的**。`ownerID != userID` 那条线有一整个测试盯着。

**这是我第四次同类误判**：

| 轮次 | 用一个层的观测推断另一层 |
|---|---|
| 36 | 用历史聚合推断当前状态 |
| 30 | 用增量语义解读 `set` 操作 |
| 54 | 用原生 SQL 推断 ORM 行为 |
| **60** | **用 handler 覆盖率推断 service 测试覆盖** |

形状完全一致：**在一个便宜的位置测量，然后对另一个位置下结论**。
这次更蠢——那个测试文件的名字就叫 `api_key_service_delete_test.go`，`ls` 一下就能看到。

**更正后的结论**：`api_key_handler` 的四个方法确实没有 HTTP 层测试，
但它们调用的 service 方法有测试，**核心安全逻辑是被覆盖的**。
要不要补 handler 层的测试是另一回事（成本高、收益低——handler 不做判断，只做转发）。

### 6.63 `/v1/live` 端点可用但完全不计费——作者自己标注的、61 轮里最实质的一处（2026-11-15 第 61 轮）

扫全仓 13 条真 TODO（过滤掉注释里的 `xxx` 占位符），最重的一条在 `openai_live.go:830`：

```
// TODO(billing): Live 会话目前不计费：TotalCost/ActualCost 恒为 0，完全绕过
// recordUsageCore/applyUsageBilling，余额模式下极低余额也能反复开启最长
// liveMaxSessionDuration 的会话。若确认按时长计费，应在此接入计费管道；
// 若确认有意免费，删除本注释即可（零值行为由
// TestFinalizeLiveCallIsIdempotentAndWritesZeroUsage 锁定）。
```

**这不是我的推断，是代码作者自己写的。** 我做了三步核实：

**① 端点确实对外可用**

```go
// gateway.go:213
gateway.POST("/live", h.OpenAIGateway.Live)
gateway.GET("/live/:call_id", h.OpenAIGateway.LiveSideband)
```

`gateway` 组挂了 `apiKeyAuth`，所以**任何持有 API Key 的用户**都能调用。

**② 它写用量日志，但金额恒为 0**

`writeUsageLogBestEffort` 会插一条 `usage_logs`，但 `TotalCost` / `ActualCost` 保持零值——
完全跳过 `applyUsageBilling`。

**③ 生产上从未被使用过**

`usage_logs` 的 `request_type` 分布：

```
2 (stream)   36,275 条   $1,505.33
1 (sync)        135 条   $3.71
```

**没有任何 `live` 记录**（`ParseUsageRequestType("live")` 对应的值一次都没出现过）。

**这意味着什么**：

- **当前没有收入损失**——没人用过
- **但门是开的**：持有 Key 的人只要发现 `/v1/live`，就能无限免费跑实时会话，
  而且低余额账号也拦不住（不计费 = 余额检查也不起作用）
- 每次会话上限是 `liveMaxSessionDuration`，但可以反复开

**为什么没动手修**：注释里那句「若确认有意免费，删除本注释即可」说明
**这是产品决策，不是遗漏**。三条路都不该我选：

1. 接入计费——要设计按时长计费的管道，工作量大
2. 禁用端点——如果这是准备上线的功能，禁了会打断计划
3. 保持免费——那就该把注释改成明确的「有意免费」

**我建议第 3 条或第 2 条，但决定权在主人。** 这里只把事实摆清楚：
**一个不计费的功能端点，正在对任何持 Key 的用户开放，而它从未被使用过。**

### 6.64 分组统计接口返回硬编码 0，但前端根本没调用它（2026-11-15 第 62 轮）

`group_handler.go:932` 的 `GetStats`：

```go
// GET /api/v1/admin/groups/:id/stats
groupID, err := strconv.ParseInt(c.Param("id"), 10, 64)
...
// Return mock data for now
response.Success(c, gin.H{
    "total_api_keys":  0,
    "active_api_keys": 0,
    "total_requests":  0,
    "total_cost":      0.0,
})
_ = groupID // TODO: implement actual stats
```

**无论哪个分组、实际有多少 Key 和请求，这个接口永远返回全零。**

**但查了前端：没有任何组件调用它。**

```
frontend/src/api/admin/groups.ts:248   export async function getStats(id)
frontend/src/api/admin/groups.ts:486   getStats,        ← 只在导出对象里
（.vue 组件里零调用）
```

真正被用的是**另一个**接口：

```
frontend/src/api/admin/dashboard.ts:162  getGroupStats() → /admin/dashboard/groups   ← 真实数据
```

**所以这是个死接口**：后端返回假数据、前端定义了函数但没人调。**用户看不到任何错误数字。**

**同一组里的其他统计接口都是真的**：

| 接口 | 实现 |
|---|---|
| `GET /groups/:id/stats` | **硬编码 0** ❌ |
| `GET /groups/usage-summary` | `dashboardService.GetGroupUsageSummary` ✅ |
| `GET /groups/capacity-summary` | `groupCapacityService.GetAllGroupCapacity` ✅ |
| `GET /groups/:id/api-keys` | 真实查询 ✅ |

**结论：无害，但建议删掉。** 理由不是「它会显示错数字」（它不会，没人用），
而是「它留在代码里会让下一个接手的人以为分组统计是坏的」，或者花了时间接上才发现
前端从来没用过。删一个没人调用的接口是零风险的，但那是代码改动，需要发版，这轮不动。

**这轮的方法值得记一笔**：从 TODO 出发 → 读实现（确认返回假数据）→ **查前端调用方**（确认无人使用）。
三步里最有价值的是第三步——如果只做前两步，我会报一个「用户看到全零」的假问题，
和 6.42 那次（拿历史 404 当当前故障）是同一个错误。

### 6.65 「刷新账号凭证」是个空壳，但没有路由调用它（2026-11-15 第 63 轮）

`admin_account.go:1309`：

```go
func (s *adminServiceImpl) RefreshAccountCredentials(ctx context.Context, id int64) (*Account, error) {
	account, err := s.accountRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// TODO: Implement refresh logic
	return account, nil          // ← 读出来原样返回，什么都没刷新
}
```

**这个比 62 轮那个更危险的功能形态**：如果它有对外接口，管理员点「刷新凭证」会拿到
`200 OK` 和一份看起来正常的账号数据，**以为刷新成功了，实际什么都没发生**。
「假成功」比「返回错误」更糟——错误至少会被人看见。

**但查了调用链——它没有对外接口**：

```
admin_account.go:1309   func (s *adminServiceImpl) RefreshAccountCredentials
admin_service.go:101    接口声明
（handler 层：零调用；路由：不存在）
```

只有实现和接口声明两处引用，**没有任何 handler 方法调用它，也没有注册路由**。

**所以这是死代码**：空壳实现 + 没人能用。

**和 62 轮那个 mock 统计接口是同一类**：功能没做完，但也没接上，所以不影响任何人。

**两轮下来一个有价值的观察**：13 条真 TODO 里，已经查的两条（mock 统计、空壳刷新）
**都是未接线的死代码**。这符合直觉——作者写 TODO 时通常知道「这个还不能上线」，
所以没接路由。真正危险的是那些**接了线但实现不全**的 TODO，比如 61 轮的 `/v1/live`：
它有路由、能调用、只是不计费。

**剩下还没查的 TODO** 里，`content_moderation.go:2039`（该禁用触发的 Key）最接近这一类——
它在审核流程里，如果确实接了线，就属于「行为不全但生效」的形状。下一轮查它。

### 6.66 唯一一条「接了线且真的被触发过」的 TODO：管理员违规 14 次，超阈值也没事（2026-11-15 第 64 轮）

`content_moderation.go:2039` 的 TODO：

```go
if user.IsAdmin() {
    slog.Warn("content_moderation.autoban_skipped_admin", ...)
    // TODO: Disable the triggering API key instead when API key mutation is available here.
    return false        // 管理员不封号，也不做任何别的
}
```

**这条路径真的被执行过，我找到了完整证据链**：

```
审核配置:  auto_ban_enabled = true
          ban_threshold    = 10
          violation_window = 720 小时（30 天）

违规记录:  user 1 (管理员, 2421873411@qq.com)  14 次  最后 11-03
          user 2 (普通用户, 947255094@qq.com)   9 次  最后 11-08

当前状态:  user 1  active（没被封）
          user 2  active（9 < 10，未达阈值）
```

**管理员累计 14 次违规，超过阈值 10，四次跨过封禁线，但因为是管理员所以全部跳过。**
普通用户 9 次没到阈值，所以也无从对照。

**这是 13 条 TODO 里唯一一条「接了线、且真的被触发过」的**。前两条（62 轮 mock 统计、
63 轮空壳刷新）都是死代码；61 轮的 `/v1/live` 接了线但没人用过。只有这条——
**代码走到了那个分支，而且走了 14 次**。

**性质判断**：这是**有意的特权豁免**，不是缺陷。不能因为管理员自己的测试请求触发关键词
就把整个系统唯一的管理员账号锁死——那会让后台再也进不去。
TODO 那条注释（「改成禁用触发的 Key 而不是封人」）是个更好的设计，属于未完成的改进。

**风险**：当前只有一个管理员，且是系统主人，风险接近零。但如果将来有多管理员、或者
管理员账号被盗用，这个豁免就会让违规行为完全没有后果——**只剩一行 warn 日志**。

**没有改**：改这条要动封禁策略，属于产品决策。

### 6.67 「测试代理连接」永远是假成功，而它被真的点过 15 次（2026-11-15 第 65 轮）

`proxy_service.go:179`：

```go
func (s *ProxyService) TestConnection(ctx context.Context, id int64) error {
	proxy, err := s.proxyRepo.GetByID(ctx, id)
	if err != nil {
		return fmt.Errorf("get proxy: %w", err)
	}
	// TODO: 实现代理连接测试逻辑
	_ = proxy
	return nil          // ← 永远成功，一次网络请求都没发
}
```

**这次不是死代码，是真的在用。**

**接线完整**：

```
路由     admin.go:536   proxies.POST("/:id/test", h.Admin.Proxy.Test)
前端     ProxySelector.vue:266   adminAPI.proxies.testProxy(proxy.id)
         ProxiesView.vue:1572    adminAPI.proxies.testProxy(proxyId)
         ProxySelector.vue:284   批量测试：props.proxies.map(handleTestProxy)
```

**审计日志确认被调用 15 次**：

```
11-11 23:52:25  POST /api/v1/admin/proxies/:id/test  200
11-11 23:52:24  POST /api/v1/admin/proxies/:id/test  200
11-10 01:11:16  POST /api/v1/admin/proxies/:id/test  200
...
```

**所以：管理员在后台点「测试代理」15 次，每次都看到成功，而实际上一次网络请求都没发出。**

**当前有没有造成损害**：1 个活跃账号配置了代理，而它的请求是成功的——
**代理可能真的可用**。也就是说，这 15 次假测试没有骗到人，纯粹是运气好。

**风险**：如果代理真的失效，界面上「测试通过」会让人继续用它，
而代理失效的后果是请求走直连（**IP 暴露**）或全部失败。**这个功能存在的意义就是提前发现这种事，
而它什么都没发现。**

**为什么没改**：实现真正的代理测试要发 HTTP 请求验证连通性，涉及超时、认证、TLS 等细节，
是完整的开发任务，不是审计里顺手能补的。**记录，不修。**

**这是 65 轮里第二个「接了线、被使用、但实现是空壳」的功能**（第一个是本轮之前的
`content_moderation` 管理员豁免——那是有意的；这个是无意的）。它比 62/63 轮那两个死代码严重，
因为**用户真的按了那个按钮**。

### 6.68 账号「测试连接」也是空壳——16 次真实点击，全部假成功（2026-11-15 第 66 轮）

`account_service.go:502`：

```go
func (s *AccountService) TestCredentials(ctx context.Context, id int64) error {
	account, err := s.accountRepo.GetByID(ctx, id)
	if err != nil { return fmt.Errorf("get account: %w", err) }
	switch account.Platform {
	case PlatformAnthropic:
		// TODO: 测试Anthropic API凭证
		return nil                 // ← 永远成功
	case PlatformOpenAI:
		// TODO: 测试OpenAI API凭证
		return nil                 // ← 永远成功
	case PlatformGemini:
		// TODO: 测试Gemini API凭证
		return nil                 // ← 永远成功
	case PlatformGrok:
		// Grok OAuth credentials are validated via token exchange/refresh and request-path probes.
		return nil
	...
```

**接线完整，而且真的被点过**：

```
路由      admin.go:399   accounts.POST("/:id/test", h.Admin.Account.Test)
前端      AccountActionMenu.vue:16   「测试连接」按钮
审计日志  admin.accounts.test.create  16 次（11-09、11-10），全部 200
```

**我们的账号是 OpenAI 平台，正好走那个 `TODO: 测试OpenAI API凭证 / return nil` 分支。**

**所以：16 次「测试连接」全部是无条件成功，一次凭证校验都没做。**

**但要区分两种情况**——这个 switch 里有些 `return nil` 是**有意的**：

| 平台 | 行为 | 性质 |
|---|---|---|
| Anthropic / OpenAI / Gemini | `// TODO` + `return nil` | **未实现** |
| Grok | 注释说「靠 token 交换/刷新和请求路径探测验证」 | **有意** |
| TypeSafe | 注释说「API Key，靠推断失败驱动健康与冷却」 | **有意** |
| 多协议 API Key 供应商 | 注释说「靠余额/额度探测与转发路径验证」 | **有意** |

**作者在三种平台上明确写了替代验证路径，只在三种平台上留了 TODO。** 这不是随手糊的代码，
是分得清哪些能靠被动机制、哪些需要主动探测。

**和 65 轮的代理测试合起来看**，这两个「测试连接」按钮都是 UI 壳：

```
代理连接测试  15 次   永远成功   空壳
账号凭证测试  16 次   永远成功   空壳（OpenAI/Anthropic/Gemini）
```

**当前有没有造成损害**：没有。唯一的 OpenAI 账号请求是成功的，凭证本身有效。
但管理员这 31 次点击**没有得到任何信息**——他以为测过了。

**没改**：实现真正的凭证测试要给每个平台发一次最小请求（OpenAI 的 models 端点、
Anthropic 的 messages 端点等），涉及配额消耗和超时策略，是完整的开发任务。
**记录，不修。**

### 6.69 纠正 6.65 和 6.66：两个「假成功」都是错的，真实测试一直工作正常（第 1 轮 / 256）

**我在 65、66 两轮报的「测试按钮是空壳」是错的。撤回。**

**真相**：handler 根本不调用我看的那两个方法。

```
ProxyHandler.Test  →  adminService.TestProxy  →  proxyProbeService.ProbeProxy   ← 真实探测，返回出口 IP、延迟、国家
AccountHandler.Test →  accountTestService.TestAccountConnection               ← 真实实现，按平台分成 8 条路径
```

而那两轮我读到的空壳：

```
ProxyService.TestConnection    ← 零调用（唯一的 .TestConnection( 是 imageStorage 的，不同对象）
AccountService.TestCredentials ← 零调用
```

**两者都是死代码，从来没有被任何 handler 调用过。**

**证据**：

- `admin_proxy.go:215` 的 `TestProxy` 调 `s.proxyProber.ProbeProxy(ctx, proxyURL)`，拿到 `exitInfo.IP / Country / LatencyMs`，失败时还会 `saveProxyLatency(Success: false)` 记录错误
- `account_test_service.go:361` 的 `TestAccountConnection` 有完整的平台分流：OpenAI → `testOpenAIAccountConnection`、Gemini → `testGeminiAccountConnection`、Grok、Antigravity、TypeSafe、Claude、多协议 CN provider 各有专用实现，通过 SSE 推送测试进度
- `proxy_probe_service.go:83` 的 `ProbeProxy` 是独立服务的真实实现

**所以那 31 次点击（代理 15 + 账号 16）是真实测试，不是假成功。**

**我错在哪**：`AccountService.TestCredentials` 和 `ProxyService.TestConnection` 的名字、签名、所在包都「看起来像」handler 会调的东西，我就假设了调用关系，**没有去读 handler 的那一行**。

**这是第 5 次和第 6 次同类误判**，而且第 60 轮的教训（覆盖率推断测试覆盖）刚刚写过：

| 轮次 | 我用什么推断什么 |
|---|---|
| 36 | 历史聚合 → 当前状态 |
| 30 | 增量语义 → set 操作 |
| 54 | 原生 SQL → ORM 行为 |
| 60 | handler 覆盖率 → service 测试覆盖 |
| **65** | **service 方法名 → handler 调用关系** |
| **66** | **同上** |

**六次同一个形状**：拿一个看起来相关的信号，跳过「实际调用是什么」这一步，直接下结论。

**这次尤其不该**：65 轮我已经查了路由、前端组件、审计日志三项，全都指向「这个功能被真实使用」——
唯独没查 handler 那 26 行代码。**最后一步最便宜，我却省了。**

**修正后的 TODO 全表**：那两个「危害最高」的条目降级为**死代码**，与 62/63 轮同类。
13 条 TODO 里**没有一条**是「接了线、被使用、实现是空壳」的。

### 6.70 流量恢复了，而且顺手澄清「配额刷新」到底是什么（2026-11-15 第 2 轮 / 256）

前 60 多轮一直说「白天零流量、最近一次计费请求是 01:32」。**这个判断已经过时了。**

**10:52 有 10 个请求成功、2 个错误**（1 分钟窗口）：

```
10:52:53  gpt-6.1-sol    1236 in /  79 out   $0.0079
10:52:52  gpt-6.1-sol     528 in / 129 out   $0.0110
10:52:49  gpt-6-astra     348 in / 272 out   $0.1453
10:52:45  gpt-6.1-sol    7413 in / 597 out   $0.0369
...
```

**同时看到 p95 延迟 33.6 秒、TTFT p95 4.35 秒**——但我**不下「延迟异常」的结论**：
这是 1 分钟窗口、10 个样本的 p95，等于取第 9 慢的那个，单个长输出请求就能把它拉高。
`concurrency_queue_depth = 0`、`account_switch_count = 0` 说明没有排队也没切号。
**样本不足以判断趋势**，等有更多数据再看。

**顺手闭环了一个从第 12 轮悬到现在的疑问**。

我之前一直把「配额刷新」当成一件事，其实它是**两个独立机制**：

| 字段 | 谁更新 | 何时 |
|---|---|---|
| `codex_7d_used_percent` | `openai_gateway_usage.go:1131` | **每次请求处理后**，按本地累计用量算 |
| `codex_credits_snapshot`（含 `fetched_at`） | `openai_quota_service.go` | **只在主动查询上游时**（admin 刷新接口） |

实测证据：

```
fetched_at    1794579066（11-14 12:51，没变）
used_7d       45（之前 43，涨了）
updated_at    11-15 10:53（刚被请求更新）
```

**所以「fetched_at 一直不动」不是刷新失效**——那个字段本来就只在主动查询额度时才更新，
而 `used_7d` 是请求驱动的，一直在变。第 12/32 轮那个「为什么 20 小时没刷新」的困惑，
答案就是**它本来就不需要每 20 小时刷新**。

**这也解释了第 26 轮的价格表 TODO 同类现象**：不是所有「看起来该定时更新」的东西都需要定时更新。

### 6.71 那 33 秒的 p95 不是回归——今天其实是六天里最好的一天（2026-11-15 第 3 轮 / 256）

上一轮看到 p95 33.6 秒，我按清单没下结论。这轮用**六天的历史分布**做了对照。

**按天汇总**（只统计有请求的样本）：

| 日期 | 样本 | p95 中位数 | p95 的 p95 | TTFT 均值 | 成功 | 错误 |
|---|---|---|---|---|---|---|
| **11-15** | 1,315 | **14,237 ms** | 34,941 | **5,652** | 5,408 | 45 |
| 11-14 | 3,259 | 13,961 | 51,306 | 5,261 | 12,959 | 1,025 |
| 11-13 | 4,202 | 25,943 | 97,724 | 8,886 | 18,897 | 74 |
| 11-12 | 920 | 26,462 | 82,700 | 9,919 | 3,584 | 63 |
| 11-11 | 692 | **30,906** | 111,091 | 8,162 | 2,105 | 49 |
| 11-10 | 509 | 26,012 | 119,102 | 11,869 | 1,366 | 2 |
| 11-09 | 441 | 20,540 | 145,019 | 10,438 | 1,189 | 57 |

**三个结论**：

1. **33.6 秒那一次落在分布的尾部**——`p95 的 p95` 是 34,941 ms，也就是说每分钟的 p95
   里，最慢的 1% 就有这么大。它不是异常值，是**尾巴本身**。
2. **今天不是变慢，是六天里最快的**：p95 中位数 14.2 秒 vs 11-11 的 30.9 秒，
   差了一半还多。TTFT 均值 5.6 秒也是历史第二低。
3. **错误率同样在改善**：今天 45 个错误 / 5,408 次成功（0.83%），
   对比 11-14 的 1,025 / 12,959（7.9%）。

**为什么 14 秒仍然偏慢**（对 API 网关来说）：这是**上游模型本身的耗时**，
不是网关引入的。同一分钟的 `concurrency_queue_depth` 和 `account_switch_count` 全程为 0——
没有排队、没有切号重试。第 27 轮测过网关自身开销不到 6 毫秒。

**所以「延迟高」这个直觉是对的，「延迟变差了」这个结论是错的。** 这两个很容易混为一谈，
差别就在于有没有拿历史分布做对照。

**顺带确认流量结构**：近 30 分钟 182 个请求、270 条指标，说明这不是一次孤立的突发，
是在持续跑。

### 6.72 成本结构：`gpt-6-astra` 只占 18% 请求，却吃掉 59% 成本（2026-11-15 第 4 轮 / 256）

近 12 小时的请求按模型拆开：

| 模型 | 请求 | 成本 | 平均输入 | 平均输出 | 平均缓存 | 缓存命中 |
|---|---|---|---|---|---|---|
| `gpt-6.1-sol` | **723** | $17.01 | 3,576 | 384 | 125,381 | **99.2%** |
| `gpt-6-astra` | **172** | **$24.27** | 3,970 | 427 | 80,069 | 97.1% |
| `gpt-6-luna` | 11 | $0.01 | 6,006 | 435 | 28,428 | 100% |

**按用户**：

```
user 4   829 请求   $32.86   1 个 key
user 2    72 请求   $ 8.44   1 个 key
user 6     5 请求   $ 0.004  1 个 key
```

**关键结构**：`gpt-6-astra` 只占 18% 的请求量，却贡献了 **59% 的成本**（$24.27 / $41.31）。

**原因在价格表里**（容器内 `data/model_pricing.json`）：

| | `gpt-6.1-sol` | `gpt-6-astra` | 倍数 |
|---|---|---|---|
| 输入 | 2e-06 | 1e-05 | **5×** |
| 输出 | 1e-05 | 5e-05 | **5×** |
| 缓存读取 | 1e-07 | 1e-06 | **10×** |

**逐笔反算验证计费正确**：

```
sol   3576×2e-6 + 384×1e-5 + 125381×1e-7 = 0.00715 + 0.00384 + 0.01254 = 0.02353   ← 实测 0.0235 ✓
astra 3970×1e-5 + 427×5e-5 +  80069×1e-6 = 0.03970 + 0.02135 + 0.08007 = 0.14112   ← 实测 0.1411 ✓
```

两个都精确对上。**这是第 26 轮价格核对的第二次独立验证，用的是今天的真实新数据。**

**一个值得注意的点**：astra 那 $0.1411 里，**缓存读取占 $0.0801（57%）**——
因为它的缓存价是 sol 的 **10 倍**，而缓存量很大（平均 8 万 token）。
换句话说，**astra 之所以贵，主要不是因为输出多，是因为缓存单价高**。

**这不是缺陷**，是定价结构决定的。但如果有人以为 astra 和 sol「差不多」，
账单会比预期高一个量级——**这件事值得在成本可见的地方体现出来**（不是我要改的东西，
只是记录这个事实）。

**缓存整体健康**：三个模型命中率 97%–100%，与第 25 轮算的 96.8% 一致并略有提升。

### 6.73 这台网关实际在支撑什么：两小时不间断的 agent 长任务（2026-11-15 第 5 轮 / 256）

近 12 小时 906 个请求，按**请求间隔**和**会话块**拆开，形状很清楚。

**间隔分布**（同一用户相邻请求的时间差）：

```
6-30 秒     603   66%
0-5 秒      196   22%
31-120 秒    93   10%
2-10 分钟     7    1%
>10 分钟      6    1%
```

**88% 的请求间隔在 30 秒以内**——这不是人在聊天，是 agent 在执行。

**会话块**（间隔超过 10 分钟算新会话）：

| 用户 | 请求数 | 起止 | 时长 |
|---|---|---|---|
| 4 | **503** | 22:56 → 01:09 | **133 分钟** |
| 4 | **320** | 09:31 → 10:55 | **84 分钟** |
| 2 | 57 | 10:42 → 10:55 | 13 分钟 |
| 2 | 8 | 09:16 → 09:17 | 1 分钟 |
| 6 | 5 | 22:59 | — |

**一个人连续跑了两小时零十三分钟，503 个请求**，平均每 16 秒一次。

**输出 token 分布是平滑的**（12–98、101–199、200–299……一直到 1002–4963 有 54 个），
**没有 16-token 那种尖峰**——和第 39 轮那个 agent 工具循环不是同一种工作负载。

**三件事因此说得通了**：

1. **缓存命中 99%**：同一个会话反复用同一份长上下文（平均 125k 缓存 token）
2. **并发限制 3 够用**：请求是顺序的，一个人一次只跑一个
3. **间隔 6-30 秒**：模型在思考，不是网关在排队（`concurrency_queue_depth` 全程 0）

**所以这台网关的实际负载形态是：极少数人、极长时间、单线程序列、超长上下文。**

这也解释了为什么之前的并发 429（1,785 次）集中在少数几天——
那是 agent 循环瞬间并发超过 3，比如工具并行调用。**平时 3 完全够。**

**一个现实含义**：这种负载下，网关的瓶颈从来不是吞吐，而是**单请求的稳定性和上下文长度的处理能力**。
`gpt-6.1-sol` 平均带 125k 缓存 token，这类请求最怕的是中途失败重放——
一次两小时的会话里如果断了，代价是用户的一整段时间。

### 6.74 两个长会话的中断情况：906 个请求里 2 次 408、3 次 429（2026-11-15 第 6 轮 / 256）

上一轮找到两个长会话块，这轮查它们期间有没有中断。

| 会话 | 请求数 | 时长 | 错误总数 | 5xx | 429 | 上游 5xx |
|---|---|---|---|---|---|---|
| 22:56 → 01:09 | 503 | 133 分钟 | **0** | 0 | 0 | 0 |
| 09:31 → 10:55 | 320 | 84 分钟 | 5 | **0** | 3 | 0 |

**第一个会话：503 个请求、两小时十三分钟，零错误。**

**第二个会话的 5 条**：

```
10:04:04  408  Timed out reading request body        key 5
10:20:52  408  Timed out reading request body        key 5
10:50:47  429  个人并发已达上限（上限 3）              key 5
10:51:19  429  同上                                   key 5
10:51:22  429  同上                                   key 5
```

**408 的来源查清了**：网关的 `RequestTimeout` 是**故意不设**的（`http.go:124` 注释写着
「不设置 WriteTimeout，因为流式响应可能持续十几分钟」「请求体使用逐次读取的 idle deadline」）。

实际生效的是逐次 socket 读超时：

```
GATEWAY_REQUEST_BODY_READ_TIMEOUT_SECONDS=120
```

**120 秒**——客户端连续两分钟一个字节都没发才会触发。这个值**不是太紧，是太宽松**。
所以那 2 次 408 不是网关配置问题，是**客户端那边卡住了**（网络中断、进程挂起之类）。

**429 那 3 次**发生在 10:50-10:51，间隔 30 秒左右——典型的 agent 并行调用超过并发 3。
和第 43 轮查的 1,785 次 429 是同一回事。

**结论：长会话质量很好。**

906 个请求里，真正的失败是 2 次客户端卡死（0.22%），3 次并发超限（0.33%），
**没有一次是网关自己出错（5xx = 0）、也没有一次上游故障（upstream 5xx = 0）**。

对一个连续跑两小时的 agent 会话来说，这个稳定性是够的。

### 6.75 长会话全程单账号——上下文一致，但也意味着没有冗余（2026-11-15 第 7 轮 / 256）

两个会话块的账号分布：

```
22:56 → 01:10     account 2 —— 508 个请求
09:31 → 10:56     account 2 —— 392 个请求
```

**900 个请求全部落在同一个账号上，零切换。**

**好的那一面**：会话上下文完全一致。同一个账号意味着同一份 session、同一套缓存，
不会出现「聊到一半换了后端，模型不认识前面说过什么」的情况。
这和指标里的 `account_switch_count = 0` 对上了。

**但另一面是**：**这个网关现在只有一个可用账号（#2）。**

```
accounts 表现状：
  #1  ChatGPT Pro 200   11-02 软删除
  #2  ChatGPT pro 200   活跃（唯一）
  #3  API               11-12 软删除
```

**所以「零切换」不是因为调度聪明，是因为没得选。**

**这是可用性上的单点**：如果 #2 失效（凭证过期、被限流、被封），
`gateway.POST /v1/chat/completions` 会立刻变成 503「No available OpenAI accounts」——
和第 49 轮那次 141 条 503 是同一个形态。

**这不是缺陷，是配置选择**（或者是账号用尽的结果：1 和 3 被删很可能因为本身就失效了）。
但它是一处**真实的单点风险**，值得写在「需要知道的事」里：

> 网关当前没有账号冗余。唯一可用账号失效 = 服务完全中断，直到换上新凭证。

**一个可考虑的缓解**（不是我能决定的）：把 `GATEWAY_MEMBER_CONCURRENCY_LIMIT` 之外的
另一层保护做起来——比如让 watchdog 在「可调度账号数 == 1」时发出提醒，
这样至少在冗余消失的**那一刻**会有人知道，而不是等到它真的挂了才发现。

现在的巡检里 `accounts_ok` 只检查「可调度账号数 > 0」，**1 个也算 ok**。

### 6.76 巡检加了一项：账号冗余度（2026-11-15 第 8 轮 / 256）

6.75 发现网关只剩一个可用账号，而巡检里的 `accounts_ok` 只判断「可调度账号数 > 0」，
**从 2 个掉到 1 个不会触发任何东西**。

这轮加了一个字段，但它**不进 failed 集合**：

```python
out['accounts_schedulable'] = _n
out['accounts_ok']          = _n > 0      # 保持原样：服务可用性
out['accounts_redundant']   = _n >= 2     # 新增：是否有冗余
```

**为什么分开**：如果把 `accounts_ok` 直接改成 `>= 2`，当前就会一直红灯——
只有一个账号是现实，天天报警只会训练人忽略告警。所以：

- `accounts_ok` 继续回答「服务能不能跑」
- `accounts_redundant` 回答「挂了还有没有备的」

**部署后实测**：

```
accounts_ok          = True
accounts_schedulable = 1
accounts_redundant   = False     ← 新字段，如实反映当前单点状态
ledger_ok            = True
key_group_ok         = True
gateway_ok           = True
failed               = None      ← 没有制造噪音
```

**这个字段的用法**：等你配了 webhook，如果想要「冗余消失就提醒」，可以针对
`accounts_redundant` 单独设规则；如果觉得单账号可以接受，就不设，它只是静静地记录事实。
**两种选择都行，但至少现在这个事实是可查的，而不是只能靠人想起来去数账号数。**

备份在 `japan_maintenance.py.bak-round8`。巡检仍是 13 个 `*_ok` 项，新字段是信息性的。

### 6.77 三天 10,135 个请求：零重映射，但图像模型真的跑通了（2026-11-15 第 9 轮 / 256）

**先查重映射**（`requested_model` 与 `model` 不一致）：

```
总请求      10,135
重映射           0
模型数        7 / 7（请求侧 = 使用侧）
requested_model 为空的 0
```

**一个都没有。** 用户请求什么模型，就是什么模型——重映射机制存在但从未被用到，
`requested_model` 也 100% 有值（记录完整）。

**三天模型分布**：

| 模型 | 请求 | 成本 | 平均缓存 |
|---|---|---|---|
| `gpt-6.1-sol` | **9,488**（94%） | $339.14 | 133,593 |
| `gpt-6-astra` | 592 | **$157.87**（47% 成本） | 98,694 |
| `gpt-6-luna` | 47 | $0.075 | 23,789 |
| `gpt-6.1-terra` | 3 | $0.002 | 13,867 |
| `gpt-6-sol` | 3 | $0.016 | 2,816 |
| `gpt-image-2.5-sunburst` | **1** | $0.201 | 0 |
| `gpt-image-2.5-flare` | **1** | $0.201 | 0 |

**图像模型真的能用**——4 次成功记录：

```
11-14 20:07:38  gpt-image-2.5-sunburst  sync  $0.201  key 11  curl/8.5.0
11-14 20:07:19  gpt-image-2.5-flare     sync  $0.201  key 11  curl/8.5.0
11-06 21:10:51  gpt-image-2.5-flare     sync  $0.201  key 5   magpie/0.1.2616
11-06 20:26:25  gpt-image-2.5-flare     sync  $0.201  key 5   magpie/0.1.2616
```

**11-14 那两次是 `curl`**——手动测试，时间在 v0.1.19 部署（21:03）前约一小时。
11-06 那两次是 `magpie/0.1.2616`，真实客户端。

所以图像生成这条链路是**通的**，而且被真实客户端用过，不只是自测。

**这一轮没有发现问题。** 但补上了一块之前完全没验证过的拼图：
**图像模型（`gpt-image-2.5-*`）在真实流量下返回过 200 且正确计费**。
之前 68 轮里从来没碰过这条路径。

### 6.78 WebSocket 路径：171 次尝试、0 次成功，失败原因是客户端不发首帧（2026-11-15 第 10 轮 / 256）

**先看全历史的 request_type 分布**：

```
type 1 (sync)     135 条   11-01 → 11-14
type 2 (stream) 36,709 条   11-02 → 11-15
type 3 (ws_v2)      0 条
type 4 (live)       0 条
```

**WS 一次都没成功过。**

**但日志里有 171 次失败尝试**：

```
openai.websocket_read_first_message_failed   171 次（最后 11-15）
openai.websocket_account_select_failed         3 次
```

按天：

```
11-12   96 次（1 个用户、1 个 key）
11-14   69 次（1 个用户、1 个 key）
11-15    6 次
```

**失败原因在 extra 里写得清清楚楚**：

```json
{"path": "/v1/responses",
 "error": "openai ws client close: 1008 missing first response.create message: context deadline exceeded"}
```

**拆开看**：

1. 请求走的是 `/v1/responses`（普通端点），网关内部升级成 WebSocket 连上游
2. 连上之后，网关等客户端发**第一条 `response.create` 消息**
3. **客户端没发**，等到 deadline 超时
4. 网关关闭连接，code **1008**（policy violation）

**所以这不是网关的问题**——是客户端连上了但不发第一帧，网关等到超时后正常关闭。

**结论：WS 是一条「从未成功、但也不是坏的」路径。**

它和 `/v1/live`（6.63）性质相同——**未验证**，不是**不可用**。
唯一的区别是 live 连尝试都没有，WS 有 171 次尝试全部卡在客户端那一侧。

**这意味着什么**：如果哪天有客户端正确发送 `response.create`，WS 能不能跑通？
**我不知道，因为从来没成功过一次。** 不能因为 171 次失败就断言它是坏的——
每次失败都发生在同一处（第一帧缺失），根本没走到真正转发的环节。

**没有可修的东西**：如果强行"修复"，只能去猜客户端的意图。记录事实，不动代码。

### 6.79 纠正 6.63：`/v1/live` 的门是锁着的，「任何持 Key 用户都能免费调用」是错的（第 11 轮 / 256）

第 61 轮我说 `/v1/live`「端点可用、完全不计费、任何持有 API Key 的用户都能调用，门是开着的」。
**「门开着」这个判断是错的。** 这轮读了完整的准入链路才发现。

**`Live` handler 有四道闸**（`openai_live.go:22`）：

```go
1. GetAPIKeyFromContext           → 401 Invalid API key
2. GetAuthSubjectFromContext      → 500 User context not found
3. 分组平台必须是 openai/composite → 404 Live is not supported for this platform
4. liveEnabledForAPIKey(apiKey)   → 403 Live is not enabled for this group
```

**第 4 道闸是关键**：

```go
func liveEnabledForAPIKey(apiKey *service.APIKey) bool {
	return apiKey != nil &&
		apiKey.Group != nil &&
		(platform == OpenAI || Composite) &&
		apiKey.Group.AllowLive        // ← 分组级开关
}
```

**实测当前配置**：

```
groups:  id=2  pro 200  platform=openai  allow_live = f(alse)  status=active
```

**唯一的分组 `allow_live = false`。所以任何 Key 调 `/v1/live` 都会收到
403 "Live is not enabled for this group"。**

**这也解释了 `request_type=4`（live）为什么是零记录**——不是「没人想用」，
是**用了也会被 403 挡在门外**，根本进不到转发和计费环节。

**修正后的结论**：

| 项 | 第 61 轮的说法 | 事实 |
|---|---|---|
| 端点注册了 | ✅ 对 | ✅ `gateway.POST("/live")` 确实在 |
| 任何持 Key 用户可调用 | ❌ **错** | 需要 `group.allow_live = true`，**当前是 false** |
| 完全不计费 | ✅ 对 | 代码确实跳过 `applyUsageBilling` |
| 门开着 | ❌ **错** | **门是锁的** |
| 从未被使用 | ✅ 对 | 但原因是**被拒绝**，不是没人试 |

**所以真实风险等级要下调**：不计费是代码层面的真实缺口，但**当前不可达**。
只有当有人把某个分组的 `allow_live` 打开时，这个缺口才会暴露。
**在此之前，它是一段睡着的代码，不是一扇敞开的门。**

**这是第七次误判**，而且和第 65/66 轮同类——**读了实现，没读准入链路**。
区别在于前两次是「读错了方法」，这次是「读对了方法，但漏了调用它的 handler 里的前置检查」。
`Live` 那 4 道闸就在 `openai_live.go:22-50`，我第 61 轮读了这个文件，却只看了 830 行的计费 TODO。

### 6.80 分组的四个功能开关：只开了图像，Anthropic 协议是关的（2026-11-15 第 12 轮 / 256）

`groups` 表上有四个 `allow_*` 开关，当前唯一分组的值：

| 开关 | 值 | 控制什么 |
|---|---|---|
| `allow_image_generation` | **true** | 图像生成 → **开着** |
| `allow_messages_dispatch` | **false** | `/v1/messages`（Anthropic 协议）→ **关着** |
| `allow_batch_image_generation` | **false** | 批量图片 → 关着 |
| `allow_live` | **false** | 实时语音 → 关着（6.79 那个） |

**图像那个是 true，和第 9 轮发现的 4 次成功图像请求对得上**——开关和实际行为一致，
这是一次干净的双向验证。

**但 `allow_messages_dispatch = false` 值得说清楚**。

它的判定逻辑（`openai_gateway_handler.go:311`）：

```go
if 平台 == Grok                    → true（豁免）
if IsMultiProtocolAPIKeyProvider   → true（豁免，注释说 CN 分组的 /v1/messages 是主要形态）
if Composite 且目标是 Grok/CN      → true（豁免）
return apiKey.Group.AllowMessagesDispatch     ← OpenAI 分组要走到这里
```

**我们分组是 `platform=openai`，走最后一行，开关是 false。**

**所以 `/v1/messages` 对当前配置是关闭的。**

**这意味着**：任何走 Anthropic Messages 协议的客户端（Claude Code、`@anthropic-ai/sdk` 等）
拿我们的 Key 调用，会拿到 403。

**和实际数据吻合**：`usage_logs` 里 36,844 条记录，**没有一条是 Anthropic 协议的**——
全是 `/v1/chat/completions` 和 `/v1/responses`。不是没人试，是试了也进不去。

**性质判断**：这是**有意的开关**，不是缺陷。

代码里 `sanitizeGroupMessagesDispatchFields` 会把非 openai/composite 平台的这个字段强制置 false，
说明它是**专门给 OpenAI 型分组准备的可配置项**，默认关闭。

**所以真实状态是**：这台网关当前只对外提供 **OpenAI 协议**（chat/responses）+ **图像生成**。
Anthropic 协议、批量图片、实时语音都是关着的。

**如果哪天想接 Claude Code**，需要打开 `allow_messages_dispatch`——一条 SQL 或后台一次点击。

### 6.81 图像开关是怎么打开的：一条没有操作者的脚本记录（2026-11-15 第 13/14 轮 / 256）

第 12 轮发现分组 2 的 `allow_image_generation = true`，但代码默认对 OpenAI 平台是
`false`，而 `admin.groups.update` 零记录。这轮追到了源头。

**11-06 18:44:25 的审计记录**（id=495）：

```json
action: zhijing.groups.enable_image_generation
body:   {"group_ids":[2,3],"allow_image_generation":true}
actor:  （空）
ip:     （空）
```

**它同时把分组 2 和 3 打开了**——这解释了为什么分组 3 创建时 audit 里是 `false`、
现在却也是 `true`。

**`zhijing.*` 前缀的操作一共 5 条**，全部无 actor、无 IP：

| 时间 | action | 内容 |
|---|---|---|
| 11-03 18:55 | `zhijing.release.concurrency.apply` | `{"member_limit":3,"global_limit":9}` |
| 11-03 23:12 | `zhijing.concurrency.uniform_3_9_9` | `{"member_limit":3,"global_limit":9,"account_limit":9}` |
| 11-04 15:07 | `zhijing.user.platform_wallet_only` | `{"user_id":2,"platform":"openai",...}` |
| 11-04 15:37 | `zhijing.users.remove_weekly_limits` | `{"scope":"all_non_deleted_users",...}` |
| 11-06 18:44 | `zhijing.groups.enable_image_generation` | `{"group_ids":[2,3],...}` |

**这五条都不是通过管理 API 做的**——代码里搜不到这些 action 名，而且 `actor_email`
和 `client_ip` 都是空的。它们是**脚本或直接 SQL 写入**，写的时候顺手往 `audit_logs`
里插了一行。

**两面看这件事**：

**好的一面**：这些运维动作**留了痕**。如果当时没插这行，我会看到「开关是 true 但
没有任何修改记录」，那才是真的无法解释。写审计的人（或脚本）有这个意识。

**不足的一面**：**没有操作者**。审计记录回答了「什么时候改了什么」，
但答不出「是谁改的」。114 行之前（6.79）我说过 401 请求无 actor 是合理的，
因为那时根本没有身份；这五条不一样——它们是**有权限的写操作**，只是绕过了认证。

**这两轮没有发现问题，只是把一个悬着的问号填上了。** 图像开关不是神秘变成 true 的，
是 11-06 一次明确的操作；而那次操作用的是绕过 API 的路径，所以审计里只有"做了什么"，
没有"谁做的"。

### 6.82 那 5 条运维脚本操作，现在还剩几条在生效（2026-11-15 第 15 轮 / 256）

6.81 找到 5 条 `zhijing.*` 脚本记录，这轮逐条核对它们**是否还在当前状态里**。

| 脚本设置 | 当前实测 | 结论 |
|---|---|---|
| `member_limit: 3` | `GATEWAY_MEMBER_CONCURRENCY_LIMIT=3` | **一致** |
| `global_limit: 9` | `GATEWAY_GLOBAL_CONCURRENCY_LIMIT=16` | **已被覆盖** |
| `account_limit: 9` | env 中不存在该变量 | **未生效** |
| `remove_weekly_limits`（全用户） | `default_platform_quotas` 的 daily/weekly/monthly **全是 null** | **一致** |
| `platform_wallet_only`（user 2） | `users` 表**没有 platform/wallet 列** | **已失效** |

**五个里两个还在、一个被覆盖、两个已经无处对应。**

**被覆盖的那个是我自己干的**：11-03 脚本把 `global_limit` 设成 9，
11-15 我在调并发配置时把它改成了 16。

**已失效的两个更有意思**：

- `account_limit: 9` —— 环境变量不存在。可能这个字段在别的键名下，也可能后来改成了
  「每账号并发由 `accounts.concurrency` 列控制」这种结构，脚本设的全局值就没人读了。
- `platform_wallet_only` —— `users` 表上根本没有 platform 或 wallet 相关列。
  **当时的 schema 和现在的不是一回事**，这个操作改的字段后来被重构掉了。

**这件事本身是一个温和的提醒**：运维脚本写进审计日志的「我做了什么」，
不等于「现在的状态就是这样」。中间可能被别的东西覆盖、可能因为 schema 演进失效。
**审计记录证明的是动作发生过，不是动作还生效。**

**没有发现问题，也没改任何东西。** 这轮只是把「5 条操作」从"存在"推进到"现在还剩几条"。

### 6.83 Redis 全局状态：2.61 MB / 64 MB，但 noeviction 意味着没有退路（2026-11-15 第 16 轮 / 256）

第一次系统看 Redis 的整体状态。

```
DBSIZE                 1,473 keys
used_memory            2.61 MB
used_memory_peak       2.77 MB
maxmemory              64 MB
maxmemory_policy       noeviction
expired_keys           108,895（主动过期 102,460）
evicted_keys           0
keyspace_hits          4,486,941
keyspace_misses        1,914,751
avg_ttl                约 35 小时
```

**命中率 70.1%**（4.49M / 6.40M）。对缓存来说正常——里面有一半是短命的状态键（槽位、
调度器快照），本来就不是命中率导向的。

**key 结构**：

| 前缀 | 数量 | 说明 |
|---|---|---|
| `sticky_session:2` | **1,060** | 用户 2 的粘性会话（72%） |
| `sched:*` | 315 | 调度器快照（ver/epoch/ready/active/retired） |
| `billing:user_platform_quota` | 3 | |
| `concurrency:*` | **7** | 见下 |

**`concurrency:*` 的实况**（第 29 轮我说过「连 slot key 都不存在」，现在有了）：

```
concurrency:user:4                zset  ttl=2395   ← 用户 4 正在跑
concurrency:account:2             zset  ttl=2395   ← 账号 2 被占用
concurrency:api_key:4             zset  ttl=2395   ← key 4 被占用
concurrency:user:active_index     zset  ttl=-1     ← 索引（永久）
concurrency:account:active_index  zset  ttl=-1
concurrency:zhijing:user_index:v1 zset  ttl=-1
```

**这是实时槽位，不是泄漏。** 2395 秒 TTL 正是配置的 40 分钟，说明此刻用户 4 有请求在跑
——和第 15 轮看到的 1,850 个 24 小时请求对得上。第 29 轮那次是空闲时刻，所以看到的是空。

**1,060 个 sticky_session 看着多，实际正常**：用户 2 在 24 小时内有 471 个请求，
而每个请求会写 2–3 个 session 键（`http-response-owner` + `response` 等），
1060 / 471 ≈ 2.25，比例对得上。**内存占用约 100 KB，可以忽略。**

**唯一值得记的是 `noeviction`**：

内存满时 Redis **不淘汰旧 key，而是让写入失败**。这是**正确的选择**（淘汰掉槽位或
session 会造成状态错乱，比报错更糟），但它意味着**没有退路**：

- 现在 2.61 MB / 64 MB，**余量 24 倍**
- 按当前的用量增长，还早得很
- 但如果用户数或并发涨到 20 倍以上，写入就会开始失败，而失败点会落在**槽位写入**上
  → 表现为请求被拒，而不是服务变慢

**这不是待修的问题**，是一个**有明确阈值的前瞻信息**：64 MB 这条线在哪，涨到什么程度会碰到。

### 6.84 调度器快照的 315 个 key：84 个固定组合 + 4 个滚动版本（2026-11-15 第 17 轮 / 256）

上一轮看到 `sched:*` 有 315 个 key，担心它会累积。这轮拆清楚了。

**三类 key，性质完全不同**：

**① 84 个固定组合（永不过期，数量恒定）**

```
sched:ver:0:anthropic:forced      sched:epoch:0:anthropic:forced
sched:ver:0:anthropic:mixed       sched:epoch:0:anthropic:mixed
sched:ver:0:gemini:single         ...
```

格式是 `sched:<ver|epoch>:<分组>:<平台>:<模式>`。84 = 组合数，不是一个时间序列
——**数量由「平台 × 模式」决定，与运行时长无关**。

**② 4 个滚动版本（TTL 60 秒）**

```
sched:2:openai:forced:v6740     ← 当前
sched:2:openai:forced:v6739     ← 上一版
sched:2:openai:single:v6740
sched:2:openai:single:v6739
```

版本号一直在涨（6754、6755……），但**旧版本 60 秒后自动删除**，所以同时最多存在两版。
`ttl=59` 实测确认。

**③ 索引类（`sched:ready` / `sched:active` / `sched:retired`，无 TTL）**

按平台 × 模式枚举，同样是固定集合。

**结论：不累积。**

版本号的持续增长（已到 6740）**不会留下垃圾**——它只活在 60 秒的窗口里。
真正无 TTL 的只有那 84 个组合键和几个索引，数量由代码枚举决定，不随请求增长。

**这条和第 16 轮的 Redis 内存数据互相印证**：2.61 MB 里，1,060 个 sticky_session 占大头，
`sched:*` 这 315 个 key 加起来不到 1 MB，且结构稳定。

**没有发现问题。** 但这轮排除了一个具体的担忧（版本号无限增长），
而那个担忧在只看到 `v6739`、`v6740` 这种名字时是很自然的。

### 6.85 磁盘 40%：23 GB 里 12.6 GB 是 Docker，其中 5.3 GB 可回收但都还在跑（2026-11-15 第 18 轮 / 256）

```
/  58G  已用 23G  剩余 36G  40%
```

**大的分块**：

| 路径 | 大小 | 占比 |
|---|---|---|
| `/var/lib/docker` | **7.6 GB** | 33% |
| `/var/lib/containerd` | **5.0 GB** | 22% |
| `/opt/zhijing-sub2api` | 2.3 GB | 10% |
| `/var/lib/snapd` | 539 MB | |
| `/root` | 466 MB | |
| `/var/log` | 404 MB | |
| `/var/backups` | 221 MB | |

**容器运行时加起来 12.6 GB，超过磁盘总量的一半。**

**`docker system df` 的明细**：

```
Images        12   5.283GB   可回收 5.283GB (100%)
Containers    12   77.82kB   0%
Local Volumes  4   6.012GB   0%
Build Cache    0   0B
```

**12 个镜像里 11 个是网关版本**：

```
ghcr.io/daniei-chen/zhijing-gateway:0.1.19   392MB
                              :0.1.17        392MB
                              :0.1.15        392MB
                              :0.1.14        392MB
                              :0.1.13        392MB
                              :0.1.12        392MB
                              :0.1.11        392MB
                              :0.1.10        392MB
                              :0.1.9         393MB
zhijing-sub2api-japan:v004-dcaf707           1.26GB
```

**为什么「100% 可回收」却又「12 个全 ACTIVE」**：那 5.283 GB 指的是**没有容器引用的层**，
而 11 个网关镜像共享同一套基础层——所以真实占用远小于 11 × 392 MB。
ACTIVE 是因为每个历史版本都还有容器在跑（18806 → 18814 那 8 个，加上 postgres、redis 等）。

**这 8 个历史容器是我前几轮刻意保留的回滚路径。** 它们各占一个镜像，
所以「回收 5.3 GB」和「保留回滚能力」是冲突的，不能两全。

**当前不需要处理**：40% 使用、36 GB 空闲，离任何阈值都远。

**如果将来要收紧**，最合理的做法是**只留最近两三个版本**（0.1.19 / 0.1.18 / 0.1.17），
把 0.1.9–0.1.16 的容器和镜像删掉，能释放 3–4 GB，同时保留近期回滚能力。

**唯一值得注意的**：`v004-dcaf707` 那个 1.26 GB 的老镜像是 11-01 之前的产物，
已经三代版本没被用过。它不占回滚路径（当前回滚链是 18806–18814 那八个）。
**如果要清，它是第一顺位**——但同样不急。

### 6.86 服务器每天挨一万次 SSH 爆破，但门是密码锁坏了的（2026-11-15 第 19 轮 / 256）

查 `/var/log` 404 MB 的构成时，发现最大的一块不是 nginx：

| 路径 | 大小 |
|---|---|
| **`/var/log/journal`** | **324 MB** |
| **`/var/log/btmp`** | **35 MB** |
| `syslog.1` | 14 MB |
| `auth.log.1` | 11 MB |
| `/var/log/nginx` | **4.5 MB** |

**nginx 日志只有 4.5 MB，轮转配置健康**（`daily` + `rotate 14` + `compress`），不是问题。

**但 `btmp` 35 MB 值得看**——那是**失败登录**记录。

**`lastb` 读出 92,940 条失败尝试**：

```
ariadne  ssh:notty  2.57.121.112      Sun Nov 15 03:07
admin    ssh:notty  2.57.121.25       Sun Nov 15 03:02
teste    ssh:notty  80.94.95.116      Sun Nov 15 03:02
ubnt     ssh:notty  138.226.239.234   Sun Nov 15 02:52
test     ssh:notty  80.94.95.115      Sun Nov 15 02:42
```

**按天分布非常稳定**：

```
11-02  10,448
11-03  14,161
11-04   7,865
11-05   9,162
11-06  10,857
11-07   9,993
11-08   9,739
11-09   8,390
```

**每天一万次左右，一直在扫。** 这是公网 22 端口的常态。

**关键是防御配置**（`sshd -T` 实测）：

```
passwordauthentication   no          ← 密码认证关闭
pubkeyauthentication     yes         ← 只认密钥
permitrootlogin          without-password
```

**密码认证是关的。** 所以这九万次爆破**一次都不可能成功**——它们连提交密码的机会都没有，
密码错了正确与否都进不来。攻击者在敲一扇没有锁孔的门。

**所以这是"每天被敲门"，不是"门没锁"。**

**当前判断：不需要处理。** 但如果想减少噪音，有三个可选动作（都不是必须的）：

1. **改 SSH 端口**（比如 2222）——扫描器基本只找 22，噪音会掉九成
2. **装 fail2ban**——失败几次就封 IP，`btmp` 也不会再涨到 35 MB
3. **限制 22 端口来源 IP**——如果管理入口固定的话

**风险等级：低。** 唯一真正的风险不是爆破，是**密钥泄露**或**服务器上有其它弱口令服务**。
`passwordauthentication no` 这条配置已经挡掉了绝大多数自动化攻击。

### 6.87 宿主机的另外两面：journal 有上限，HTTP 扫描几乎为零（2026-11-15 第 20 轮 / 256）

上一轮看了 SSH，这轮补完宿主机的另外两面。

**① journal 324 MB 会不会一直涨**

```
journalctl --disk-usage    →  323.5M
/etc/systemd/journald.conf  →  全部注释掉（用默认值）
```

默认值是什么：`SystemMaxUse` 缺省是**磁盘的 10%，上限 4 GB**。
这台机器 58 GB，所以上限是 **4 GB**，当前用了 323 MB，**余量 12 倍**。

**journald 自己会按这个上限轮转**，不会无限增长。所以「324 MB 会不会变成 3 GB → 30 GB」
这个担心不成立——它到 4 GB 就封顶了。

如果想让这条线更紧，可以设 `SystemMaxUse=500M`；现在没必要，磁盘还有 36 GB 空。

**② 80/443 有没有类似的扫描**

源站 nginx 的 access log 只有 **353 行**：

```
8  /dashboard
1  /zend/.env          1  /yii/.env           1  /www/phpinfo.php
1  /www/.env           1  /wp/.env            1  /worker/.env
1  /wp-admin/phpinfo.php
```

**典型的 WordPress / PHP 扫描器**——找 `.env`、`phpinfo.php`、`wp-admin`。
但**每个路径只有 1 次**，总共不到 20 次。

**原因是边缘 nginx 在前面挡着**（`175.27.132.225`）。源站只看到少量漏过来的，
这和 SSH 每天一万次形成鲜明对比——**HTTP 面基本没被扫到**。

而且这些路径全部返回 404（源站没有 PHP、没有 WordPress、没有 `.env` 文件），
**扫也扫不出东西**。

**宿主机三面收口**：

| 面 | 状态 |
|---|---|
| SSH 22 | 每天约 1 万次爆破，**密码认证关闭所以无效** |
| HTTP 80/443 | **不到 20 次扫描**，边缘挡住 + 无对应路径 |
| journal | 323 MB，**4 GB 上限自动轮转** |

**没有需要处理的问题。** 唯一的"噪音源"是 SSH 爆破——它不构成风险，
但如果你改了 SSH 端口或加 fail2ban，`btmp` 和 `journal` 都会更清爽。

### 6.88 订阅表是空的：36,880 个请求全部走余额（2026-11-15 第 21 轮 / 256）

一直没查过订阅这条线。结果很简单：

**`user_subscriptions` 表 0 行。**

**`usage_logs.billing_type` 也只有一种值**：

```
billing_type = 0   36,880 条   $1,545.70   5 个用户
```

`BillingTypeBalance` 就是 0。**所以全部流量都是余额计费，没有一笔走订阅。**

**这条对前面几轮的结论有直接影响**：

第 30 轮我做过「初始 + 兑换 − 消费 = 余额」的平账，六个用户全部精确对上。
当时那个式子覆盖的是**余额路径**——现在知道，**余额路径就是全部**，
不存在「订阅那部分没核对」的缺口。**那次平账是完整的。**

反过来，`BillingTypeSubscription` 那一整套分支（订阅余额、窗口重置、额度扣减）
在这个部署里**从未执行过一次**。代码在、测试在、但不承载任何流量。

**这不是问题**。订阅是一种备用计费模式，有它没坏处；只是要知道，
如果哪天改用订阅模式，那条路径**在生产上从未被验证过**——
和 `/v1/live`、WebSocket 一样，属于「代码支持但没走过」的类别。

**当前计费模式只有一种，而且这一种被完整核对过。** 这是好事。

### 6.89 WebSocket 那 171 次失败全部来自同一个无 UA 的工具（2026-11-15 第 22 轮 / 256）

上一轮把这 171 次失败归为「未验证」。这轮查了来源，可以更精确。

**全部 171 条记录的归属完全一致**：

```
user_id      4
api_key_id   4
user_agent   （空）
path         /v1/responses
```

**一个用户、一个 key、没有 User-Agent、同一个路径，171 次。**

**这说明什么**：

不是"很多客户端都试不通 WebSocket"——**只有一个来源在试，而且它连 UA 都没带**。
正常的 SDK 或浏览器都会带 UA；没有 UA 意味着这是个手写脚本或极简测试工具。

**错误原因仍然是那一句**（6.78 查过）：

```
close 1008, missing first response.create message, context deadline exceeded
```

**客户端连上了 WebSocket，但从不发送服务端等待的第一帧。**

**所以这 171 次的性质是**：**一个实现不完整的客户端反复尝试，每次都在同一处失败**。
网关侧的行为是对的——等不到首帧就按超时关闭，返回 1008。

**修正后的判断**：

| 之前说 | 现在知道 |
|---|---|
| WS 路径「未验证」 | 更准确：**没有正常客户端试过**，试过的那个缺少必要步骤 |
| 171 次失败 | **同一个无 UA 工具**的 171 次重复尝试 |

**这仍然不算「WS 能用」的证据**——那个工具没走完流程，所以转发环节依然没被验证。
但现在知道**失败在客户端，不在网关**，这一点比上一轮更确定。

**没有需要修的东西。** 如果哪天想确认 WS 到底能不能跑，需要的是一个**正确发送
`response.create` 首帧的客户端**——那是测试工作，不是修 bug。

### 6.90 代码结构：110 个函数超过 200 行，最长的 1,982 行（2026-11-15 第 23 轮 / 256）

第一次量化这个仓库的结构。统计非测试、非 ent 生成代码：

```
函数总数              14,611
≥100 行                392
≥200 行                110
```

**最长的 12 个**：

| 行数 | 位置 | 函数 |
|---|---|---|
| **1,982** | `handler/admin/setting_handler_update.go:493` | `UpdateSettings` |
| **1,965** | `service/openai_ws_forwarder_ingress.go:65` | `ProxyResponsesWebSocketFromClient` |
| **1,354** | `service/openai_gateway_forward.go:23` | `Forward` |
| **1,119** | `config/config.go:2843` | `Validate` |
| **1,020** | `handler/gateway_handler.go:125` | `Messages` |
| 988 | `service/openai_gateway_response_handling.go:52` | `handleStreamingResponseWithReasoning` |
| 928 | `handler/openai_gateway_handler.go:2487` | `ResponsesWebSocket` |
| 882 | `service/crs_sync_service.go:263` | `SyncFromCRS` |
| 838 | `service/openai_ws_forwarder_v2.go:20` | `forwardOpenAIWSV2` |
| 805 | `service/openai_ws_v2_passthrough_adapter.go:666` | `proxyResponsesWebSocketV2Passthrough` |
| 769 | `service/gateway_forward.go:91` | `Forward` |
| 713 | `service/billing_service.go:351` | `initFallbackPricing` |

**三个观察**：

**① `Forward` 是网关最核心的路径，1,354 行。** 每个请求都要经过它。
一个 1,354 行的函数意味着**很难有一个测试能覆盖它的全部分支**——
第 58 轮看到 service 覆盖率 72.8%，那 27% 没覆盖的很可能就躲在这样的函数里。

**② WebSocket 相关的超长函数有四个**（1,965 + 928 + 838 + 805 = 4,536 行）。
这和 6.78/6.89 的发现对照很有意思：**这部分代码量最大、结构最复杂，却从未被成功执行过。**
没人跑过的 4,536 行，是这套代码里最"重"的未验证区域。

**③ `UpdateSettings` 1,982 行**——一个函数处理所有设置项。第 15 轮查到「286 项配置」
（6.41），这个函数大概是在用巨大的 switch/if 逐个处理它们。

**这是结构性债务，不是缺陷。**

代码能跑，15 个版本验证过，14,611 个函数里绝大多数是短的。而且这是**继承自上游的分叉**——
重构长函数会立刻偏离上游，以后每次同步都要手工解冲突。**代价大于收益，不建议动。**

**但它解释了一件事**：为什么第 58 轮覆盖率只有 72.8%——不是没写测试，
是有些函数大到单个测试很难覆盖。

**没有改动，只是把"代码有多复杂"变成了数字。**

### 6.91 长函数全都有测试，86%–90%——我差点又报一个假问题（2026-11-15 第 24 轮 / 256）

上一轮看到 110 个函数超过 200 行，最长的 1,982 行，担心「长函数难以测试覆盖」。

这轮做了交叉验证，**结论相反**。

**先做了一个便宜但危险的检查**：grep 函数名在测试文件里的出现次数。

```
Forward（1,354 行）                     435 处引用（95 个测试文件）
UpdateSettings（1,982 行）               58 处（15 个测试文件）
ProxyResponsesWebSocketFromClient（1,965） 58 处（15 个文件）
handleStreamingResponseWithReasoning（988）  0 处  ← 看起来完全没测
```

**那一刻我准备写「988 行的流式响应核心，零测试覆盖」。**

**然后去查了真实覆盖率**：

```
handleStreamingResponseWithReasoning     89.3%
Forward                                  86.2%
ProxyResponsesWebSocketFromClient        81.0%
forwardOpenAIWSV2                        89.7%
```

**那个"零引用"的函数，实际覆盖率 89.3%。**

**为什么**：grep 只能找到**直接写出函数名**的测试。而
`handleStreamingResponseWithReasoning` 是被 `Forward` 间接调用的——
测试测 `Forward`，里面的分支自然覆盖到它。**调用链上的覆盖不需要写出名字。**

**这是第八次同类风险的现场拦截**：

| 我用的便宜口径 | 真实情况 |
|---|---|
| grep 函数名 | 只反映直接引用，不反映调用链覆盖 |
| 正确的做法 | 查覆盖率 profile（`go tool cover`） |

**和之前七次完全同形**——用一个便宜的测量替代真实的执行路径。
区别只是这次在写报告**之前**查了第二个数据源。

**修正后的结论：这个代码库的测试覆盖比看起来好。**

四个最长的核心函数，覆盖率都在 81%–90% 之间。110 个长函数里没有出现
「又长又没测」的组合——至少在这几个最重要的上面没有。

**没有改动。** 上一轮说「长函数是结构性债务、不建议重构」，那个判断不变；
但「长函数难覆盖」这个隐含担忧，被数据推翻了。

### 6.92 756 处 `_ =`：显式忽略错误的地方都在合理位置（2026-11-15 第 25 轮 / 256）

查「错误被主动吞掉」的位置，看有没有落在计费或认证路径上。

**两个数**：

```
//nolint:errcheck   10 处
_ = <expr>         756 处（其中 ent 生成代码占 60，手写 696）
```

**那 10 处 `nolint:errcheck` 全是流式写入**：

```go
fmt.Fprintf(c.Writer, "event: error\ndata: %s\n\n", errPayload) //nolint:errcheck
writeChunk(chunk)                                              //nolint:errcheck
fmt.Fprint(c.Writer, out)                                      //nolint:errcheck
```

**这三处的共同点**：写 SSE 流时忽略写失败。这是**正确**的——流式响应写到一半客户端断开，
再报错也没人接，只会污染日志。所以作者显式标注「我知道在忽略」，不是无意漏掉。

**手写代码里 696 处 `_ =`，过滤掉常规清理模式后剩下的类型**：

| 类型 | 例子 | 判断 |
|---|---|---|
| 响应序列化 | `_ = json.NewEncoder(w).Encode(...)` | 合理（写完就没下文了） |
| 事务回滚 | `_ = tx.Rollback()` | 常见模式 |
| 补偿回滚 | `_ = h.authService.RollbackOAuthEmailAccountCreation(...)` | 合理 |
| 配置绑定 | `_ = viper.BindEnv(...)` | 合理 |
| **读配置** | `_ = v.ReadInConfig()` | 值得看一眼 |

**唯一留意的那处**：`config.go:4025` 的 `_ = v.ReadInConfig()`——配置文件读失败被忽略。
但这更像是**设计**：允许在没有配置文件的情况下用默认值启动（第 22 轮查过
「11 项配置与代码默认值不同，都是刻意收紧」，说明默认值路径是正常工作的）。

**关键结论：计费和认证路径上没有任何一处静默吞错。**

`usage_billing_repo.Apply`、`admin_auth` 的七步校验、槽位获取——这些地方的错误都是
逐层返回的，没有 `_ =`。

**没有改动。** 这一轮的价值是排除了一个具体担忧：如果某处「计费失败但错误被吞」，
那是静默漏扣；查下来没有。

### 6.93 先撤回 6.57 对 pricing 的判断，再发 v0.1.20（2026-11-15 第 26 轮 / 256）

本轮做两件事：纠正一条 30 轮前的错误结论，然后把四条一直卡着的遗留项做进 v0.1.20。

#### 一、6.57 说「pricing 更新一直在失败」，这是错的

6.57 我写过：

> 那 57 次拉取失败 + 14 次只读失败说明：这套运行时更新链路**一直在尝试、
> 一直在失败、失败了只记日志**。

**只有「一直在尝试」是对的。** 决定性证据来自容器 stdout（`ops_system_logs`
只收 warn/error，info 不入库，所以从数据库看不到成功记录）：

```
docker logs zhijing-api-v0119-final | grep -c "Hash check passed"
→ 37

07:13:17  Hash check passed, no update needed
07:23:17  Hash check passed, no update needed
... 每 10 分钟一次，连续 37 次，失败 0 次
```

失败的真实分布：

```
Failed to fetch remote hash   57 条   2026-11-01 19:27 → 11-02 20:56（约 25 小时）
Failed to save file (只读)     7 条   2026-11-10 12:39 → 11-14 02:55（旧容器挂载）
最近 24 小时                   0 条
```

两批都是**历史问题且已自行消失**：前者是 11-01/02 那两天的网络故障，后者是
11-14 02:50 之前旧容器的挂载方式，v0.1.19 起 `/app/data` 已是 rw 的 bind mount。

**所以「价格表跟随镜像」不是「更新失败」的结果，而是「远程哈希一直等于本地哈希」**——
镜像里打的就是当时的最新价格，运行期没有新价格可下。6.57 把「mtime 等于构建时间」
读成了失败证据，实际上它只说明这段时间上游没调价。

**这条从技术债里划掉。** 教训与 6.43、6.52 同形：**用「没有成功日志」推断「一直失败」，
而那个日志级别根本不入库**。要判断成功/失败，得去有成功记录的地方（容器 stdout）。

#### 二、v0.1.20 的四项改动

都不是新功能，是 20 多轮里记录在案、但一直卡在「需要决策」或「要发版」的遗留项。

**① 删除三个空壳方法**（`AccountService.TestCredentials`、
`ProxyService.TestConnection`、`adminServiceImpl.RefreshAccountCredentials`）

三者的共同形状：**有方法名、有签名、永远返回成功或原样返回，零调用方**。
第 65/66 轮我曾把它们当成「接了线的假成功」（用户点了 31 次测试按钮什么都没测），
第 67 轮撤回：handler 走的是另外两条真实链路
（`TestAccountConnection` / `TestProxy → ProbeProxy`）。

所以它们的真实危害不是「骗了用户」，而是**骗下一个读代码的人**。删掉。

**② 移除 `GET /admin/groups/:id/stats`**

原实现返回四项硬编码 0。前端 `groups.ts` 定义了 `getStats`，但没有任何组件调用；
真实分组用量走 `/admin/dashboard/groups` 与 `/admin/groups/usage-summary`。

选择删除而不是补实现：补实现要给 `apiKeyRepo` 接口加方法（影响 5 个 stub），
而收益是让一个没人调用的接口变成正确——不值。**一个永远返回全零的统计接口
比不存在更危险。** 测试从断言 200 改为断言 404，把这个删除固化成回归。

**③ `migrations/253`：`api_keys.group_id` 外键 `ON DELETE SET NULL` → `RESTRICT`**

这是 11-14 事故的第二环，6.52 已查明机制但一直没做：

```
应用层允许删分组（v0.1.13 之前）
→ DB 的 SET NULL 把 Key 的 group_id 置空
→ 调度器找不到分组
→ 503 "No available OpenAI accounts"
→ 141 条 5xx
```

v0.1.14 修的是第一环（应用层拒绝删除），**数据库这一层当时仍然敞开着**——
任何绕过 `DeleteGroup` 的删除路径都能重新制造孤儿。现在两层都堵上。
执行前核实 `api_keys` 12 行、`group_id IS NULL` 为 0。

与 `usage_logs` 的分工（6.53 的 251 迁移）：历史账目允许分组消失（保持 SET NULL），
活跃配置不允许变孤儿（改为 RESTRICT）。

**④ `AccountExpiryService`：Stop 之后 Start 会静默失效**

`stopCh` 是一次性 channel。旧 `Start` 无任何防护，「先 Stop 再 Start」会起一个
goroutine，它先跑一次 `runOnce`，然后立刻命中已关闭的 `stopCh` 退出——
**定时暂停过期账号的功能再也不工作，且没有一条日志**。

生产上 Stop 只在进程退出时调用，所以从未被走到。但只要有人写「热重载配置」，
就会踩上。现在 Start 拒绝重复启动与 Stop 后重启，两种情况都留日志。

这个服务此前**零测试**（6.60 记录的覆盖率盲区之一）。新增 6 个用例，
其中两个用 `git stash` 验证过在旧实现下必然失败：

```
TestAccountExpiryServiceStartIsIdempotent        旧: calls=3 (期望 1)
TestAccountExpiryServiceStartAfterStopIsRefused  旧: calls=2 (期望 1)
```

**「测试能区分修复前后」是这轮唯一值得强调的验证方式**——否则测试全绿只说明
测试和实现自洽，不说明缺陷存在过。

#### 三、发布状态

```
golangci-lint 2.14.0（与 CI 同版本）  0 issues
go build ./...                       通过
后端相关包测试                        全绿
前端 vue-tsc -b                      通过
```

镜像由 tag `v0.1.20` 触发的 Release workflow 构建推 ghcr，服务器 pull 后走
`/root/zhijing-zero-downtime-deploy-v0.1.0.sh` 零停机切换。

