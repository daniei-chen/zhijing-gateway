# 智境网关零停机发布约定

生产发布必须先拉取新镜像，在独立 loopback 端口启动候选实例，等待 `/readyz` 同时确认数据库和 Redis，再修改 Nginx upstream 并执行 `nginx -t && systemctl reload nginx`。旧实例必须保留为 backup，直到观察窗口结束。

脚本会：

1. 从当前容器复制非敏感的运行参数到临时、权限为 0600 的 env 文件；不会把内容打印到日志。
2. 使用当前实例的数据挂载和 Docker 网络启动新容器，并施加 non-root、只读根文件系统、capability drop、no-new-privileges、PID/内存限制。
3. 轮询候选实例 `/readyz`，并检查容器状态、重启次数、OOM、panic/fatal 日志；
   任一异常即删除候选实例，不触碰生产 upstream。
4. 检查深度就绪与内嵌登录页，确认账号池和前端产物都已可用。
5. 保存 Nginx 配置快照，切换 upstream，执行配置测试和 reload。
6. 对本机和公网路由执行 smoke check；失败时恢复 Nginx 快照并 reload。
7. 观察窗口每 15 秒统计 HTTP 5xx、非上游 5xx、流内上游 5xx，并持续检查候选容器状态。
   查询失败或任意指标超过限制都会立即回切；候选容器保留供排查。

示例：

```sh
IMAGE=ghcr.io/daniei-chen/zhijing-gateway:0.1.4 \
CURRENT_CONTAINER=zhijing-api-v0101-final-r1 \
NEW_CONTAINER=zhijing-api-v014-final \
NEW_PORT=18801 \
deploy/zhijing/zero-downtime-deploy.sh
```

脚本不会自动删除旧实例或镜像，便于在观察窗口内回滚。稳定后再按审计记录清理退出实例，并保留当前版本和至少一个可启动回滚版本。
