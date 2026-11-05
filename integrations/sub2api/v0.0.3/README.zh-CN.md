# v0.0.3 · 浏览器会话与首响应诊断补丁

这是 **23 个通用源码与合成测试文件的差异**，基于已经运行的 v0.0.2 私有源码提交 `4851ca95b134322c14ca9904bc82c550a3880a67`。不包含完整后端、生产配置、数据库、真实请求内容或凭据；不能直接套用原版 Sub2API，也不能再次叠加历史 v0.0.2 补丁。

本轮已完成本地短回归、定向 race、Go vet 与 Linux amd64 交叉构建。**尚未部署生产，没有供应商推理速度改善的实测结论。** 公共 CI 只能核验补丁结构与摘要，无法编译未公开的完整后端。

## 改动

| 边界 | 行为 |
| --- | --- |
| OAuth 登录回调 | GitHub、Google、LinuxDo、OIDC 已有用户通过既有、与浏览器绑定且单次消费的待完成会话兑换；URL 不携带 access/refresh token。旧服务预先签发但未交付的刷新凭证会撤销。 |
| 浏览器登录 | 同源 HTTPS 浏览器显式选择 HttpOnly、Secure、SameSite=Strict、host-only、`/api/v1` Cookie；真实 JWT/刷新凭证不再返回给该模式的 JavaScript。 |
| 轮转与晚到响应 | 每次登录及刷新使用独立 Cookie 名称。公开 `zjs`/`zjr` 选择符本身不能认证；原 JWT、用户状态、角色与会话版本校验继续执行。 |
| 原客户端 | 未选择 Cookie 模式的 Bearer、API Key 和已有客户端保持原认证协议。HTTP 只允许真正回环地址的隔离测试。 |
| 诊断归因 | 请求 ID 淘汰后保留有界退休标记；碰撞或容量不足时停止不可靠关联，绝不回填另一条请求的数据。 |
| 首响应 | 新增上游写请求完成、首字节、首事件，以及有内容输出到达与成功刷新里程碑。保留原 TTFT 口径与 SSE 数据、调度和计费。 |

HttpOnly 减少凭据被 JavaScript 直接读取的风险，不能阻止同源恶意脚本代用户操作。Cookie 模式要求前后端同源；跨域旧客户端继续使用原 Bearer 模式。管理员 WebSocket 的 Cookie 选择符也必须通过同源检查和原管理员认证。

## 本地复验

仓库根目录运行；目标必须是隔离的匹配源码工作树：

```bash
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --artifact-only
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source --apply
python3 integrations/sub2api/check_patch.py --bundle v0.0.3 --root /path/to/isolated-source --verify-applied

cd /path/to/isolated-source/backend
go test -short ./internal/handler ./internal/service ./internal/server/... ./internal/pkg/... ./internal/repository
go test -race ./internal/pkg/gatewaytiming ./internal/server/middleware ./internal/handler ./internal/service \
  -run 'TestBrowserSession|TestOAuthLoginHandoff|TestHistory|TestTrace|TestResponsesUseful|TestResponsesOutputKind'
go vet ./internal/handler ./internal/service ./internal/server/... ./internal/pkg/gatewaytiming ./internal/repository
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /tmp/zhijing-api-v003 ./cmd/server
```

工具先核对明确列出的前置文件与所有补丁文件摘要，再执行 `git apply --check`；它不会部署、连接数据库或运行 SSH。摘要匹配说明这些文件一致，不替代完整后端来源审计。独立源码 ZIP 若将本目录平铺为 `integrations/sub2api/`，使用其附带的 `check_patch.py` 时省略 `--bundle`。

## 发布顺序与回退

本候选必须先验证并更新匹配后端，再发布前端。新前端拒绝可复用的 URL 登录 token；旧后端的 OAuth 回调因此不能与新前端混用。旧前端可沿用已存在的待完成会话流程，普通 Bearer 客户端继续可用；这不等于旧版本所有业务已完成浏览器验收。

后续若获准切换，先使用独立实例验收认证、邮件、OAuth、管理员权限和流式请求，再按实际运行环境保留在途请求并切流。本工具不修改单例服务、共享 Redis 租约或限额。回退时先让浏览器重新登录旧前端，待新实例在途请求退出后再处理后端；旧后端不识别新 Cookie 选择符，不能宣称回退无需重新登录。

全局覆盖率仍低于 80%，当前交付为可审查候选。详见[本轮验证与剩余项](../../../docs/reviews/2026-11-05-v003-repair.zh-CN.md)。
