//go:build unit

package ip

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func resolvePeerForTest(t *testing.T, remoteAddr string, headers map[string]string, trusted []string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/admin/system/update", nil)
	c.Request.RemoteAddr = remoteAddr
	for key, value := range headers {
		c.Request.Header.Set(key, value)
	}
	return ResolvePeerClientIP(c, CompileIPRules(trusted))
}

func TestResolvePeerClientIPIgnoresForwardedHeadersFromUntrustedPeer(t *testing.T) {
	got := resolvePeerForTest(t, "198.51.100.7:41234", map[string]string{
		"X-Forwarded-For":  "127.0.0.1",
		"X-Real-IP":        "127.0.0.1",
		"CF-Connecting-IP": "127.0.0.1",
	}, nil)

	require.Equal(t, "198.51.100.7", got)
}

func TestResolvePeerClientIPUsesBareRemoteAddr(t *testing.T) {
	require.Equal(t, "127.0.0.1", resolvePeerForTest(t, "127.0.0.1", nil, nil))
	require.Equal(t, "::1", resolvePeerForTest(t, "[::1]:8080", nil, nil))
	require.Equal(t, "", resolvePeerForTest(t, "", nil, nil))
}

func TestResolvePeerClientIPWalksTrustedProxyChain(t *testing.T) {
	trusted := []string{"127.0.0.1/32", "10.0.0.0/8"}

	got := resolvePeerForTest(t, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "203.0.113.9, 10.1.2.3",
	}, trusted)
	require.Equal(t, "203.0.113.9", got)

	// 全部跳数都是可信代理时回落到对端本身，而不是采信最左侧的值。
	got = resolvePeerForTest(t, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "10.1.2.3",
	}, trusted)
	require.Equal(t, "127.0.0.1", got)

	// XFF 缺失时看 X-Real-IP。
	got = resolvePeerForTest(t, "127.0.0.1:41234", map[string]string{
		"X-Real-IP": "175.27.132.225",
	}, trusted)
	require.Equal(t, "175.27.132.225", got)
}

// 可信代理保留调用方自带字段、再把真实调用方作为另一个字段追加时，
// 必须走完整个链的右侧，不能被最左侧（可伪造）的字段骗过。
func TestResolvePeerClientIPCombinesRepeatedXFFFields(t *testing.T) {
	got := resolvePeerForTest(t, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "175.27.132.225",
	}, []string{"127.0.0.1/32"})
	require.Equal(t, "175.27.132.225", got)

	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/admin/system/update", nil)
	c.Request.RemoteAddr = "127.0.0.1:41234"
	c.Request.Header.Add("X-Forwarded-For", "175.27.132.225")
	c.Request.Header.Add("X-Forwarded-For", "203.0.113.50")

	require.Equal(t, "203.0.113.50", ResolvePeerClientIP(c, CompileIPRules([]string{"127.0.0.1/32"})))
}

func TestResolvePeerClientIPStopsAtMalformedHop(t *testing.T) {
	got := resolvePeerForTest(t, "127.0.0.1:41234", map[string]string{
		"X-Forwarded-For": "203.0.113.9, unknown",
	}, []string{"127.0.0.1/32"})

	require.Equal(t, "127.0.0.1", got)
}

func TestFirstMatchingRuleReportsMatchedPattern(t *testing.T) {
	rules := CompileIPRules([]string{"175.27.132.225/32", "::1/128"})

	require.Equal(t, "175.27.132.225/32", FirstMatchingRule("175.27.132.225", rules))
	require.Equal(t, "::1/128", FirstMatchingRule("::1", rules))
	require.Equal(t, "", FirstMatchingRule("203.0.113.9", rules))
	require.Equal(t, "", FirstMatchingRule("not-an-ip", rules))
	require.Equal(t, "", FirstMatchingRule("127.0.0.1", nil))
}
