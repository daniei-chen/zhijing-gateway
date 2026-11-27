# 文档索引

这份目录里的东西分三类：**怎么用**、**为什么这么做**、**查过什么结论**。

最后一类最容易被忘，也最容易重复劳动 —— 所以它排在前面。

## 决策与审计（查过的结论，动手前先看这里）

| 文档 | 结论一句话 |
|---|---|
| [能力差距审计（2026-11）](feature-gap-audit-2026-11.md) | 和 one-api / new-api / LiteLLM 比，七个候选差距里六个已具备或不是问题；真差距只有「按团队的花费预算」和「按 token 限速」两条，且当前都不触发 |
| [决策记录：不做响应缓存（2026-11-26）](cache-decision-2026-11.md) | 7 天 37,903 次请求里 99.98% 是流式，缓存只能服务非流式，天花板 0.02%，不值得建 |
| [阶段一：默认配置止血（2026-11-27）](security/2026-11-27-phase1-hardening.md) | 五条默认值改动各自做了什么、升级后会发生什么、之后怎么继续收紧；未落地的标 pending |

## 集成与配置

| 文档 | 讲什么 |
|---|---|
| [支付系统配置指南](PAYMENT.md) | Payment system configuration（English） |
| [支付系统配置指南（中文）](PAYMENT_CN.md) | 同上，中文版 |
| [管理端支付集成 API](ADMIN_PAYMENT_INTEGRATION_API.md) | 给管理端用的支付接口约定 |
| [管理员 API 密钥](admin-api-keys.md) | 管理员密钥的权限、轮换与使用边界 |
| [平台管理 MCP（OAuth）](mcp.md) | 通过 MCP 做平台管理，OAuth 流程 |
| [插件开发教程](PLUGIN_DEVELOPMENT.md) | Sub2API 插件怎么写、怎么装 |

## 功能说明

| 文档 | 讲什么 |
|---|---|
| [组合分组](COMPOSITE_GROUPS.md) | Composite Groups：把多个分组当成一个用 |
| [异步图像任务](ASYNC_IMAGE_TASKS.md) | Asynchronous image tasks |
| [批量图像 MVP](BATCH_IMAGE_MVP.md) | Batch image 的最小可用设计 |
| [Seedance 原生 API](seedance-api.md) | Seedance 的接口形态与差异 |
| [OpenAI 请求的 JSON 批量编辑](moego-json-batching.md) | 对请求体做批量字段编辑 |
| [Native Codex Images](OPENAI_IMAGES_CODEX.md) | Codex 图像接口的状态码与代理超时 |
| [GPT-5.5 retirement](OPENAI_GPT55_RETIREMENT.md) | ChatGPT 账号下 GPT-5.5 下线的处理方式 |
| [Channel Monitor V2 默认值](channel-monitor-v2-safe-defaults.md) | 监控默认值与渐进回填的安全边界 |

## 内部约定

| 文档 | 讲什么 |
|---|---|
| [并发与资源安全规则](agent-resource-safety.md) | 自动化改动的并发与资源使用边界 |

---

新增文档时记得在 `.gitignore` 里放行：这个目录默认忽略大部分内容，
只有显式列进白名单的才会进仓库（`!docs/<文件名>`）。
