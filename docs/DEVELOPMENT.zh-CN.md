# 本地开发与验证

这是 Sub2API 的智境前端工作区。v0.0.2 对会话隔离和嵌入凭证作明确安全修复，保留 API 路径与服务端角色、额度、计费。开发和预览不需要生产凭据。

## 独立克隆

推荐使用 Node.js 24 与 pnpm 9.15.9。在物理目录中安装依赖，保留 `frontend/pnpm-lock.yaml`：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..
python qa/preview_server.py --port 18872
```

预览首页 `http://127.0.0.1:18872/__preview` 提供成员、管理员及登录入口。全部使用合成数据，同源连接策略会阻止意外访问外部接口；常规业务写入返回拒绝，仅演示会话与模拟通知偏好在内存中处理。

## 检查命令

```bash
cd frontend
pnpm typecheck
pnpm test:run --maxWorkers=4 --minWorkers=1
pnpm build
cd ..
python tools/verify_frontend.py
node tools/verify_ops_contract.mjs
python integrations/sub2api/check_patch.py --artifact-only
```

可针对共用界面运行：

```bash
cd frontend
pnpm test:run src/components/common/__tests__ src/components/layout/__tests__ src/components/auth/__tests__ src/composables/__tests__/useStepUp.spec.ts
```

便携检查不需要历史提交：保留原 227 文件兼容基线，对安全修复与可选类型分别核对登记摘要，验证 68 条路由、法律文本、资源命名空间和演示身份隔离。根级 `.github/workflows/ci.yml` 使用同样检查与冻结安装，时区固定为 Asia/Shanghai。四条原安全验收可通过 `pnpm test:run --config vitest.review.config.ts` 单独执行。

本地 v0.0.2 复用了已安装的物理依赖，最终构建与全量回归由 pnpm 9.15.9 执行；没有修改共享 node_modules、锁文件或全局包管理器。

## 生成可复核的发布包

先提交经过验证的源码与证据，再使用一个空输出目录：

```bash
python tools/package_release.py --output ../release-output-v0.0.2
python tools/verify_release.py ../release-output-v0.0.2
```

清单记录发布提交、前端源树、依赖锁与逐个静态文件的 SHA256；下载校验另覆盖两个 ZIP 和外部清单。工具不覆盖既有发布目录，不上传或部署。标签、GitHub Release 与生产切换分别处理。

## 与既有后端集成

将 `frontend/dist/` 作为静态前端接入原有站点。`/api/` 和模型请求继续使用原网关；官网 `/assets/` 与工作台 `/app-assets/` 分开。先部署静态资源，再切换 HTML 入口；保留历史哈希文件和可恢复的旧入口。

前端安全修复不需要新后端接口；时序数据需要[准确匹配的可选源码补丁](../integrations/sub2api/README.zh-CN.md)，旧后端正常显示“未采集”。依赖嵌入 URL 中原登录 token 的服务需要迁移，完整兑换票据协议尚未实现。更新安全版本时应完整刷新旧标签；不一致会话停止请求，重新登录可重建。

服务端配置、密钥、运行日志及数据库不属于本仓库的演示工程。
