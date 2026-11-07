package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOpsLocalConcurrencyAttribution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tt := range []struct {
		name, code, message, marker, owner string
		upstream, local                    bool
	}{
		{"user code", service.GatewayUserConcurrencyLimitCode, "busy", "", "client", false, true},
		{"global code", service.GatewayGlobalConcurrencyLimitCode, "busy", "", "platform", false, true},
		{"legacy user", "", "个人并发已达上限，请等待正在执行的请求完成后再试", "", "client", false, true},
		{"legacy global", "", "网关并发已达上限，请等待正在执行的请求完成后再试", "", "platform", false, true},
		{"queue", gatewayQueueFullCode, "Too many pending requests, please retry later", "", "platform", false, true},
		{"real upstream", "rate_limit_exceeded", "Rate limit reached", "", "provider", true, false},
		{"provider returned local-like code", service.GatewayUserConcurrencyLimitCode, "个人并发已达上限", "", "provider", true, false},
		{"local refusal after prior attempt", "", "busy", service.GatewayGlobalConcurrencyLimitCode, "platform", true, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
			if tt.upstream {
				c.Set(service.OpsUpstreamStatusCodeKey, 429)
				// Generic error-envelope metadata is not trusted local-origin evidence.
				service.SetOpsLocalErrorType(c, "rate_limit_error", tt.code)
			}
			if tt.marker != "" {
				markLocalConcurrencyResponse(c, 429, tt.marker, false)
			}
			phase, limited, owner, source := classifyOpsErrorLog(c, "rate_limit_error", tt.message, tt.code, 429)
			require.Equal(t, tt.owner, owner)
			require.Equal(t, tt.local, limited)
			if tt.local {
				require.Equal(t, "request", phase)
				require.Equal(t, "gateway", source)
			} else {
				require.Equal(t, "upstream", phase)
				require.Equal(t, "upstream_http", source)
			}
			if tt.upstream {
				require.Equal(t, 429, c.GetInt(service.OpsUpstreamStatusCodeKey))
			}
		})
	}
}

func TestOpenAIConcurrencyResponseHasAdvisoryBackoff(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, scope := range []string{"user", "global"} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
		h := &OpenAIGatewayHandler{}
		h.handleConcurrencyError(c, &service.GatewayConcurrencyLimitError{Scope: scope, Limit: 3}, scope, false)
		require.Equal(t, http.StatusTooManyRequests, rec.Code)
		require.Equal(t, "2", rec.Header().Get("Retry-After"))
		var body struct {
			Error struct{ Type, Code, Message string }
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		require.Equal(t, "rate_limit_error", body.Error.Type)
		require.Equal(t, "gateway_"+scope+"_concurrency_limit", body.Error.Code)
		require.Contains(t, body.Error.Message, "上限 3")
		_, code := service.OpsLocalErrorType(c)
		require.Equal(t, body.Error.Code, code)
	}
}

func TestConcurrencyBackoffDoesNotChangeStartedStreamOrCancellation(t *testing.T) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Writer.WriteHeaderNow()
	markLocalConcurrencyResponse(c, 429, service.GatewayUserConcurrencyLimitCode, true)
	require.Empty(t, rec.Header().Get("Retry-After"))
	status, _, code, _ := concurrencyErrorResponse(context.Canceled, "user")
	markLocalConcurrencyResponse(c, status, code, false)
	require.Equal(t, 499, status)
	require.Empty(t, rec.Header().Get("Retry-After"))
}
