//go:build unit

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type oauthBindSessionBlockedUsers struct {
	service.UserRepository
	user    service.User
	entered chan struct{}
	release chan struct{}
}

func (r *oauthBindSessionBlockedUsers) GetByID(context.Context, int64) (*service.User, error) {
	close(r.entered)
	<-r.release
	clone := r.user
	return &clone, nil
}

func (*oauthBindSessionBlockedUsers) GetUserAvatar(context.Context, int64) (*service.UserAvatar, error) {
	return nil, nil
}

func TestOAuthBindCookieRejectsRevocationDuringUserLookup(t *testing.T) {
	ctx := context.Background()
	h, client := newOAuthPendingFlowTestHandlerWithDependencies(t, oauthPendingFlowTestHandlerOptions{refreshCache: newBrowserSessionRedisCache(t)})
	created, err := client.User.Create().SetEmail("bind-revoke-race@example.invalid").SetPasswordHash("synthetic-password-hash").SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(ctx)
	require.NoError(t, err)
	user, err := h.userService.GetByID(ctx, created.ID)
	require.NoError(t, err)
	raw, err := h.authService.GenerateToken(ctx, user)
	require.NoError(t, err)
	blocked := &oauthBindSessionBlockedUsers{user: *user, entered: make(chan struct{}), release: make(chan struct{})}
	h.userService = service.NewUserService(blocked, nil, nil, nil)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "https://gateway.invalid/api/v1/auth/oauth/linuxdo/start?intent=bind_current_user", nil)
	c.Request.AddCookie(&http.Cookie{Name: oauthBindAccessTokenCookieName, Value: url.QueryEscape(raw)})
	done := make(chan error, 1)
	go func() {
		_, err := h.resolveOAuthBindTargetUserID(c)
		done <- err
	}()
	select {
	case <-blocked.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("user lookup not reached")
	}
	require.NoError(t, h.authService.RevokeAllUserSessions(ctx, user.ID))
	close(blocked.release)
	require.ErrorIs(t, <-done, service.ErrTokenRevoked)
}

func TestOAuthBindCookieRejectsChangedFingerprint(t *testing.T) {
	ctx := context.Background()
	h, client := newOAuthPendingFlowTestHandlerWithDependencies(t, oauthPendingFlowTestHandlerOptions{
		refreshCache:  newBrowserSessionRedisCache(t),
		settingValues: map[string]string{service.SettingKeySessionBindingEnabled: "true"},
	})
	created, err := client.User.Create().SetEmail("independent-bind@example.invalid").SetPasswordHash("synthetic-password-hash").SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(ctx)
	require.NoError(t, err)
	user, err := h.userService.GetByID(ctx, created.ID)
	require.NoError(t, err)
	require.True(t, h.settingSvc.IsSessionBindingEnabled(ctx))
	original := service.WithSessionBinding(ctx, &service.SessionBinding{IP: "192.0.2.10", UserAgent: "SyntheticOriginalBrowser"})
	raw, err := h.authService.GenerateToken(original, user)
	require.NoError(t, err)
	claims, err := h.authService.ValidateToken(raw)
	require.NoError(t, err)
	require.NotEmpty(t, claims.BindingHash)
	changed := service.WithSessionBinding(ctx, &service.SessionBinding{IP: "198.51.100.20", UserAgent: "SyntheticOtherBrowser"})
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "https://gateway.invalid/api/v1/auth/oauth/linuxdo/start?intent=bind_current_user", nil).WithContext(changed)
	c.Request.AddCookie(&http.Cookie{Name: oauthBindAccessTokenCookieName, Value: url.QueryEscape(raw)})
	target, err := h.resolveOAuthBindTargetUserID(c)
	require.ErrorIs(t, err, service.ErrSessionBindingMismatch, "bound access JWT must not authorize OAuth binding from a different IP/UA")
	require.Nil(t, target)
}

func TestOAuthBindCookieFingerprintCompatibility(t *testing.T) {
	original := service.SessionBinding{IP: "192.0.2.10", UserAgent: "SyntheticOriginalBrowser"}
	for _, tc := range []struct {
		name     string
		enabled  bool
		legacy   bool
		fallback bool
		binding  service.SessionBinding
		mismatch bool
	}{
		{name: "matching", enabled: true, binding: original},
		{name: "switch_disabled", binding: service.SessionBinding{IP: "198.51.100.20", UserAgent: "SyntheticOtherBrowser"}},
		{name: "legacy_empty_hash", enabled: true, legacy: true, binding: service.SessionBinding{IP: "198.51.100.20", UserAgent: "SyntheticOtherBrowser"}},
		{name: "changed_ip", enabled: true, binding: service.SessionBinding{IP: "198.51.100.20", UserAgent: original.UserAgent}, mismatch: true},
		{name: "changed_user_agent", enabled: true, binding: service.SessionBinding{IP: original.IP, UserAgent: "SyntheticOtherBrowser"}, mismatch: true},
		{name: "canonical_request_fallback", enabled: true, fallback: true, binding: original},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			enabled := "false"
			if tc.enabled {
				enabled = "true"
			}
			h, client := newOAuthPendingFlowTestHandlerWithDependencies(t, oauthPendingFlowTestHandlerOptions{refreshCache: newBrowserSessionRedisCache(t), settingValues: map[string]string{service.SettingKeySessionBindingEnabled: enabled}})
			created, err := client.User.Create().SetEmail("bind-compat@example.invalid").SetPasswordHash("synthetic-password-hash").SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(ctx)
			require.NoError(t, err)
			user, err := h.userService.GetByID(ctx, created.ID)
			require.NoError(t, err)
			signingContext := ctx
			if !tc.legacy {
				signingContext = service.WithSessionBinding(ctx, &original)
			}
			raw, err := h.authService.GenerateToken(signingContext, user)
			require.NoError(t, err)
			requestContext := ctx
			if !tc.fallback {
				requestContext = service.WithSessionBinding(ctx, &tc.binding)
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, "https://gateway.invalid/api/v1/auth/oauth/linuxdo/start?intent=bind_current_user", nil).WithContext(requestContext)
			c.Request.RemoteAddr = tc.binding.IP + ":12345"
			c.Request.Header.Set("User-Agent", tc.binding.UserAgent)
			c.Request.AddCookie(&http.Cookie{Name: oauthBindAccessTokenCookieName, Value: url.QueryEscape(raw)})
			target, err := h.resolveOAuthBindTargetUserID(c)
			if tc.mismatch {
				require.ErrorIs(t, err, service.ErrSessionBindingMismatch)
				require.Nil(t, target)
				claims, parseErr := h.authService.ValidateToken(raw)
				require.NoError(t, parseErr)
				require.ErrorIs(t, h.authService.ValidateSession(ctx, claims), service.ErrTokenRevoked)
			} else {
				require.NoError(t, err)
				require.NotNil(t, target)
				require.Equal(t, user.ID, *target)
			}
		})
	}
}
