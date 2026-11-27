package middleware

import (
	"log/slog"
	"net/http"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ip"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/gin-gonic/gin"
)

// SystemUpdateGateForbiddenCode 是硬门关闭时的唯一对外错误码。
// enabled=false 与“对端不在 allow_cidrs”共用它：路由是否存在在开源二进制里
// 是公开信息，对外区分两者没有收益，只会把配置状态暴露给调用方；精确原因
// 写进审计。
const SystemUpdateGateForbiddenCode = "ADMIN_SYSTEM_UPDATE_FORBIDDEN"

// AdminSystemUpdatePolicy 是 POST /api/v1/admin/system/update 应用层硬门的策略快照。
type AdminSystemUpdatePolicy struct {
	Enabled    bool
	AllowCIDRs []string
	// TrustedProxies 取自 server.trusted_proxies：只有 TCP 对端命中它时，
	// 才按可信代理链解析调用方地址；否则一律以 TCP 对端为准。
	TrustedProxies []string
}

// NewAdminSystemUpdateGate 创建 /admin/system/update 的应用层硬门。
//
// 这个端点会用下载的二进制替换正在运行的服务（≈ 主机代码执行），因此门是
// 三重且默认关死的：
//  1. policy.Enabled 为 false 时一律拒绝；
//  2. 来源只按 TCP 对端判定（见 ip.ResolvePeerClientIP），对端必须命中
//     policy.AllowCIDRs；
//  3. 即使前两步都通过，仍强制要求当前会话完成过 TOTP step-up。
//
// 与 StepUpAuthMiddleware 的关键区别：本门不读取 settings.step_up_enabled，
// 全局 step-up 开关被误关也照样拦（调用 enforceStepUpWithReason 时 settings 传
// nil，即 fail-closed）。不要把这个行为套用到其他端点，那些端点的语义由全局
// 开关决定。
func NewAdminSystemUpdateGate(
	policy AdminSystemUpdatePolicy,
	totpService *service.TotpService,
	userService *service.UserService,
) gin.HandlerFunc {
	return adminSystemUpdateGate(
		policy.Enabled,
		ip.CompileIPRules(policy.AllowCIDRs),
		ip.CompileIPRules(policy.TrustedProxies),
		stepUpGrantOrNil(totpService),
		stepUpUserOrNil(userService),
	)
}

// stepUpGrantOrNil / stepUpUserOrNil 避免 typed-nil 装箱后绕过 enforceStepUp
// 内的失败路径（与 stepUpSettingsOrNil 同理）。
func stepUpGrantOrNil(totpService *service.TotpService) stepUpGrantChecker {
	if totpService == nil {
		return nil
	}
	return totpService
}

func stepUpUserOrNil(userService *service.UserService) stepUpUserReader {
	if userService == nil {
		return nil
	}
	return userService
}

func adminSystemUpdateGate(
	enabled bool,
	rules *ip.CompiledIPRules,
	trustedProxies *ip.CompiledIPRules,
	grantChecker stepUpGrantChecker,
	userReader stepUpUserReader,
) gin.HandlerFunc {
	return func(c *gin.Context) {
		peerIP := ip.ResolvePeerClientIP(c, trustedProxies)
		matchedRule := ip.FirstMatchingRule(peerIP, rules)

		if !enabled {
			abortAdminSystemUpdateGate(c)
			recordAdminSystemUpdateGate(c, peerIP, matchedRule, "", "disabled")
			return
		}
		if matchedRule == "" {
			abortAdminSystemUpdateGate(c)
			recordAdminSystemUpdateGate(c, peerIP, matchedRule, "", "peer_not_allowed")
			return
		}

		// settings 传 nil：无条件执行 step-up，不受 settings.step_up_enabled 影响。
		if granted, reason := enforceStepUpWithReason(c, grantChecker, userReader, nil); !granted {
			recordAdminSystemUpdateGate(c, peerIP, matchedRule, reason, "denied")
			return
		}
		c.Next()
		recordAdminSystemUpdateGate(c, peerIP, matchedRule, "granted", "allowed")
	}
}

func abortAdminSystemUpdateGate(c *gin.Context) {
	AbortWithError(c, http.StatusForbidden, SystemUpdateGateForbiddenCode,
		"This endpoint is disabled or the caller address is not allowed")
}

// recordAdminSystemUpdateGate 为每次尝试留下判定细节。两个出口：
//   - SetAuditExtra 把细节挂到管理面审计记录上（admin 组的审计中间件会入库）；
//   - slog 再写一行进程日志，审计服务不可用时仍有本地痕迹。
//
// 对端地址单独记录是有意为之：审计记录的 ClientIP 走 SecurityClientIP，
// 在旧版转发头兼容开关开启时可能被请求头伪造，这里的值才是判定依据。
func recordAdminSystemUpdateGate(c *gin.Context, peerIP, matchedRule, stepUpState, result string) {
	if matchedRule == "" {
		matchedRule = "none"
	}
	if stepUpState == "" {
		stepUpState = "not_evaluated"
	}

	SetAuditExtra(c, map[string]any{
		"system_update_peer_ip": peerIP,
		"system_update_cidr":    matchedRule,
		"system_update_step_up": stepUpState,
		"system_update_result":  result,
	})

	level := slog.LevelWarn
	if result == "allowed" {
		level = slog.LevelInfo
	}
	slog.Log(c.Request.Context(), level, "admin system update gate decision",
		"peer_ip", peerIP,
		"matched_rule", matchedRule,
		"step_up", stepUpState,
		"result", result,
		"status", c.Writer.Status(),
	)
}
