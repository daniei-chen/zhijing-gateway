package admin

import (
	"strconv"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/adminaccess"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/response"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
)

// ReplayBalanceUpdate confirms only a previously saved balance result. It has
// no business executor, so unknown/expired results cannot repeat the write.
// A distinct route also fails safely on an older backend that lacks replay.
func (h *UserHandler) ReplayBalanceUpdate(c *gin.Context) {
	userID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || userID <= 0 {
		response.BadRequest(c, "Invalid user ID")
		return
	}
	var req UpdateBalanceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "Invalid request: "+err.Error())
		return
	}
	// Use the exact original write route and payload for fingerprint comparison.
	payload := struct {
		UserID int64                `json:"user_id"`
		Body   UpdateBalanceRequest `json:"body"`
	}{UserID: userID, Body: req}
	result, err := service.DefaultIdempotencyCoordinator().Replay(c.Request.Context(), service.IdempotencyExecuteOptions{
		Scope: "admin.users.balance.update", ActorScope: adminReplayActorScope(c),
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
	if adminaccess.FromContext(c.Request.Context()) != nil {
		response.Success(c, gin.H{"id": userID})
		return
	}
	response.Success(c, result.Data)
}
