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

## 6. 上游审计规则

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
