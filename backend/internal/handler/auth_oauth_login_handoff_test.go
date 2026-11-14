package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOAuthLoginHandoffBrowserBoundSingleConsumption(t *testing.T) {
	for _, provider := range []string{"github", "google", "linuxdo", "oidc"} {
		t.Run(provider, func(t *testing.T) {
			h, client := newOAuthPendingFlowTestHandler(t, false)
			ctx := context.Background()
			u, err := client.User.Create().SetEmail(provider + "@example.invalid").SetUsername(provider).SetPasswordHash("unused").SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(ctx)
			require.NoError(t, err)
			_, err = client.AuthIdentity.Create().SetUserID(u.ID).SetProviderType(provider).SetProviderKey(provider).SetProviderSubject("fixture-subject").Save(ctx)
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("GET", "https://gateway.example/api/v1/auth/oauth/"+provider+"/callback", nil)
			h.stageOAuthLogin(c, "/auth/oauth/callback", &service.TokenPair{AccessToken: "never-in-url"}, &service.User{ID: u.ID, Email: u.Email}, "/dashboard", service.PendingAuthIdentityKey{ProviderType: provider, ProviderKey: provider, ProviderSubject: "fixture-subject"}, nil)
			require.Equal(t, http.StatusFound, recorder.Code)
			require.Equal(t, "/auth/oauth/callback", recorder.Header().Get("Location"))
			require.NotContains(t, recorder.Body.String(), "never-in-url")
			cookies := recorder.Result().Cookies()
			for _, cookie := range cookies {
				require.True(t, cookie.HttpOnly)
				require.True(t, cookie.Secure)
				require.Equal(t, http.SameSiteLaxMode, cookie.SameSite)
			}
			stored, err := client.PendingAuthSession.Query().Only(ctx)
			require.NoError(t, err)
			require.Equal(t, u.ID, *stored.TargetUserID)
			payload, ok := readCompletionResponse(stored.LocalFlowState)
			require.True(t, ok)
			require.NotContains(t, payload, "access_token")
			require.NotContains(t, payload, "refresh_token")
			exchange := func(wrongBrowser bool) *httptest.ResponseRecorder {
				response := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(response)
				c.Request = httptest.NewRequest("POST", "https://gateway.example/api/v1/auth/oauth/pending/exchange", nil)
				for _, cookie := range cookies {
					clone := *cookie
					if wrongBrowser && clone.Name == oauthPendingBrowserCookieName {
						clone.Value = encodeCookieValue("another-browser")
					}
					c.Request.AddCookie(&clone)
				}
				h.ExchangePendingOAuthCompletion(c)
				return response
			}
			require.GreaterOrEqual(t, exchange(true).Code, 400)
			stored, err = client.PendingAuthSession.Get(ctx, stored.ID)
			require.NoError(t, err)
			require.Nil(t, stored.ConsumedAt)
			success := exchange(false)
			require.Equal(t, http.StatusOK, success.Code, success.Body.String())
			data := decodeJSONResponseData(t, success)
			require.NotEmpty(t, data["access_token"])
			accessToken, ok := data["access_token"].(string)
			if !ok {
				t.Fatal("access token has unexpected shape")
			}
			claims, err := h.authService.ValidateToken(accessToken)
			require.NoError(t, err)
			require.Equal(t, u.ID, claims.UserID)
			require.GreaterOrEqual(t, exchange(false).Code, 400, "completion must be single use")
		})
	}
}

func TestOAuthLoginHandoffExpiredPendingCannotIssueLogin(t *testing.T) {
	h, client := newOAuthPendingFlowTestHandler(t, false)
	ctx := context.Background()
	u, err := client.User.Create().SetEmail("expired@example.invalid").SetPasswordHash("unused").SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(ctx)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("GET", "https://gateway.example/api/v1/auth/oauth/github/callback", nil)
	h.stageOAuthLogin(c, "/auth/oauth/callback", &service.TokenPair{AccessToken: "discarded"}, &service.User{ID: u.ID, Email: u.Email}, "/dashboard", service.PendingAuthIdentityKey{ProviderType: "github", ProviderKey: "github", ProviderSubject: "expired"}, nil)
	stored, err := client.PendingAuthSession.Query().Only(ctx)
	require.NoError(t, err)
	require.NoError(t, client.PendingAuthSession.UpdateOneID(stored.ID).SetExpiresAt(time.Now().Add(-time.Minute)).Exec(ctx))
	response := httptest.NewRecorder()
	exchange, _ := gin.CreateTestContext(response)
	exchange.Request = httptest.NewRequest("POST", "https://gateway.example/api/v1/auth/oauth/pending/exchange", nil)
	for _, cookie := range recorder.Result().Cookies() {
		exchange.Request.AddCookie(cookie)
	}
	h.ExchangePendingOAuthCompletion(exchange)
	require.GreaterOrEqual(t, response.Code, 400)
	require.NotContains(t, response.Body.String(), "access_token")
}
