package admin

import (
	"strconv"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/response"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
)

// ReplayBulkAction reads the whole saved batch result, including partial
// failures, without retrying any item. It never invokes the bulk executor.
func (h *SubscriptionHandler) ReplayBulkAction(c *gin.Context) {
	var req service.BulkSubscriptionActionInput
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}
	if err := req.Validate(); err != nil {
		response.ErrorFrom(c, err)
		return
	}
	result, err := service.DefaultIdempotencyCoordinator().Replay(c.Request.Context(), service.IdempotencyExecuteOptions{
		Scope: "admin.subscriptions.bulk-action", ActorScope: adminActorScope(c),
		Method: c.Request.Method, Route: strings.TrimSuffix(c.FullPath(), "/replay"),
		IdempotencyKey: c.GetHeader("Idempotency-Key"), Payload: req,
	})
	if err != nil {
		if retryAfter := service.RetryAfterSecondsFromError(err); retryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(retryAfter))
		}
		response.ErrorFrom(c, err)
		return
	}
	c.Header("X-Idempotency-Replayed", "true")
	response.Success(c, result.Data)
}
