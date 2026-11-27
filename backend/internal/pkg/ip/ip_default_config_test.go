//go:build unit

package ip_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ip"
	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

func loadDefaultConfig(t *testing.T) *config.Config {
	t.Helper()
	viper.Reset()
	t.Cleanup(viper.Reset)
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))

	cfg, err := config.Load()
	require.NoError(t, err)
	return cfg
}

func TestDefaultConfigDoesNotTrustForwardedClientIPHeaders(t *testing.T) {
	cfg := loadDefaultConfig(t)
	require.False(t, cfg.TrustForwardedIPForAPIKeyACL())

	gin.SetMode(gin.TestMode)
	r := gin.New()
	require.NoError(t, r.SetTrustedProxies(nil))
	r.GET("/t", func(c *gin.Context) {
		c.String(200, ip.GetSecurityClientIP(c, cfg.TrustForwardedIPForAPIKeyACL()))
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/t", nil)
	req.RemoteAddr = "9.9.9.9:12345"
	req.Header.Set("CF-Connecting-IP", "1.2.3.4")
	req.Header.Set("X-Real-IP", "1.2.3.4")
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	r.ServeHTTP(w, req)

	require.Equal(t, "9.9.9.9", w.Body.String(), "default config must resolve the TCP peer, not a spoofable header")
}
