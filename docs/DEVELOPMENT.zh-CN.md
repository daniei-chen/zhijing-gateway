# 本地开发与验证

项目是 Sub2API 的智境前端工作区，保留原生 Vue 页面、API 客户端与角色逻辑。开发和预览不需要生产凭据。

## 独立克隆

推荐使用 Node.js 24 与 pnpm 9.15.9。在物理目录中安装依赖，保留 `frontend/pnpm-lock.yaml`：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm build
cd ..
python qa/preview_server.py --port 18871
```

预览首页 `http://127.0.0.1:18871/__preview` 提供成员、管理员及登录入口。全部使用合成数据，同源连接策略会阻止意外访问外部接口；常规业务写入返回拒绝，仅演示会话与模拟通知偏好在内存中处理。

## 检查命令

```bash
cd frontend
pnpm typecheck
pnpm test:run
pnpm build
cd ..
python tools/verify_frontend.py
```

可针对共用界面运行：

```bash
cd frontend
pnpm test:run src/components/common/__tests__ src/components/layout/__tests__ src/components/auth/__tests__ src/composables/__tests__/useStepUp.spec.ts
```

便携验证工具不依赖开发者原工作树或历史提交。它核对 227 个原契约文件、68 条路由、入口资源命名空间，并检查生产构建没有混入演示身份和横幅。

## 与既有后端集成

将 `frontend/dist/` 作为静态前端接入原有站点。`/api/` 和模型请求继续使用原网关；官网 `/assets/` 与工作台 `/app-assets/` 分开。先部署静态资源，再切换 HTML 入口；保留历史哈希文件和可恢复的旧入口。

服务端配置、密钥、运行日志及数据库不属于本仓库的演示工程。
