# 智境 Gateway v0.0.2：严格审计、修复与性能验证

审计日期：2026-11-05。对象：[zhijing-gateway v0.0.2](https://github.com/daniei-chen/zhijing-gateway/releases/tag/v0.0.2)。本报告与代码、回归测试和机器可读证据一同交付。

## 1. 结论与交付状态

本轮已经落实前端会话、异步生命周期、敏感信息存储、付款/备份轮询、导出一致性、依赖和发布工具修复。原版到最终候选的登录页静态 JS 依赖 gzip 总量减少 **39.73%**，成员工作台减少 **31.92%**；**409 个文件、3,245 项前端测试全部通过**，另有 Python 工具回归 20/20、Node 契约回归 3/3、真实 Chromium 合成冒烟 9/9。依赖扫描在本轮数据库时点，全量和生产范围均返回 0 条已知告警。[验证总表](../audits/2026-11-05/validation.json) · [原版/候选体积对照](../audits/2026-11-05/bundle-comparison.json)

**完整前后端终审仍未完成。** 以下边界直接影响是否能给出“最高级别、每行均已证明、全部性能已优化”的结论：

- 公开仓库没有完整后端，只有 17 文件的可选诊断补丁。服务端鉴权、租户隔离、计费事务、限流、调度、数据库与 Redis 实现不能据此审计。
- 全仓已建立逐文件清单，但人工完整阅读、关键路径审阅、自动检查和文件盘点的范围不同；不能把扫描过的文件都称为逐行精审。
- 原覆盖率配置未真正执行全局 80% 门槛；现已修正。实际四项覆盖率均未达到 80%，覆盖率命令按要求返回失败。
- OAuth 回调协议、批量图片预览缓存、后端历史时序关联及大型页面仍有明确待办。
- 没有本轮生产压测、上线切换、真实支付结算或真实邮件发送，也没有证据支持网关 TTFT、p95/p99 或 TPS 的提升比例。

交付定位是可审核的修复候选。安全和性能结论以本报告标明的证据范围为准。

## 2. 版本、来源与发布资产

| 项目 | 本轮核实结果 |
|---|---|
| GitHub 最新正式 Release | `v0.0.2` |
| Release 对应提交 | `c690c0dbb84b627dedabf85d7f0178fda28bb510` |
| 审计与修复起点 | `8f72c8545d8134b4c4d14036a2060fd2a08b0053` |
| 两提交之差 | 仅一条 README 部署记录更新；应用源码相同 |
| 原始跟踪文件 | 1,182 个；基线工作树每个 Git blob 均与提交一致 |
| 原版锁与安装锁 | 逐字节一致，SHA-256 `0c2e5969a1eca24a0c04251c16239cbf6f5c4ee9da066826f5bf2584eee7c8be` |
| 原版实际工具链 | Node 24.22.1、pnpm 9.15.9、Vite 5.4.21、Vitest 2.1.9、XLSX 0.18.5 |
| 最终候选主要版本 | Node 24.22.1、pnpm 9.15.9、Vite 6.4.5、Vitest 4.1.12、SheetJS 0.20.3 |

已实际下载正式发布的前端 ZIP、诊断源码 ZIP、BUILD-MANIFEST 和 SHA256SUMS。四个文件的 SHA-256 与 GitHub 资产摘要全部相符，SHA256SUMS 的三个条目全部匹配，当前严格版 `verify_release.py` 也接受原版发布包，识别到 310 个静态文件及正确的 Release 提交。没有执行归档中的代码。[发布资产完整证据](../audits/2026-11-05/published-release-verification.json) · [基线来源证明](../audits/2026-11-05/original-source-proof.json)

Release 与 README 中的既有上线记录属于历史说明。本轮未独立核实生产部署；旧 manifest 的 `production_deployed` 字段也不代表本轮核实了生产状态。

## 3. 逐文件覆盖：明确人工与自动工作的差别

当前非递归审阅清单包括原始全部跟踪文件，以及本轮新增的实现、测试和工具；不把生成的审计报告本身、node_modules 或构建输出重复计入源码范围。

| 覆盖方式 | 文件数 | 能说明什么 |
|---|---:|---|
| 完整人工阅读/编写并复核 | 76 | 该文件整体经过阅读；仍不等于形式化证明 |
| 人工审阅关键段落、脚本、调用链或语义差异 | 67 | 对已标明的关键路径有人工结论；其余内容不能宣称完整精审 |
| 自动检查为主 | 880 | 语法、类型、lint、测试或结构模式得到检查；不能等同业务语义全审 |
| 文件盘点、哈希/资产记录 | 189 | 文件被纳入清单；没有把资产和未深审文档当作已验证业务代码 |
| 合计 | 1212 | 每个文件有路径、哈希和审阅层级 |

Vue/TypeScript 全范围结构检查覆盖 **990 个单元**，无语法解析失败；全仓前端 ESLint 检查 **994 个文件**，0 error、0 warning。结构检查记录定时器、监听器、异步调用、Web Storage、IndexedDB 和 HTML sink 的位置；它不解析全部别名、计算属性访问或证明每个消毒调用正确。

[逐文件审阅清单](../audits/2026-11-05/file-review-inventory.json) · [全前端结构清单](../audits/2026-11-05/all-frontend-structural-scan.json) · [认证审阅](../audits/2026-11-05/review-auth.json) · [前端审阅](../audits/2026-11-05/review-frontend.json) · [发布/补丁审阅](../audits/2026-11-05/review-release.json)

## 4. 已确认并修复的问题

优先级采用工程处理顺序：P1 为应优先合入的会话、安全或条件性可用性问题；P2 为重要正确性、可靠性和性能问题；P3 为低风险工具边界。条件成立与否、攻击可达性和服务端缺失分别标明，没有从前端缺陷直接推导服务器提权。

### 4.1 认证、注册和敏感操作

| 问题 | 原行为与影响 | 修复后的行为 | 主要依据 |
|---|---|---|---|
| 验证码等待期间旧登录/注册/OAuth 意图继续执行，P1 | 在等待验证码后才锁定提交或取得会话；另一标签换号后，旧操作仍可继续 | 等待前锁定提交并捕获会话，每个安全相关 await 后复验；卸载后停止续发请求和跳转 | [LoginView](../../frontend/src/views/auth/LoginView.vue)、[RegisterView](../../frontend/src/views/auth/RegisterView.vue)、[EmailVerifyView](../../frontend/src/views/auth/EmailVerifyView.vue) |
| WebAuthn begin/原生认证/finish 缺少共同归属，P1 | 浏览器原生认证对话框持续期间可能切换登录会话 | 原生请求加入取消信号，begin 到 finish 绑定同一 generation/subject；相同用户重新登录也视为新会话 | [passkey.ts](../../frontend/src/api/passkey.ts) |
| TOTP 二次确认后重放旧敏感操作，P1 | 确认窗口跨越换号或离开页面后，旧回调可能重试或一直挂起 | 绑定发起会话和组件作用域；换会话/卸载会结算取消，重试前后复验 | [useStepUp.ts](../../frontend/src/composables/useStepUp.ts) |
| 短 TTL token 刷新循环与超长定时器溢出，P1，依赖配置 | 固定提前 120 秒使生命周期不超过两分钟的新 token 立即刷新；大延迟可能被浏览器截断 | 提前量为 `min(120秒, 剩余时间/2)`，至少等待 1 秒；超出定时器范围时分段调度；同到期时间保留原计划 | [auth store](../../frontend/src/stores/auth.ts) |
| 启动恢复混用跨标签身份，P2 | 读取 A 的 token/user 时，B 提交新会话，界面缓存可能与请求会话不一致 | 读取前后检查同一快照，明确采用该快照，旧失败清理不会删除新凭据 | [auth store](../../frontend/src/stores/auth.ts)、[authSession.ts](../../frontend/src/api/authSession.ts) |
| 注册明文密码落入 sessionStorage，P2 | 密码可从 `register_data` 恢复，页面刷新也能继续恢复秘密 | 未消费的交接草稿与会话绑定、最多保留 15 分钟并仅能消费一次；消费后由验证码页组件持有，在返回、完成或卸载时清理；启动清理旧存储，刷新走过期流程 | [registrationDraft.ts](../../frontend/src/utils/registrationDraft.ts) |
| 嵌入 URL 的异常/编码边界，防御性修复 | 编码 fragment、userinfo、解析失败返回原字符串未统一拒绝 | 对凭据参数进行规范解码检查，拒绝 userinfo、无效协议和无效 URL | [embedded-url.ts](../../frontend/src/utils/embedded-url.ts) |

注册改动有一个明确体验变化：在验证码页刷新或新开标签会丢失内存草稿，需要返回注册页重新输入密码。浏览器实测确认正常 SPA 跳转保留验证码表单，Web Storage 没有密码，刷新后出现会话过期提示。注册 API 的业务字段和开关仍由原接口处理。[浏览器证据](../audits/2026-11-05/browser-smoke.json)

### 4.2 流式请求、实时连接与并发页面

两个账号测试弹窗原有独立的流式 fetch 实现，缺少与通用客户端一致的会话和组件生命周期约束。现在使用共同的 [accountTestStream.ts](../../frontend/src/api/accountTestStream.ts)：会话替换、关闭和卸载取消请求；旧结果不能覆盖新测试；解析支持 CRLF 和 EOF 最后一个无换行记录；非完整 EOF 明确报错；终态到达立即结束，同一 chunk 中的后续记录也不再处理。`finally` 释放 reader 和请求，单条未完成记录限制为 16 Mi 个字符，并避免每个小 chunk 都从头扫描已有长前缀。这个上限约束单条记录，不宣称已经限制整个合法流的总输出内存。

QPS WebSocket 辅助函数加入发起会话归属、旧 socket 回调失效、完整资源清理以及首次握手失败也适用的重连预算。同一会话内的 token 轮换可以重新取 token；换登录会话不会把旧订阅重新认证成新用户。当前仓库未发现它的实际调用点，所以不把该修复折算成现有线上收益。[ops.ts](../../frontend/src/api/admin/ops.ts)

表格、Accounts 的 ETag 自动刷新、监控标签页以及共享批量图片权限缓存，都加入请求版本/取消控制和写回前的归属检查。仅发送 AbortSignal 不能保证底层适配器一定停止；晚到响应即使正常 resolve，也必须被拒绝写入较新的页面。分页查询使用最初参数快照，组件卸载后不再注册监听器或重启定时器。[useTableLoader](../../frontend/src/composables/useTableLoader.ts) · [AccountsView](../../frontend/src/views/admin/AccountsView.vue) · [ChannelStatusV2View](../../frontend/src/views/user/ChannelStatusV2View.vue) · [useBatchImageAccess](../../frontend/src/composables/useBatchImageAccess.ts)

### 4.3 支付、备份、复制和导出

| 范围 | 实质修复 | 验证边界 |
|---|---|---|
| Stripe 弹窗 | 使用共同 paymentAPI；同时检查消息 origin、opener 和字段；异步 SDK 和轮询绑定会话/生命周期 | 没有真实支付、退款或结算测试 |
| Stripe/二维码/支付状态轮询 | 整个查询和二次确认链保持一次只运行一个请求；终态、过期、换订单和卸载后停止；旧取消/成功不能影响新订单 | 解决前端并发与显示归属，不证明服务端结算正确 |
| 备份/恢复状态轮询 | 避免 2 秒 interval 下慢请求重叠，按 controller 识别新旧轮询；离开页面后不再晚通知 | 只给两个 GET 增加兼容可选 signal，恢复 POST 语义未改 |
| 账号、分组、监控复制 | 账号重试键按管理员隔离；晚到成功只清理自己捕获的键，不能删除新操作的键；管理员身份可解析时，模糊失败仍保留重试键 | 后端幂等作用域不在仓库中；升级不继承无归属的旧账号键 |
| 管理员 Excel 导出 | 固定整次导出的筛选、排序和文件名；分页、卸载、换会话及 XLSX 序列化完成后都检查归属 | 同步序列化期间另一标签也能换会话，因此下载前再次检查 |

[支付生命周期回归](../../frontend/src/components/payment/__tests__/paymentPolling.lifecycle.spec.ts) · [备份轮询回归](../../frontend/src/views/admin/__tests__/BackupView.polling.spec.ts) · [复制并发回归](../../frontend/src/api/__tests__/admin.duplicateConcurrency.spec.ts) · [导出回归](../../frontend/src/views/admin/__tests__/UsageView.exportLifecycle.spec.ts)

SheetJS 升级另用真实库完成分页写入/读取往返验证，覆盖中文、零值、固定精度金额字符串和公式样式的非可信名称；断言导出单元格保持字符串且不生成公式。原 CSV 公式注入防护断言保留。Vitest 4 升级所需的 Blob mock 改为可构造函数，没有删除这些断言。[真实 XLSX 测试](../../frontend/src/utils/__tests__/xlsx.export.spec.ts)

### 4.4 开发注入、依赖与发布链

Vite 开发服务器向 HTML 注入公开设置时，原始 JSON 字符串可包含结束 script 标签的文本。现在转义 HTML 敏感字符和 Unicode 行分隔符，并用 DOMParser 检查只产生一个 script 且数据无损。该问题需要攻击者影响开发服务器拿到的设置值；缺失的生产后端 HTML 注入代码不在这个修复的验证范围内。[序列化 helper](../../frontend/build/serializePublicSettings.ts)

依赖扫描原返回 **79 条告警**：危急 3、高 35、中 37、低 4，原始 JSON 有 75 个 advisory 对象。它们是扫描器结果，不能表述成 79 个已经证明可从线上利用的漏洞。已移除没有运行时引用的 `@lobehub/icons` 及其庞大依赖链、更新受影响工具与依赖，使用 SheetJS 官方 0.20.3 tarball 并锁定完整性，固定 Node/pnpm，默认安装不执行依赖 lifecycle scripts。开发依赖中 glob/minimatch 的跨主版本覆盖经过完整测试、类型检查与 lint 验证。[依赖前后证据](../audits/2026-11-05/dependencies-original.json) · [最终全量](../audits/2026-11-05/dependencies-final.json) · [最终生产](../audits/2026-11-05/dependencies-production-final.json) · [SheetJS 官方安装说明](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)

发布链修复包括：

- 用始终运行的显式检查替代关键 Python `assert`，使 `python -O` 也会拒绝被篡改的源码、补丁或归档。
- 拒绝空/不完整校验清单、重复 ZIP 成员、路径穿越、符号链接、额外敏感文件及不匹配的 manifest；约束解压工作量。
- 打包前进行冻结安装、完整测试和新构建，避免把忽略目录中的旧 dist 标成当前提交；诊断输入使用白名单，避免夹带 `.env`。
- 保留历史兼容与安全哈希，另建本轮 15 文件增量清单。Ops 校验器准确报告 `runtime_changed=true`、`types_only=false`。
- 合成预览服务拒绝非法 Content-Length、矛盾分帧、超大正文、非对象 JSON 与非法分页；该服务仅绑定回环地址。

[发布回归记录](../audits/2026-11-05/review-release.json) · [明确审核增量](../security-changes-audit-20261105.json) · [发布验证器](../../tools/verify_release.py)

## 5. 性能：已测量的收益

### 5.1 原版源码与最终候选的静态依赖图

基线使用原提交的全部 1,182 个跟踪文件及原锁安装；构建前后 Git blob/哈希均一致。候选构建的 733 个输入前后哈希一致，314 个产物与浏览器预览目录逐文件一致。计数包含为依赖图测量生成的 `.vite/manifest.json`；原版重建为 311 个文件、候选为 314 个文件，分别有 1 个测量 manifest。正式发布 ZIP 的 310 个静态文件采用其原始打包口径。以下由同一测量脚本读取 Vite manifest，合并主入口和目标路由的静态 imports，对每个 JS 文件分别 gzip 后求和。[测量工具](../../tools/measure_frontend_bundle.py)

| 入口图 | 原版 gzip 字节 | 候选 gzip 字节 | 下降 |
|---|---:|---:|---:|
| 主入口 | 218,779 | 207,301 | 5.25% |
| 登录页 | 385,159 | 232,131 | **39.73%** |
| 成员工作台 | 478,612 | 325,829 | **31.92%** |
| 管理员用量页 | 527,546 | 374,763 | 28.96% |
| Airwallex 支付页 | 402,578 | 249,715 | 37.97% |
| 账号管理 | 711,319 | 559,401 | 21.36% |
| 设置页 | 513,645 | 361,272 | 29.67% |

主要结构性原因是 XLSX 和 Airwallex 从公共 vendor 块分离，恢复按需加载。原 `vendor-ui` 436,938 字节，最终 7,301 字节；最终 XLSX 独立块 500,050 字节，只有需要时加载。XLSX/Airwallex/Stripe 均不在主入口、登录页、成员工作台和管理员用量页的静态图中。

这些数字不包括 dynamicImports、CSS、图片、HTTP 开销和真实浏览器计时。现有相邻路由预加载也可能产生额外请求。前后工具链和依赖版本不同，因此表格表示完整修复候选的总体变化；不能把所有差额都独立归因于一处代码，更不能说页面延迟下降 39.73% 或网关吞吐提高相同比例。

### 5.2 会话检查的 CPU 开销

使用最终源码及原版源码的不可变快照，在 Node 24.22.1 / TypeScript 5.6.3 下进行 7 轮交替顺序测量；每个版本每轮预热 2,000 次、测量 10,000 次。实际合成 access token 为 2,058 字符、refresh token 为 138 字符。全部测量均保留，单次 capture 中位数从 **50.888357 μs 降至 3.475463 μs**，原版与候选的中位耗时之比约为 **14.64∶1**。原版两个输入文件均与 Git HEAD 一致，最终输入及测试脚本均记录 SHA-256。早期候选的不同测量保存在历史证据中，未与本次结果混算。

每次检查仍读取存储并核验 generation、subject、phase 和凭据提交记录，仅避免对相同凭据重复做 SHA-256。没有缓存“会话仍有效”这个判断。结果是 Node 内存 Storage 上认证辅助函数的 CPU 微基准，不是浏览器网络时延、服务端请求耗时或 API 吞吐。[完整微基准](../audits/2026-11-05/auth-cpu-benchmark-final.json) · [复现工具](../../tools/benchmark_auth_session.mjs)

### 5.3 请求数量与生命周期

慢轮询现在在整个请求链完成前不会启动同一轮询的第二个请求；终态、卸载或换订单后停止处理旧结果。相同权限查询共享进行中的请求；自动刷新不覆盖新查询。这些改动消除了已复现的重复工作与状态竞争。没有把回归测试中的请求次数外推为线上 QPS 降幅。

## 6. 前端架构仍需处理的部分

**职责过大的组件。** SettingsView 13,394 行、CreateAccountModal 7,492 行、GroupsView 6,942 行、EditAccountModal 6,425 行、BatchImageGuideView 2,693 行、AccountsView 2,664 行。行数本身不能证明卡顿，但意味着状态所有权、回归覆盖和跨功能影响很难控制。最终构建仍保留 Accounts 单块约 857 KB 的警告，未通过提高警告阈值掩盖它。

建议按设置域、账号接入类型和弹窗边界拆成明确模块，把重型编辑器与 SDK 挂到实际打开操作上；拆分时继续验证原 payload、角色、计费字段、功能开关和键盘行为。单纯重排文件不计为性能优化，必须同时检查实际依赖图及设备上的交互延迟。

**批量图片任务与预览缓存。** `BatchImageGuideView` 的任务、详情和 IndexedDB 预览加载缺乏共同的请求代次。预览数据库/键没有显式用户命名空间，晚到预览可能在卸载后创建 Blob URL。这里是已观察到的客户端隔离与生命周期设计缺口，尚未证明服务端跨用户数据泄漏。需要按会话与选中任务绑定所有预览工作，并明确用户缓存命名、登出清理和保留期限；这些改动尚未在本候选中实现。[定位与建议](../audits/2026-11-05/review-frontend.json)

**令牌与 OAuth 边界。** 长期 access/refresh token 仍在同源 JavaScript 可读的 localStorage。多个 OAuth callback 兼容直接接受 fragment token。当前仓库不足以证明服务端 state、nonce、PKCE、浏览器发起绑定、一次性兑换和防重放。应与实际后端一起审查，并优先考虑服务端绑定的一次性 code 兑换方案；不能只改前端就断开现有协议。OAuth 建议参考 [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html)，本报告没有把未见到服务端实现等同于已证实可利用漏洞。

**剩余低优先界面问题。** 忘记密码页在等待验证码前没有锁定提交，可能重复触发重置邮件请求；没有测试真实服务端邮件或限速。相邻路由预加载也缺少明确的弱网/节流预算，需要浏览器瀑布图再决定范围。本轮没有把这些项目标为已修复。

## 7. 后端诊断补丁的发现与限制

### 7.1 不能替代完整后端的部分

公开的诊断 ZIP 仅含集成说明、manifest、检查脚本和差异补丁。补丁依赖已有自定义计时和并发接口，需要完全匹配的源码基线；随意取上游 Sub2API 最新版不能证明它适配实际部署。

本轮完整阅读了公开补丁及集成工具，并验证了发布包与补丁完整性。缺少可用 Go 工具链；Python 提取与哈希检查已经执行，精确提取的 5,017 字节 `history.go` 与原 manifest 的 SHA-256 一致。Go 探针已经编写，但未执行编译、race 或 benchmark。完整服务端鉴权、钱包/计费、上游调度、HTTP 连接池、SQL 和 Redis 均不能据当前材料下结论。

### 7.2 请求 ID 重用可能污染诊断归因，P2，尚未修复

静态控制流显示以下情形：容量为 1 时写入请求 A，写入 B 淘汰 A，再写入同一个 A；先前的碰撞信息随淘汰丢失。如果旧数据库行还位于前后五分钟的匹配窗口，Lookup 可能把新 A 的指标附到旧 A 上。这个问题在同用户、同 API Key 内影响诊断可信度；不能据此推导计费错误或跨租户泄漏。

已提交独立探针断言“旧行不应拿到新请求时序”。预期它会揭示原 helper 的缺陷，但**本轮未实际执行 Go 探针**。根本修复应采用可持久关联到单次请求实例的标识，或具有明确淘汰语义的失败关闭策略，并在匹配的完整后端验证。历史发布补丁和 manifest 保持原样。[探针工具](../../tools/audit_backend_history.py) · [Go 用例](../../qa/history_audit/history_test.go)

### 7.3 容量、锁与测量可信度

History 的容量上限与 TTL 同时生效，标注 24 小时不能保证保留 24 小时请求。如果每个新请求占一个条目且稳定写入 100 次/秒，4096 个条目的容量窗口约为 `4096/100 ≈ 41秒`；这只是明确假设下的容量计算，不是该服务真实流量。

Lookup 在全局锁内进行标识哈希与指标复制，发布侧有 ID 长度限制而查找侧不对称。缺少完整后端，无法确认超长 ID 能否进入这条路径；也没有锁竞争和吞吐实测。应先在安全的压测环境跑并发 race 与基准，验证把规范化/哈希移到锁前、采用不可变快照的收益及正确性。

## 8. 真正优化网关延迟与速率所需的下一阶段

要给出网关级结论，需要完整且与部署一致的后端提交、去敏配置及目标负载/SLO。不要提供生产密钥、token、用户提示词或真实账户日志。

| 层面 | 需要的检查和测量 | 判断依据 |
|---|---|---|
| 请求路径与排队 | 上传、解析、鉴权、用户/密钥/上游并发等待、重试、首事件、首 token、完整响应分开计时 | p50/p95/p99 及错误率；区分网关开销和上游模型生成时间 |
| 并发与限流 | 排队上限、等待 deadline、取消传播、租户公平、重试退避及 429 行为 | 在目标负载下吞吐稳定，超载时能有界拒绝并恢复 |
| 上游 HTTP/流式处理 | 连接复用、拨号/TLS/响应头/总超时、客户端断开、响应体关闭、背压 | 文件描述符、连接、goroutine/内存随负载回落，无持续泄漏 |
| SQL/Redis | 慢查询、索引、N+1、连接池等待、缓存命中/失效、热 key 与分布式限流 | 实际执行计划和去敏 trace；先找到热点再改参数 |
| 计费与幂等 | 并发扣费、重试、取消、部分流、重复回调、事务或补偿 | 可复现的一致性不变量，不能以吞吐换取重复扣款或漏扣 |
| 客户端体验 | 冷/暖缓存、弱网、慢设备、大列表、滚动、内存和导航 | 实际 LCP/INP、长任务、瀑布图；包体积只是其中一项 |

压测应包含流式/非流式、长短输入、慢上游、错误突发、多租户竞争、客户端取消和短 TTL token。先固定正确性与资源上限，再逐级提高负载寻找稳定吞吐和拐点。缺少这些数据时，直接提高并发、连接池、超时或重试次数不能证明更快，反而可能增加排队尾延迟。

## 9. 验证结果、覆盖率与证据

| 检查 | 结果 |
|---|---|
| 原版完整回归 | 392 文件，3,139/3,139 |
| 最终候选完整回归 | 409 文件，3,245/3,245，新增 106 项测试 |
| 原版确实失败的前端行为场景 | 86：认证 22、页面/支付/轮询 35、流/WS 18、导出 4、复制 7；这是场景数，不是漏洞数 |
| Python 工具回归 | 20/20 |
| Node 增量契约回归 | 3/3 |
| 类型检查 | `vue-tsc --noEmit` 通过 |
| 全仓前端 ESLint | 994 文件，0 error，0 warning |
| 冻结依赖安装 | 通过，未执行依赖安装脚本 |
| 原版与候选生产构建 | 均通过；候选 314 个文件（含 1 个测量 manifest） |
| 前端兼容检查 | 227 个历史受保护文件、13 个历史安全条目、15 个本轮审阅增量、2 个运行文档和 68 条路由通过；构建未混入 QA 代码 |
| Ops 源码/运行时检查 | 通过；明确报告运行时已变更 |
| 原始正式发布包 | 四个资产摘要匹配；严格验证器接受原包 310 个静态文件 |
| 真实 Chromium 153 合成冒烟 | 9/9，捕获的未处理 `pageerror` 为 0；仅本地合成数据 |
| 完整后端编译 / Go race / 网关压测 | 未执行，条件不具备 |

[候选逐用例结果](../audits/2026-11-05/tests-candidate.json) · [原版测试汇总](../audits/2026-11-05/tests-original.json) · [日志索引](../audits/2026-11-05/log-index.json) · [浏览器检查](../audits/2026-11-05/browser-smoke.json)

覆盖率单独列出，避免与测试断言通过混淆：

| 指标 | 已覆盖 / 总数 | 实际 | 全局门槛 | 结果 |
|---|---:|---:|---:|---|
| 行 | 33,475 / 49,885 | 67.10% | 80% | 未达标 |
| 语句 | 35,920 / 55,114 | 65.17% | 80% | 未达标 |
| 函数 | 6,058 / 11,675 | 51.88% | 80% | 未达标 |
| 分支 | 23,036 / 42,040 | 54.79% | 80% | 未达标 |

原配置把 `global` 当作嵌套路径匹配项，未真正设定全局阈值。本轮已经把四项门槛移到正确层级。最终覆盖率命令退出码为 **1**，原因是上述门槛未通过；3,245 项测试断言全部通过。没有降低阈值或排除难测业务文件以得到绿色结果。CI 当前执行完整断言、构建和契约校验；覆盖率命令的失败仍作为独立审计缺口记录。[配置修复](../../frontend/vitest.config.ts) · [逐文件覆盖率](../audits/2026-11-05/coverage-summary.json)

浏览器的 9 项检查包括 5 项横向溢出检查（桌面登录、320px 工作台、390px 验证码页、320px 明/暗登录），以及 4 项行为检查（合成管理员登录、跨标签换用户离开管理员路由、注册 SPA 交接不持久化密码、刷新后草稿不可恢复）。`pageerror` 计数不涵盖所有 HTTP 失败或 console 消息。

浏览器截图为合成账户；本地容器字体/Emoji 回退不代表完整真实设备字体矩阵。没有测试 Safari/Firefox、真实 WebAuthn 硬件或第三方支付 SDK 的完整外部流程。[320px 登录](../audits/2026-11-05/screenshots/login-mobile.png) · [注册刷新后的过期页](../audits/2026-11-05/screenshots/registration-expired-mobile.png) · [320px 工作台](../audits/2026-11-05/screenshots/member-mobile.png)

## 10. 复现与审核

在 Node 24 和 pnpm 9.15.9 下，从仓库根目录执行：

```bash
corepack pnpm@9.15.9 --dir frontend install --frozen-lockfile --ignore-scripts
corepack pnpm@9.15.9 --dir frontend test:run --maxWorkers=4
corepack pnpm@9.15.9 --dir frontend typecheck
corepack pnpm@9.15.9 --dir frontend lint:check
corepack pnpm@9.15.9 --dir frontend build
python3 -m unittest discover -s tools/tests -v
node --test tools/tests/test_ops_contract.mjs
python3 tools/verify_frontend.py
node tools/verify_ops_contract.mjs
python3 -O integrations/sub2api/check_patch.py --artifact-only
```

覆盖率复现命令会按实际结果拒绝当前未达到 80% 的覆盖率：

```bash
corepack pnpm@9.15.9 --dir frontend test:coverage --maxWorkers=4
```

依赖和构建图复现：

```bash
corepack pnpm@9.15.9 --dir frontend audit --json
corepack pnpm@9.15.9 --dir frontend audit --prod --json
corepack pnpm@9.15.9 --dir frontend exec vite build --manifest
python3 tools/measure_frontend_bundle.py frontend/dist /tmp/bundle-metrics.json
node tools/audit_frontend_structure.cjs /tmp/frontend-structure.json
node tools/benchmark_auth_session.mjs --baseline /path/to/original-checkout --output /tmp/auth-benchmark.json
```

浏览器工具 `tools/audit_browser_smoke.cjs` 需要 Playwright 及浏览器。它会自行启动临时回环预览服务，仅在该进程启用合成注册配置，拦截验证码发送并阻止外部请求；不会访问生产服务。输出目录可通过 `AUDIT_BROWSER_OUTPUT` 指定。使用单独安装的 serverless Chromium 时，`AUDIT_CHROMIUM_PACKAGE_ROOT` 指向该包的独立 npm 安装目录。 Playwright 不属于项目锁定依赖；它从 `CODEX_PRIMARY_RUNTIME_NODE_MODULES` 或项目 frontend 模块路径解析。若独立目录已安装 Playwright 与 Chromium 包，可执行：

```bash
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/path/to/browser-deps/node_modules \
AUDIT_CHROMIUM_PACKAGE_ROOT=/path/to/browser-deps \
AUDIT_BROWSER_OUTPUT=/tmp/zhijing-browser-smoke \
node tools/audit_browser_smoke.cjs
```

使用 Playwright 自身已安装的浏览器时省略 `AUDIT_CHROMIUM_PACKAGE_ROOT`，仍需保证 Playwright 模块可以按上述路径解析。

后端探针只有取得合适 Go 工具链后才可执行，不能把下列命令当作本轮已完成的结果：

```bash
python3 tools/audit_backend_history.py --go /path/to/go --mode test --race
python3 tools/audit_backend_history.py --go /path/to/go --mode benchmark
```

审核时优先检查会话归属与密码存储修复、支付/复制/导出回归、安装锁与发布白名单。完整后端及生产延迟/速率的下一阶段，需要补齐匹配源码、去敏运行参数和目标负载后再作结论。
