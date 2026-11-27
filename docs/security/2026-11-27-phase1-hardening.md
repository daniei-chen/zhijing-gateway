# 阶段一：默认配置止血（2026-11-27）

这份文档记录阶段一五条改动：改了什么、升级后会发生什么、之后还能怎么收紧。来源是阶段一四线程与应用层硬门的改动（父 issue DAN-4，子项 DAN-5 / DAN-6 / DAN-7 / DAN-8 / DAN-27），加上本 PR 把源站拒绝清单和校验脚本收进仓库的部分。

**怎么读状态**：每条都标了「仓库状态」。标 pending 的表示本文写作时 `main` 上还是旧行为，具体实现以对应的 issue 与 PR 为准；标 PR #NN 的表示改动已经开 PR、尚未合并。这里不写没在仓库里验证过的东西，也不重述审计报告。

## 一览

| # | 改动 | issue | 仓库状态 |
|---|---|---|---|
| 1 | Docker / Apple container 发布端口默认回环 | DAN-5 | PR [#22](https://github.com/daniei-chen/zhijing-gateway/pull/22)，待合并 |
| 2 | 转发头信任默认 `false`，不再静默回翻 | DAN-6 | pending |
| 3 | 首启 setup 服务只绑回环 | DAN-7 | pending |
| 4 | CI 增加 race 检测任务 | DAN-8 | pending |
| 5 | `/admin/system/update` 应用层硬门 + 源站 403 清单入仓 | DAN-27 | 硬门 pending；模板与校验脚本见本 PR |

这五条的共同点是：它们各自都不算漏洞，但默认值拼起来就是一条链 —— 直连 8080 绕过反代、伪造转发头冒充内网来源、首启向导对全网开放、换二进制只靠一层运维记得配的 403。

## 1. 发布端口默认回环（DAN-5）

**之前**：`deploy/docker-compose.yml:38`、`docker-compose.local.yml:46`、`docker-compose.standalone.yml:34` 都是 `${BIND_HOST:-0.0.0.0}`，`deploy/.env.example` 也写着 `BIND_HOST=0.0.0.0`，`deploy/apple-container.sh:431` 的回退默认值同样是 `0.0.0.0`。装完即可从任何网卡直连宿主 `8080`，反向代理上的 TLS、限流、来源限制全部可以绕开。

**改法**：默认值改为 `127.0.0.1`（`docker-compose.dev.yml` 原本就是），`.env.example` 同步并写清 opt-in 方式，`apple-container.sh` 的回退值同步。Apple `container` 没有必须绑 `0.0.0.0` 的网络约束：`--publish` 接受 host IP，回环只影响谁能连到发布端口。

**升级后会发生什么**：

- 依赖旧默认 `0.0.0.0` 直连 `8080` 的部署，在 Compose 文件更新后（`docker-deploy.sh` 会重新下载，手动部署会拉新的 `deploy/`）只在回环上监听，需要显式 `BIND_HOST=0.0.0.0` 才能继续直连。
- 经反向代理访问的部署不受影响，反代本来就连 `127.0.0.1:8080`。
- 已有 `.env` 文件不会被改动；只有 `.env` 里没写 `BIND_HOST` 的部署才会吃到默认值变化。

**怎么继续收紧**：保持回环 + 反代。确实需要直连时，`BIND_HOST=0.0.0.0` 加防火墙限源，并记进变更单 —— 这两件事必须同时做，只做前一件就是回到阶段一之前。

**怎么验证**：`deploy/tests/bind-host-default-test.sh`（随 PR #22 一起入库，断言四个 compose 的发布地址取自 `${BIND_HOST:-...}` 且默认回环，并覆盖 `.env.example` 与 `apple-container.sh` 的回退值）；手工确认 `docker compose -f deploy/docker-compose.yml config` 输出的 `host_ip` 是 `127.0.0.1`。

## 2. 转发头信任默认 `false`（DAN-6，pending）

**之前**：`backend/internal/config/config.go:2236` 是 `viper.SetDefault("security.trust_forwarded_ip_for_api_key_acl", true)`。这个开关打开时，`X-Forwarded-For`、`X-Real-IP`、`CF-Connecting-IP` 和自定义头会直接决定客户端 IP，用于日志与 API Key 的 IP 白名单。任何人能直连到源站，就能用这些头冒充任意来源地址。`deploy/EDGE_SECURITY.md` 的 "Trusted client IPs" 一节描述的就是这套行为，并注明它默认开启是「为了升级兼容」。

**改法（pending）**：默认改为 `false`，并且升级时不再把用户已经显式关掉的 `false` 静默改回 `true` —— 现状里正是这条「静默回翻」让关掉它变得没有意义。具体开关、迁移与回填行为以 DAN-6 的 PR 为准；本文不替它下结论。

**升级后会发生什么（按 issue 目标，未落地）**：没有显式配置的部署按直连 peer 判定客户端 IP。依赖转发头识别真实客户端的部署必须显式启用该开关，并同时配置 `server.trusted_proxies` 或自定义头列表。顺序反了会先把所有请求认成反代 IP：IP 白名单会误放或误拦，限流也会从按用户退化成按反代聚合。

**怎么继续收紧**：先把 `server.trusted_proxies` 收敛到反代地址（`127.0.0.1/32`、`::1/128` 或入口机地址），再打开转发头信任，最后才在 API Key 上依赖 IP 白名单。每一步都用真实客户端的日志核对解析出的 IP。

## 3. 首启 setup 只绑回环（DAN-7，pending）

**之前**：`backend/cmd/server/main.go:98` 的 `runSetupServer()` 用 `config.GetServerAddress()`，而 `backend/internal/config/config.go:4021` 的默认值是 `server.host = 0.0.0.0`。首次启动、尚未初始化时，setup 向导（建管理员、写配置）对整个网络开放 —— 谁先连上，谁就完成初始化。

**改法（pending）**：setup 服务只绑回环，以 DAN-7 的 PR 为准。

**升级后会发生什么**：二进制 / systemd 部署首次启动时，setup 向导只能从本机或 SSH 隧道访问，需要在本机打开或 `ssh -L` 转发。Docker Compose 部署不受影响：`AUTO_SETUP=true`（`deploy/docker-compose.yml:53`）时首启走 `AutoSetupFromEnv()`，不会进入 setup 服务（`backend/cmd/server/main.go:82-95`）。

**怎么继续收紧**：初始化窗口本身就该当作敏感时段：不要在这段时间把端口暴露到公网；`AUTO_SETUP` 的部署把初始管理员口令从日志里取走之后立即轮换。

## 4. CI 跑 race 检测（DAN-8，pending）

**之前**：`backend/Makefile:23` 已经有 `test-race` 目标，但 `.github/workflows/backend-ci.yml` 里没有调用它（全文没有 `-race`），`deploy/zhijing/patches/0001-ci-race-job.patch` 也还是一份没应用的补丁。并发回归只能靠人记得本地跑。

**改法（pending）**：CI 增加 race 检测任务，以 DAN-8 的 PR 为准。

**升级后会发生什么**：运行时行为没有任何变化；PR 会在数据竞争上变红。这是把「偶发 5xx」提前到合并之前的一步，短期可能多出一些原本看不见的红灯 —— 那正是它存在的意义。

**怎么继续收紧**：先把 `test-race` 现有 `-run` 覆盖到的并发用例（限流、缓存、调度池、原子计数）在 CI 里稳定下来，再扩大包范围和运行时长。

## 5. `/admin/system/update` 应用层硬门与源站拒绝清单（DAN-27 + 本 PR）

**之前**：`PerformUpdate`（`backend/internal/handler/admin/system_handler.go:84`）走管理员鉴权、`stepUpAuth` 和幂等锁，但「下载并替换服务二进制、再重启进程」在应用层没有第二道门 —— 也就是说，拿到一个管理员登录（含二次验证）就等于能换掉二进制。目前唯一的拦截是源站 nginx 对 `/api/v1/admin/system/{update,rollback,restart}` 的 403，而源站站点配置**不入仓**（`deploy/zhijing/README.md:73`），靠运维记得配，是单点。仓库里的 `deploy/zhijing/nginx/zhijing.kaogong.art.edge.conf` 是入口机配置，全文没有一条 403，全部透传到源站。

**改法**：

- 应用层硬门（pending，DAN-27）：在应用层再拦一次，不再依赖「源站记得配」。
- 本 PR 把源站侧的东西收进仓库，让它可以 diff、可以检查、部署时可以验证：
  - `deploy/zhijing/nginx/zhijing.origin.deny.conf`：源站敏感端点的 403 模板，覆盖换二进制（`system/update`、`system/rollback`、`system/restart`）、备份整组（列表、创建、下载、恢复、删除，含 `data-management/backups`）、以及导出类（账号、代理、兑换码）。备份用「资源级拒绝」而不是按方法放行 `GET`：一个只含 `limit_except` 的精确 location 会把 `GET` 变成 404（没有内容处理器可继承），与其留半开的口子，不如把这一组操作全部收进受信路径。文件顶部写明这是**推荐下限**，不是完整配置。
  - `deploy/zhijing/verify-sensitive-endpoints.sh`：逐条探测清单里的路径，不带任何凭据，非 403 就非零退出并打印实际状态码。支持 `--base-url`、`--expect`、`--method`、`--host`、`--resolve`、`--timeout`、`-k`、`--list`。
  - `zero-downtime-deploy.sh` 增加 `VERIFY_SENSITIVE_ENDPOINTS=1` 开关：发布时在公网 `/api/release` 自证之后跑一次探测，任何一条不是 403 就判发布失败（触发回滚）。默认关闭，因为它的前提是源站已经 `include` 模板。

**升级后会发生什么**：源站 `include` 模板并 reload 之后，公网入口对上面这些路径直接回 403，请求根本到不了应用层；只读的 `system/version`、`check-updates` 这类接口不受影响（实测见下）。管理端里这些页面（换版本、备份、导入导出）要从受信路径访问：本机、SSH 隧道或跳板机。这是刻意的取舍 —— 这些操作本该在受控通道里做。

**怎么继续收紧**：这份清单是下限。可以按同样格式继续把 `data-management` 的配置读写、`ops/system-logs` 纳入；等 DAN-27 的应用层硬门落地后，Nginx 403 从「唯一一层」变成「第二层」，那时才谈得上冗余。

**怎么验证**：

```sh
# 模板与探测清单必须一致，且双向自测（stub 全 403 / 全 200 / 只漏一条）
bash deploy/tests/verify-sensitive-endpoints-test.sh

# 对着真实目标探测（源站或公网入口）
deploy/zhijing/verify-sensitive-endpoints.sh --base-url https://<host>
```

自测里 `全部 200 必须失败`、`只漏一条必须点名那一条` 两个方向都会跑；只测「全 403 通过」等于没测。

模板本身用 `nginx -t` 校验过，也在本地 nginx 里实测过：模板里的 13 条路径返回 403，`/healthz` 与只读的 `/api/v1/admin/system/version` 仍然返回 200。

## 建议的上线顺序

1. 源站 `include` 拒绝模板，`nginx -t` 通过后 reload，用校验脚本确认 403（只增加拒绝，不改既有流量路径）。
2. 发布端口回环（DAN-5），确认反代仍然连通。
3. 转发头信任改 `false`（DAN-6）：先配好 `trusted_proxies` / 自定义头，再切默认。
4. setup 服务只绑回环（DAN-7），首启改成从本机或隧道完成。
5. CI race（DAN-8）。
6. 应用层硬门（DAN-27），把「只靠 nginx」变成「两层都拦」。

每一步都能单独回退：1 和 2 是配置，3 和 4 是开关与监听地址，5 只影响 CI，6 是代码但可以带开关灰度。
