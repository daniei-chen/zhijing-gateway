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
