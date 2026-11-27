//go:build unit

package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ip"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// defaultAdminSystemUpdatePolicy 与配置默认值同形：关闭，只允许回环。
func defaultAdminSystemUpdatePolicy() AdminSystemUpdatePolicy {
	return AdminSystemUpdatePolicy{
		Enabled:    false,
		AllowCIDRs: []string{"127.0.0.1/32", "::1/128"},
	}
}

type systemUpdateGateProbe struct {
	called     bool
	auditExtra map[string]any
}

type systemUpdateGateOptions struct {
	policy      AdminSystemUpdatePolicy
	granted     bool
	totpEnabled bool
}

func newSystemUpdateGateRouter(t *testing.T, opts systemUpdateGateOptions) (*gin.Engine, *systemUpdateGateProbe) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	probe := &systemUpdateGateProbe{}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(ContextKeyUser), AuthSubject{UserID: 7})
		c.Set(ContextKeySessionID, "session-7")
		c.Next()
		if value, ok := c.Get(auditCtxKeyExtra); ok {
			if extra, ok := value.(map[string]any); ok {
				probe.auditExtra = extra
			}
		}
	})
	gate := adminSystemUpdateGate(
		opts.policy.Enabled,
		ip.CompileIPRules(opts.policy.AllowCIDRs),
		ip.CompileIPRules(opts.policy.TrustedProxies),
		stubStepUpGrantChecker{granted: opts.granted},
		stubStepUpUserReader{user: &service.User{TotpEnabled: opts.totpEnabled}},
	)
	router.POST("/api/v1/admin/system/update", gate, func(c *gin.Context) {
		probe.called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})
	return router, probe
}

func postSystemUpdate(router *gin.Engine, remoteAddr string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/update", nil)
	req.RemoteAddr = remoteAddr
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// 默认配置（enabled=false）下，非回环对端必须被拒绝且不进入 handler。
func TestAdminSystemUpdateGateDefaultPolicyRejectsNonLoopbackPeer(t *testing.T) {
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      defaultAdminSystemUpdatePolicy(),
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "203.0.113.9:41234", nil)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), SystemUpdateGateForbiddenCode)
	require.False(t, probe.called, "handler must not run when the gate is closed")
}

// 默认配置下即使对端是回环也必须拒绝：enabled=false 是独立的一道闸。
func TestAdminSystemUpdateGateDefaultPolicyRejectsLoopbackPeer(t *testing.T) {
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      defaultAdminSystemUpdatePolicy(),
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", nil)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.False(t, probe.called)
}

// enabled=true + CIDR 匹配 + 没有 step-up 授权 → 拒绝，且不受全局开关影响
// （adminSystemUpdateGate 不接收 settings，结构上就无法读取 IsStepUpEnabled）。
func TestAdminSystemUpdateGateRequiresStepUpEvenWhenCIDRMatches(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     false,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", nil)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "STEP_UP_REQUIRED")
	require.False(t, probe.called)
}

// enabled=true + CIDR 匹配 + 有效 step-up → 通过。
func TestAdminSystemUpdateGateAllowsWhenCIDRMatchesAndStepUpGranted(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", nil)

	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, probe.called)
}

// 对端不在 trusted_proxies 里时，伪造的转发头不能改变来源判定。
func TestAdminSystemUpdateGateIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "198.51.100.7:41234", map[string]string{
		"X-Forwarded-For":   "127.0.0.1",
		"X-Real-IP":         "127.0.0.1",
		"CF-Connecting-IP":  "127.0.0.1",
		"True-Client-IP":    "127.0.0.1",
		"X-Client-IP":       "127.0.0.1",
		"Forwarded":         "for=127.0.0.1",
		"X-Forwarded-Host":  "localhost",
		"X-Forwarded-Proto": "https",
	})

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.False(t, probe.called)
	require.Equal(t, "198.51.100.7", probe.auditExtra["system_update_peer_ip"])
	require.Equal(t, "none", probe.auditExtra["system_update_cidr"])
}

// 对端本身是可信代理时，按可信代理链解析出的客户端地址做 CIDR 匹配。
func TestAdminSystemUpdateGateResolvesTrustedProxyChain(t *testing.T) {
	policy := AdminSystemUpdatePolicy{
		Enabled:        true,
		AllowCIDRs:     []string{"175.27.132.225/32"},
		TrustedProxies: []string{"127.0.0.1/32"},
	}
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "175.27.132.225",
	})

	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, probe.called)
	require.Equal(t, "175.27.132.225", probe.auditExtra["system_update_peer_ip"])
	require.Equal(t, "175.27.132.225/32", probe.auditExtra["system_update_cidr"])
}

// 可信代理链解析出的地址不在 allow_cidrs 里同样拒绝。
func TestAdminSystemUpdateGateRejectsUntrustedClientBehindTrustedProxy(t *testing.T) {
	policy := AdminSystemUpdatePolicy{
		Enabled:        true,
		AllowCIDRs:     []string{"175.27.132.225/32"},
		TrustedProxies: []string{"127.0.0.1/32"},
	}
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: true,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "203.0.113.50",
	})

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.False(t, probe.called)
}

// 可信代理保留调用方自带字段、再追加真实调用方时，重复的 XFF 字段不能让
// 客户端伪造的白名单地址通过 CIDR 判定。
func TestAdminSystemUpdateGateRejectsSpoofedRepeatedXFFFields(t *testing.T) {
	policy := AdminSystemUpdatePolicy{
		Enabled:        true,
		AllowCIDRs:     []string{"175.27.132.225/32"},
		TrustedProxies: []string{"127.0.0.1/32"},
	}
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: true,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/system/update", nil)
	req.RemoteAddr = "127.0.0.1:41234"
	req.Header.Add("X-Forwarded-For", "175.27.132.225")
	req.Header.Add("X-Forwarded-For", "203.0.113.50")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.False(t, probe.called)
	require.Equal(t, "203.0.113.50", probe.auditExtra["system_update_peer_ip"])
}

// 未启用 TOTP 的账号无法完成 step-up，硬门必须拒绝而不是放行。
func TestAdminSystemUpdateGateRequiresTotpEnrollment(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true
	router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
		policy:      policy,
		granted:     true,
		totpEnabled: false,
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", nil)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "STEP_UP_TOTP_NOT_ENABLED")
	require.False(t, probe.called)
}

// 机器凭证（admin API key）即使持有授权也不能通过硬门。
func TestAdminSystemUpdateGateRejectsMachineCredentials(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true
	gin.SetMode(gin.TestMode)
	probe := &systemUpdateGateProbe{}
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(string(ContextKeyUser), AuthSubject{UserID: 7})
		c.Set("auth_method", service.AuditAuthMethodAdminAPIKey)
		c.Next()
	})
	gate := adminSystemUpdateGate(
		policy.Enabled,
		ip.CompileIPRules(policy.AllowCIDRs),
		nil,
		stubStepUpGrantChecker{granted: true},
		stubStepUpUserReader{user: &service.User{TotpEnabled: true}},
	)
	router.POST("/api/v1/admin/system/update", gate, func(c *gin.Context) {
		probe.called = true
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	rec := postSystemUpdate(router, "127.0.0.1:41234", nil)

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), "STEP_UP_ADMIN_API_KEY_FORBIDDEN")
	require.False(t, probe.called)
}

// 每次尝试都要留下可审计的判定细节：对端、命中的规则、step-up 状态、结果。
func TestAdminSystemUpdateGateAuditsEveryAttempt(t *testing.T) {
	policy := defaultAdminSystemUpdatePolicy()
	policy.Enabled = true

	t.Run("disabled", func(t *testing.T) {
		router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
			policy:      defaultAdminSystemUpdatePolicy(),
			granted:     true,
			totpEnabled: true,
		})
		postSystemUpdate(router, "127.0.0.1:41234", nil)

		require.Equal(t, "127.0.0.1", probe.auditExtra["system_update_peer_ip"])
		require.Equal(t, "127.0.0.1/32", probe.auditExtra["system_update_cidr"])
		require.Equal(t, "disabled", probe.auditExtra["system_update_result"])
	})

	t.Run("step up missing", func(t *testing.T) {
		router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
			policy:      policy,
			granted:     false,
			totpEnabled: true,
		})
		postSystemUpdate(router, "127.0.0.1:41234", nil)

		require.Equal(t, "denied", probe.auditExtra["system_update_result"])
		require.Equal(t, "STEP_UP_REQUIRED", probe.auditExtra["system_update_step_up"])
	})

	t.Run("allowed", func(t *testing.T) {
		router, probe := newSystemUpdateGateRouter(t, systemUpdateGateOptions{
			policy:      policy,
			granted:     true,
			totpEnabled: true,
		})
		postSystemUpdate(router, "127.0.0.1:41234", nil)

		require.Equal(t, "allowed", probe.auditExtra["system_update_result"])
		require.Equal(t, "granted", probe.auditExtra["system_update_step_up"])
	})
}
