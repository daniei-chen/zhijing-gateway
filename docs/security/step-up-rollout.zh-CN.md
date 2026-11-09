# 启用 step-up 2FA 的安全切换指引

> 关联：v0.0.6 的 P2-02 补丁给 `/admin/system/{update,rollback,restart}` 挂上了 step-up 门控。**门控默认不生效**，需要按本文顺序启用。

## 为什么需要

`step_up_enabled` 当前为 `false`，且管理员账号未绑定 TOTP。这意味着：

- 任何持有 admin API Key 的人可以直接 `POST /admin/system/update`，让服务下载 release 包并 `os.Rename` 覆盖自身二进制——等价于**主机代码执行**；
- 备份恢复、插件上传、scoped admin key 管理等**本来就有** step-up 保护的接口，当前也全部无保护。

## 顺序铁律

**先绑 TOTP → 再开开关 → 最后部署补丁。** 顺序错了会把管理员锁在门外。

## 1. 授权机制（先搞清，否则测试命令会写错）

grant 是**服务端会话级**的，不是请求头：

```go
// middleware/step_up.go
func StepUpSessionKey(c *gin.Context, userID int64) string {
	if sid := c.GetString(ContextKeySessionID); sid != "" {
		return sid                    // 绑定 refresh token family 会话
	}
	return fmt.Sprintf("u%d", userID) // 无会话 ID 的旧 token 退化为用户级
}
```

前端 `composables/useStepUp.ts` 的流程是：请求返回 `403 STEP_UP_REQUIRED` → 弹 TOTP 窗口 → 调 `POST /api/v1/user/totp/step-up` 建立 grant → **重试原请求**。不需要任何自定义 header。

grant 有效期 **15 分钟**。

## 2. 逃生通道（必须先确认）

`SettingService.IsStepUpEnabled` → `settingRepo.GetValue` → 直接查 PostgreSQL，**全链路无缓存**。所以改库立即生效：

```sql
UPDATE settings SET value='false', updated_at=NOW() WHERE key='step_up_enabled';
```

执行后下一次请求就放行，无需重启。**这是整个方案的安全底线。**

## 3. 操作步骤

### 步骤 1：绑定 TOTP（零风险）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/v1/user/totp/status` | 查是否已启用 |
| POST | `/api/v1/user/totp/setup` | 生成 secret + 二维码（**不会启用**） |
| POST | `/api/v1/user/totp/enable` | 提交验证码，正式启用 |
| POST | `/api/v1/user/totp/step-up` | 提交验证码，换取 grant |

推荐在后台页面操作（有二维码渲染）。完成后 `status` 应返回 `totp_enabled: true`。

此时 `step_up_enabled` 仍为 false，**所有接口行为不变**。

### 步骤 2：先做一次 step-up

```bash
curl -sS -X POST https://<host>/api/v1/user/totp/step-up \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

在开关还没打开时先验证"能拿到 grant"，避免开着开关才发现拿不到。

### 步骤 3：打开开关

优先走后台页面（设置 → 安全 → 敏感操作二次验证），页面会先校验"本人已启用 2FA"。

或直接改库：

```sql
UPDATE settings SET value='true', updated_at=NOW() WHERE key='step_up_enabled';
```

### 步骤 4：验证门控生效（用只读接口，别拿写操作试）

```bash
# 4a) 没有 grant 时应 403
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/admin/accounts/data \
  -H "Authorization: Bearer $ADMIN_JWT"

# 4b) 先建立 grant，再请求应 200
curl -s -X POST https://<host>/api/v1/user/totp/step-up \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/admin/accounts/data \
  -H "Authorization: Bearer $ADMIN_JWT"
```

再用浏览器点一次「账号导出」，确认会弹 TOTP 窗而不是直接报错。

## 4. 风险与缓解

| 风险 | 触发条件 | 后果 | 缓解 |
| --- | --- | --- | --- |
| 管理员被锁死 | 开开关后拿不到 grant | 受保护接口 403 | 改 `settings` 表立即生效（已验证无缓存） |
| 登录锁死 | 绑 TOTP 后手机丢失 | 无法登录 | 恢复码 / 邮箱重置；此时 `step_up_enabled` 仍为 false |
| TOTP 密钥丢失 | 容器重启 + `TOTP_ENCRYPTION_KEY` 未持久化 | 所有 2FA 用户无法登录 | 确保该环境变量已设置并纳入备份 |
| 前端不弹窗 | 前端版本过旧 | 后台操作全 403 | v0.0.4 起前端已含 `useStepUp`；上线前用浏览器实测一次 |
| grant 串号 | 无 session id 的旧 token | 同用户所有旧 token 共享一个 grant | 重新登录拿新 token 即可 |
