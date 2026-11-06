# v0.0.3 · 浏览器会话与首响应诊断补丁

这是 **85 个通用源码与合成测试文件的差异**，基于已经运行的 v0.0.2 私有源码提交 `4851ca95b134322c14ca9904bc82c550a3880a67`，本次已打包候选私有源码提交为 `dcaf707cad583955873ed94097d63c9a4be12e82`。不包含完整后端、生产配置、数据库、真实请求内容或凭据；不能直接套用原版 Sub2API，也不能再次叠加历史 v0.0.2 补丁。

该提交已完成完整 `-tags unit -short ./...` 回归：64 个有执行包、12,561 个顶层测试通过，39 个测试事件及 51 个无执行包跳过；Go vet 与匹配内嵌资源的 Linux amd64 构建通过。85 文件在干净基线应用及摘要校验通过；12 包扩大定向 race 通过，1,238 个顶层测试、2,338 个含子例通过事件、14 个既有条件跳过。保留原四个名称批次并增加一个4项请求校验批次，五批均通过，12 是唯一包数，执行包事件共 49 次。Gin、配额缓存及邮箱缓存测试夹具竞争已修复，保留原业务断言与并行场景。完整重试来源摘要已包含并完成独立复验。**尚未部署生产，没有供应商推理速度改善的实测结论。** 公共 CI 只能核验补丁结构与摘要，无法编译未公开的完整后端。

## 改动

| 边界 | 行为 |
| --- | --- |
| OAuth 登录回调 | GitHub、Google、LinuxDo、OIDC 已有用户通过既有、与浏览器绑定且单次消费的待完成会话兑换；URL 不携带 access/refresh token。旧服务预先签发但未交付的刷新凭证会撤销。 |
| 浏览器登录 | 同源 HTTPS 浏览器显式选择 HttpOnly、Secure、SameSite=Strict、host-only、`/api/v1` Cookie；真实 JWT/刷新凭证不再返回给该模式的 JavaScript。 |
| 轮转与晚到响应 | 每次登录及刷新使用独立 Cookie 名称。公开 `zjs`/`zjr` 选择符本身不能认证；原 JWT、用户状态、角色与会话版本校验继续执行。 |
| 认证撤销 | Redis 原子消费刷新凭证，用户代际与会话家族撤销在 JWT／OAuth／管理员 WebSocket 中继续校验；已消费 RT 别名只用于撤销。混合凭据在修改前拒绝，撤销写入失败不报告成功。 |
| 存储启动检查 | 不可淘汰、同步 AOF 与健康状态缺一不可。专用短期连接池支持截止时间与提前取消；失败时停止新实例启动，业务池配置保持原值。 |
| 原客户端 | 未选择 Cookie 模式的 Bearer、API Key 和已有客户端保持原认证协议。HTTP 只允许真正回环地址的隔离测试。 |
| 诊断归因 | 请求 ID 淘汰后保留有界退休标记；碰撞或容量不足时停止不可靠关联，绝不回填另一条请求的数据。 |
| 首响应 | 新增上游写请求完成、首字节、首事件，以及有内容输出到达与成功刷新里程碑。保留原 TTFT 口径与 SSE 数据、调度和计费。 |
| 余额与订阅结果核对 | 新增余额、单项订阅延期和批量订阅的独立只读重放端点；按原管理员、目标、请求及幂等键查询已存结果，缺失、过期或不匹配时不重新执行。原写入服务、额度及有效期算法保持。 |
| 批量图片提交核对 | 已保存任务按原用户、密钥、请求与操作标识核对，不重新入队、选择上游或冻结费用；只读端点精确豁免耗尽余额检查，身份、停用、IP 和组访问限制继续执行。原提交服务保持原样。 |
| 图片重试来源 | 按原用户与密钥读取完整历史及分项，包含已隐藏祖先；缺失、重复、归属冲突或分页不完整时拒绝不完整摘要。重试使用当前可见任务入口，历史读取仅为快照，不是原子预留或计费执行。 |

HttpOnly 减少凭据被 JavaScript 直接读取的风险，不能阻止同源恶意脚本代用户操作。Cookie 模式要求前后端同源；跨域旧客户端继续使用原 Bearer 模式。管理员 WebSocket 的 Cookie 选择符也必须通过同源检查和原管理员认证。

## 运行条件与恢复

本补丁把撤销记录当作认证状态。Redis 必须使用以下运行条件，并允许应用执行这四个字段的 `CONFIG GET` 和 `INFO persistence`：

```conf
maxmemory-policy noeviction
appendonly yes
appendfsync always
no-appendfsync-on-rewrite no
```

启动时还要求 `loading:0`、`aof_enabled:1`、`aof_last_write_status:ok`。检查无权限、字段缺失、超时或值不符时，新实例在监听之前失败；不会自动修改 Redis。`always` 会增加共享 Redis 写入的磁盘等待，切流前需在隔离环境核验，不能把其成本说成网关提速。生产当前每秒落盘不满足新实例要求。

并行 API 实例必须精确设置 `ZHIJING_API_ONLY=1`，启动前及启动后均单独回读该值；`true` 或缺失会进入普通角色，启动清扫可能删除其他进程的在途并发租约。原安装状态、只读数据挂载、既有迁移与价格文件必须保持一致。API 角色仍有本实例的用量、账本与清理任务，不能等同于“没有后台工作”。

检查只覆盖启动时可验证的条件，不能发现运维恢复了相同配置的旧备份。恢复前先停止认证入口，使旧 JWT、旧 RT／别名和待完成认证票据失效，再恢复流量；只更换 JWT 签名秘密可能留下可兑换的旧 RT。不得 `FLUSHDB`／`FLUSHALL` 或丢弃共享卷，不能借重启旧单例清除在途租约。

## 本地复验

仓库根目录运行；目标必须是隔离的匹配源码工作树：

```bash
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --artifact-only
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source --apply
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source --verify-applied

cd /path/to/isolated-source/backend
go test -tags unit -short ./internal/handler/... ./internal/service ./internal/server/... ./internal/pkg/... ./internal/repository ./cmd/server
go test -race -tags unit -short ./internal/pkg/gatewaytiming ./internal/server/middleware ./internal/handler/... ./internal/service ./internal/repository \
  -run 'BrowserSession|OAuthLoginHandoff|History|Trace|ResponsesUseful|ResponsesOutputKind|RefreshSessionRedis|SessionSecurity|OpsWSSession|Revalidator|AuthStorePolicy|ProvideRedisAuthPolicy'
go vet ./internal/handler ./internal/service ./internal/server/... ./internal/pkg/gatewaytiming ./internal/repository
# 先恢复已独立核验的原 API peer 的 181 文件内嵌资源树至 internal/web/dist。
# 新公共工作台单独发布，不用它的 dist 替换这份兼容输入。
go test -tags 'unit embed' -short ./internal/web
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags embed -o /tmp/zhijing-api-v003-api-peer ./cmd/server
```

工具先核对明确列出的前置文件与所有补丁文件摘要，再执行 `git apply --check`；它不会部署、连接数据库或运行 SSH。摘要匹配说明这些文件一致，不替代完整后端来源审计。独立源码 ZIP 若将本目录平铺为 `integrations/sub2api/`，使用其附带的 `check_patch.py` 时省略 `--bundle`。

匹配候选的二进制摘要、Go 构建标志、冻结内嵌树逐文件摘要见[构建证据](../../../docs/proofs/v0.0.3-followup/backend-api-peer-build.json)。此前不带 `embed` 的 Linux 构建只验证编译，不能充当现有 API peer 的等价替换包；其 HTML 设置、CSP nonce 与静态资源服务面不同。

## 发布顺序与回退

本候选必须先验证并更新匹配后端，再发布前端。新前端拒绝可复用的 URL 登录 token；旧后端的 OAuth 回调因此不能与新前端混用。旧前端可沿用已存在的待完成会话流程，普通 Bearer 客户端继续可用；这不等于旧版本所有业务已完成浏览器验收。

用户已授权在原发布门禁通过后切换；当前仍需先使用独立实例验收认证、邮件、OAuth、管理员权限和流式请求，再按实际环境保留在途推理并切流。旧实例不理解新撤销代际，不能让其继续处理认证／长连接而宣称升级完成。本工具不修改单例服务、共享 Redis 租约或限额。回退时先让浏览器重新登录旧前端，待新实例在途请求退出后再处理后端；旧后端不识别新 Cookie 选择符，不能宣称回退无需重新登录。

入口热切后保留旧 peer；TCP 连接归零、共享槽位归零或容器 grace 时间均不能单独证明长流和异步用量已完成。停止旧实例需要该实例 handler、断连后上游采集与用量队列的共同排空证据。没有这些证据时继续保留，不依赖当前 5 秒 HTTP Shutdown 强制结束请求，也不重启 legacy 单例。

全局覆盖率仍低于 80%，当前交付为可审查候选。详见[本轮验证与剩余项](../../../docs/reviews/2026-11-06-v003-followup.zh-CN.md)。

新增备份请求校验保留空请求默认14天、0永久及合法正整数；非EOF解析错误和负数在启动备份前返回400。本轮仅候选交付，后续审查按用户要求暂停，未上线。
