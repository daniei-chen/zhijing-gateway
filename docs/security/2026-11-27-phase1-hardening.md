# 阶段一：默认配置止血（2026-11-27）

阶段一的六条改动已经全部落地。这份文档记录每一条**实际改成了什么**、升级后会发生什么、之后还能怎么收紧，以及哪些属于需要向上游回灌的候选。

来源：父 issue DAN-4 的子项 DAN-5 / DAN-6 / DAN-7 / DAN-8 / DAN-27，加上 DAN-30（源站拒绝清单与部署校验）。**核对对象是 `main` = `52c779a0b3655c8ecb2a664f3fcd0f7e72ebf8d5`**：下面每一条都是在仓库文件里核对过的，不是照 PR 状态抄的。

这六条各自都不算漏洞，但默认值拼起来是一条链：直连 8080 绕过反代、伪造转发头冒充内网来源、首启向导对全网开放、换二进制只靠一层运维记得配的 403。

## 一览

| # | 改动 | issue | PR | 合并点 |
|---|---|---|---|---|
| 1 | Docker / Apple container 发布端口默认回环 | DAN-5 | [#22](https://github.com/daniei-chen/zhijing-gateway/pull/22) | `95dc97a6e314984b2041cd23c4795bd5b76935b2` |
| 2 | 转发头信任默认 `false`，迁移不再回翻 | DAN-6 | [#25](https://github.com/daniei-chen/zhijing-gateway/pull/25) | `18964c6314ab12c61d7705c7f3edd06e42504acb` |
| 3 | 首启 setup 只绑回环 + 一次性 setup token | DAN-7 | [#26](https://github.com/daniei-chen/zhijing-gateway/pull/26) | `293992005e9d6bfd8957a4eae847e24fefb71229` |
| 4 | CI 独立 race 检测任务 | DAN-8 | [#23](https://github.com/daniei-chen/zhijing-gateway/pull/23) | `0e20d7af8f5807ad66012b57503e95c0df714465` |
| 5 | `/admin/system/update` 应用层硬门（默认关死） | DAN-27 | [#27](https://github.com/daniei-chen/zhijing-gateway/pull/27) | `52c779a0b3655c8ecb2a664f3fcd0f7e72ebf8d5` |
| 6 | 源站 403 清单与部署校验 | DAN-30 | [#24](https://github.com/daniei-chen/zhijing-gateway/pull/24) | `fa4d8c876be0a04e79512144af40275b3418ce11` |

## 1. 发布端口默认回环（DAN-5）

**之前**：`deploy/docker-compose.yml`、`docker-compose.local.yml`、`docker-compose.standalone.yml` 都是 `${BIND_HOST:-0.0.0.0}`，`.env.example` 也是 `BIND_HOST=0.0.0.0`，`deploy/apple-container.sh` 的回退默认值同样是 `0.0.0.0`。装完即可从任何网卡直连宿主 `8080`，反向代理上的 TLS、限流、来源限制全部可以绕开。

**改法**：四个 Compose 文件的默认发布地址统一为 `${BIND_HOST:-127.0.0.1}`（`docker-compose.dev.yml` 原本就是），`.env.example` 改为 `BIND_HOST=127.0.0.1` 并写清 opt-in 方式，`apple-container.sh` 的回退值同步。Apple `container` 没有必须绑 `0.0.0.0` 的网络约束：`--publish` 接受 host IP。

**升级后会发生什么**：

- 依赖旧默认 `0.0.0.0` 直连 `8080` 的部署，在 Compose 文件更新后只在回环上监听，需要显式 `BIND_HOST=0.0.0.0` 才能继续直连。
- 经反向代理访问的部署不受影响，反代本来就连 `127.0.0.1:8080`。
- 已有 `.env` 不会被改动；只有没写 `BIND_HOST` 的部署才会吃到默认值变化。

**怎么继续收紧**：保持回环 + 反代。确实要直连时，`BIND_HOST=0.0.0.0` 与防火墙限源必须同时做。

**怎么验证**：`deploy/tests/bind-host-default-test.sh`；手工 `docker compose -f deploy/docker-compose.yml config` 看 `host_ip` 是 `127.0.0.1`。

## 2. 转发头信任默认 `false`（DAN-6）

**之前**：`security.trust_forwarded_ip_for_api_key_acl` 默认 `true`，`X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` 等头直接决定客户端 IP，用于日志与 API Key 的 IP 白名单。能直连源站的人可以冒充任意来源地址。更麻烦的是升级迁移会把用户显式设成的 `false` **静默改回** `true`，关掉它等于没关。

**改法**：

- 默认值改为 `false`：`backend/internal/config/config.go` 的 `viper.SetDefault("security.trust_forwarded_ip_for_api_key_acl", false)`。
- 迁移不再回翻：`backend/internal/service/setting_service.go` 以库里的值为准，只在检测到「关闭且未配置 `server.trusted_proxies`」时写一条 warn 日志并给出修复建议，不再改写用户设置（代码注释里写明了旧行为为什么被删掉）。
- 设置页初值同步为关闭：`frontend/src/views/admin/SettingsView.vue` 的 `api_key_acl_trust_forwarded_ip: false`。

**升级后会发生什么**：没有显式配置的部署按 TCP 对端（配合 `server.trusted_proxies`）判定客户端 IP。依赖转发头识别真实客户端的部署必须显式开启该开关并配置 `server.trusted_proxies` 或自定义头列表；顺序反了会先把所有请求认成反代 IP —— IP 白名单误放或误拦、限流从按用户退化成按反代聚合。`deploy/EDGE_SECURITY.md` 的 "Trusted client IPs" 一节是配置说明。

**怎么继续收紧**：先把 `server.trusted_proxies` 收敛到反代地址（`127.0.0.1/32`、`::1/128` 或入口机地址），再考虑打开转发头信任，最后才在 API Key 上依赖 IP 白名单。

## 3. 首启 setup 只绑回环 + 一次性 token（DAN-7）

**之前**：`runSetupServer()` 用 `config.GetServerAddress()`，默认 `server.host = 0.0.0.0`。首次启动、尚未初始化时，setup 向导（建管理员、写配置）对整个网络开放 —— 谁先连上谁完成初始化。

**改法**：

- `backend/internal/config/config.go` 新增 `GetSetupServerAddress()`：默认 `127.0.0.1:8080`（`setupWizardDefaultHost` / `setupWizardDefaultPort`），只有显式的 `SERVER_HOST` 或配置文件里的 `server.host` 才覆盖，并通过 `Explicit` 字段把「运维主动选择」这件事报出来。
- 一次性 token：`backend/internal/setup/token.go` 生成随机 token，写入 data 目录的 `setup-token` 文件，启动时也打印到日志；所有 setup **写**请求必须带 `X-Setup-Token`（`backend/internal/setup/handler.go` 的 `setupTokenGuard`），初始化完成后 token 失效（`InvalidateSetupToken`）。

**升级后会发生什么**：二进制 / systemd 部署首次启动时，setup 向导只能从本机或 SSH 隧道访问，并且写入还要 token。Docker Compose 部署不受影响：`AUTO_SETUP=true` 时首启走 `AutoSetupFromEnv()`，不会进入 setup 服务。

**怎么继续收紧**：首启窗口本身就是敏感时段 —— 不要在这段时间把端口暴露到公网；`AUTO_SETUP` 的部署把初始管理员口令从日志取走后立即轮换。

## 4. CI 跑 race 检测（DAN-8）

**之前**：`backend/Makefile` 有 `test-race` 目标，但 `.github/workflows/backend-ci.yml` 从不调用它，并发回归只能靠人记得本地跑。

**改法**：CI 增加独立 `race` job（`ubuntu-latest`、`working-directory: backend`、跑 `make test-race`），只挑并发相关用例（限流、缓存、调度池、槽位、原子计数），约 95 秒。`deploy/tests/ci-race-job-test.sh` 守住这个 job 的存在与内容。

**升级后会发生什么**：运行时行为没有任何变化；PR 会在数据竞争上变红。

**怎么继续收紧**：把 `test-race` 的 `-run` 过滤逐步扩到更多包，再拉长观察面。

## 5. `/admin/system/update` 应用层硬门（DAN-27）

**之前**：`PerformUpdate` 只有管理员鉴权、`stepUpAuth` 和幂等锁 —— 拿到一个管理员登录（含二次验证）就等于能换掉服务二进制。唯一的额外拦截是源站 nginx 的 403，而那份站点配置不入仓。

**改法**：`security.admin_system_update` 默认关死（`enabled=false`，`allow_cidrs=["127.0.0.1/32","::1/128"]`），由 `backend/internal/server/middleware/admin_system_update_gate.go` 执行三重判定：

1. `enabled=false` 一律拒绝（默认状态）；
2. 调用方地址只按 **TCP 对端**判定（`ip.ResolvePeerClientIP`），对端必须命中 `allow_cidrs`；
3. 即使前两步通过，仍强制要求会话完成过 TOTP step-up，且**不读取** `settings.step_up_enabled` —— 全局开关被误关也照样拦。

三种失败共用错误码 `ADMIN_SYSTEM_UPDATE_FORBIDDEN`，精确原因写进审计（对端地址、命中的规则、step-up 状态、结果）。挂载点：`backend/internal/server/routes/admin.go` 的 `registerSystemRoutes`（`UpdateGate()` 在 `stepUpAuth` 之前），策略在 `backend/internal/handler/wire.go` 装配。

**升级后会发生什么**：公网调用 `POST /api/v1/admin/system/update` 一律 403，即使是管理员带 step-up。要在线更新必须显式 `enabled=true` 且调用方对端命中 `allow_cidrs`（默认只允许回环）—— 也就是说必须在源站本机或隧道里操作。`rollback` / `restart` 仍然只靠 `stepUpAuth` 与源站 nginx 的 403。

**怎么继续收紧**：保持默认关闭；把 `enabled=true` 当成高危变更对待，`allow_cidrs` 永远不要写成 `0.0.0.0/0`。

## 6. 源站 403 清单与部署校验（DAN-30）

**之前**：`/api/v1/admin/system/{update,rollback,restart}`、备份与导出类接口唯一的拦截是源站 nginx 的 403，而源站站点配置不入仓（`deploy/zhijing/README.md`）；仓库里的入口机配置全文没有一条 403，全部透传。

**改法**：

- `deploy/zhijing/nginx/zhijing.origin.deny.conf`：源站侧 403 模板，共 13 条路径 —— 换二进制（三个 `system/*`）、备份整组（列表、创建、下载、恢复、删除，含 `data-management/backups`）、导入导出（账号、代理、兑换码）。备份用「资源级拒绝」而不是按方法放行 `GET`：只带 `limit_except` 的精确 location 没有内容处理器可继承，`GET` 会变 404。
- `deploy/zhijing/verify-sensitive-endpoints.sh`：不带凭据逐条探测，非 403 就非零退出并打印实际状态码；支持 `--base-url`、`--expect`、`--method`、`--host`、`--resolve`、`--timeout`、`-k`、`--list`。
- `deploy/zhijing/zero-downtime-deploy.sh` 增加 `VERIFY_SENSITIVE_ENDPOINTS=1` 开关：发布时在公网 `/api/release` 自证之后跑一次探测，不通过就 `restore_previous_upstream()` 回切并保留候选（不能用 `|| die`：切换后显式 exit 不触发 `ERR` trap，会把新 upstream 留在生产上）。

**升级后会发生什么**：源站 `include` 模板并 reload 之后，公网入口对这些路径直接 403，请求到不了应用层；`/healthz`、`system/version`、`check-updates` 这类只读接口不受影响。管理端「换版本 / 备份 / 导入导出」要从受信路径访问：本机、SSH 隧道或跳板机。

**怎么继续收紧**：清单是下限，可继续纳入 `data-management` 的配置读写、`ops/system-logs`。应用层硬门（第 5 条）落地后，nginx 403 从「唯一一层」变成「第二层」。

**怎么验证**：

```sh
bash deploy/tests/verify-sensitive-endpoints-test.sh            # 模板与探测清单一致 + 双向自测
bash deploy/zhijing/verify-sensitive-endpoints.sh --base-url https://<host>
```

## 上游回灌

规则见 [`docs/UPSTREAM.md`](./../UPSTREAM.md)：改上游拥有的文件必须回答「上游是否同问题、是否需要回灌、回灌形态能否去掉智境专属内容」，边界表也在那里。

阶段一这六条里，**五条是回灌候选，一条是本地扩展**。下表只写「现在 main 上有什么、归谁、候选补丁形态」——**没有任何一条已经回灌**：回灌要 owner 决定，而且 `UPSTREAM.md` 的「未回灌清单」目前是空的，判定记在各自的 issue 上（DAN-5 / DAN-6 / DAN-7 / DAN-8 / DAN-27）。

| 改动 | 实现位置 | 上游归属（`UPSTREAM.md` 第三节） | 回灌候选 |
|---|---|---|---|
| BIND_HOST 回环默认 | `deploy/docker-compose.yml`、`docker-compose.local.yml`、`docker-compose.standalone.yml`、`deploy/.env.example`、`deploy/apple-container.sh` | `deploy/`（除本地子目录）属上游拥有 | 是。上游 `4233cc3d` 同样是 `0.0.0.0`，且上游自己的 `docker-compose.dev.yml` 已是 `127.0.0.1`（内部方向不一致 = 漏改），改动可整份 `git am`；`deploy/tests/bind-host-default-test.sh` 是本地扩展，可选附带 |
| 转发头默认 `false` + 迁移不回翻 | `backend/internal/config/config.go`、`backend/internal/service/setting_service.go`、`frontend/src/views/admin/SettingsView.vue` | `backend/`、`frontend/` 属上游拥有 | 是。默认值与静默回翻都在上游代码里，回灌时需要连同前端的设置页初值一起带 |
| setup 只绑回环 + 一次性 token | `backend/internal/config/config.go`、`backend/cmd/server/main.go`、`backend/internal/setup/token.go`、`backend/internal/setup/handler.go` | `backend/` 属上游拥有 | 是。新增文件 + 既有文件改动，补丁要按 `format-patch` 的顺序叠放 |
| CI race job | `.github/workflows/backend-ci.yml`（`race` job）+ `deploy/tests/ci-race-job-test.sh` | `.github/` 属上游拥有；`deploy/tests/ci-race-job-test.sh` 是本地扩展 | 是，但只回灌 workflow 那一份；上游的 shell job 结构不同，看守用例不跟着走 |
| `registerSystemRoutes` 三个 POST 的 step-up | `backend/internal/server/routes/admin.go` | `backend/` 属上游拥有 | 是。三行 `stepUpAuth`，形态最小 |
| 源站 403 清单 + 校验脚本 | `deploy/zhijing/nginx/*`、`deploy/zhijing/verify-sensitive-endpoints.sh`、`docs/security/*` | 本地扩展（上游没有 `deploy/zhijing/`，反代是 Caddy 不是 nginx） | 否。nginx 规则在上游没有对应位置；可提炼的只有「与反代无关的敏感端点探测」这个思路，那是新工具，不在本阶段 |

## 一条 triage 教训：给不出「为什么安全」就当缺陷

`X-Forwarded-For: unknown` 那次是活例：review 里它最初被当成一条 note —— 畸形跳数返回空地址，看起来只是防御性代码。实际上，如果"畸形跳数"回落到「对端自身」，而 `allow_cidrs` 默认包含 `127.0.0.1/32`，那么一个格式错误的值就能把「能连到代理」变成「通过地址检查」。

现在的实现是：`backend/internal/pkg/ip/ip.go` 的 `ResolvePeerClientIP` 遇到无法解析的跳数就把整条链作废、返回空地址，由调用方拒绝（`x-forwarded-for` 有值时不看 `X-Real-IP`，避免不改写该头的代理把客户端自带值透传成判定依据）；用例 `TestResolvePeerClientIPRejectsMalformedHop` 覆盖 `unknown`、空值以及 `203.0.113.9, unknown`。

教训：note 与缺陷的差别不是「看起来危险不危险」，而是**能不能给出机制上的安全论证**。论证里一旦出现「如果……就会通过」，它就不是 note，按缺陷处理并补一条修前会失败的用例。

## 建议的上线顺序

1. 源站 `include` 拒绝模板，`nginx -t` 通过后 reload，用校验脚本确认 403（只增加拒绝，不改既有流量路径）。
2. 发布端口回环，确认反代仍然连通。
3. 转发头信任：先配好 `trusted_proxies` / 自定义头，再打开（现在默认已是关闭）。
4. setup 首启改成本机或隧道完成（`AUTO_SETUP` 部署无需动作）。
5. 应用层硬门保持默认关闭，需要在线更新时再显式打开并限制 `allow_cidrs`。
6. CI race 已在跑，后续扩大覆盖面。

每一步都能单独回退：1、2、6 是配置与 CI，3、4、5 是开关与监听地址。
