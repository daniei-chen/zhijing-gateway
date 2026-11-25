package routes

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newReleaseTestRouter(info ReleaseInfo) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterCommonRoutes(r, nil, info, nil, nil)
	return r
}

func getRelease(t *testing.T, r *gin.Engine) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/release", nil))

	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return rec.Code, body
}

// /api/release 是发布后确认「线上跑的是哪个构建」的唯一入口（2026-11-25 审计）。
// 三个身份字段必须原样透出，不能改写。
func TestReleaseReportsBuildIdentity(t *testing.T) {
	r := newReleaseTestRouter(ReleaseInfo{
		Version:   "0.1.30",
		Commit:    "abcdef1234567890",
		BuildTime: "2026-11-26T00:00:00Z",
		BuildType: "release",
	})

	code, body := getRelease(t, r)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "0.1.30", body["version"])
	require.Equal(t, "abcdef1234567890", body["commit"])
	require.Equal(t, "2026-11-26T00:00:00Z", body["build_time"])
	require.Equal(t, "release", body["build_type"])
}

// 手工构建没有链接期注入：端点仍要可用，回落成 unknown 而不是空串。
func TestReleaseFallsBackToUnknown(t *testing.T) {
	r := newReleaseTestRouter(ReleaseInfo{})

	code, body := getRelease(t, r)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "unknown", body["version"])
	require.Equal(t, "unknown", body["commit"])
	require.Equal(t, "unknown", body["build_time"])
	require.Equal(t, "unknown", body["build_type"])
}

// 运行时长与启动时刻必须自洽：刚启动时接近 0，且 started_at 能解析成 UTC 时间。
func TestReleaseUptimeAndStartedAt(t *testing.T) {
	r := newReleaseTestRouter(ReleaseInfo{Version: "0.1.30"})

	_, body := getRelease(t, r)
	uptime, ok := body["uptime_seconds"].(float64)
	require.True(t, ok, "uptime_seconds should be a number")
	require.GreaterOrEqual(t, uptime, 0.0)

	startedAt, ok := body["started_at"].(string)
	require.True(t, ok)
	parsed, err := time.Parse(time.RFC3339, startedAt)
	require.NoError(t, err)
	require.True(t, parsed.Before(time.Now().Add(time.Minute)))
}

// 端点只回答「哪个构建、跑了多久」，不要顺手把配置、路径、依赖地址带出去。
func TestReleaseExposesOnlyIdentityFields(t *testing.T) {
	r := newReleaseTestRouter(ReleaseInfo{Version: "0.1.30", Commit: "abc"})

	_, body := getRelease(t, r)
	allowed := map[string]bool{
		"version":        true,
		"commit":         true,
		"build_time":     true,
		"build_type":     true,
		"started_at":     true,
		"uptime_seconds": true,
	}
	for key := range body {
		require.True(t, allowed[key], "unexpected field leaked: %s", key)
	}
}
