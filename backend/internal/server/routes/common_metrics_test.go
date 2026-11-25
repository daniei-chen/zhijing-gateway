//go:build unit

package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newMetricsTestRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterCommonRoutes(r, nil, ReleaseInfo{}, nil, nil)
	return r
}

// 未配置 METRICS_TOKEN 时端点必须不可用，而且用 404 而不是 401 —— 不让人确认它存在。
func TestMetricsDisabledByDefault(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "")
	r := newMetricsTestRouter()

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

func TestMetricsRejectsWrongToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "s3cret")
	r := newMetricsTestRouter()

	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/metrics", nil),
		httptest.NewRequest(http.MethodGet, "/metrics?token=wrong", nil),
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		require.Equal(t, http.StatusNotFound, rec.Code)
	}
}

func TestMetricsAcceptsBearerToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "s3cret")
	r := newMetricsTestRouter()

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	req.Header.Set("Authorization", "Bearer s3cret")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Header().Get("Content-Type"), "text/plain")
	require.Contains(t, rec.Body.String(), "zhijing_uptime_seconds")
}

func TestMetricsAcceptsQueryToken(t *testing.T) {
	t.Setenv("METRICS_TOKEN", "s3cret")
	r := newMetricsTestRouter()

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics?token=s3cret", nil))

	require.Equal(t, http.StatusOK, rec.Code)
	require.True(t, strings.Contains(rec.Body.String(), "zhijing_go_goroutines"))
}
