//go:build unit

package ip_test

import (
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ip"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 本用例钉住的是**已知缺陷的现状**，不是期望值，见 DAN-59。
//
// security.trust_forwarded_ip_for_api_key_acl=true 时，GetSecurityClientIP 走进
// 兼容路径并直接采信转发头：它不校验 TCP 对端是否在 server.trusted_proxies 里
// （这里 gin 明确不信任任何代理），且 CF-Connecting-IP 优先于 X-Real-IP 与
// X-Forwarded-For。也就是说「打开这个开关」不只是放宽了白名单的来源判定，而是
// 让任何能直连端口的调用方都能自报客户端地址。
//
// 这就是配套门禁只允许显式 opt-in、并且迁移不得把存量 false 翻回 true 的原因。
// DAN-59 修好（兼容路径补上对端校验 / 调整头优先级）之后，本用例必须跟着改成
// 新的期望值——它现在变红说明缺陷被修了，不是回归。
func TestForwardedTrustSkipsProxyValidationPinnedToDAN59(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	router.GET("/client-ip", func(c *gin.Context) {
		c.String(200, "%s|%s", ip.GetSecurityClientIP(c, true), ip.GetTrustedClientIP(c))
	})

	req := httptest.NewRequest("GET", "/client-ip", nil)
	req.RemoteAddr = "9.9.9.9:12345"
	req.Header.Set("CF-Connecting-IP", "1.2.3.4")
	req.Header.Set("X-Real-IP", "5.6.7.8")
	req.Header.Set("X-Forwarded-For", "7.7.7.7")

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, "1.2.3.4|9.9.9.9", rec.Body.String(),
		"现状：开关打开时（左侧）采信调用方自报的 CF-Connecting-IP，不做对端校验；"+
			"关闭时（右侧）用 TCP 对端。DAN-59 修好后改这里")
}
