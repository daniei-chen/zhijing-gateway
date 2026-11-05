# 2026-11-05 审计证据索引

结论、修复、已测量收益和剩余边界见 [中文完整报告](../../reviews/2026-11-05-strict-audit.zh-CN.md)。本目录中的数据不构成完整后端安全认证或生产性能承诺。

| 证据 | 用途 |
|---|---|
| [validation.json](validation.json) | 验证总表；明确保留覆盖率命令退出码 1 |
| [file-review-inventory.json](file-review-inventory.json) | 原始全部跟踪文件与新增实现的逐文件哈希、审阅深度和可用覆盖率 |
| [tests-candidate.json](tests-candidate.json)、[tests-original.json](tests-original.json) | 最终 3,245 项断言与原版 3,139 项断言；候选结果保留逐用例记录 |
| [coverage-summary.json](coverage-summary.json) | 四项全局覆盖率与逐文件数据；均未达到项目 80% 门槛 |
| [review-auth.json](review-auth.json)、[review-frontend.json](review-frontend.json)、[review-release.json](review-release.json) | 各方向发现、回归、源码位置、未解决事项和审阅范围 |
| [all-frontend-structural-scan.json](all-frontend-structural-scan.json) | 990 个 Vue/TypeScript 单元的结构位置清单；不等同语义全审 |
| [bundle-comparison.json](bundle-comparison.json) | 原版与最终候选的静态 JS imports 图对照；不是页面加载或 API 延迟实测 |
| [original-source-proof.json](original-source-proof.json)、[build-input-sha256.json](build-input-sha256.json)、[build-artifact-sha256.json](build-artifact-sha256.json) | 基线与最终构建的来源/输入/产物证明 |
| [auth-cpu-benchmark-final.json](auth-cpu-benchmark-final.json) | 最终不可变源码快照、7 轮完整测量、实际 token 长度及运行环境 |
| [auth-cpu-benchmark-early.json](auth-cpu-benchmark-early.json) | 历史候选记录；旧文件把载荷长度误述为 token 长度，最终报告已纠正，不能作为最终性能数字 |
| [dependencies-original.json](dependencies-original.json)、[dependencies-final.json](dependencies-final.json)、[dependencies-production-final.json](dependencies-production-final.json) | 本轮数据库时点的依赖告警对照；不证明所有告警可利用或不存在未知漏洞 |
| [browser-smoke.json](browser-smoke.json)、[screenshots](screenshots) | 真实 Chromium、本地合成账户的 9 项检查；没有真实支付或邮件发送 |
| [published-release-verification.json](published-release-verification.json) | 实际下载四项正式资产并核对摘要、ZIP 清单与 manifest；没有执行其中代码 |
| [frontend-contract.json](frontend-contract.json)、[ops-contract.json](ops-contract.json) | 兼容保护增量与真实运行时变更检查 |
| [log-index.json](log-index.json) | 保留日志的原始 SHA-256 及规范化说明 |

`${AUDIT_WORKSPACE}` 表示本轮临时工作目录，不是可直接使用的本地路径。日志去除了颜色控制符、行尾空白及文件末尾多余空行，并将工作区绝对路径替换为该占位符；索引保留原始字节哈希。逐用例结果从原始 JSON 提取，避免重复保存巨大的 coverageMap；逐文件覆盖率另在 coverage-summary.json 中提供。

`frontend-structural-scan.json` 是前端专项的较小范围历史扫描；`all-frontend-structural-scan.json` 是最终全范围结构扫描。历史 CPU 测量原样保留用于可追溯性，最终实际 token 长度为 2,058/138 字符，其中包括 10 字符的 `SYNTHETIC-` 前缀。不能混合不同候选的测量结果。

工具只使用合成凭据、合成账户及公开发布资产。完整后端缺失，Go 编译、race、Go benchmark 和网关压测均没有执行；后端探针中的预期失败不能表述为本轮实测失败。
