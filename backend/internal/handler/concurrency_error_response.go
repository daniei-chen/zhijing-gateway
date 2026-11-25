package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
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
		c.Header("Retry-After", "30")
	}
}

// opsRetryAfterSeconds 读的是**这条错误真正发出去的** Retry-After（秒）。
//
// 表里一直有 retry_after_seconds 这一列，但从来没有代码写过它：能看到「今天拒绝了
// 110 次并发超限」，看不到「我们让客户端等多久」。没有这个数就没法判断退避建议是否
// 合理，也没法区分「客户端没听话」和「我们给的等待时间太短」。
//
// 之所以读响应头而不是读上面那个 "30" 常量：任何路径（本地拒绝、上游 429 透传）
// 只要设了 Retry-After 都会被记下来，记录值和客户端收到的值一定一致。
func opsRetryAfterSeconds(c *gin.Context) *int {
	if c == nil || c.Writer == nil {
		return nil
	}
	raw := strings.TrimSpace(c.Writer.Header().Get("Retry-After"))
	if raw == "" {
		return nil
	}
	secs, err := strconv.Atoi(raw)
	if err != nil || secs <= 0 {
		return nil
	}
	return &secs
}
