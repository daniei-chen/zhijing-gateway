package routes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newReadyzTestRouter(businessCheck func(context.Context) (map[string]any, error)) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	// redisClient/dbCheck 都为 nil：探针报告 not_configured 而不判失败，
	// 这样用例只聚焦深度探针本身。
	RegisterCommonRoutes(r, nil, ReleaseInfo{}, nil, businessCheck)
	return r
}

func readyzChecks(t *testing.T, r *gin.Engine, path string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

	var body struct {
		Status string         `json:"status"`
		Checks map[string]any `json:"checks"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body), rec.Body.String())
	return rec.Code, body.Checks
}

// 浅探针保持原语义：不查账号，也不应出现 business 字段。
func TestReadyzShallowSkipsBusinessCheck(t *testing.T) {
	called := false
	r := newReadyzTestRouter(func(context.Context) (map[string]any, error) {
		called = true
		return nil, nil
	})

	code, checks := readyzChecks(t, r, "/readyz")
	require.Equal(t, http.StatusOK, code)
	require.False(t, called, "business check must not run on the shallow probe")
	require.NotContains(t, checks, "business")
}

// deep=1 且账号可用：200，业务检查通过，明细透出。
func TestReadyzDeepReportsSchedulableAccounts(t *testing.T) {
	r := newReadyzTestRouter(func(context.Context) (map[string]any, error) {
		return map[string]any{"schedulable_accounts": 2}, nil
	})

	code, checks := readyzChecks(t, r, "/readyz?deep=1")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "ok", checks["business"])
	require.Equal(t, float64(2), checks["schedulable_accounts"])
}

// deep=1 但没有可调度账号：503，明细仍然透出，便于定位是「0 个账号」还是查询失败。
func TestReadyzDeepFailsWithoutAccounts(t *testing.T) {
	r := newReadyzTestRouter(func(context.Context) (map[string]any, error) {
		return map[string]any{"schedulable_accounts": 0}, errors.New("no schedulable accounts")
	})

	code, checks := readyzChecks(t, r, "/readyz?deep=1")
	require.Equal(t, http.StatusServiceUnavailable, code)
	require.Equal(t, "error", checks["business"])
	require.Equal(t, "no schedulable accounts", checks["business_error"])
	require.Equal(t, float64(0), checks["schedulable_accounts"])
}

// businessCheck 未注入时深度探针不判失败，避免把「未配置」误报成故障。
func TestReadyzDeepWithoutCheckIsNotConfigured(t *testing.T) {
	r := newReadyzTestRouter(nil)

	code, checks := readyzChecks(t, r, "/readyz?deep=true")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "not_configured", checks["business"])
}

// 依赖失败仍然压过业务检查：DB 挂了就是 503，不管账号在不在。
func TestReadyzDeepStillFailsOnDatabaseError(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterCommonRoutes(r, nil, ReleaseInfo{}, func(context.Context) error {
		return errors.New("db down")
	}, func(context.Context) (map[string]any, error) {
		return map[string]any{"schedulable_accounts": 1}, nil
	})

	code, checks := readyzChecks(t, r, "/readyz?deep=1")
	require.Equal(t, http.StatusServiceUnavailable, code)
	require.Equal(t, "error", checks["database"])
	require.Equal(t, "ok", checks["business"])
}

func TestDeepReadinessRequestedParsing(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{
		{"", false},
		{"0", false},
		{"false", false},
		{"no", false},
		{"1", true},
		{"true", true},
		{"TRUE", true},
		{" yes ", true},
	} {
		gin.SetMode(gin.TestMode)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
		q := req.URL.Query()
		q.Set("deep", tc.value)
		req.URL.RawQuery = q.Encode()
		c.Request = req
		require.Equal(t, tc.want, deepReadinessRequested(c), "deep=%q", tc.value)
	}
}

func TestDeepReadinessRequestedMissingParam(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	require.False(t, deepReadinessRequested(c))
}
