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

截至 2026-11-15 01:05（北京时间），生产版本是 **v0.1.11**（强制档位能力守卫）：

- Release：https://github.com/daniei-chen/zhijing-gateway/releases/tag/v0.1.11（「智境网关 0.1.11」）
- 源码提交：`96edb2e52`
- GHCR digest：`sha256:6e923bc88acc4337fb8dcfb3a638cb4a1d329d5202040044f27012edb6ba4475`
- 当前容器：`zhijing-api-v0111-final`，loopback 端口 **18808**
- 回滚容器：18807（v0.1.10）、18806（v0.1.9）。2026-11-15 已清理 18805/18804/18803/18802/18801/18799/18793
  七个容器连同它们在 nginx peers 块里的条目，磁盘 42%→35%（镜像 7.1GB→4.0GB）。
  要回到更老的版本只能重新 `docker pull` 镜像 + 起容器 + 把 `server 127.0.0.1:<port> backup;`
  加回 peers 块（改完必须 `nginx -t` 再 `systemctl reload nginx`）。
- **v0.1.11 切换证据**：`observe: 0 new 5xx within 180s, within limit`；切换后 7 个真实请求
  （user 4）全部成功，容器 `restart=0`，8 分钟内 0 条 error。
- **v0.1.11 的行为变化**：分组强制 Ultra Fast 时，先读账号
  `extra.upstream_model_metadata` 里该模型的 `service_tiers`；只有目录声明了 `ultrafast`
  才注入，否则回退 `priority`（并记 `[OpenAI Fast] ... only advertises priority; falling back`），
  目录里没有任何兼容档位时不注入。无目录快照的账号行为不变。
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
gateway_ok  accounts_ok  model_catalog_ok  model_route_ok
```

后两个是 2026-11-15 加的，起因是 gpt-5.6-luna 那 4 次 404：当时 `/readyz` 全绿、账号可调度、
5xx 为 0，**坏的只有「某个模型还能不能用」**。

- `model_catalog_age_hours` / `model_catalog_ok`：账号 `extra.upstream_model_metadata.synced_at`
  距今小时数，> 72h 告警。
- `model_not_found_6h` / `model_route_ok`：近 6 小时 `model_not_found` 计数，≥ 10 告警
  （客户端偶尔试一个不存在的模型名属正常，不算）。

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
