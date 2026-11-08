# v0.0.5 配套后端源码差异

智境 v0.0.5 的后端跟随上游 Sub2API `v0.2.20`，并在其上恢复智境的行为层。目录内是本版相对上游的**通用源码差异**；前端没有变化，继续使用 v0.0.4 的静态资源。

| 来源 | 固定值 |
| --- | --- |
| 上游基线 | `6b4b37db43443b5e88e424fe3c69602cc3810dfb`（v0.2.20） |
| 验证过的后端源码 | `f8a506c` |
| 补丁 SHA-256 | `a85f3b431c3929f8458091b737af01ff2632cc78664f3724112ab0a0cb56b036` |
| 补丁文件 | `v0.0.5-upstream-0.2.20.patch` |
| 变更文件 | 176 个（仅 `backend/`，不含内嵌前端 dist） |

## 应用方式

```sh
python integrations/sub2api/check_patch.py --bundle v0.0.5 --artifact-only
python integrations/sub2api/check_patch.py --bundle v0.0.5 --root /isolated/matching-source --apply
python integrations/sub2api/check_patch.py --bundle v0.0.5 --root /isolated/matching-source --verify-applied
```

补丁已在纯净上游 `6b4b37db` 树上验证 `git apply --check` 通过；`backend/internal/web/dist`（346 个前端文件）不在补丁内，需要在构建前放入 v0.0.4 的构建产物。

## 验证摘要

- 构建：`go build ./...`、`-tags embed` 发布构建通过
- 全 tag 编译：无 tag（含 `!unit`）、`integration`、`e2e`、`mcp_go_client_oauth` 全部通过
- 单元：handler 2041 项 RUN、0 失败；repository／server／pkg 通过；service 整包 `ok 196.7s`
- 并发：`-race` 跑预算／迁移／drain 相关包，0 个 DATA RACE
- 依赖：`govulncheck` 调用链 0 漏洞
- 集成：真实 PostgreSQL 18 + Redis 7 上 6 套件 177 子测试通过
- 运行时：旧 UI × 新后端本地全栈实测，263 个旧 UI 端点回放 0 回归

此包只包含授权公开的通用源码差异与许可证，不包含完整私有后端、二进制、部署配置、真实凭据或业务日志。GitHub 发布与生产部署分开记录。
