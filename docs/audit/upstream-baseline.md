# 上游基线：四个 sha 与"不能 git merge"的证据链

写这份文件的原因是：仓库里同时存在四个 sha，它们被当成同一个"基线"用了两周。任何人接手回灌前必须先读这里，否则第一次比对就会得出错误结论。

## 一、证据（先看证据，再看结论）

以下命令在 `52c779a` 上执行，输出原样引用。

### 1. 本仓库与上游没有共同祖先

```
$ git merge-base HEAD upstream/main
（无输出）
$ echo $?
1
```

`merge-base` 返回空：不存在任何共同祖先提交。

### 2. 声明基线不是本仓库的祖先

```
$ git log -1 --format='%h %ad %s' --date=short 10ba8f9b4
10ba8f9b4 2026-11-11 Merge pull request #8639 from xy3xy3/feat/claude-fable-mythos-5-2
$ git merge-base --is-ancestor 10ba8f9b4 HEAD; echo $?
1
```

（注：未 fetch 上游之前 `git cat-file -t 10ba8f9b4` 会报 `fatal: could not get object info`；fetch 之后对象在本地能取到，但 `--is-ancestor` 说明它与本仓库的历史无关。两者不矛盾——本地有对象 ≠ 有血缘。）

### 3. 本地历史只有一个 root，且自报"跟随上游 v0.2.20 + 重放补丁"

```
$ git rev-list --max-parents=0 HEAD
e5247df77f7af4c19614d846eafbe0e865f6d58c
$ git log -1 --format='%s' e5247df
zhijing 0.2.20-zhijing-3-9-v0.0.5: follow upstream sub2api v0.2.20 (6b4b37db) and replay deployed v0.0.3 patch
```

这是一个**新仓库**，把上游 v0.2.20 的内容 + 已部署的补丁重放成第一个提交，不是 GitHub fork。

### 4. `local-v002-baseline.json` 记的是什么

```
$ python -c "import json;print(json.load(open('local-v002-baseline.json'))['upstream'])"
d851a38477597157e78450d30af2d8504764d085
```

该文件是导入时对 78 个文件的 sha256 指纹（导入提交信息里写明 `patch: local branch zhijing/v0.0.3-backend (dcaf707) vs d851a38, 174 files`）。它是**三方合并的参照物**，不是"上游基线"。

### 5. 四个 sha 各归其位

| 点 | sha | 日期 | 用途 |
|---|---|---|---|
| 回灌起点 | `530c5e3a4` | 2026-11-11 | 上一轮审计记录的上游 HEAD，欠账的真实起点 |
| 回灌终点 | `4233cc3` | 2026-11-27 | 当前上游 HEAD |
| 声明基线 | `10ba8f9b4` | 2026-11-11（v0.2.21） | 仅用于 `docs/UPSTREAM.md` 的对照表述 |
| 导入指纹参照 | `d851a384` | 2026-10-30 | 只给 `local-v002-baseline.json` 用，不参与回灌计算 |

`530c5e3a4 → 4233cc3`：468 个提交、694 个文件（175 新增 / 519 修改）。

## 二、结论（由上面的证据直接得出）

1. **`git merge upstream/main` 在任何时候都是错的。** 没有共同祖先，合并结果等于用上游整棵树覆盖本地：本 fork 的硬化（hash 锁、受保护字节、门禁清单、fork-manifest）会静默消失，git 也不会报冲突。
2. **唯一安全的升级路径是逐文件判定。** `fork-manifest.json` 那套"新增 / 修改 / 保留"的记录方式，加上按文件的三方合并，是这套仓库结构下唯一不会丢东西的做法。
3. **回灌必须分片、一片一个 PR、每片带 `fork mechanisms preserved` 清单**（见 `docs/audit/backport-shards.md`）。
4. **四个 sha 各归其位**，按第一节第 5 条的表用。不要再用"基线"这个词泛指其中任何一个。

## 三、维护方式

- 每次回灌完成，只更新表中的"回灌起点"到那次的终点；"回灌终点"始终是当时的 `upstream/main`。
- `d851a384` 那一行永不改：它是历史，改了就丢证据。
- 如果哪天真的要对齐上游历史（而不是逐文件合并），那是一件独立的大工程，需要单独的方案与回退点，不在本文件的讨论范围内。
