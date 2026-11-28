# 测试分层：哪些测试今天没人在跑

基于 main `5600095a7`（2026-11-28）实测。所有数字都由本文第 2 节的命令跑出来，不是估的。

**一句话结论**：仓库有 1809 个 `_test.go`、13470 个 `func Test*`，CI（`.github/workflows/backend-ci.yml`）只跑 `unit`、`integration` 和无标签三块。**15 条 embed 测试（发布形态的唯一自动化保险）和 11 条 e2e 测试从未在 CI 上跑过**；windows、mcp_go_client_oauth 各 1 条属于平台/可选依赖路径，不接 CI，但下面给了能直接复制的手工命令；两个 deploy 脚本没接线。

## 1. 标签总表

"人工怎么跑"一列的命令全部在 `backend/` 目录下执行。

| 标签 | 测试文件 | 测试函数 | 今天谁跑 | 决定 | 为什么 | 人工怎么跑（在 `backend/`） |
|---|---|---|---|---|---|---|
| 无标签 | 1053 | 7626 | CI `test` job（两次 `-tags` 跑都会带上） | 保持 | 已覆盖 | `go test ./...` |
| `unit` | 645 | 5568 | CI `test` job → `make test-unit` | 保持 | 已覆盖 | `go test -tags=unit ./...` |
| `integration` | 103 | 246 | CI `test` job → `make test-integration` | 保持 | 已覆盖；注意它排在 unit 之后，unit 红则这一步跳过 | `go test -tags=integration ./...` |
| `embed` | 1 | 15 | **没人跑**。发布构建用 `-tags embed`，但测试不跑 | **接，每次 push** | 测的是"前端资源嵌进二进制"的发布形态（`Dockerfile:100`、`deploy/Dockerfile:76`、`.goreleaser.yaml:15`、`.goreleaser.simple.yaml:16`）。发布路径唯一的自动化保险，本机 `ok 1.498s` | `go test -tags=embed ./internal/web/ -count=1` |
| `e2e` | 3 | 11 | **没人跑**（`make test-e2e` 指向不存在的脚本，见 §3.6） | **接，仅 main** | HTTP 黑盒打整套栈，慢且要起 postgres/redis/网关；不适合每个 PR | 先按 §4.5 起栈，再 `go test -tags=e2e -v -count=1 -timeout=300s ./internal/integration/...` |
| `windows` | 1 | 1 | **没人跑**（CI runner 是 ubuntu/macos） | 不接 | CI 没有 Windows runner；属于客户端 relay 的平台路径。本机实测通过（§6.2） | `go test -tags=windows ./cmd/zhijing-client-relay/ -count=1 -v` |
| `mcp_go_client_oauth` | 1 | 1 | **没人跑** | 不接 | 可选依赖路径（官方 Go SDK 互操作验证），要拨 tag 才编进来；接进 CI 会抵消这个隔离。本机实测通过（§6.3） | `go test -tags=mcp_go_client_oauth ./internal/server/routes/ -run TestMCPOAuthOfficialGoSDKInteroperability -count=1 -v` |
| `!darwin` | 1 | 1 | **跑**（ubuntu 上 `!darwin` 成立，随 `-tags=unit` 编进去） | 保持 | 已覆盖，无需改动 | 随 `-tags=unit` 自动带上 |
| `!unit` | 1 | 0 | 跑（`-tags=integration` 时作为桩编进去） | 保持 | 是 helper 桩文件，没有测试用例 | 随 `-tags=integration` 自动带上 |

`TestMain` 说明：`internal/integration` 里有 1 个 `TestMain`，所以 `grep -c '^func Test'` 数出来是 12，`go test -list '.*'` 数出来是 11 条真用例。本表用后者。

补充两点口径：

- `backend-ci.yml` 里还有一个 `race` job，用 `-tags=unit` 只跑并发相关子集（`make test-race` → `backend/scripts/race-gate.sh`）。它是同一批标签的抽样，不改变上表的标签覆盖面；它今天的命中数与它为什么不会再静默空跑，见 §8。
- "今天谁跑"只看 `.github/workflows/`。发布流水线（`.goreleaser*.yaml`、`Dockerfile`）会用 `-tags embed` **构建**，但那里没有测试步骤。


## 2. 普查怎么做的

```bash
# 所有 build 行（含非测试文件）
grep -rn "^//go:build" backend --include=*.go | sed 's/.*\/\/go:build //' | sort | uniq -c | sort -rn

# 按标签数测试文件
grep -rl "^//go:build unit$" backend --include=*_test.go | wc -l        # 645
grep -rl "^//go:build integration$" backend --include=*_test.go | wc -l  # 103
grep -rl "^//go:build e2e$" backend --include=*_test.go | wc -l          # 3

# 按标签数测试函数
grep -rl "^//go:build unit$" backend --include=*_test.go | xargs grep -h '^func Test' | wc -l   # 5568

# 权威口径：Go 自己认出多少条
cd backend
go test -tags=embed ./internal/web/ -list '.*' | grep -c '^Test'              # 15
go test -tags=e2e   ./internal/integration/ -list '.*' | grep -c '^Test'      # 11
```

**为什么"文件数"不等于"真跑了"** —— tag 直接决定哪些文件被编进来。同一个 `internal/web` 包：

```bash
$ go list -f '{{.TestGoFiles}}' ./internal/web/
[]                                                   # 无标签：一个测试文件都没有
$ go list -tags=unit -f '{{.TestGoFiles}}' ./internal/web/
[spa_fallback_test.go static_cache_test.go]          # 6 条
$ go list -tags=embed -f 'TestGo: {{.TestGoFiles}} | Go: {{.GoFiles}}' ./internal/web/
TestGo: [embed_test.go] | Go: [embed_on.go html_cache.go spa_fallback.go static_cache.go]
```

对应 `-list` 的条数：无标签 **0**、`-tags=unit` **6**、`-tags=embed` **15**。注意 embed 那一跑里 `spa_fallback_test.go`/`static_cache_test.go` 反而被排除（它们是 `//go:build unit`），所以 **embed job 和 unit job 不是重叠关系，是互补关系**。

`internal/integration` 更极端：整个包只有 `//go:build e2e` 三个文件，无标签时 `go list` 直接报 `build constraints exclude all Go files`，`go test ./...` 连包名都不会列出来——所以它既不红也不绿，是**不存在**。

## 3. 逐类判断

### 3.1 embed：接进 CI，每次 push

理由：`internal/web/embed_test.go` 15 条测试覆盖的是发布构建才有的代码路径（`embed_on.go`、`html_cache.go`），而 unit job 跑的是 `embed_off.go` 那条。也就是说**今天 CI 绿，完全不能说明发布镜像里的前端资源是对的**。

本机实测（§6.1）：`ok github.com/daniei-chen/zhijing-gateway/internal/web 1.498s`。CI 冷缓存要加编译时间，但仍然是个位数分钟以内的事。

### 3.2 e2e：接进 CI，PR 与 main 两档

见 §4 的前置条件。要点：11 条测试是 HTTP 黑盒，需要一整套跑起来的栈；其中只有 2 条（用户注册/登录 + API Key 生命周期）能在没有上游账号的情况下真正验证东西，另外 9 条需要真实 API Key 和上游账号。

2026-11-28 起它不再只在 main 上跑（`pull_request` 也会真跑），并分成两档：

| 档 | 触发 | 跑什么 | 条数下限 |
|---|---|---|---|
| `pr` | `pull_request` | `-run '^(TestUserRegistrationAndLogin\|TestAPIKeyLifecycle\|TestAPIKeyRevocationIsImmediate\|TestRegistrationSwitchIsEnforcedBothWays)$'` | `E2E_MIN_TOP_LEVEL_PASS: 4` |
| `full` | `main` push、`workflow_dispatch` | 全包（11 条顶层） | `E2E_MIN_TOP_LEVEL_PASS: 4` |

下限写在 workflow 的 job env 里，是一个脚本要核的数字，不是注释：断言步数行首的 `--- PASS: `，低于下限直接红。**4 是实测出来的数字，不是目标也不是整数拍脑袋**：pr 档跑 4 条、4 条全 PASS；full 档多跑的 9 条是 SKIP（缺上游密钥），不计入 PASS。要再抬，得先让那 9 条能被真跑（见 §4.4），否则下限只是把「跑 4 条也算过」写得更正式。

2026-11-28 实测（#56 第一轮，run `46135841927`）：`stack_ready=292s`、`tests_done=304s`、`top_level_pass=2 top_level_fail=0`。也就是说 **一整轮的成本 96% 在起栈，跑用例只占 12 秒**——加用例的边际成本是秒级，成本在镜像构建与起栈上，所以缓存打在构建上（`docker/build-push-action` + `cache-from/to: type=gha`，compose 里显式 `image: zhijing-gateway:dev`）。

### 3.3 windows：不接，给命令

CI runner 是 `ubuntu-latest` / `macos-15`，没有 Windows。这条测的是 `cmd/zhijing-client-relay` 的系统代理识别（`parseLoopbackProxy`），只在 Windows 上有意义。

```bash
cd backend
GOOS=windows go test -tags=windows ./cmd/zhijing-client-relay/ -run TestWindowsProxyOnlyAcceptsCurrentCredentialFreeLoopback -count=1 -v
```

在 Windows 上直接 `go test -tags=windows ./cmd/zhijing-client-relay/ -count=1` 即可，不用 `GOOS`。**本机实测通过**（§6.2）。

### 3.4 mcp_go_client_oauth：不接，给命令

`internal/server/routes/mcp_oauth_sdk_test.go` 用官方 `github.com/modelcontextprotocol/go-sdk`（`backend/go.mod:34`，`v1.4.1`）驱动完整的 OAuth 发现/注册/PKCE/换取/刷新流程，验证我们的 MCP OAuth 端点与官方 SDK 互通。它默认不编译，只有显式拨 tag 才进来——这是有意的可选依赖隔离，接进 CI 会把这个隔离抵消掉。

```bash
cd backend
go test -tags=mcp_go_client_oauth ./internal/server/routes/ -run TestMCPOAuthOfficialGoSDKInteroperability -count=1 -v
```

**本机实测通过**（§6.3），依赖已在 `go.mod`，不需要额外 `go get`。

### 3.5 deploy 的两个脚本：接进 CI

两个都是纯文件系统检查（`grep -Fq` 核仓库文件），不联网、不起容器：

| 脚本 | 检查什么 | 解释器 | 本机耗时 |
|---|---|---|---|
| `deploy/tests/phase1-hardening-doc-test.sh` | `docs/security/2026-11-27-phase1-hardening.md` 里每条"已落地"都能在仓库里核到，且不把已落地的写成 pending | `/bin/sh` | 1.8s |
| `deploy/tests/install-github-token-test.sh` | `deploy/install.sh` 的 `UPDATE_GITHUB_TOKEN` 只进 API 请求头，不泄漏到 argv、`.curlrc`、环境；token 缺失时回落到 `GITHUB_TOKEN`/`GH_TOKEN` | `/bin/bash`（用了 `set -euo pipefail` 和 `source <(...)`） | 4.1s |

两者在 main 上都是绿的（§6.4、§6.5），所以接线只是把它们纳入门禁，不是"接线顺手修红"。

**放哪个 job 有讲究**：`install-github-token-test.sh` 用了 GNU 的 `head -n -1`（`deploy/tests/install-github-token-test.sh:26`），而 macOS 的 BSD `head` 对负行数直接报 `head: illegal line count -- -1`。所以这两个检查要放在 **ubuntu** 的 `test` job，不能跟着其他 `deploy/tests/*` 进 `shell` job（那是 `macos-15`）——放进去第一天就是假红。

### 3.6 顺带发现：`make test-e2e` 是死链

`backend/Makefile:26-27`：

```make
test-e2e:
	./scripts/e2e-test.sh
```

`backend/scripts/` 里只有 `finalize-ingress-reject-cleanup.sql` 和 `resolve-version.sh`，**`e2e-test.sh` 在整个仓库不存在**（`find . -name 'e2e-test.sh'` 无输出）。所以 `make test-e2e` 一定失败，真正能用的是 `make test-e2e-local`（`backend/Makefile:29-30`）。

这解释了 e2e 为什么从来没跑起来：那个本该负责"起栈 + 灌数据 + 跑测试"的脚本没被写出来。本文档不修它（超出本次范围），但 e2e job 的设计必须绕开它。

## 4. e2e 的前置条件（实测）

### 4.1 它是什么

`internal/integration/e2e_*.go` 全部是 HTTP 黑盒，打 `BASE_URL`（默认 `http://localhost:8080`，`e2e_gateway_test.go:19`）。`TestMain`（`e2e_gateway_test.go:70`）只打印环境信息，不做任何启动——**它不会帮你把服务拉起来**。

### 4.2 11 条测试各自要什么

| 测试 | 门槛 | 没有门槛时 |
|---|---|---|
| `TestClaudeModelsList`、`TestClaudeMessages`、`TestClaudeMessagesWithComplexTools`、`TestClaudeMessagesWithThinkingAndTools`、`TestClaudeMessagesWithNoSignature` | `CLAUDE_API_KEY` 非空 | `t.Skip` |
| `TestGeminiModelsList`、`TestGeminiGenerateContent` | `GEMINI_API_KEY` 非空 | `t.Skip` |
| `TestClaudeMessagesWithGeminiModel`、`TestGeminiEndpointWithClaudeModel` | `ENDPOINT_PREFIX=/antigravity` | `t.Skip("仅在 Antigravity 模式下运行")` |
| `TestUserRegistrationAndLogin` | 栈在跑且 `/api/v1/auth/register`、`/api/v1/auth/login`、`/api/v1/user/profile` 存在 | **任何非 200 都 `t.Fatalf`**（2026-11-28 起）。此前 404 被当成「继续尝试」，整条测试降级成 skip，所以它自接入起从未绿过也没人发现 |
| `TestAPIKeyLifecycle` | 栈在跑 + 能登录（`ADMIN_EMAIL`/`ADMIN_PASSWORD`，否则用测试用户） | **登录失败即 `t.Fatalf`**（2026-11-28 起）。`/v1/models` 返回 402/403 仍算通过（栈里没有上游账号），其它状态码硬失败；**并用一个伪造 Key 做对照，要求它被拒成 401**，这样 402/403 才是「鉴权过了但没有账户」的证据，而不是鉴权坏了对谁都回同一个码 |

注意 `CLAUDE_API_KEY` / `GEMINI_API_KEY` 是**网关自己签发的 API Key**（`Authorization: Bearer` 打 `baseURL`，`e2e_gateway_test.go:113`），不是上游厂商的 key。

### 4.2.1 面板路径必须带 `/api/v1`

`e2e_user_flow_test.go` 打的是 `internal/server/routes/` 里真实注册的路径：注册/登录在 `auth.go:35`/`:38`（`v1.Group("/auth")`），当前用户是 `user.GET("/profile")`（`user.go:31`，**不是** `/user/me`），API Key 是 `keys.POST("")`（`user.go:87`），用量看板是 `usage.GET("/dashboard/stats")`（`user.go:115`）。这一组此前写成了不带 `v1` 的 `/api/auth/...`、`/api/user/me`、`/api/usage/dashboard`，路由根本不存在。

**这一层的教训不是"改路径"，是"测试不许靠 skip 自己通过"**：非 200 一律 `t.Fatalf`，并让 `Assert the stack-backed tests actually ran` 继续兜底（父测试 PASS 但子测试全 skip 时它会红）。

### 4.3 `E2E_MOCK` 不能救场

`e2e_helpers_test.go:14` 的注释说"当 `E2E_MOCK=true` 时，使用本地 Mock 响应替代真实 API 调用"，但**整套后端没有任何 mock 实现**：

```bash
$ grep -rn "E2E_MOCK" backend --include=*.go | grep -v _test.go
# 无输出
```

`isMockMode()` 只被 `skipIfNoRealAPI` 用了一次（`e2e_helpers_test.go:25`），作用是**不跳过**。所以 `E2E_MOCK=true` 会让测试真的去打网关、真的去要上游账号——不是 mock，是解除跳过。

### 4.4 所以 e2e job 能诚实地跑什么

在没有上游账号的 CI 里，**只有 2 条能真正验证**：`TestUserRegistrationAndLogin`（管理员打开注册开关 → 注册 → 登录 → JWT → `/api/v1/user/profile`）和 `TestAPIKeyLifecycle`（建 Key → 用 Key 打 `/v1/models` → 查用量）。这 2 条覆盖的是真实的 HTTP 路由、鉴权、DB 写入，价值不低。

另外 9 条会在没有 key 时跳过——这正是「绿得没有意义」的风险点，所以 job 里有两层断言：**这 2 条必须是 `PASS` 而不是 `SKIP`**，且**顶层 `--- PASS:` 的条数不得低于下限**（`E2E_MIN_TOP_LEVEL_PASS`）。只有第一层不够：拿一个更窄的 `-run` 就能让整个包秒过，而那 2 条断言照样全绿。

把 9 条 SKIP 变成真断言的办法不是再加几条打本地 admin 接口的用例，而是**在栈里放一个假的 OpenAI 兼容上游**：那样转发、计费扣费、配额、模型列表、上游错误映射（4xx 与超时各一条）才真正被走过。在这条到位之前，下限就停在 2——写大了只是换一种假绿。

要真跑那 9 条，需要一个配好真实上游账号的 staging 环境（不是 CI 里临时起的栈）：

```bash
export BASE_URL="https://<staging>"
export CLAUDE_API_KEY="<网关签发的 key>"
export GEMINI_API_KEY="<网关签发的 key>"
cd backend && go test -tags=e2e -v -timeout=300s ./internal/integration/
```

### 4.5 起栈要什么（按 `deploy/docker-compose.dev.yml` 读出来的）

- 三个服务：`zhijing-gateway`（从本仓库源码 build）、`postgres`、`redis`
- 必填：`POSTGRES_PASSWORD`（compose 里是 `${POSTGRES_PASSWORD:?}`，不填直接报错）
- `AUTO_SETUP=true` 才会自动跑迁移
- 容器以 `user: "1000:1000"` 跑且 `read_only: true`，挂载 `./data:/app/data`，所以宿主要先建好 `data/` 并给 uid 1000 写权限
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` 用来让首次启动创建管理员——这既是 `TestAPIKeyLifecycle` 的登录凭据，也要 export 到跑测试的那个进程里
- 端口默认 `${BIND_HOST:-127.0.0.1}:${SERVER_PORT:-8080}:8080`，正好对上测试的 `BASE_URL` 默认值
- **redis 必须以 `--appendfsync always` 运行**：网关启动时检查 `maxmemory-policy=noeviction`、`appendonly=yes`、`appendfsync=always`、`no-appendfsync-on-rewrite=no` 和 AOF 可写状态（`INFO persistence` 的 `loading`/`aof_enabled`/`aof_last_write_status`），任一条不满足就拒绝启动，容器退出并被 `restart: unless-stopped` 反复拉起（日志：`Failed to initialize application: auth store policy: appendfsync must be always`）。改 `deploy/docker-compose*.yml` 里 redis 的 `command:` 之前先看 `backend/internal/repository/auth_store_policy.go`；`deploy/tests/redis-auth-store-durability-test.sh` 在 CI 里守这条，取值直接从那边的表里读。走 `docker-compose.standalone.yml`（外接 redis）的部署要自己在那个 redis 上设这四项。

**本机没有 docker**（`docker: command not found`），§4.5 的每一步都没有在真机上跑过。**这是 e2e job 唯一未经实测的部分，合并后首次 main push 是它的第一次真跑。**

## 5. 手动执行清单（可直接复制）

```bash
# --- embed：发布形态，最重要，也最便宜 ---
cd backend && go test -tags=embed ./internal/web/ -count=1

# --- e2e：先起栈（需要 docker）---
cd deploy
mkdir -p data && chown -R 1000:1000 data        # Linux；容器以 1000:1000 跑且 read_only
export POSTGRES_PASSWORD='...' REDIS_PASSWORD='...'
export ADMIN_EMAIL='admin@local' ADMIN_PASSWORD='...'
export JWT_SECRET="$(openssl rand -hex 32)" TOTP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
docker compose -f docker-compose.dev.yml up -d --build
curl -fsS http://127.0.0.1:8080/health && curl -fsS http://127.0.0.1:8080/readyz  # 等这个过了再跑测试

# --- e2e：跑（后台进程要能看到 ADMIN_EMAIL/ADMIN_PASSWORD）---
cd ../backend && go test -tags=e2e -v -count=1 -timeout=300s ./internal/integration/...
# 只有 2 条真跑，9 条 SKIP 属预期；要 9 条也跑见 §4.4

# --- 平台 / 可选依赖两条 ---
cd backend && go test -tags=windows ./cmd/zhijing-client-relay/ -count=1 -v
cd backend && go test -tags=mcp_go_client_oauth ./internal/server/routes/ -run TestMCPOAuthOfficialGoSDKInteroperability -count=1 -v

# --- 两个 deploy 脚本 ---
sh deploy/tests/phase1-hardening-doc-test.sh
/bin/bash deploy/tests/install-github-token-test.sh
```

## 6. 本次实测输出

环境：Windows x86_64，`go1.27.4 windows/amd64`，`export GOSUMDB=sum.golang.org`。

### 6.1 embed

```
$ cd backend && go test -tags=embed ./internal/web/ -count=1
ok  	github.com/daniei-chen/zhijing-gateway/internal/web	1.498s
```

（进程总耗时约 91s，其中约 90s 是首次编译；测试本身 1.498s。）

### 6.2 windows

```
$ go test -tags=windows ./cmd/zhijing-client-relay/ -run TestWindowsProxyOnlyAcceptsCurrentCredentialFreeLoopback -count=1 -v
=== RUN   TestWindowsProxyOnlyAcceptsCurrentCredentialFreeLoopback
--- PASS: TestWindowsProxyOnlyAcceptsCurrentCredentialFreeLoopback (0.00s)
PASS
ok  	github.com/daniei-chen/zhijing-gateway/cmd/zhijing-client-relay	0.285s
```

### 6.3 mcp_go_client_oauth

```
$ go test -tags=mcp_go_client_oauth ./internal/server/routes/ -run TestMCPOAuthOfficialGoSDKInteroperability -count=1
ok  	github.com/daniei-chen/zhijing-gateway/internal/server/routes	1.779s
```

### 6.4–6.5 deploy 两个脚本

```
$ sh deploy/tests/phase1-hardening-doc-test.sh
phase1 hardening doc test passed                    # exit=0

$ /bin/bash deploy/tests/install-github-token-test.sh
install GitHub token checks passed                  # exit=0
```

### 6.6 没有栈时 e2e 不会假绿

```
$ go test -tags=e2e ./internal/integration/ -run TestUserRegistrationAndLogin -count=1 -v
🚀 E2E Gateway Tests - http://localhost:8080 (prefix="", 混合模式, CLAUDE_API_KEY=false, GEMINI_API_KEY=false)
=== RUN   TestUserRegistrationAndLogin/注册新用户
    e2e_user_flow_test.go:38: 注册接口不可用，跳过用户流程测试: ... dial tcp [::1]:8080: connectex: ...
--- FAIL: TestUserRegistrationAndLogin (0.05s)
    --- SKIP: TestUserRegistrationAndLogin/注册新用户 (0.04s)
    --- FAIL: TestUserRegistrationAndLogin/用户登录获取JWT (0.00s)
FAIL
```

结论：栈没起来时这条会红，不会悄悄绿。这对 e2e job 是好事——它意味着 job 红了一定有原因。

## 7. 待核项

1. **e2e job 的起栈步骤未经实测**：本机没有 docker，§4.5 / §5 的 compose 段落只做了静态阅读。合并后首次 main push 是首次真跑。
2. **9 条上游相关 e2e 仍然是盲区**：需要一配有真实上游账号的 staging 才能跑，CI 里解决不了。
3. **`make test-e2e` 死链未修**：`backend/Makefile:27` 指向不存在的 `scripts/e2e-test.sh`。要么补脚本（起栈+灌数据），要么把这行删掉指向 `test-e2e-local`。本文档不动它。
4. **`integration` 步依赖 unit 步**：`backend-ci.yml:43-48` 是顺序 step，unit 红则 integration 一起跳过（历史上发生过）。要不要拆成并行 job 是另一个决定。
5. **`E2E_MOCK` 的实现与注释不符**：`e2e_helpers_test.go:14` 说 mock 上游，实际只解除跳过。要么实现 mock，要么把注释改对。本文档不动测试代码。

## 8. 必检不许"命令退 0 但什么都没跑"（2026-11-28，基于 `a5176cb4d`）

9 个必检（含 `embed`）今天都真跑、没有 job 级条件跳过。但"今天真跑"不是机制：下面三条通路
都能让某条必检在没人察觉的情况下变绿，现在每条都补了断言，并且都验过"改之前绿、改之后红"。

| 位置 | 原来的静默绿 | 现在 | 红的样子（实测） |
|---|---|---|---|
| `race` job | `-run` 零命中时 `go test` 退 0，只打 `[no tests to run]`。改名一个测试、把并发用例挪出 `internal/service`/`internal/handler`、或改坏正则，都会变成什么都没验。 | `backend/scripts/race-gate.sh` 数 `-v` 输出里的 `^=== RUN`（不含子测试），低于 **1300** 就红。今天的真实命中数是 **1431**，余量 9%。 | `race gate: only 0 tests ran, floor is 1300.` |
| `release-helpers` job | `python -m unittest discover -s .github/release-tools -p 'test_release_matrix.py'` 匹配不到文件时退 0，打 `Ran 0 tests`。 | `.github/release-tools/run-tests.sh`：显式模块路径（模块不存在时 unittest 自己报错）+ `Ran N tests` 下限 **10**（今天的真实用例数）。 | `release matrix tests: ran 0 tests, floor is 10` |
| `shell` job → `deploy/tests/docker-runtime-resources-test.sh` | 找不到能跑的解释器时打 `skip: no runnable python interpreter found` 仍退 0，`py_compile` 断言静默消失。macos-15 镜像自带 python3，所以这个分支只会因为环境坏掉而出现——写成 skip 正好吃掉唯一一次告警。 | skip 分支改成 `fail`。 | `docker runtime resources test failed: no runnable python interpreter...` |

另外两条同一性质的修补：

- **`frontend-security` 的豁免通道以前永远用不上**：`pnpm audit --audit-level=high` 命中 high 时命令自己退非零，那一步先红，`tools/check_pnpm_audit_exceptions.py` 根本没机会跑，`.github/audit-exceptions.yml` 对 high/critical 是死配置。现在只有那条命令带 `|| true`，紧跟一步 `tools/assert_pnpm_audit_report.py` 断言报告可解析且含 `metadata.vulnerabilities`（`{}` 在豁免脚本眼里等于"没有漏洞"，所以这一步是承重的），判定权仍归豁免脚本。`tools/check-pnpm-audit-exceptions-test.py` 喂真实形状的报告验五种情形：未豁免 high 红、已豁免绿、过期红、干净绿、只有 low 绿。
- **`govulncheck` 版本钉死**：`@latest` 换成 `@v1.10.0`（2026-11-28 `@latest` 实际解析到的版本），不让上游发坏版本把必检无缘无故变红。

下限是粗粒度闸，说清它挡不住什么：它挡的是「整批消失」（race 少 131 条以上）、
「过滤器指向空集合」和「job 被条件跳过」；**挡不住单个并发用例改名后悄悄退出抽样**——
那需要一份用例名清单，代价是每次合法改名/新增都要同步，本轮不做。这条残余缺口写在这里，
不要当成已经挡住了。

**还有一条防复发**：`deploy/tests/ci-workflow-guards-test.sh`（入口在 `release-helpers` job 里跑，
断言本体是 `deploy/tests/ci_workflow_guards_test.py`）守四件事：

1. **9 个必检 job 块里不出现 `if` / `paths` / `paths-ignore` / `continue-on-error` / `needs`。**
   `needs` 在这张清单里是因为**依赖失败的 job 会被 skip，而 GitHub 把 skip 报告成 Success**——
   一条 `needs: [frontend]` 就足以让某个必检在某些 PR 上"绿着不跑"。唯一豁免是 `needs` 与
   `if: always()` 同时出现（`always()` 让 job 无论如何都跑，skip 这条路被堵死）；`if` 的其他写法
   一律红，`if: always() && ...` 这种组合也红。`if: always()    ` 的尾随空格、`if: 'always()'` 的
   引用形式都先 strip 再比——YAML 里它们是同一个值。
2. **触发面**：承载必检的 workflow 必须仍由 `pull_request` 触发，且它下面不得有
   `branches` / `branches-ignore`（按 base 过滤，stacked PR 的 base 不是 main 就一条检查都不排队）
   或 `paths` / `paths-ignore`（只改文档的 PR 同样一条检查都没有）。`types` **有意不在禁列**：
   它让后续 push 不重跑，但 check run 挂在 head sha 上，不触发就是新 head 上没有 check run，
   分支保护照样卡住合并——失败形态是死锁，产生不了假通过；而
   `[opened, synchronize, reopened, ready_for_review]` 是常见合法写法。
3. **每个 `| tee` 之后必须读 `PIPESTATUS`**。`cmd | tee log` 的 `$?` 是 `tee` 的退出码，只靠
   `set -o pipefail` 才能拿到左边那条命令的——pipefail 一旦被去掉（把头部改成 `set -eu` 是最
   常见的改法），`|| status=$?` 就永远不触发：一条失败的测试会打印出 `FAILED (failures=1)` 之后
   照样退 0。2026-11-28 的审查就是靠 `set +o pipefail` 对照抓出来的。
4. `race` 的 `-run` 正则今天仍命中 ≥ 下限条测试（静态模型，与运行时逐条对齐，今天 1431）。

**为什么改用解析而不是正则**（2026-11-28）：按字面 `key:` 写的正则被三种 YAML 等价写法全部
绕过——`needs : [frontend]`、`if : ...`、`"needs": [frontend]`，解析出来的键就是 `needs` / `if`，
正则一条都接不住，只有规范写法能被抓到。现在用 `yaml.safe_load` 解析文档再断言键；
`deploy/tests/ci_workflow_guards_matrix.py` 用同一份注入矩阵同时跑新旧守卫，新守卫全中、旧守卫
漏掉其中 6 个变体，那张表就是"改之前漏、改之后不漏"的成对证据。

解析器本身也要自证：喂真实 workflow 断言抽出来的**具体键**（不是"能 load 就算过"），并且空文档
与语法非法都必须硬失败——空字典会让所有"键不在里面"的断言全部通过，那是比正则漏词更彻底的
静默洞。

**为什么跑在 `release-helpers` 而不是 `shell`**：PyYAML==6.0.3 已经在
`.github/release-tools/requirements-release.txt` 里钉死并由那个 job 安装，零网络；macos 的
`shell` job 要多装一套 python 才有同一个解析器。HOME-3 的要求是只留一个解析器、不许运行时
回退（回退分支在 CI 里永远跑不到，是一段没人验的代码），所以放在那个已经保证有它的 job 里。

本地复跑：

```bash
sh deploy/tests/ci-workflow-guards-test.sh        # 9 个 job + race 正则命中数
sh deploy/tests/ci-race-job-test.sh               # race job 的形状（含 race-gate.sh 的断言）
bash .github/release-tools/run-tests.sh           # 发布矩阵：显式模块 + 下限 10
python tools/check-pnpm-audit-exceptions-test.py -v
```
