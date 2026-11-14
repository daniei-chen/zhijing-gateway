package handler

import (
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *OpenAIGatewayHandler) cyberPolicyLogOnly(c *gin.Context, apiKey *service.APIKey) bool {
	if h == nil || c == nil || c.Request == nil {
		return false
	}
	if apiKey != nil && h.contentModerationService.IsContentAuditExempt(c.Request.Context(), apiKey.UserID, apiKey.ID) {
		return true
	}
	return h.gatewayService.CyberPolicyLogOnly(c.Request.Context(), apiKey)
}

// Both HTTP and WebSocket admission skip existing blocks for trusted users.
func (h *OpenAIGatewayHandler) findBlockedCyberSessionForAPIKey(c *gin.Context, apiKey *service.APIKey, body []byte) string {
	if apiKey == nil || h.cyberPolicyLogOnly(c, apiKey) {
		return ""
	}
	return findBlockedCyberSessionKey(c.Request.Context(), h.gatewayService, apiKey.ID, c, body)
}
