# 智境网关生产运维脚本

本目录存放**生产机实际运行的**发布与运维脚本。脚本入仓的目的是让这些逻辑可审计、可 diff、可回滚，而不是散落在生产机磁盘上（此前 `japan_maintenance.py` 只存在于 `/opt/zhijing-sub2api/`，版本无法追溯）。

## japan_maintenance.py

日本生产机的健康看护与备份脚本，由两个 systemd 单元驱动：

| 单元 | 周期 | 调用 |
| --- | --- | --- |
| `zhijing-japan-health.timer` | 60s | `python3 japan_maintenance.py watch` |
| `zhijing-japan-backup.timer` | 每日 | `python3 japan_maintenance.py backup` |

### 部署位置

生产机路径为 `/opt/zhijing-sub2api/japan_maintenance.py`，权限 `0755 root:root`。更新方式：

```sh
# 先备份，再覆盖，再语法校验，最后跑一次只读 watch 验证
cp -a /opt/zhijing-sub2api/japan_maintenance.py \
      /opt/zhijing-sub2api/japan_maintenance.py.bak-$(date -u +%Y%m%dT%H%M%SZ)
install -m 0755 deploy/zhijing/japan_maintenance.py /opt/zhijing-sub2api/japan_maintenance.py
python3 -m py_compile /opt/zhijing-sub2api/japan_maintenance.py
/usr/bin/python3 /opt/zhijing-sub2api/japan_maintenance.py watch
```

脚本改动**不需要重启容器、不需要 reload Nginx**：下一次 timer 触发即生效。

### watch 的输出契约

一次 `watch` 输出一行 JSON，关键字段：

- `local_health`：`http://<当前主实例端口>/health` 是否 200（端口从 Nginx `upstream` 的 peers 块解析）
- `ops.certs[]`：Nginx 实际在用的每一张证书的剩余天数
- `ops.cert_days_left` / `cert_ok`：取所有证书中最早到期的一张
- `ops.backup_ok` / `backup_age_hours`：最近一次备份的年龄（>12h 视为异常）
- `ops.disk_ok` / `disk_free_gb`：根分区使用率是否低于 85%
- `ops.db_ok`：宿主机直连 PostgreSQL 执行 `select 1`
- `ops.billing_ok` / `billing_failures_pending`：待重放计费失败数（>0 需人工介入）
- `ops.pitr_ok` / `pitr_age_hours`：48h 基础备份与保留策略清理是否按时完成

### 自动重启默认关闭

`watch` 在老版本里会对本机健康失败执行 `docker restart`。重启窗口内请求必然失败，与"不停机"要求冲突，因此**默认关闭**：只有显式设置环境变量 `ZHIJING_AUTO_RESTART=1` 才恢复旧行为。默认行为是记录状态并置 `restart_skipped=auto_restart_disabled`，由人工或发布流程处置。

### 已知边界

- `check_ops_baselines()` 里的证书检查会逐个读取 Nginx 配置中出现的证书路径；如果某张证书文件不存在会被跳过，不会报错。
- 备份是「库完整性优先」：`pg_dump -Fc` + `pg_restore --list` 校验 + Redis `SAVE`，但 Redis 快照与数据库不同步（`redis_snapshot_simultaneous_with_database=false`），恢复时以数据库为计费权威。
- 备份仍落在同一块磁盘（`/var/backups/zhijing-sub2api`），异机/对象存储副本尚未落地。

## nginx/

`nginx/zhijing.kaogong.art.edge.conf` 是国内入口机（`175.27.132.225`）终止 TLS 并回源日本生产机的站点配置模板。源站侧的完整站点配置包含大量主机特定路径与历史回滚注释，不入仓；发布脚本与 `zero-downtime-deploy.sh` 通过 `# ---- zhijing-peers-begin/end ----` 标记块管理 upstream 主备。

## zero-downtime-deploy.sh

零停机发布脚本，见 `../ZHIJING_ZERO_DOWNTIME.md`。要点：候选实例先在独立 loopback 端口通过 `/readyz`，再改 upstream、`nginx -t`、`reload`，失败自动恢复快照。
