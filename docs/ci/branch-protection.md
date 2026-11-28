# main 分支保护与必需检查

`main` 的合并门由一个 GitHub ruleset 控制。**它不在仓库里**：不在 `.github/` 下，不随代码走，改它要仓库 admin 权限的 REST 调用。这份文档是它在本仓库里的唯一锚点。

**改 CI 里任何 job 的名字之前，先读第 4 节。** 顺序错了会让所有 PR 永久卡住。

- 核对时间：2026-11-28T03:35Z（北京时间 11:35）
- 核对对象：`main` = `89bf20ea7`（`git fetch && git rev-parse --short origin/main`）
- 证据来源：`GET /repos/daniei-chen/zhijing-gateway/rulesets/28278717`；`GET /repos/daniei-chen/zhijing-gateway/commits/89bf20ea79a45fdd17e8c1dec6dc9117a4df7d46/check-runs`；`.github/workflows/*.yml`

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
| `required_status_checks` | `strict_required_status_checks_policy=false`（不要求与 main 同步）；`do_not_enforce_on_create=false`；8 个 context | 8 条检查全部成功才可合并 |

8 个必需检查的 context（与 check run 的 `name` 精确字符串匹配）：

```
shell  test  race  frontend  golangci-lint  release-helpers  backend-security  frontend-security
```

`main` 的 head `89bf20ea7` 上实测 10 条 check run：上面 8 条 + `embed` + `e2e`。核对时 `test`、`e2e` 尚未结束，其余 8 条 success。

必需审批是 0，所以 PR 不需要 approve，也不要求解决 review 线程——门禁全部压在 CI 上。`pull_request` 规则里另带 `require_extra_approval_for_unattributed_changes: true`；按 GitHub 文档该开关只在「Copilot 以自身身份开 PR 且规则集要求非零审批」时生效，**0 审批下无效**，本仓库不受影响。

直推 `main` 会被拒，实测返回 409：

```
Changes must be made through a pull request. 8 of 8 required status checks are expected.
```

## 2. 为什么是这 8 条

| 检查 | 定义 | 挡什么 |
|---|---|---|
| `shell` | `backend-ci.yml:16`（macos-15） | 部署脚本：`/bin/bash -n` 语法检查 `deploy/apple-container.sh`，然后真跑 `deploy/tests/` 下 10 个脚本。跑在 macOS 上是为了顺带覆盖 BSD 与 GNU 的 shell 差异。 |
| `test` | `backend-ci.yml:33`（ubuntu） | 后端单元测试（`make test-unit`）+ 集成测试（`make test-integration`）+ 三条 deploy 一致性测试（compose 简单模式、install 脚本 token 处理、阶段一加固文档）。 |
| `race` | `backend-ci.yml:158` | 并发关键路径的 `-race` 数据竞争检测（`make test-race`，只挑并发相关用例）。`go vet` 和 golangci-lint 都看不出数据竞争，只有它能。 |
| `frontend` | `backend-ci.yml:178` | 前端 `lint:check`、`typecheck`、`test:run`（vitest 全量）、生产 `build`。 |
| `golangci-lint` | `backend-ci.yml:208` | Go 静态检查（golangci-lint v2.14.0，`--timeout=30m`）。 |
| `release-helpers` | `backend-ci.yml:228` | 发布辅助工具的单元测试（`.github/release-tools` 发布矩阵）+ `bash -n release-images.sh`。 |
| `backend-security` | `security-scan.yml:13` | `govulncheck ./...`：Go 依赖与标准库的已知漏洞。 |
| `frontend-security` | `security-scan.yml:33` | `pnpm audit --prod --audit-level=high` + `tools/check_pnpm_audit_exceptions.py` 核例外清单，挡「高危依赖漏洞」与「例外过期没清理」。 |

每条检查背后跑到哪些测试、哪些测试至今没进 CI，见 `docs/ci/test-tiers.md`。

## 3. 为什么另外四条没挂

| 检查 | 位置 | 不挂的理由 |
|---|---|---|
| `cla-check` | `cla.yml:20-25` | 条件 job：只在 `issue_comment` 或「非 closed 的 `pull_request_target`」上跑。它的红绿取决于贡献者签没签 CLA，与代码质量无关；挂成必需等于让一次性的签名状态卡住所有合并。CLA 由流程保证：`cla-signatures` 分支的 `cla.json` 已有 `daniei-chen`（id 328942951）的签名记录（2026-11-28T01:25:35Z，PR #37）。它红了仍然要人看，只是不当合并门。 |
| `cla-lock` | `cla.yml:54-58` | 只在 PR **已合并**后跑（`action == 'closed' && merged == true`）。PR 阶段它永远是 skipped，挂进 required 不提供任何覆盖。 |
| `e2e` | `backend-ci.yml:102` | 只在 `main` 的 push 和 `workflow_dispatch` 上跑（`if: github.event_name == 'workflow_dispatch' \|\| github.ref == 'refs/heads/main'`；`ci/e2e-*` 这个 push 例外 2026-11-28 已删除）。PR head 上它以 `completed/skipped` 出现在检查列表里（PR #44 head `914ded94d` 实测），而按 GitHub 文档「被 skip 的 job 报告状态为 Success」，所以挂成 required 只是一条永远不阻止合并的空门。**它已经真跑通过，不是「靠 main 兜底」而是「跑过、绿过、连绿两次」**：run `46129909080`，2026-11-28，head `50bc5e392`，两轮分别 job `140932574046` 与 `140936895340`（同一个 run 的两次 attempt，同一个 head sha），注册 → 登录 → 建 API Key → 用 Key 调网关 → 查用量五步全部 PASS；「全跳过混成绿」这条路被 job 里的断言步堵死（`backend-ci.yml:190-197` 要求两条用例各有一行 `--- PASS:`，出现 `--- SKIP:` 就判红）。**代价：PR 阶段仍然看不见 e2e 回归。** 要让它成为真门，先把 e2e 改成 PR 可跑（起栈成本与上游 key 是真问题，见 `docs/ci/test-tiers.md` §4），再按第 4 节的顺序加进 required。 |
| `embed` | `backend-ci.yml:66` | 跑的是发布形态（`-tags=embed`）的 15 条测试，是发布路径上唯一的自动化保险。2026-11-28 才接进 CI，先观察几轮稳定性再挂；它现在在 PR 上是绿的，但「绿过几次」还不足以下结论。 |

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

**这 9 条 SKIP 是「2 条太薄」的硬证据**：无密钥条件下 11 条里 9 条什么都不验。要抬下限，得先把上游换成栈内可用的假 OpenAI 兼容服务，让代理链路（转发、计费扣费、配额、模型列表、上游错误映射）在没有真实上游账号时也能被验——只加「打本地 admin 接口」的用例不会让这个数字变厚。

## 4. 改 job 名 / 增删 job 的操作规程（最重要）

机制：required check 按 **context 字符串**匹配 check run 的 `name`。job 没写 `name:` 时，`name` 就等于 job id——本仓库 `.github/workflows/*.yml` 里没有任何 job 级 `name:`（`grep -nE '^    name:' .github/workflows/*.yml` 无输出），所以今天 8 个 context 全部是 job id。

两个方向都会出事，而且都没有出口（`bypass_actors` 为空）：

- 改了 job 名、规则集里还是旧名：旧 context 永远等不到，所有 PR 停在 `Expected — Waiting for status to be reported`，合并按钮锁死。
- 规则集里加了新名、workflow 里没有那个 job：同样永久等不到。

正确顺序（不能跳步）：

1. **先加别名 job**：workflow 里保留旧 job 不动，新增一个跑同样命令、新名字的 job。这一步会让 CI 时间翻倍，是有意付的代价——它是唯一能让「旧名绿」和「新名绿」在同一轮 PR 上同时成立的形态。
2. 开一轮 PR：旧名、新名两条都出现且绿。
3. `PUT /repos/daniei-chen/zhijing-gateway/rulesets/28278717`，把 required 列表里的旧名换成新名（同一个请求里删旧加新）。该接口是**全量替换**，必须带完整 `rules` 数组——漏写一条规则等于删掉一条规则。
4. 删掉旧 job，再开一轮 PR 确认 8 条照旧绿。
5. 最后改本文档（时间、新名、验证用的 head sha）。

绝对不要先改 job 名再改规则集：改完名字的 PR 自己就合不进去（它的 head 上不再有旧 context），这个状态只能靠人再调一次规则集救回来。

新增一条检查（不涉及改名）走缩短版：先把 job 加进 workflow → 让一轮 PR 跑出绿 → 再挂进 required → 改本文档。

规则集只有仓库 admin 能改。当前持有该权限的只有驾驶线程（智境小队长）；其余线程改不动，也不要试。

## 5. 绕行与应急

**不要删规则集来调试。** 删掉它等于瞬间放开直推和 force-push，把「合并卡住」升级成「main 可以被任意覆盖」，而且删除这个动作本身不留记录。

某个必需检查因为基础设施原因长期红（runner 挂了、上游 registry 5xx、缓存坏了），按这个顺序处理：

1. 先确认红因不是代码：`cancelled` / `timed_out` 先重跑一次；真有断言失败就修代码。
2. 确认是基础设施且短期修不好：把它从 required 列表里**暂时摘掉**（同样一次 `PUT`，其余 7 条保持不动），并在本文档第 7 节记一行：摘了哪条、为什么、谁摘的、恢复条件是什么。摘掉期间合并仍受另外 7 条 + PR 规则约束。
3. 修好后加回 required，并在第 7 节记一行「已恢复」。
4. 删规则集是最后手段：只在同时有多个必需检查坏到完全无法合并、且当天必须合并时用。用完必须同时回滚本文档，否则文档立刻变成假话。

## 6. 会踩的坑

- **不要取消当前 head 的 run。** 被取消的必需检查结论是 `cancelled`，而 required 检查只认 success，`cancelled` 会让 PR 停在未通过。清队只能取消同一分支上已被新 commit 取代的旧 run（按 head sha 判断）。万一取消了当前 head，补救办法是在该 head 上 re-run 那个 workflow。
- **同一个 head 上同名检查可能出现两条。** `security-scan.yml` 同时监听 `push` 和 `pull_request`（`security-scan.yml:4-5`），所以 `backend-security`、`frontend-security` 在同一个 head 上各会出两条。PR #44 head `914ded94d` 实测 14 条 check run，其中这两条各 2 条、其余各 1 条。判断「8 条绿了没有」要按 `(head_sha, name)` 去重并优先取 `pull_request` 那条，否则会把清队造成的 `cancelled` 误读成失败，或者把 8 条数成 14 条。
- **`strict=false` 是有意关的，代价要认。** 它不要求 PR 与 main 同步，所以 main 前进后旧 PR 的绿仍然有效、不用全员重跑；代价是那个「绿」只对 PR 的 head 成立，不对合并后的结果成立。合并前看一眼 `git log origin/main` 有没有动到你改的文件。
- **`git push --dry-run` 验不了分支保护。** 2026-11-28T03:40Z 在本仓库执行 `git push --dry-run origin HEAD:main`（源 `465d500fe`），退出码 0，输出 `89bf20ea7..465d500fe  HEAD -> main`，**没有报错**——ruleset 的拒绝发生在真正的 ref 更新时，dry-run 看不到。要验就用一次会真写的调用（例如 Contents API 写文件），看返回 409。
- **规则集不在仓库里，review 看不见它。** 改规则集不产生 commit、不走 PR、没人 review。所以每次改都必须同步改本文档，否则下一轮没人知道门在哪。

## 7. 变更记录

| 时间（UTC） | 变更 | 依据 / 验证 |
|---|---|---|
| 2026-11-28T03:24:00Z | 建立 ruleset `28278717`：`deletion`、`non_fast_forward`、`pull_request`（0 审批）、`required_status_checks`（8 条，strict 关）；`bypass_actors` 空 | `GET /repos/daniei-chen/zhijing-gateway/rulesets/28278717` |
| 2026-11-28T03:24Z 起 | 直推 `main` 被拒：Contents API 写文件返回 409 `Changes must be made through a pull request. 8 of 8 required status checks are expected.` | 实测（Contents API） |
| 2026-11-28 | 本文档入库 | 同期 PR，见 PR 描述 |

摘除 / 恢复必需检查也追加到这张表。
