# 生产环境运维脚本（存档）

这里放**跑在 154.36.187.147 上、但不属于应用代码**的运维脚本。

放进来是因为它们决定线上流量怎么走 —— 之前只存在服务器 `/root/` 下，
改了什么、为什么改，没有任何记录，出问题时无法审计。

改动这些脚本前请先备份服务器上的原文件，改完用 `bash -n` 检查语法，
并在下面记录改动原因。

## zhijing-canary-switch.sh

按权重把推理流量在「canary」和「stable」两个实例之间分配：

```sh
sudo ./zhijing-canary-switch.sh canary 25   # canary 25% / stable 75%
sudo ./zhijing-canary-switch.sh canary 50   # canary 50% / stable 50%
sudo ./zhijing-canary-switch.sh promote     # canary 100%，stable 转 backup
sudo ./zhijing-canary-switch.sh rollback    # stable 100%，canary 转 backup
```

端口约定：`NEW_PORT=18819`（canary）、`OLD_PORT=18818`（stable）。
脚本会先备份当前配置到 `/root/zhijing-nginx-canary-<ts>.bak`，失败时自动恢复。

### 2026-11-24：保留兄弟实例

原来的 peers 段只写死 `18819`/`18818` 加 `18817`–`18813`，于是每次切权重都会把
**其他流水线部署在 18820/18821 上的实例整行删掉**。被删掉的版本连「回滚候选」
都不是了，只能重建容器再进配置。

现在生成 peers 段时会额外探测 `SIBLING_PORTS`（默认 `18821 18820`）是否在监听，
在监听就追加 `backup` 行。`backup` 不参与权重分配，只在前两者都不可用时兜底，
所以不改变灰度比例。

同时去掉了注释里写死的版本号（`# canary 0.1.25`、`# stable 0.1.24`）——
端口上跑的版本会被换掉，注释不跟着改就是在配置里留假信息。现在只标角色，
真实版本用 `docker ps` 或 `/readyz` 确认。

## 从一个能 ssh 的机器发布

`release-to-host.sh` 把「打包 → 上传 → 构建 → 发布 → 初验」串成一条命令：

```bash
HOST=root@154.36.187.147 ./release-to-host.sh 0.1.28 132342b
```

它会先用 `git archive` 按 commit 打包（不是 tar 工作区，避免把没提交的改动带上线），
再在主机上构建镜像、调用 `zero-downtime-deploy.sh`，最后读一次 `/readyz` 和新容器状态。

`STOP_TIMEOUT_SECONDS` 默认 35，**必须大于应用的 `SHUTDOWN_TIMEOUT_SECONDS`**，
否则还在排空的实例会先被 SIGKILL（v0.1.28 起才有这两个变量）。

脚本只做机械步骤，**长流排空那一步要人工看**：起一条流，在第 5 秒
`docker stop` 旧实例，流必须继续到 `[DONE]`。这是「发布不打断在途调用」的唯一硬证据。
