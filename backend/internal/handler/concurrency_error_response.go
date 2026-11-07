package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

const statusClientClosedRequest = 499
const opsLocalConcurrencyCodeKey = "ops_local_concurrency_code"

const (
	gatewayQueueFullCode        = "gateway_queue_full"
	gatewayConcurrencyLimitCode = "gateway_concurrency_limit"
)

func concurrencyErrorResponse(err error, slotType string) (int, string, string, string) {
	var policyErr *service.GatewayConcurrencyLimitError
	if errors.As(err, &policyErr) {
		code := service.GatewayUserConcurrencyLimitCode
		if policyErr.Scope == "global" {
			code = service.GatewayGlobalConcurrencyLimitCode
		}
		return http.StatusTooManyRequests, "rate_limit_error", code,
			fmt.Sprintf("%s（上限 %d）", policyErr.Error(), policyErr.Limit)
	}
	var waitQueueFullErr *WaitQueueFullError
	if errors.As(err, &waitQueueFullErr) {
		return http.StatusTooManyRequests, "rate_limit_error", gatewayQueueFullCode,
			"Too many pending requests, please retry later"
	}

	var concurrencyErr *ConcurrencyError
	if errors.As(err, &concurrencyErr) {
		if concurrencyErr.SlotType != "" {
			slotType = concurrencyErr.SlotType
		}
		return http.StatusTooManyRequests, "rate_limit_error", gatewayConcurrencyLimitCode,
			fmt.Sprintf("Concurrency limit exceeded for %s, please retry later", slotType)
	}

	if errors.Is(err, context.Canceled) {
		return statusClientClosedRequest, "api_error", "", "context canceled"
	}

	return http.StatusServiceUnavailable, "api_error", "", "Service temporarily unavailable, please retry later"
}

// markLocalConcurrencyResponse describes a local refusal without dispatching,
// retrying, clearing previous attempt evidence or changing concurrency policy.
func markLocalConcurrencyResponse(c *gin.Context, status int, code string, streamStarted bool) {
	if c == nil || status != http.StatusTooManyRequests || service.OpsConcurrencyScope(code, "") == "" {
		return
	}
	service.SetOpsLocalErrorType(c, "rate_limit_error", code)
	c.Set(opsLocalConcurrencyCodeKey, code)
	if !streamStarted && !c.Writer.Written() {
		// Advisory minimum backoff, not a promise that capacity will be available.
		c.Header("Retry-After", "2")
	}
}
