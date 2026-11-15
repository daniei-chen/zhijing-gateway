# 审计与升级交付摘要（2026-11-15，46 轮）

五分钟版。细节在 `AI_HANDOFF_PROTOCOL.md`（编号索引）和另外三份清单里。

---

## 一、实际改了什么（有版本号，可回滚）

| 版本 | 改了什么 | 为什么重要 |
|---|---|---|
| **v0.1.13** | 巡检告警不再静默失败，逐收件人记录脱敏地址和错误 | 之前告警发不出去时**毫无痕迹**，400 多条事件 `email_sent` 全是 false |
| **v0.1.14** | 删除分组时若有 Key 绑定则拒绝 | 之前会静默把 Key 的 `group_id` 置空 → 制造孤儿 Key → 全部 503（11-14 19:10 那次就是这个） |
| **v0.1.15** | 不再自动创建测试账号 | 启动路径里的副作用 |
| **v0.1.16** | 缺失的静态资源返回 404 | 之前返回 `200 text/html`（3040 字节的 index.html），客户端拿到 200 却解析不了 |
| **v0.1.17** | 同上，修 `legacy ServeEmbeddedFrontend` 路径 | |
| **v0.1.18** | Prometheus `/metrics`（默认关闭） | 之前完全没有指标出口 |
| **v0.1.19** | 修 v0.1.18 的 lint 问题 | CI 第一次全绿 |
| **v0.1.20** | 删 3 个空壳方法 + 假统计接口；`api_keys.group_id` 外键改 RESTRICT；修 `AccountExpiryService` 的 Stop/Start 静默失效 | 见下 |

**全部不停机部署，当前 v0.1.20 在 18815 端口，`restart=0`，9 个历史版本容器保留可回滚
（18814 是 nginx 的 backup peer，切回即秒级回滚）。**

### v0.1.20 做了什么（2026-11-15 11:37 上线）

| 改动 | 依据 | 验证方式 |
|---|---|---|
| 删 `TestCredentials`、`ProxyService.TestConnection`、`RefreshAccountCredentials` | 三个都是「有名字、有签名、永远成功、零调用」的死代码 | 编译通过；`golangci-lint` 0 issues；确认真实能力在 `TestAccountConnection` / `ProbeProxy` |
| 删 `GET /admin/groups/:id/stats` | 返回四项硬编码 0，前端 `getStats` 无组件调用 | 线上实测：该路径 **404**，相邻的 `/api-keys` 与 `/groups/:id` 仍是 401（路由在、认证拦） |
| `migrations/253`：`api_keys.group_id` `SET NULL` → `RESTRICT` | 11-14 那次 141 条 5xx 的第二环，v0.1.14 只堵了应用层 | `schema_migrations` 有该行；`pg_get_constraintdef` 实测为 `ON DELETE RESTRICT` |
| `AccountExpiryService` Stop 后 Start 静默失效 | `stopCh` 一次性，旧 `Start` 无防护 | 新增 6 个测试；两个用 `git stash` 验证过旧实现下必失败（calls=3 / calls=2） |

180 秒观察窗口：**0 个新 5xx**，期间 35+ 个真实请求正常处理（$2.79 用量）。

## 二、发现了什么

### 已经修掉的（上面 7 个版本）

### 还没修的，按风险排序

| 等级 | 问题 | 状态 |
|---|---|---|
| **P1** | **告警通道断着**：334 条事件 0 投递，SMTP 只差一个密码 | 需要凭据 |
| **P2** | **线上前端是 11-01 / 11-06 两套陈旧产物**，镜像里的新构建没人用 | 脚本就绪，dry-run 通过 |
| **P2** | 预聚合表算得对但没人读（24 处引用 0 处 SELECT） | 改了会影响数据口径 |
| **P3** | `billing_failures` 只写不读，且缺 10 类字段，无法重放 | 要迁移 + 动账务 |
| **P3** | CI 缺 `-race` job | patch 就绪，token 缺 scope |
| **P3** | 死列三个（`attempted_key_prefix`、`replay_attempts`、`last_replay_at`） | 删要迁移 |
| **P3** | 2.3 GB 历史快照 | 4 个脚本有引用 |

> **v0.1.20 从这张表里移走了三条**：`api_keys.group_id` 外键（已改 RESTRICT）、
> 空壳方法（已删）、假统计接口（已删）。
> 另有「价格表运行时更新一直失败」**撤销**——第 55 轮判断错误，它其实每 10 分钟
> 成功一次（容器 stdout 37 次 `Hash check passed`），失败只集中在 11-01/02 那 25 小时。

### 查过、确认没问题的（不用管）

- **槽位无泄漏**：代码逐分支核对 + Redis 里连 slot key 都不存在
- **账务平**：6 个用户「初始 + 兑换 − 消费 = 余额」精确到分
- **计费 1:1**：`usage_logs` 36,410 行 = `usage_billing_dedup` 36,410 行
- **价格表生效**：反算单价与 `model_pricing.json` 三项完全一致
- **token 统计精确**：整千值只占万分之二
- **认证链 7 步、fail-closed**：Redis 挂了返回 503 而不是放行
- **备份可恢复**：实测恢复到临时 PG，106 张表行数逐项一致
- **延迟**：应用 < 2ms，用户侧 28–41ms（瓶颈在网络）

## 三、需要你做的三个决定

**① 告警通道**（P1，最高优先）

```bash
echo '你的 webhook 地址' > /opt/zhijing-sub2api/maintenance/webhook_url
```
或后台填 QQ 邮箱 SMTP 授权码。**这一条不通，出事永远没人知道**，包括账务异常。

**② 前端切换**（P2）

```bash
bash /root/switch-frontend-to-proxy.sh apply    # 回滚：--rollback
```
dry-run 已验证配置合法、线上未变。切换后你能看到 v0.1.10 起就做好的功能。

**③ CI race patch**（P3）

```bash
git am deploy/zhijing/patches/0001-ci-race-job.patch
```

## 四、我说错了两次，都记着

1. **第 36 轮**说「5 个模型调不通、客户端撞了 50 次墙」→ **撤回**。那些 404 全发生在账号入组之前，入组后一条都没有。
2. **第 30 轮**说「管理员余额差 0.000524 是浮点误差」→ **纠正**。是我把被 `set` 覆盖掉的兑换码算进了收入，账其实是平的。

两次都写进文档了，没有悄悄改。

## 五、35 轮没有再发版，原因

第 10 轮之后没有代码改动。剩下的候选要么需要你决定、要么需要凭据、要么会改变数据口径或用户可见行为。

**为了发版而发版不是升级。** 这 35 轮的产出是审计结论、三份清单、两个脚本（上游检测已上线、前端切换待执行）。

## 六、证据分级

`AUDIT-EVIDENCE-20261115.md` 把每项结论标成：实测 / 代码+数据 / 仅代码 / 仅数据 / 推断 / 未验证。

**当前：推断 0 条，未验证项都注明了原因**（需要凭据、需要真实流量、不该在生产上试）。

---

## 一句话

**能修的都修了并验证了，能查的都查了并分级了，剩下的三件事卡在一个决定或一个密码上。**
