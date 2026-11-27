# 上游边界与回灌规则

> 一句话：智境网关是 `Wei-Shaw/sub2api` 的改写版，**一切改动跟随上游**。改上游拥有的文件，PR 描述里必须写清「上游是否同样有该问题、是否需要回灌」。写不出这一句，说明边界没搞清。

## 一、上游是谁

| 项 | 值 |
|---|---|
| 上游仓库 | <https://github.com/Wei-Shaw/sub2api>（公开） |
| 上游 Go module | `github.com/Wei-Shaw/sub2api` |
| 本地 Go module | `github.com/daniei-chen/zhijing-gateway` |
| 本仓库形态 | 独立仓库，**不是 GitHub fork**；`git remote -v` 只有 `origin`（git.capy.ai 镜像） |

证据：

- `DEV_GUIDE.md:9` —「上游仓库 Wei-Shaw/sub2api」。
- `AI_HANDOFF_PROTOCOL.md:277` —「官方上游是 Wei-Shaw/sub2api」。
- `AUDIT-20261114.md:118` —「基线：`Wei-Shaw/sub2api` 的 `v0.2.21` = commit `10ba8f9b4`」。
- 改名是机械的：把上游任一 `.go` 文件的 `github.com/Wei-Shaw/sub2api` 替换成 `github.com/daniei-chen/zhijing-gateway`，与本地同名文件逐字节相同。基线内的 1787 个文件属于这一类，见第三节。

## 二、申报的基线版本

**基线 = 上游 tag `v0.2.21` = commit `10ba8f9b4dc2e6023d4a9879ab77b21841babd10`（2026-11-11 09:37:34 +0800）。**

怎么定的，三步都能复核：

1. 仓库自己的审计已经申报过这个基线：`AUDIT-20261114.md:118`。
2. 内容比对独立复现：对基线文件集逐文件比 blob，`v0.2.20` 有 2548 个文件与本地不同，`v0.2.21` 2467，`v0.2.22` 2604，`v0.2.25` 2735，上游 `main` 2804。最小值落在 `v0.2.21`。
3. 变更方向核对：`v0.2.20→v0.2.21` 上游改了 200 个文件，本地在 81 个上等于新版、0 个等于旧版；`v0.2.21→v0.2.22` 上游改了 339 个，本地 142 个仍是旧版、只有 4 个是新版。→ 本地在 `v0.2.21` 之后没有整体前移。

**不确定度（读到这里别跳过）：这不是一份干净的 `v0.2.21` 快照。**

- 本地 root commit `e5247df` 的提交信息自报「follow upstream sub2api v0.2.20 (6b4b37db)」，之后 `bea53d9`、`30fa3da` 两次「回灌」把它推到了 `v0.2.21`。
- 406 个「非机械改名」差异文件里有 7 个的本地内容等于上游**另一个**版本，属导入漂移而非本地改动：`backend/Dockerfile`、`backend/ent/migrate/schema.go`、`backend/internal/service/admin_group_duplicate.go`、`backend/internal/service/api_key_auth_cache.go`、`frontend/src/views/admin/GroupsView.vue`、`frontend/src/views/admin/groupsOpenAIFast.ts`、`frontend/src/views/admin/__tests__/groupsOpenAIFast.spec.ts`。
- 因此准确表述是：**`v0.2.21` + 上述 7 个文件来自其他上游版本**。定不到更细的 commit，理由是本地历史与上游没有共同祖先——本地 280 个提交自成一条线，与上游做 `git merge-base` 为空，没有 ancestry 可用。
- 上游 `main` 在 2026-11-27 是 `4233cc3d`，自基线以来新增 175 个文件、改动 519 个。`AUDIT-20261114.md:119`「`v0.2.21` 之后只有 2 个提交」这句话已经过期。

## 三、目录边界表

统计口径：基线 `v0.2.21` 的 4649 个文件对本地 `main` 的 4841 个文件，逐文件比 blob。

- **完全一致**：blob 相同。
- **仅机械改名**：把上游内容做 module 路径替换后与本地逐字节相同——这种差异不算本地改动，同步时无冲突风险。
- **本地改过**：排除机械改名后仍不同的文件，共 406 个，其中 7 个是上节的导入漂移，其余 399 个是真实本地改动。
- **本地新增 / 本地删除**：上游基线没有、本地有 / 上游基线有、本地没有。

| 区域 | 上游文件 | 完全一致 | 仅机械改名 | 本地改过 | 本地新增 | 本地删除 | 归属 |
|---|---|---|---|---|---|---|---|
| `backend/` | 3527 | 1457 | 1784 | 286 | 161 | 0 | 上游拥有 |
| `frontend/` | 974 | 898 | 3 | 73 | 4 | 0 | 上游拥有 |
| `assets/` | 42 | 1 | 0 | 0 | 0 | 41 | 上游拥有 |
| `openspec/` | 24 | 24 | 0 | 0 | 0 | 0 | 上游拥有 |
| `skills/` | 4 | 1 | 0 | 3 | 0 | 0 | 上游拥有 |
| `tools/` | 1 | 0 | 0 | 1 | 0 | 0 | 上游拥有 |
| `.github/` | 12 | 3 | 0 | 9 | 1 | 0 | 上游拥有 |
| `deploy/`（除本地子目录） | 33 | 11 | 0 | 22 | 2 | 0 | 上游拥有 |
| `deploy/zhijing/`、`deploy/ops/`、`deploy/ZHIJING_ZERO_DOWNTIME.md`、`deploy/zhijing-gateway.service` | 0 | 0 | 0 | 0 | 23 | 0 | 本地扩展 |
| `docs/`（除本地文档） | 18 | 18 | 0 | 0 | 4 | 0 | 混合 |
| 根目录上游文件（`README*.md`、`Makefile`、`Dockerfile*`、`CLA.md`、`LICENSE`、`DEV_GUIDE.md`、`.gitignore`、`.dockerignore`、`.gitattributes`、`.goreleaser*.yaml`） | 14 | 2 | 0 | 12 | 0 | 0 | 上游拥有 |
| 根目录本地文档与脚本（`AUDIT-*.md`、`TECH-DEBT-*.md`、`SYSTEMIC-RISK-*.md`、`SILENT-FAILURES-*.md`、`TODO-SURVEY-*.md`、`FALSE-POSITIVE-CHECKLIST.md`、`AI_HANDOFF_PROTOCOL.md`、`HANDBOOK.md`、`.release-notes-v*.md`、`local-v002-baseline.json`、`snapshot_existing_source.py`） | 0 | 0 | 0 | 38 | 0 | 0 | 本地扩展 |

三个归属的含义：

- **上游拥有**——整片区域都是上游文件。改动 = 改上游文件，PR 必须写回灌判断；合并后该改动进「欠回灌」账。
- **本地扩展**——上游没有这些路径。改动不受回灌约束，但 PR 里要写明「本地独有」。
- **混合**——区域里两种文件并存，按文件判定：**文件在上游存在** → 按上游拥有处理；**不在** → 按本地扩展处理。

按文件判定的具体落点（脚本 `tools/upstream-diff.sh` 里是可执行副本，两者必须同步改）：

| 路径 | 归属 |
|---|---|
| `deploy/zhijing/**`、`deploy/ops/**`、`deploy/ZHIJING_ZERO_DOWNTIME.md`、`deploy/zhijing-gateway.service` | 本地扩展 |
| `deploy/tests/bind-host-default-test.sh`、`deploy/tests/ci-race-job-test.sh` | 本地扩展（`deploy/tests/` 其余文件是上游的） |
| `docs/README.md`、`docs/feature-gap-audit-2026-11.md`、`docs/cache-decision-2026-11.md`、`docs/releases/v0.0.8.zh-CN.md`、`docs/security/**`、`docs/UPSTREAM.md` | 本地扩展 |
| 根目录 `AUDIT-*`、`TECH-DEBT-*`、`SYSTEMIC-RISK-*`、`SILENT-FAILURES-*`、`TODO-SURVEY-*`、`FALSE-POSITIVE-CHECKLIST.md`、`AI_HANDOFF_PROTOCOL.md`、`HANDBOOK.md`、`.release-notes-v*`、`local-v002-baseline.json`、`snapshot_existing_source.py` | 本地扩展 |
| 其余一切（含 `.github/dependabot.yml` 这类上游没有但放在上游目录里的新文件——按「上游没有该文件」判为本地扩展） | 上游拥有 |

## 四、一条硬规则

**改上游拥有的文件，PR 描述必须回答三个问题，缺一不可：**

1. 上游是否也有这个问题？（给出上游文件路径与行号，不要猜）
2. 是否需要回灌？
3. 回灌的形态是什么？能否去掉智境专属的 IP、主机名、路径、产品名？

本地独有的改动同样要在 PR 里写明「本地独有」以及理由。这条规则的用途不是形式审查：不回灌的安全修复会在下次同步上游时被原样带回来，重复一遍排查。

## 五、回灌流程

### 比对环境

```sh
git clone https://github.com/Wei-Shaw/sub2api ~/.capy/work/upstream-sub2api
# 需要按某个基线比对时
git -C ~/.capy/work/upstream-sub2api checkout 10ba8f9b4
tools/upstream-diff.sh --upstream ~/.capy/work/upstream-sub2api --baseline v0.2.21
```

不要把上游代码提交进本仓库，也不要 `git fetch upstream --tags`：`AUDIT-20261114.md:125` 记过这个坑——上游 tag 会污染本地版本号空间，`git describe` 会选错。

### 补丁放哪

`deploy/zhijing/patches/`，命名 `NNNN-<kebab-slug>.patch`，序号递增、不复用。

先例：`0001-ci-race-job.patch` 曾放在这里，`c72e9e1` 提交进来，`0e20d7a`（#23）落地后删除。**补丁是临时的运输工具，不是档案**：改动进了上游或进了本地 CI，补丁文件就该消失，只在本节的「未回灌清单」里留一行记录。

### 补丁格式与提交信息

- 用 `git format-patch` 产出，一封补丁一个提交，上游可以 `git am` 直接吃。
- 提交信息沿用仓库习惯的前缀：`fix(deploy):`、`fix(config):`、`fix(security):`、`chore(ci):`。
- 正文写清三件事：问题是什么、改了什么、**升级影响**（默认值变化会打到现有部署时必须写）。

### 上游不接受时

1. 补丁**留在仓库**里，不要删——它是本地与上游分叉点的唯一记录。
2. 在下表登记一行，写清补丁号、上游 issue/PR 链接、拒绝理由。
3. 该改动从此按「长期本地补丁」对待：每次同步上游都要重放，**重放失败即同步失败**，不能悄悄跳过。
4. 如果上游接受了：删补丁、删登记行，改动随上游流入。

### 未回灌清单

| 补丁 | 上游 issue/PR | 状态 | 理由 / 重放要求 |
|---|---|---|---|
| （空） | | | 目前没有长期本地补丁；六条安全改动的回灌判定记在各自的 issue 上 |

## 六、差异清单工具

```sh
tools/upstream-diff.sh --upstream ~/.capy/work/upstream-sub2api            # 差异最大的前 20 个文件
tools/upstream-diff.sh --upstream ~/.capy/work/upstream-sub2api --top 0    # 全部
tools/upstream-diff.sh --upstream ~/.capy/work/upstream-sub2api --class local --top 0
tools/upstream-diff.sh --upstream ~/.capy/work/upstream-sub2api --baseline v0.2.21 --missing
```

输出是 TAB 分隔的三列，按改动行数降序，`#` 开头的是注释行：

| 列 | 含义 |
|---|---|
| 改动行数 | `+` 行与 `-` 行之和，口径同 `git diff --numstat`；本地新增按 0 计，排在最后；二进制按 1 计 |
| 分类 | `mixed` / `local` / `missing` |
| 路径 | 相对仓库根 |

分类只有三种：

- `mixed`——上游文件，我们改过。**这是要写回灌判断的那一类。**
- `local`——上游没有这个文件（本地新增，或落在本地独有目录）。
- `missing`——上游有、本地没有，只在 `--missing` 时列出。多半是被删掉的上游能力，值得逐条问一句为什么。

三个实现细节值得知道：

- 比对前先把上游内容里的 module 路径换成我们的，所以机械改名不会进清单。
- 构建产物（`frontend/dist`、`frontend/coverage`、`build/`、`backend/build`、`plugins/`）跳过，但 `backend/internal/web/dist` 不跳——那是随仓库发布的嵌入式前端产物，是真正要比对的文件。
- 脚本自己锁 `LC_ALL=C`。`diff` 的输出是要被解析的，翻译过的「Files … differ」/「Only in …」会让解析器一条都认不出来，而脚本照样成功退出、报出 0 个差异——静默漏报比报错坏得多，所以不看调用方的 locale。

自测（构造两个假目录，不联网、不需要上游 checkout，覆盖归一化、三种分类、排序、`--top` / `--class` 过滤与参数校验）：

```sh
sh tools/upstream-diff-test.sh
```

这个自测没有接进 CI——本 PR 不碰 workflow。改 `tools/upstream-diff.sh` 的 `classify_area()` 时必须同时改本节的边界表并手动跑一遍自测。

## 七、已知漂移

这些不是「待办」，是当前状态的一部分，同步上游时必须先看一眼：

| 现象 | 证据 | 处理 |
|---|---|---|
| `assets/partners/**` 41 个上游文件被本地删除 | `8e44ece`「docs: remove the sponsor section from all three READMEs」 | 有意为之（去赞助商）。同步上游时不要恢复 |
| `.github/dependabot.yml` 是本地新增，上游没有 | 上游 `main` 的 `.github/` 只有 `SECURITY.md`、`audit-exceptions.yml`、`release-tools/`、`workflows/` | 本地扩展；上游若哪天加同名文件，先比内容再决定谁覆盖谁 |
| `docs/changes/2026-11-12-request-memory.md` 上游有、本地没有 | 基线之后新增，尚未同步 | 下次同步上游时一并带入 |
| 7 个文件的内容来自其他上游版本 | 见第二节 | 无实际影响；按「本地改过」计入统计 |
