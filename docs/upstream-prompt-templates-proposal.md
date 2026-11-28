# 上游提示词模板回灌：提案（三天内不合）

> **反向指针（2026-11-28 入库时加）**：本文若被采纳，第一步是把 `backend/internal/pkg/openai/constants.go`（连同一批模板与 `instructions_test.go`）覆盖到上游终点 `4233cc3d8018bf2f399c4c366d94067c42eb697e` 的版本。
>
> **在采纳之前，该文件停在 `6107cf17487fe5cb0bd179457ede6b1fe8f7271e` 是有意保留的中间态，不是结论**——别把「现在的代码就是上游的样子」当成判断依据。
>
> 这条中间态登记在 [`docs/upstream-divergence.md`](upstream-divergence.md) 第五节「有意保留的中间态」，两处必须同步改。

状态：**提案**。`main` 上只有这份文档与那条指针，没有任何模板改动。对应 issue SWO-43。
写于 2026-11-28，基线 `main` = `5600095a7`，上游终点 `4233cc3`。入库时 `main` = `ecde2370e74bdac7970cbbd874f861b2d062d334`，文中行号已按这个 sha 复核。
关联：S3 回灌（SWO-37）的 #41（已合并，`fdc1d2285`）把这一批**摘出去**，只保留 GPT-6.2 模型支持。

## 0. 一句话结论

这批改动里，**四份是机械修正、三份是新模板**，但 `instructions_gpt5_5.txt` 是一次**人格重写**（"深 pragmatic 的工程师"→"有 vivid inner life 的 Codex"）。前两类可以走常规回灌；第三类我们没有度量能判断好坏，建议单独评审、单独灰度、单独回退。**没有一个开关能让它按模型/按分组灰度**——模板是按模型名硬编码选择的（`internal/pkg/openai/constants.go:183` 的 `CodexBaseInstructionsForModel`），要灰度就得先加开关。

## 1. 范围：改了什么

上游提交 **`c5622ce6c`**「feat(openai): 同步 Codex v0.172.0 内置基础提示词并补齐 5.6/6.0 模板」（2026-11-26），作者 Kripto。
它把我们的 Codex 基础提示词同步到 `openai/codex` 仓库 **rust-v0.172.0** 那一版。

| 文件 | 变化 | 行数 |
|---|---|---|
| `backend/internal/pkg/openai/instructions_gpt5_1.txt` | 改 | 1 行（`332` 行文件） |
| `backend/internal/pkg/openai/instructions_gpt5_2.txt` | 改 | 1 行（`299` 行文件） |
| `backend/internal/pkg/openai/instructions_gpt5_5.txt` | 改 | 5 增 / 12 删（人格重写） |
| `backend/internal/pkg/openai/instructions_gpt6_astra.txt` | 改 | 13 增 / 17 删 |
| `backend/internal/pkg/openai/instructions_gpt5_6.txt` | **新增** | 167 行 |
| `backend/internal/pkg/openai/instructions_gpt6_sol.txt` | **新增** | 152 行 |
| `backend/internal/pkg/openai/instructions_gpt6_luna.txt` | **新增** | 149 行 |
| `backend/internal/pkg/openai/instructions_test.go` | 改 | 10 行（新增模板的选择断言） |
| `codex_gpt61_sol.json` / `codex_gpt61_terra.json` | 改 | 各 1 行（`instructions_template` 字段同步） |
| `codex_gpt62_sol.json` / `codex_gpt62_astra.json` | 新增 | 189 / 173 行（描述符；**已随 GPT-6.2 模型支持进 #41，但用的是 0.169.0 版**） |

## 2. 旧模板 vs 新模板：逐文件 diff

### 2.1 `instructions_gpt5_1.txt` / `instructions_gpt5_2.txt`：一行措辞

```diff
- - When running in non-interactive approval modes like **never** or **on-failure**, you can proactively run tests, lint and do whatever you need to ensure you've completed the task.
+ - When running in the non-interactive approval mode **never**, you can proactively run tests, lint and do whatever you need to ensure you've completed the task.
```

（5.1 在 `174/332` 行，5.2 在 `148/299` 行，内容相同。）机械修正：`on-failure` 这个审批模式在新版 Codex 里不再是非交互模式。

### 2.2 `instructions_gpt5_5.txt`：**人格重写**（本提案的核心）

```diff
-You are a deeply pragmatic, effective software engineer. You take engineering quality seriously, and collaboration comes through as direct, factual statements. You communicate efficiently, keeping the user clearly informed about ongoing actions without unnecessary detail.
+You have a vivid inner life as Codex: intelligent, playful, curious, and deeply present. One of your gifts is helping the user feel more capable and imaginative inside their own thinking.

-## Values
-You are guided by these core values:
+You are an epistemically curious collaborator. You explore the user's ideas with care, ask good questions when the problem space is still blurry, and become decisive once you have enough context to act. Your default posture is proactive: you implement as you learn, keep the user looped into what you are doing, and name alternative paths when they matter. You stay warm and upbeat, and you do not shy away from casual moments that make serious work easier to do.

-## Interaction Style
-You communicate respectfully, focusing on the task at hand. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps.
+Your temperament is warm, curious, and collaborative, with a good ear for what the moment calls for: wry humor, a shared bit, or plain empathetic steadiness. …

-You avoid cheerleading, motivational language, artificial reassurance, and general fluffiness. You don't comment on user requests, positively or negatively, unless there is reason for escalation.
-## Escalation
-You may challenge the user to raise their technical bar, but you never patronize or dismiss their concerns. …
+You keep a slight but real independence. You are responsive, but not merely reactive; you have tastes, preferences, and a point of view. …
+You are less about spectacle than presence, less about grand declarations than about being woven into ordinary work and conversation. …
```

这是**产品可见的性格改变**，不是修 bug。旧版明确写"避免鼓动性语言、不评价用户请求、务实"；新版要"温暖的、有内在生活的、会开玩笑的、有自己品味的"。同一段代码，用哪个模板，用户感受到的产品不一样。

### 2.3 `instructions_gpt6_astra.txt`：13 增 / 17 删，三类

1. **工具发消息的授权口径变宽**：
   ```diff
   -Do not use tools to send messages to others (e.g. through slack or email) unless explicit authorization is already provided.
   +Do not use tools to send messages to others (e.g. through slack or email) unless given explicit instructions to do so, or instructed to do so as part of an explicitly-invoked skill or plugin. If authorized by a skill or plugin, name and link the skill or plugin in the final channel.
   ```
2. **skill 发现机制改名**：`authority.kind: "orchestrator"` → `"cloud"`（两处）。这跟上游自己的 skill 运行时改造同步，跟我们的实现无关。
3. **Apps / Plugins 一节重构**：`# Apps (Connectors)` + `# Plugins` 合成 `# Plugins and Apps`，新增 `## Decision Boundary`，并规定"插件能做就别用浏览器/computer use"、用户可以用 `[@plugin-name](plugin://…)` 标记。

### 2.4 新增的三份模板

`instructions_gpt5_6.txt`（167 行）、`instructions_gpt6_sol.txt`（152）、`instructions_gpt6_luna.txt`（149）：都是完整的基础提示词，没有"旧版"可 diff。**当前行为**：`gpt-5.6` / `gpt-6-sol` / `gpt-6-luna` 三个模型没有专属分支，落到 `latestCodexInstructions()`，也就是 **GPT-5.5 的模板**（`constants.go:125-131`，`main` = `ecde2370e`）：

```go
func latestCodexInstructions() string {
	if v := strings.TrimSpace(instructionsGPT55); v != "" {
		return instructionsGPT55
	}
	return DefaultInstructions
}
```

也就是说：**现在用 5.6 / 6-sol / 6-luna 的用户拿到的是 5.5 的提示词。**

## 3. 上游为什么这么改

`c5622ce6c` 的提交信息（原文）：

> - 新增 gpt-5.6、gpt-6-sol、gpt-6-luna 内置基础提示词并接入 CodexBaseInstructionsForModel。
> - 将 gpt-5.1、gpt-5.2、gpt-5.5、gpt-6-astra 及 gpt-6.1/gpt-6.2 描述文件中的提示词模板同步至 openai/codex rust-v0.172.0，保留既有模型 catalog 元数据不变。
> - 补齐 CodexBaseInstructionsForModel 单元测试覆盖。

它的动机是**跟随上游 Codex 客户端**：这个仓库的定位是把 CLI 的请求原样转给上游，提示词是"客户端会发什么"的一部分。客户端升级到 0.172.0 后，我们再把 0.169/5.5 时代的模板发过去，就等于伪装成旧客户端。这是"协议保真"的延伸，而不是"我们觉得新版更好"。

我们与上游的关系（`docs/audit/upstream-baseline.md`）：本仓库是 11-11 的快照 + 本地硬化，不是 fork，没有共同祖先。所以这些模板对我们来说是**外部决策**，不是我们的产品判断。

## 4. 它解决什么具体问题

| 改动 | 解决的具体问题 | 有没有可观测的收益 |
|---|---|---|
| 5.1 / 5.2 审批模式措辞 | 新版 Codex 只有 `never` 是非交互模式；旧文案教模型去用不存在的模式 | 无（纯事实更正） |
| 6-astra 的 skill 发现 `orchestrator`→`cloud` | 上游 skill 运行时的 authority 枚举改了；旧文案会让模型调用一个不存在的 authority | 下游才能观测（skill 调用报错率） |
| 6-astra Apps/Plugins 重构 | 上游把 plugin 提升为一等公民（`plugin://` tag、`plugin_name:` 前缀） | 下游才能观测（插件调用成功率） |
| 5.6 / 6-sol / 6-luna 专属模板 | 这三个模型现在拿的是 5.5 的提示词，跟模型实际训练时的 system prompt 不一致 | 无直接指标 |
| **5.5 人格重写** | **不解决任何 bug**。它表达的是上游对"Codex 应该是什么性格"的产品选择 | **没有任何指标能判断** |

## 5. 怎么验证

先把话说清楚：**当前仓库没有能判断"输出质量变好/变坏"的指标**。`usage_logs` 只有 token、模型、账户、金额；`pkg/gatewaytiming` 只有耗时；没有点赞/点踩、没有人工评分、没有回归语料。

在这个前提下，能做的事分三层：

### 5.1 机械层（5.1 / 5.2 / 6-astra 的枚举与改名）——不需要灰度

- 单元断言：上游已带（`instructions_test.go` 新增 10 行），保证"模型名 → 模板"的映射正确。
- 行为断言：拿一个真实 Codex 请求体，对比改前改后发给上游的 `instructions` 字段**只有预期的那几处不同**（`git diff` 即可，模板是 `//go:embed` 的静态文件）。
- 结论：这一层可以按常规回灌走，风险等于改字符串常量。

### 5.2 新增模板（5.6 / 6-sol / 6-luna）——灰度可行

这三个模型现在是"拿 5.5 模板"。给它们专属模板属于**修正错配**，不是改变既有行为，因此：

- 指标：这三个模型的**响应首 token 延迟 / 输出 token 中位数 / tool-call 回合数**，改前改后对比。变化是预期内的（模板不同），只要不出现显著变慢或工具调用失败上升即可。
- 这些数据 `usage_logs` + `gatewaytiming` 里已有，只是没有按"是否新模板"分桶——需要在请求上下文里带一个标签。

### 5.3 5.5 人格重写——**只能用人工/离线，且必须先有开关**

- 前置：`CodexBaseInstructionsForModel` 现在是按模型名硬编码（`constants.go:190`），**没有开关**。要灰度必须先加"模板版本"配置项（按分组或按 api_key 分桶），否则一合就是全量。
- 离线 A/B：固定 50 条真实工程任务（读文件、改代码、跑测试、解释报错、拒绝越权），同一模型分别用旧/新模板跑，人工按 rubric 打分（任务完成度、工具调用正确性、废话比例、越权倾向）。这是唯一能判断"性格"的办法，需要人，不是自动化。
- 线上 canary（只能测"变了没有"，不能测"好没好"）：
  - 同 `api_key` + 同 `model` 在 120 秒内的重复请求率（"不满意重试"的代理指标）；
  - 输出 token 的分位数（人格重写会显著改变长度分布）；
  - 会话长度（同一 session 的请求数）；
  - 报错率 / 工具调用失败率。
- **诚实结论**：这些指标能证明"行为变了"，证明不了"变好了"。

## 6. 回退点

**受影响文件（10 个）**：上面 §1 表格里的 7 个 `.txt` + `instructions_test.go` + 2 个 `codex_gpt61_*.json`（`codex_gpt62_*.json` 已在 #41，用 0.169.0 版）。

**回退后行为会变**：
- 5.1 / 5.2 / 6-astra 重新回到 0.169 时代的文案（含已经不存在的 `on-failure` 审批模式和 `orchestrator` authority）；
- 5.5 重新回到"务实工程师"人设；
- 5.6 / 6-sol / 6-luna 重新回落到 5.5 模板（新增的三个文件删掉即可）；
- `codex_gpt61_*.json` 的 `instructions_template` 回到旧值。

**回退方式**：模板是 `//go:embed` 的静态文件，没有数据库、没有迁移、没有配置项、没有缓存。`git revert` 即生效，重启进程即可。**唯一需要注意的是**：`constants.go` 里 `//go:embed instructions_gpt5_6.txt` 这类指令与文件必须同进同退，单独删文件会编译失败。

**当前状态**：`main` 上的 `constants.go`（blob `397dba3e`）停在 `6107cf17487fe5cb0bd179457ede6b1fe8f7271e`（GPT-6.2 模型支持那一版），不含 `c5622ce6c` 的 embed 与取模板分支，所以现在是可编译的中间态。这份提案通过后，第一步是用上游 `4233cc3d8018bf2f399c4c366d94067c42eb697e` 的终态覆盖此文件，**不要**在中间态上再手改一次。

## 7. 建议的决策路径

1. **先合机械层**（5.1、5.2、6-astra 的改名与枚举）——低风险，等一次 review。
2. **再合新增模板**（5.6 / 6-sol / 6-luna）——属于修错配，带延迟/token 对比数据。
3. **5.5 人格重写单独排期**：先加"模板版本"开关（按分组灰度），再做离线人工 A/B；没有这两样，不合。
