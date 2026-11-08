<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.svg">
  <img alt="智境 ZHIJING · 复杂有序，智能从容。" src="docs/images/hero-light.svg" width="100%">
</picture>

<p align="center">
  <b>智境网关 · 交互有序，发布有据</b><br>
  <sub>以液态玻璃、清晰排版和细腻交互，连接你的工具与创造。</sub>
</p>

<p align="center">
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-42b883?style=flat-square">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-638bdf?style=flat-square">
  <a href="https://github.com/daniei-chen/zhijing-gateway/releases/tag/v0.0.5"><img alt="Release v0.0.5" src="https://img.shields.io/badge/Release-v0.0.5-8b6ad5?style=flat-square"></a>
  <a href="https://github.com/daniei-chen/zhijing-gateway/actions/workflows/ci.yml"><img alt="Frontend verification" src="https://github.com/daniei-chen/zhijing-gateway/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="LGPL v3" src="https://img.shields.io/badge/License-LGPL--3.0-868093?style=flat-square"></a>
</p>

<p align="center">
  <a href="#界面一览">界面一览</a> · <a href="#本地运行">本地运行</a> · <a href="#设计与交互">设计与交互</a> · <a href="#验证与兼容">验证与兼容</a>
</p>

智境提供登录、成员工作台与管理员控制台的统一前端。业务能力沿用 [Sub2API](https://github.com/Wei-Shaw/sub2api)，权限、计费与功能开关继续由后端决定。公开前端源码、合成预览、验证工具及明确版本的通用后端差异补丁。

> **上线状态**：v0.0.5 后端已于 2026-11-08 完成生产上线（前端与 v0.0.4 完全一致，未重建）：新建 18784 peer，5% → 25% → 50% → 100% 灰度，每档 0 错误、0 5xx；旧 peer 保留为 `backup` 回滚窗口。详见[线上部署记录](docs/deployments/v0.0.5-2026-11-08.zh-CN.md)。本页截图继续使用合成数据，额度、价格、指标与有效期均为演示样例。

**版本下载**：[v0.0.5 · 后端随上游升级，交互保持原样](https://github.com/daniei-chen/zhijing-gateway/releases/tag/v0.0.5)，提供配套后端源码差异、构建清单和 SHA256（前端沿用 v0.0.4 构建，无需更新静态资源）；[更新说明](docs/releases/v0.0.5.zh-CN.md)。GitHub 发布与线上部署分开记录；当前线上后端为 v0.0.5（前端仍是 v0.0.4 构建）。

## v0.0.5 · 后端随上游升级，交互保持原样

本版是**后端升级版**：后端跟随上游 Sub2API `v0.2.20`（`6b4b37db`）并恢复智境的全部行为层，前端沿用 v0.0.4 构建（346 个静态文件，未重新构建、视觉与交互不变）。因此升级路径是「先换后端、前端不动」，回滚只需把入口权重切回旧 peer。

| 改进 | 实际行为 |
| --- | --- |
| 上游稳定性合入 | 96 个上游提交：WS 连接池与租约、SSE 限制、鉴权与会话、计费模式、迁移校验、观测口径等。 |
| 智境行为保留 | 256 MiB 请求体预算、120s 单次读/写停滞、30s 断连 drain、25 分钟转发上限、关键词与管理豁免、并发 3/9/9。 |
| 本地增补修复 | 配置键守护测试、迁移回滚开关（默认关）、预算记账、drain 优先级行为测试。 |
| 迁移一致 | 生产库 `schema_migrations` 300 条与源码 300 个文件一致；启动校验通过，**无新增迁移**。 |
| 灰度验证 | 5% → 25% → 50% → 100%，每档 0 错误、0 5xx；公网 `/healthz`、`/login`、`/api/v1/settings/public` 均 200。 |

后端验证（本地冻结输入）：`go build`／全 tag `go vet`／`-race`（0 数据竞争）／`govulncheck`（调用链 0 漏洞）／handler 2041 项与 service 整包通过／真实 PostgreSQL 18 + Redis 7 上 6 套件 177 子测试通过／旧 UI 263 个端点回放 0 回归。

## v0.0.4 · 交互有序，发布有据

<p align="center"><sub>SESSION / 操作有归属　·　WORKSPACE / 首次即就绪　·　RELEASE / 验证可复现</sub></p>

| 细节更稳 | 流程连贯 | 发布有据 |
| :--- | :--- | :--- |
| 首次打开加载模型、TLS 与错误规则；MiniMax 国际预设保持准确，定时测试防重复与迟到写回。 | OAuth 邮箱冲突正确进入绑定；支付成功后继续有限跟进至入账，余额完成后刷新一次。 | **542 个文件、6,739 项测试全通过**；原四项全局 80% 覆盖率门槛全部通过，干净提交独立打包与摘要校验。 |

| 行覆盖率 | 语句覆盖率 | 函数覆盖率 | 分支覆盖率 |
| :---: | :---: | :---: | :---: |
| **89.40%** | **86.66%** | **84.50%** | **80.24%** |

合并此前未正式发布的 v0.0.3 会话与资源生命周期修复：匹配后端支持 HttpOnly Cookie、OAuth 一次性交接、图片资源清理、按需加载、设置草稿保留与更细的首响应诊断。原 TTFT、模型、权限、计费与额度口径保持。

先验收并升级[匹配后端](integrations/sub2api/v0.0.5/README.zh-CN.md)，再更新前端（v0.0.5 前端无变化）；已完成[匹配版本的生产升级](docs/deployments/v0.0.5-2026-11-08.zh-CN.md)。覆盖率和回归通过不代表每条路径都已验证，也没有生产 TTFT 长尾消除的测量结论。详见[机器可读验证摘要](docs/validation-v0.0.4.json)、[逐项运行修复](docs/proofs/v0.0.4/frontend-runtime-fixes.json)和[完整回归证据](docs/proofs/v0.0.4/frontend-validation-final.json)。历史 [v0.0.3 候选](docs/releases/v0.0.3.zh-CN.md)保留当时门禁与范围。

## v0.0.2 · 已发布的工作台基础

| 连接的边界 | 这一版的行为 |
| :--- | :--- |
| 每次操作有归属 | 请求、刷新、重试与状态写回绑定会话；换号后清除旧页面缓存。 |
| 嵌入不传登录凭证 | iframe 与新窗口不再携带原登录 token，回调查询参数也不进入来源追踪。 |
| 等待可以解释 | 上传、规范化、并发等待与首事件分别计时，缺失保持“未采集”。 |
| 发布可以复验 | 全量回归、保留原始兼容基线、根级 CI、来源与产物摘要。 |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/v0.0.2-request-timing-dark.jpg">
  <img alt="智境 v0.0.2 请求时序面板，合成数据" src="docs/images/v0.0.2-request-timing-light.jpg" width="100%">
</picture>

阶段耗时与累计里程碑使用各自口径，原有 `first_token_ms` 保留；真实零等待与未采集清楚区分。前端兼容旧后端，完整阶段数据需要匹配的[可选诊断补丁](integrations/sub2api/README.zh-CN.md)。

依赖旧嵌入 `token` 参数的服务需要迁移。本版本先停止传原登录凭证；短时、单次兑换票据仍需后端与接收方联调，详见[安全修复与核实记录](docs/reviews/2026-11-05-security-followup.zh-CN.md)。

## 界面一览

### 一眼掌握，运行有序

运维概览、实时指标和系统状态采用统一的层次与材质。数据区域保持清晰，玻璃效果集中在导航、控件和浮层。

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/admin-ops-dark.png">
  <img alt="智境管理员运维面板，合成数据演示" src="docs/images/admin-ops-light.png" width="100%">
</picture>

<table>
  <tr>
    <td width="50%"><b>成员与业务</b><br><sub>筛选、固定列、选择与行操作，保持熟悉的操作方式。</sub></td>
    <td width="50%"><b>轻盈而清晰的弹窗</b><br><sub>统一表单、按钮与焦点反馈，复杂配置也有秩序。</sub></td>
  </tr>
  <tr>
    <td><img alt="成员管理表格，合成数据" src="docs/images/admin-members.png"></td>
    <td><img alt="创建成员玻璃弹窗，合成数据" src="docs/images/admin-dialog.png"></td>
  </tr>
</table>

## 设计与交互

| 体验 | 具体实现 |
| :--- | :--- |
| **液态玻璃** | 紫、蓝、青光场，细高光边缘与柔和内阴影；浅色和深色保持一致。 |
| **有层次的数据** | 表格保留清晰底色、固定列与虚拟滚动，选中和悬停状态同步呈现。 |
| **细腻的反馈** | 按钮按压、导航滑块、切页与弹窗过渡；支持暂停及系统减少动态效果。 |
| **键盘与窄屏** | 顶层弹窗焦点循环、Escape 关闭和焦点恢复；手机表格切换卡片，输入字号 16px。 |
| **统一管理入口** | 24 个管理页面覆盖运维、成员、订阅、账号、渠道、用量、订单、风控与设置。 |

<details>
  <summary><b>查看 320px 窄屏弹窗</b></summary>
  <p align="center"><img alt="320px 窄屏表单，合成数据" src="docs/images/admin-mobile.png" width="320"></p>
</details>

## 本地运行

使用 Node.js 24、pnpm 9.15.9 与 Python 3。首次安装请在独立克隆目录执行。

```bash
git clone https://github.com/daniei-chen/zhijing-gateway.git
cd zhijing-gateway/frontend
pnpm install --frozen-lockfile
pnpm build
cd ..
python qa/preview_server.py --port 18872
```

打开 [本地预览入口](http://127.0.0.1:18872/__preview)，选择登录页、成员工作台或管理员控制台。

| 入口 | 地址 |
| :--- | :--- |
| 管理员演示 | `http://127.0.0.1:18872/__preview/admin` |
| 成员演示 | `http://127.0.0.1:18872/__preview/member` |
| 登录页面 | `http://127.0.0.1:18872/login` |

演示服务只监听本机，使用合成身份与接口；页面会显示隔离预览横幅。业务写入被阻止，演示不会连接真实网关、模型、邮件或支付服务。演示账户为 `admin@preview.local` / `member@preview.local`，演示密码为 `Preview2026!`。

## 验证与兼容

当前 v0.0.5 的后端结果见[机器可读验证摘要](docs/validation-v0.0.5.json)；v0.0.4 的前端结果见[机器可读验证摘要](docs/validation-v0.0.4.json)。[严格审计报告](docs/reviews/2026-11-05-strict-audit.zh-CN.md)记录继承的安全、依赖与性能修复；其历史计数不改写为本轮结果。下面的 v0.0.2 数据保留原发布口径。

v0.0.2 前端全量回归 **392 个文件、3,139 项测试通过**；原四条失败的安全验收全部转为通过。真实客户端、认证 API 与状态仓库的合成往返覆盖不同 HTTP 方法、晚到结果、同账号重新登录、刷新与会话切换。本地浏览器验证双标签管理员到成员切换、浅/深色时序面板、320/390px 和关闭后焦点恢复。

V6 原有 24 个管理入口的视觉验收作为基础保留；本轮没有把其余移动排序、启动恢复或 OTP 易用性待办宣称全部修复。详细范围见[验证摘要](docs/validation-v0.0.2.json)。

```bash
cd frontend
pnpm typecheck
pnpm lint:check
pnpm test:coverage --maxWorkers=4
pnpm build
cd ..
python tools/verify_frontend.py
node tools/verify_ops_contract.mjs
python integrations/sub2api/check_patch.py --artifact-only
python integrations/sub2api/check_patch.py --bundle v0.0.5 --artifact-only
```

- 原 227 文件兼容基线保留；v0.0.2、严格审计与 v0.0.3 的变更分别通过明确摘要链登记，未静默重建基线。Ops 契约明确包含已批准的运行时变化。
- 68 条路由声明与两份运行时法律文本保持；原 API 路径、服务端权限、额度与计费继续生效。
- 构建资源使用 `/app-assets/`，与官网 `/assets/` 分离。
- `frontend/dist/` 仅为静态前端，演示注入与合成身份不进入构建。

这些检查说明前端与隔离演示的验证范围；真实支付、发信、供应商推理和生产切换需按实际环境分别验收。

## 工程结构

```text
frontend/              Vue、TypeScript、样式与组件测试
  src/styles/          智境设计语言与各版本表现层
  public/app-assets/   本地托管字体与品牌资源
qa/                    本机合成数据预览
integrations/sub2api/  历史诊断补丁、v0.0.5 上游 v0.2.20 配套补丁与摘要核验
tools/                 契约、构建、发布包及下载校验
docs/                  设计、验证、界面图片和字体许可
```

接入既有网关时保持原 API 路由，先验证匹配后端与静态资源，再选择发布窗口并保留旧哈希资源。更新安全版本时应完整刷新旧标签；v0.0.4 延续的认证变更要求后端先升级。完整后端不包含在本工程中，补丁只适用于明确匹配的自定义源码，不应直接套用原版 Sub2API。

## 来源与许可

业务前端基于 [Wei-Shaw/sub2api](https://github.com/Wei-Shaw/sub2api) 的 `d851a38477597157e78450d30af2d8504764d085` 及既有智境登录外壳演进。原 [LICENSE](LICENSE)、[CLA](CLA.md) 与上游法律文本保留，遵循 LGPL v3。

Manrope、Noto Sans SC 与 IBM Plex Mono 的 OFL 文本见 [字体许可](docs/font-licenses)。封面为项目自有 SVG 表现层；界面中的品牌标识与字体来源见 [资源说明](docs/ASSETS.zh-CN.md)。

<p align="center"><sub>ZHIJING / 让复杂留给系统，让智能回归创造。</sub></p>
