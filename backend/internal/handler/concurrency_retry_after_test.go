package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// ops_error_logs.retry_after_seconds 这一列一直存在，但从来没有任何代码写过它。
// 结果是：能查到「今天拒绝了 110 次并发超限」，查不到「我们让客户端等多久」。
// 下面这几条盯的就是「记下来的值 = 客户端真正收到的值」。
func TestOpsRetryAfterSecondsReadsResponseHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Writer.Header().Set("Retry-After", "30")

	got := opsRetryAfterSeconds(c)
	require.NotNil(t, got)
	require.Equal(t, 30, *got)
}

func TestOpsRetryAfterSecondsIgnoresUnusableValues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name  string
		value string
	}{
		{name: "absent", value: ""},
		{name: "blank", value: "   "},
		{name: "not a number", value: "soon"},
		{name: "zero", value: "0"},
		{name: "negative", value: "-5"},
		{name: "http date form", value: "Wed, 21 Oct 2026 07:28:00 GMT"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			if tt.value != "" {
				c.Writer.Header().Set("Retry-After", tt.value)
			}
			require.Nil(t, opsRetryAfterSeconds(c))
		})
	}
}

func TestOpsRetryAfterSecondsToleratesNilContext(t *testing.T) {
	require.Nil(t, opsRetryAfterSeconds(nil))
}

// 记录路径要和延迟字段走同一条填充链：只要走到 applyOpsLatencyFieldsFromContext，
// 这条错误被要求等待多久就一定会落库。
func TestApplyOpsLatencyFieldsCarriesRetryAfter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Writer.Header().Set("Retry-After", "30")

	entry := &service.OpsInsertErrorLogInput{}
	applyOpsLatencyFieldsFromContext(c, entry)

	require.NotNil(t, entry.RetryAfterSeconds)
	require.Equal(t, 30, *entry.RetryAfterSeconds)
}

// 并发拒绝的响应头与随后记录的值必须一致 —— 前者是客户端看到的，后者是我们日后分析的依据。
func TestConcurrencyRefusalRecordsTheSameRetryAfterItSends(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name string
		err  error
	}{
		{name: "member limit", err: &service.GatewayConcurrencyLimitError{Scope: "user", Limit: 3}},
		{name: "global limit", err: &service.GatewayConcurrencyLimitError{Scope: "global", Limit: 9}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

			status, errType, code, _ := concurrencyErrorResponse(tt.err, "user")
			require.Equal(t, http.StatusTooManyRequests, status)
			markLocalConcurrencyResponse(c, status, code, false)
			require.Equal(t, "rate_limit_error", errType)

			sent := rec.Header().Get("Retry-After")
			require.Equal(t, "30", sent)

			entry := &service.OpsInsertErrorLogInput{}
			applyOpsLatencyFieldsFromContext(c, entry)
			require.NotNil(t, entry.RetryAfterSeconds)
			require.Equal(t, 30, *entry.RetryAfterSeconds)
		})
	}
}
