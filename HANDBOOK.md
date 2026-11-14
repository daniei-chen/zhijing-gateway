# 智境网关 · 手册总入口

这是六份文档的导航页。**先读这一页**，再按需要跳转。

最后一轮更新：2026-11-15（审计第 51 轮）

---

## 一、系统是什么

OpenAI / Anthropic / Gemini 兼容的 API 网关。生产在 `154.36.187.147`，
边缘 `175.27.132.225`，域名 `zhijing.kaogong.art`。

```
用户 → 边缘 nginx → 源站 nginx → Go 网关 (dockerd, 端口 18814)
                                    ├── PostgreSQL 18（zhijing_trial 库，106 张表）
                                    └── Redis（并发槽位、缓存、会话）
```

当前版本 **v0.1.19**，容器 `zhijing-api-v0119-final`，8 个历史版本保留可回滚
（18806 → 18814）。

---

## 二、六份文档各管什么

| 文档 | 管什么 | 什么时候读 |
|---|---|---|
| **`HANDBOOK.md`**（本页） | 导航、系统概览、关键事实 | 第一次接触 |
| **`AI_HANDOFF_PROTOCOL.md`** | 规则 + 50 条审计记录（带编号索引） | 要知道「某件事查过没有」 |
| **`AUDIT-EVIDENCE-20261115.md`** | 每条结论的证据强度和分级 | 要判断「这个说法有多硬」 |
| **`TECH-DEBT-20261115.md`** | 发现但没做的事，按风险排 | 要决定「现在做什么」 |
| **`SILENT-FAILURES-20261115.md`** | 「看起来在工作，实际断了」的七条 | 排查「为什么没反应」 |
| **`SYSTEMIC-RISK-20261115.md`** | 五条单独合理、合起来有系统性风险 | 理解「为什么需要告警出口」 |
| **`AUDIT-DELIVERY-20261115.md`** | 五分钟版交付摘要 | 只想快速了解全貌 |

---

## 三、按场景导航

**「我要改配置」**
→ `AI_HANDOFF_PROTOCOL.md` §6.30（生产配置 vs 代码默认值的完整对照）
→ 注意 `maintenance/webhook_url`、`runtime.env`、`settings` 表三处不同位置

**「我要发版」**
→ `AI_HANDOFF_PROTOCOL.md` §5.3 / §5.4（CI 门禁、无停机发布流程）
→ `§6.18`（发版前必须跑本地 golangci-lint，这条踩过两次）

**「出事了，怎么查」**
→ `SILENT-FAILURES-20261115.md`（先确认不是「静默失效」这类）
→ `AI_HANDOFF_PROTOCOL.md` §6.31（两套 request_id 无法跨表关联，只能按 user + 时间窗）

**「这个功能真的在工作吗」**
→ `SILENT-FAILURES-20261115.md` 的七条，以及 §SYSTEMIC-RISK 的五个信号存储点

**「我要接手这个项目」**
→ 本页 → `AUDIT-DELIVERY-20261115.md` → `AI_HANDOFF_PROTOCOL.md` §5（标准接手流程）

**「为什么某个判断可信 / 不可信」**
→ `AUDIT-EVIDENCE-20261115.md`，看分级（实测 / 双证 / 仅代码 / 推断 / 未验证）

---

## 四、十件必须先知道的事

1. **告警通道是断的**。334 条事件 0 投递，SMTP 只差一个密码。出事没人会知道。
2. **线上前端是 11-01 的旧构建**，镜像里的新 dist 没人用。切换脚本已备好且 dry-run 通过。
3. **删分组会静默制造孤儿 Key** —— v0.1.14 已加保护，但数据库层仍是 `ON DELETE SET NULL`。
4. **软删除的分组仍可被调度**。唯一挡住它的是 `DeleteGroup` 那处检查。
5. **计费是原子且幂等的**（单事务 + `request_id` 唯一索引），36,410 行一一对应。
6. **`usage_logs` 的 user / key / account 外键是 RESTRICT**，账务历史删不掉。
7. **两套 request_id 不通**：`usage_logs` 存 `client:<uuid>`，`ops_error_logs` 存裸 uuid。
8. **`/v1/models` 列出 12 个模型，其中 5 个从未被成功调用过**（但也从未在被正确配置的情况下试过）。
9. **1,785 次 429 全部来自本地并发限制**，不是上游限流。旧的固定并发 3 是瓶颈，新的动态规则（≤1 用户 → 5）还没被真实流量验证。
10. **任何「管理动作」都不验证结果**。删了分组不会检查是否真的停用。

---

## 五、交接检查清单

接手时按顺序过一遍：

- [ ] `docker inspect` 确认生产容器 healthy、restart=0
- [ ] `curl /readyz?deep=1` 确认 business / database / redis 三项 ok
- [ ] `python3 japan_maintenance.py watch` 看 11 项巡检
- [ ] 确认 `maintenance/webhook_url` 是否存在（现在不存在 → 告警出不去）
- [ ] 确认 `maintenance/upstream_head.json` 是否有 sha（上游检测是否在跑）
- [ ] 查阅 `TECH-DEBT-20261115.md` 里 A/B 两类（等你决策 / 等凭据）
- [ ] 发版前跑 `golangci-lint run --timeout=30m`

---

## 六、三条最容易踩的坑

**① 改了代码但没改线上前端**
`backend/internal/web/dist` 是镜像内嵌的，nginx 服务的却是 `/var/www/` 下的静态副本。
部署脚本不碰这两个目录。用户看到的可能还是两周前的界面。

**② 用聚合数字推断当前状态**
11-14 那 141 条 503 和 50 次 404 都是**配置变更前**的历史数据。跨时间的聚合必须配时间线读。
（这个错误我犯过两次，见 §6.43 和 §6.44。）

**③ 用元数据表推断约束**
`pg_constraint` 看不到 `CREATE UNIQUE INDEX`。软删除系统用部分唯一索引，
只看约束表会误判「缺唯一约束」。（§6.52）

---

## 七、紧急联系路径

现在**没有**自动告警。出问题只能靠：

1. 后台 `/api/v1/admin/*` 看 `ops_system_logs`
2. `ops_error_logs` 按 `status_code >= 500` 查
3. `billing_failures` 看 `status='pending'`
4. 服务器上 `python3 japan_maintenance.py watch` 手动跑一次巡检

**这四条都需要人主动执行。** 配了 webhook 之后，第 4 条的结果会自动推送。
