# Sub2API 诊断集成 · v0.0.2

这是可选的后端**源码差异补丁**，与本版本静态前端分别交付。前端安全修复不需要安装此补丁；旧后端没有阶段时序时，界面保留“未采集”和原有首事件指标。

补丁基于上游 `d851a38477597157e78450d30af2d8504764d085` 及既有智境自定义计时、并发接口。它**不能直接用于原版 Sub2API**。本仓库不含私有后端历史、部署配置、账号信息或日志；本地定制源码也没有被证明就是当前生产二进制的可复现基线。

## 包含内容

- 以可信本地标记区分个人、网关、账号和排队拒绝；保留既有上游尝试证据。普通上游响应不能通过相似错误文案伪装成本地来源。
- 本地 429 在尚未开始响应时附带 `Retry-After: 2`，仅表示建议的最短退避，不保证两秒后可用。
- 进程内有界时序缓存，最多 4096 条、24 小时；按已认证用户、API Key、请求编号哈希及时间窗口匹配。仅保留数字白名单和固定读取终态，不保留请求正文、提示词、密钥或连接对象。
- 在既有管理员请求明细中增加可选 `gateway_timing`、`error_owner`、`error_source` 字段。不新增数据库表或迁移，不调整额度、调度、重试、并发数或计费。

重启、跨进程查询、容量淘汰、到期或重复编号会造成时序缺失。该缓存用于诊断，不是持久化审计或账本，也不参与健康评分。旧错误记录不会被批量改写；界面中的历史模板识别提示不改变原始统计。

## 在隔离源码中核对

```bash
python integrations/sub2api/check_patch.py --artifact-only
python integrations/sub2api/check_patch.py --root /path/to/isolated/source
# 只有源码校验与 git apply --check 都通过时，才在该本地工作树中应用：
python integrations/sub2api/check_patch.py --root /path/to/isolated/source --apply
python integrations/sub2api/check_patch.py --root /path/to/isolated/source --verify-applied
```

工具默认只检查。它不连接服务器，不管理服务，不清理 Redis，也不部署。文件哈希不匹配时应停下核对源码，不要忽略检查或强行套用。`INTEGRATION-MANIFEST.json` 记录匹配条件与改动前后摘要；保留原有法律文本，遵循项目 LGPL v3 许可。

## 本地验证范围

匹配的完整隔离后端完成 5 个包、196 个测试及子测试的定向回归，另完成账号准入相关回归、Go vet 与 Linux amd64 交叉构建。HTTP 往返测试使用真实记录中间件、服务与管理员 handler，认证、存储和上游为合成依赖。

公开 CI 只核验补丁完整性，**不代表公开仓库已经编译完整后端**。没有访问真实供应商、付费推理或生产数据库，也没有进行生产运行验收。原有首次转发事件 `first_token_ms` 的含义保持，不能据它单独推断上传等待或用户可见文字的出现时间。
