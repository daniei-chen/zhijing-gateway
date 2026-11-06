# v0.0.4 配套后端源码差异

智境 v0.0.4 前端需要匹配的浏览器会话、OAuth 交接和诊断能力。此目录复用最终 v0.0.3 候选已验证的 **85 文件通用补丁**；本轮没有新增后端实现，也没有替换生产服务。

| 来源 | 固定值 |
| --- | --- |
| 适用的自定义基线 | `4851ca95b134322c14ca9904bc82c550a3880a67` |
| 验证过的后端源码 | `dcaf707cad583955873ed94097d63c9a4be12e82` |
| 补丁 SHA-256 | `6c9f6ffa14ba4ecef094a36cfe26596955ea8711b35070ee5110b315114cf093` |
| 本版本补丁文件 | `v0.0.4-session-timing.patch` |

补丁字节与最终 v0.0.3 候选完全相同，仅使用独立版本目录与清单。不要重复应用两份相同差异，也不能直接应用于原版 Sub2API。清单同时锁定每个文件的前后摘要及先决输入。

```sh
python integrations/sub2api/check_patch.py --bundle v0.0.4 --artifact-only
python integrations/sub2api/check_patch.py --bundle v0.0.4 --root /isolated/matching-source --apply
python integrations/sub2api/check_patch.py --bundle v0.0.4 --root /isolated/matching-source --verify-applied
```

发布源码 ZIP 内的目录已平铺；使用 ZIP 附带校验器时省略 `--bundle`。工具只处理指定的隔离源码，不连接生产数据库或更改服务。

已有验证包括 64 个执行包、12,561 个顶层单元测试、Go vet、12 个唯一包的定向 race，以及冻结 181 文件内嵌资源的 Linux amd64 构建。详细结果见[完整单元回归](../../../docs/proofs/v0.0.3-followup/backend-full-unit-checkpoint-09-summary.json)、[独立应用与 race 证据](../../../docs/proofs/v0.0.3-followup/backend-artifact-dcaf707-summary.json)和[构建清单](../../../docs/proofs/v0.0.3-followup/backend-api-peer-build.json)。这些是相同源码已有的验证，未改写为本次新测量；公共 CI 的补丁检查不能替代完整后端编译。

先验收并升级匹配后端，再更新前端。新的 OAuth 回调拒绝 URL 中的原登录 token；Cookie 会话也需要匹配的服务端与认证存储策略。配置条件、兼容边界、在途推理与用量排空要求沿用[配套实现说明](../v0.0.3/README.zh-CN.md)及本目录清单。保留旧哈希静态文件和可验证回退，不能通过重启旧单例清空共享租约。

此包只包含授权公开的通用源码差异与许可证，不包含完整私有后端、二进制、部署配置、真实凭据或业务日志。GitHub 发布与生产部署分开记录；本轮不宣称生产 TTFT 长尾已消除。
