package handler

import (
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// Successful OAuth login uses the same browser-bound, single-consumption
// exchange as account adoption. No reusable login credential travels in a URL.
func (h *AuthHandler) stageOAuthLogin(c *gin.Context, callback string, pair *service.TokenPair, user *service.User, redirect string, identity service.PendingAuthIdentityKey, claims map[string]any) {
	if pair == nil || user == nil || user.ID <= 0 {
		redirectOAuthError(c, callback, "session_error", "invalid login completion", "")
		return
	}
	// Legacy service calls issue a pair before returning the resolved user. That
	// pair is never delivered; discard its refresh token before staging exchange.
	if strings.TrimSpace(pair.RefreshToken) != "" {
		if err := h.authService.RevokeRefreshToken(c.Request.Context(), pair.RefreshToken); err != nil {
			redirectOAuthError(c, callback, "session_error", "unable to stage login completion", "")
			return
		}
	}
	browser, _ := readOAuthPendingBrowserCookie(c)
	if strings.TrimSpace(browser) == "" {
		var err error
		browser, err = generateOAuthPendingBrowserSession()
		if err != nil {
			redirectOAuthError(c, callback, "session_error", "unable to stage login completion", "")
			return
		}
		setOAuthPendingBrowserCookie(c, browser, isRequestHTTPS(c))
	}
	err := h.createOAuthPendingSession(c, oauthPendingSessionPayload{
		Intent: oauthIntentLogin, Identity: identity, TargetUserID: &user.ID,
		ResolvedEmail: user.Email, RedirectTo: redirect, BrowserSessionKey: browser,
		UpstreamIdentityClaims: claims, CompletionResponse: map[string]any{"provider": identity.ProviderType},
	})
	if err != nil {
		redirectOAuthError(c, callback, "session_error", "unable to stage login completion", "")
		return
	}
	redirectToFrontendCallback(c, callback)
}
