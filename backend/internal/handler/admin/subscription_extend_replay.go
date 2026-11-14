package admin

import (
	"strconv"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/response"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
)

// ReplayExtend confirms a saved adjustment without running ExtendSubscription.
// Keep its distinct route safe when an older backend lacks this capability.
func (h *SubscriptionHandler) ReplayExtend(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, "Invalid subscription ID")
		return
	}
	var req AdjustSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}
	payload := struct {
		SubscriptionID int64                     `json:"subscription_id"`
		Body           AdjustSubscriptionRequest `json:"body"`
	}{SubscriptionID: id, Body: req}
	result, err := service.DefaultIdempotencyCoordinator().Replay(c.Request.Context(), service.IdempotencyExecuteOptions{
		Scope: "admin.subscriptions.extend", ActorScope: adminReplayActorScope(c),
		Method: c.Request.Method, Route: strings.TrimSuffix(c.FullPath(), "/replay"),
		IdempotencyKey: c.GetHeader("Idempotency-Key"), Payload: payload,
	})
	if err != nil {
		if retryAfter := service.RetryAfterSecondsFromError(err); retryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(retryAfter))
		}
		response.ErrorFrom(c, err)
		return
	}
	c.Header("X-Idempotency-Replayed", "true")
	response.Success(c, adminSubscriptionResponse(c, result.Data))
}
