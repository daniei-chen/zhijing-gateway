package service

import "context"

// GatewayConcurrencyLimitError is a local admission refusal, not an upstream
// rate limit. Callers must not queue or fail over to evade this limit.
type GatewayConcurrencyLimitError struct {
	Scope string
	Limit int
}

func (e *GatewayConcurrencyLimitError) Error() string {
	if e.Scope == "global" {
		return "网关并发已达上限，请等待正在执行的请求完成后再试"
	}
	return "个人并发已达上限，请等待正在执行的请求完成后再试"
}

type liveUserReservationKey struct{}

// WithLiveUserReservation is internal context, never a trusted client header.
func WithLiveUserReservation(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, liveUserReservationKey{}, requestID)
}
