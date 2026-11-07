package service

import (
	"context"

	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
)

func observeOpenAISpeedTier(ctx context.Context, c *gin.Context, account *Account) {
	if account == nil || !account.IsOpenAI() {
		return
	}
	contract := "api_response"
	if account.IsOpenAIOAuthLike() {
		contract = "oauth_unverified"
	}
	gatewaytiming.RecordTier(ctx, "contract", contract)
	gatewaytiming.RecordTier(ctx, "response", observedUpstreamResponseServiceTier(c))
}
