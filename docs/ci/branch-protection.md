# main 分支保护与必需检查

`main` 的合并门由一个 GitHub ruleset 控制。**它不在仓库里**：不在 `.github/` 下，不随代码走，改它要仓库 admin 权限的 REST 调用。这份文档是它在本仓库里的唯一锚点。

**改 CI 里任何 job 的名字之前，先读第 4 节。** 顺序错了会让所有 PR 永久卡住。

- 核对时间：2026-11-28T13:30Z 前后（北京时间 21:30）。这一次的规则集清单是**新抓的**，不再沿用 09:27Z 的返回。
- 核对对象：`main` = `8b01fe6f7`（`#52` 合入后，2026-11-28 本线程 `git fetch && git rev-parse --short origin/main`）。`c8e16f07f` 是上一次核对时的 head，已过期。
- 证据来源：`GET /repos/daniei-chen/zhijing-gateway/rulesets/28278717`（由持有仓库 admin 权限的驾驶线程读，返 10 个 context，报文记在 SWO-69 的评论里：`[\"shell\",\"test\",\"race\",\"frontend\",\"golangci-lint\",\"release-helpers\",\"backend-security\",\"frontend-security\",\"embed\",\"e2e\"]`）；`.github/workflows/*.yml`。本线程没有该接口的读权限，不重复抓。
- **job 一律用 job id 引用，不用行号。** job id 就是 required check 的 `context`，改名要走第 4 节的五步流程；行号不是——加一个 `if:` 或一个 step 就能把整张表推偏（本文档自己就撞过：e2e 那批改动把 `shell`/`test`/`race` 各行整体下移，表里的 `:16`/`:34`/`:159` 全部失效）。

## 1. 规则集现状

| 项 | 值 |
|---|---|
| 名称 / id | `main protection` / `28278717` |
| 状态 | `enforcement=active`，`target=branch`，条件 `~DEFAULT_BRANCH`（即 `main`） |
| 生效时间 | `2026-11-28T03:24:00Z`（北京时间 11:24） |
| 绕过者 | `bypass_actors` 为空——**没有任何人或 App 能绕过**，管理员也一样 |

四条规则：

| 规则 | 关键参数 | 含义 |
|---|---|---|
| `deletion` | — | 不能删除 `main` |
| `non_fast_forward` | — | 不能 force-push 或非快进推送 |
| `pull_request` | 必需审批 **0**；`require_last_push_approval=false`；`required_review_thread_resolution=false`；`dismiss_stale_reviews_on_push=false`；允许 merge / squash / rebase | 改动只能经 PR 进入 |
| `required_status_checks` | `strict_required_status_checks_policy=false`（不要求与 main 同步）；`do_not_enforce_on_create=false`；10 个 context | 10 条检查全部成功才可合并 |

10 个必需检查的 context（与 check run 的 `name` 精确字符串匹配）：

```
shell  test  race  frontend  golangci-lint  release-helpers  backend-security  frontend-security  embed  e2e
```

`embed` 是 2026-11-28 当天加进 required 的（`GET /repos/daniei-chen/zhijing-gateway/rules/branches/main` 的 `required_status_checks.parameters.required_status_checks` 里能看到 `{"context":"embed"}`）。加之前，`main` 的 head `89bf20ea7` 上是 10 条 check run = 8 条必需 + `embed` + `e2e`。

必需审批是 0，所以 PR 不需要 approve，也不要求解决 review 线程——门禁全部压在 CI 上。`pull_request` 规则里另带 `require_extra_approval_for_unattributed_changes: true`；按 GitHub 文档该开关只在「Copilot 以自身身份开 PR 且规则集要求非零审批」时生效，**0 审批下无效**，本仓库不受影响。

直推 `main` 会被拒，实测返回 409：

```
Changes must be made through a pull request. 8 of 8 required status checks are expected.
```

（这是 2026-11-28T03:24Z 那次实测的原文。当天 `embed` 进必需名单后条数应为 `9 of 9`，本次没有重新抓这条报文。）

## 2. 为什么是这 10 条

| 检查 | 定义 | 挡什么 |
|---|---|---|
| `shell` | `backend-ci.yml` 的 `shell` job（macos-15） | 部署脚本：`/bin/bash -n` 语法检查 `deploy/apple-container.sh`，然后 **11 条真跑 + 1 条 `-n` 语法检查**（`deploy/tests/` 下 10 个脚本 + `deploy/test-caddyfile-cache.sh`）。跑在 macOS 上是为了顺带覆盖 BSD 与 GNU 的 shell 差异。 |
| `test` | `backend-ci.yml` 的 `test` job（ubuntu） | 后端单元测试（`make test-unit`）+ 集成测试（`make test-integration`）+ 三条 deploy 一致性测试（compose 简单模式、install 脚本 token 处理、阶段一加固文档）。 |
| `race` | `backend-ci.yml` 的 `race` job | 并发关键路径的 `-race` 数据竞争检测（`make test-race` → `backend/scripts/race-gate.sh`，只挑并发相关用例）。`go vet` 和 golangci-lint 都看不出数据竞争，只有它能。门禁会断言 `-v` 输出里真跑过的测试条数 ≥ 1300：`-run` 零命中时 `go test` 退 0，没有这条断言，改名或挪目录就能让它静默变绿。退出码取 `${PIPESTATUS[0]}`，所以 pipefail 被去掉也不会把失败的 `go test` 报成绿。 |
| `frontend` | `backend-ci.yml` 的 `frontend` job | 前端 `lint:check`、`typecheck`、`test:run`（vitest 全量）、生产 `build`。 |
| `golangci-lint` | `backend-ci.yml` 的 `golangci-lint` job | Go 静态检查（golangci-lint v2.14.0，`--timeout=30m`）。 |
| `release-helpers` | `backend-ci.yml` 的 `release-helpers` job | 发布辅助工具的单元测试（`.github/release-tools` 发布矩阵，走 `.github/release-tools/run-tests.sh`：显式模块路径 + `Ran N tests` 下限 10，退出码取 `${PIPESTATUS[0]}`）+ `tools/check-pnpm-audit-exceptions-test.py` + `deploy/tests/ci-workflow-guards-test.sh`（10 个必检 job 不许出现 `if`/`paths`/`paths-ignore`/`continue-on-error`/`needs`，`needs` 配 `if: always()` 除外；触发面必须有 `pull_request` 且不得按 base/路径过滤；`Ran N` 有下限）+ `bash -n release-images.sh`。`discover -p` 匹配不到文件时退 0，所以不再用它；守卫用 `yaml.safe_load` 解析文档断言键，因为正则挡不住 `needs :` 这类等价写法；它需要 PyYAML，所以跑在 `release-helpers` 而不是裸 bash 的 `shell`。 |
| `backend-security` | `security-scan.yml` 的 `backend-security` job | `govulncheck ./...`：Go 依赖与标准库的已知漏洞。工具版本钉死（`@v1.10.0`，2026-11-28 时 `@latest` 解析到的版本），不让上游发坏版本把必检变红。 |
| `frontend-security` | `security-scan.yml` 的 `frontend-security` job | `pnpm audit --prod --audit-level=high`（**只有这一条命令**带 `|| true`，否则命中 high 时它自己先红、豁免清单永远用不上）+ `tools/assert_pnpm_audit_report.py` 断言报告可解析且含 `metadata.vulnerabilities`（否则网络失败会装成「没有漏洞」）+ `tools/check_pnpm_audit_exceptions.py` 核例外清单，挡「高危依赖漏洞」与「例外过期没清理」。 |
| `embed` | `backend-ci.yml` 的 `embed` job | `go test -tags=embed ./internal/web/ -count=1 -v`：发布形态（前端资源嵌进二进制）的 15 条顶层测试（出处：2026-11-28 本地跑同一条命令，`--- PASS:` 行首计数 15，0 SKIP，go1.27.4），发布路径上唯一的自动化保险。2026-11-28 接进 CI 并当天挂进 required。 |
| `e2e` | `backend-ci.yml` 的 `e2e` job | 起真栈（`docker compose -f docker-compose.dev.yml up -d --build`）跑 e2e 用例，`E2E_TIER` 按事件选档（PR = `pr`，其余 = `full`），`E2E_MIN_TOP_LEVEL_PASS=4` 断言顶层 PASS 条数、出现 `--- SKIP:` 即红。2026-11-28 由 HOME-3 挂进 required：前提是 `#52` 先去掉了 job 级 `if: github.ref == 'refs/heads/main'`——在那之前它在 PR 上永远 skip，而 skip 按成功计，挂进 required 只是一块永远绿的牌子。两轮实测与 SKIP 占比见 §3.1；本片起守卫也会挡住「重新给它加 job 级 `if:`」这类改动。 |

每条检查背后跑到哪些测试、哪些测试至今没进 CI，见 `docs/ci/test-tiers.md`。

## 3. 为什么另外两条没挂

| 检查 | 位置 | 不挂的理由 |
|---|---|---|
| `cla-check` | `cla.yml` 的 `cla-check` job | 条件 job：只在 `issue_comment` 或「非 closed 的 `pull_request_target`」上跑。它的红绿取决于贡献者签没签 CLA，与代码质量无关；挂成必需等于让一次性的签名状态卡住所有合并。CLA 由流程保证：`cla-signatures` 分支的 `cla.json` 已有 `daniei-chen`（id 328942951）的签名记录（2026-11-28T01:25:35Z，PR #37）。它红了仍然要人看，只是不当合并门。 |
| `cla-lock` | `cla.yml` 的 `cla-lock` job | 只在 PR **已合并**后跑（`action == 'closed' && merged == true`）。PR 阶段它永远是 skipped，挂进 required 不提供任何覆盖。 |

`e2e` 2026-11-28 已挂进 required，所以它从这张表挪进了第 2 节。它此前正是这张表的反面样本：**不进 required 时红着没人看**——`e2e` 自 `#43` 接进 CI 起，main 上四轮 run 全红（`6eb48bfe1` / `cca5a0cec` / `c78373a63` / `aea3b8b5f`），合并照常通过，没人看它。它真跑通的证据留在下面 §3.1。

### 3.1 e2e 的两轮实测（2026-11-28，run `46129909080`，head `50bc5e392`）

同一个 run 跑了两次（attempt 1 / attempt 2），逐条结果完全一致——这一致本身就是证据：它不是抖动出来的绿。

| | attempt 1（job `140932574046`） | attempt 2（job `140936895340`） |
|---|---|---|
| `=== RUN` 行数（含子测试） | 18 | 18 |
| 顶层用例（不重复） | 11 | 11 |
| `--- PASS:` 顶层 | 2 | 2 |
| `--- SKIP:` 顶层 | 9 | 9 |
| 子测试 `    --- PASS:` | 7 | 7 |

2 条 PASS 是 `TestUserRegistrationAndLogin`、`TestAPIKeyLifecycle`；9 条 SKIP 全是 Claude/Gemini 那批（`TestClaudeMessages*`、`TestClaudeModelsList`、`TestGemini*`），因为栈里没有 `CLAUDE_API_KEY` / `GEMINI_API_KEY`。

**这 9 条 SKIP 是「2 条太薄」的硬证据**：无密钥条件下 11 条里 9 条什么都不验。但抬下限的办法不是「加一个 OpenAI 兼容的假上游」——这 9 条打的是 `/v1/messages`（Claude 形状 5 条）与 `/v1beta/*`（Gemini 形状 2 条），另有 2 条只在该栈未启用的 Antigravity 模式下才不 skip，**一个 OpenAI 形状的假上游对这 9 条一条都救不了**（它只对将来新写的 OpenAI 形状转发用例有用，而这种用例现在一条都没有）。真正的标的是 Anthropic 适配器（下一步），Gemini 更远；而且即使两套假协议都做到位，天花板也是 **9 条顶层 PASS（2+7），不是 11**。在那之前，PR 档的下限靠「不依赖上游的真实路径」抬：密钥吊销即时失效、注册开关双向生效这类，见 `docs/ci/test-tiers.md` §3.2。

## 4. 改 job 名 / 增删 job 的操作规程（最重要）

机制：required check 按 **context 字符串**匹配 check run 的 `name`。job 没写 `name:` 时，`name` 就等于 job id——本仓库 `.github/workflows/*.yml` 里没有任何 job 级 `name:`（`grep -nE '^    name:' .github/workflows/*.yml` 无输出），所以今天 10 个 context 全部是 job id。

两个方向都会出事，而且都没有出口（`bypass_actors` 为空）：

- 改了 job 名、规则集里还是旧名：旧 context 永远等不到，所有 PR 停在 `Expected — Waiting for status to be reported`，合并按钮锁死。
- 规则集里加了新名、workflow 里没有那个 job：同样永久等不到。

正确顺序（不能跳步）：

1. **先加别名 job**：workflow 里保留旧 job 不动，新增一个跑同样命令、新名字的 job。这一步会让 CI 时间翻倍，是有意付的代价——它是唯一能让「旧名绿」和「新名绿」在同一轮 PR 上同时成立的形态。
2. 开一轮 PR：旧名、新名两条都出现且绿。
3. `PUT /repos/daniei-chen/zhijing-gateway/rulesets/28278717`，把 required 列表里的旧名换成新名（同一个请求里删旧加新）。该接口是**全量替换**，必须带完整 `rules` 数组——漏写一条规则等于删掉一条规则。
4. 删掉旧 job，再开一轮 PR 确认 10 条照旧绿。
5. 最后改本文档（时间、新名、验证用的 head sha）。

绝对不要先改 job 名再改规则集：改完名字的 PR 自己就合不进去（它的 head 上不再有旧 context），这个状态只能靠人再调一次规则集救回来。

新增一条检查（不涉及改名）走缩短版：先把 job 加进 workflow → 让一轮 PR 跑出绿 → 再挂进 required → 改本文档。

规则集只有仓库 admin 能改。当前持有该权限的只有驾驶线程（智境小队长）；其余线程改不动，也不要试。

## 5. 绕行与应急

**不要删规则集来调试。** 删掉它等于瞬间放开直推和 force-push，把「合并卡住」升级成「main 可以被任意覆盖」，而且删除这个动作本身不留记录。

某个必需检查因为基础设施原因长期红（runner 挂了、上游 registry 5xx、缓存坏了），按这个顺序处理：

1. 先确认红因不是代码：`cancelled` / `timed_out` 先重跑一次；真有断言失败就修代码。
2. 确认是基础设施且短期修不好：把它从 required 列表里**暂时摘掉**（同样一次 `PUT`，其余 9 条保持不动），并在本文档第 7 节记一行：摘了哪条、为什么、谁摘的、恢复条件是什么。摘掉期间合并仍受另外 9 条 + PR 规则约束。
3. 修好后加回 required，并在第 7 节记一行「已恢复」。
4. 删规则集是最后手段：只在同时有多个必需检查坏到完全无法合并、且当天必须合并时用。用完必须同时回滚本文档，否则文档立刻变成假话。

## 6. 会踩的坑

- **不要取消当前 head 的 run。** 被取消的必需检查结论是 `cancelled`，而 required 检查只认 success，`cancelled` 会让 PR 停在未通过。清队只能取消同一分支上已被新 commit 取代的旧 run（按 head sha 判断）。万一取消了当前 head，补救办法是在该 head 上 re-run 那个 workflow。
- **同一个 head 上同名检查可能出现两条。** `security-scan.yml` 的 `on:` 同时监听 `push` 和 `pull_request`，所以 `backend-security`、`frontend-security` 在同一个 head 上各会出两条。PR #44 head `914ded94d` 实测 14 条 check run，其中这两条各 2 条、其余各 1 条。判断「必需检查绿了没有」要按 `(head_sha, name)` 去重并优先取 `pull_request` 那条，否则会把清队造成的 `cancelled` 误读成失败，也会把条数数重。
- **`strict=false` 是有意关的，代价要认。** 它不要求 PR 与 main 同步，所以 main 前进后旧 PR 的绿仍然有效、不用全员重跑；代价是那个「绿」只对 PR 的 head 成立，不对合并后的结果成立。合并前看一眼 `git log origin/main` 有没有动到你改的文件。
- **`git push --dry-run` 验不了分支保护。** 2026-11-28T03:40Z 在本仓库执行 `git push --dry-run origin HEAD:main`（源 `465d500fe`），退出码 0，输出 `89bf20ea7..465d500fe  HEAD -> main`，**没有报错**——ruleset 的拒绝发生在真正的 ref 更新时，dry-run 看不到。要验就用一次会真写的调用（例如 Contents API 写文件），看返回 409。
- **规则集不在仓库里，review 看不见它。** 改规则集不产生 commit、不走 PR、没人 review。所以每次改都必须同步改本文档，否则下一轮没人知道门在哪。

## 7. 变更记录

| 时间（UTC） | 变更 | 依据 / 验证 |
|---|---|---|
| 2026-11-28T03:24:00Z | 建立 ruleset `28278717`：`deletion`、`non_fast_forward`、`pull_request`（0 审批）、`required_status_checks`（8 条，strict 关）；`bypass_actors` 空 | `GET /repos/daniei-chen/zhijing-gateway/rulesets/28278717` |
| 2026-11-28T03:24Z 起 | 直推 `main` 被拒：Contents API 写文件返回 409 `Changes must be made through a pull request. 8 of 8 required status checks are expected.` | 实测（Contents API） |
| 2026-11-28 | 本文档入库 | 同期 PR，见 PR 描述 |
| 2026-11-28 当日 | `required_status_checks` 从 8 条加到 9 条：新增 `embed` | `GET /repos/daniei-chen/zhijing-gateway/rules/branches/main` 的 `required_status_checks.parameters` |
| 2026-11-28 | `required_status_checks` 从 9 条加到 10 条：新增 `e2e`（前置：`#52` 去掉了它的 job 级 `if:`，它在 PR 上真跑） | 驾驶线程读 `GET /repos/daniei-chen/zhijing-gateway/rulesets/28278717`，报文记在 SWO-69 评论；实测见 §3.1 |

摘除 / 恢复必需检查也追加到这张表。
