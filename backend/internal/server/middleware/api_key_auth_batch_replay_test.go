//go:build unit

package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func batchReplayAuthKey() *service.APIKey {
	return &service.APIKey{ID: 22, UserID: 11, Key: "synthetic-history-key", Status: service.StatusActive,
		User: &service.User{ID: 11, Status: service.StatusActive, Role: service.RoleUser, Balance: 0}}
}

func batchReplayAuthRouter(t *testing.T, key *service.APIKey, subscription *service.SubscriptionService) (*gin.Engine, *int, *int) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	touches, reached := 0, 0
	repo := &stubApiKeyRepo{
		getByKey: func(_ context.Context, credential string) (*service.APIKey, error) {
			if credential != key.Key {
				return nil, service.ErrAPIKeyNotFound
			}
			copy := *key
			if key.User != nil {
				user := *key.User
				copy.User = &user
			}
			return &copy, nil
		},
		updateLastUsed: func(context.Context, int64, time.Time) error { touches++; return nil },
	}
	cfg := &config.Config{RunMode: config.RunModeStandard}
	cfg.SetTrustForwardedIPForAPIKeyACL(false)
	svc := service.NewAPIKeyService(repo, nil, nil, nil, nil, nil, cfg)
	router := gin.New()
	router.RedirectTrailingSlash = false
	router.RedirectFixedPath = false
	require.NoError(t, router.SetTrustedProxies(nil))
	router.Use(gin.HandlerFunc(NewAPIKeyAuthMiddleware(svc, subscription, cfg)))
	router.Any("/*path", func(c *gin.Context) {
		reached++
		owner, ok := GetAPIKeyFromContext(c)
		require.True(t, ok)
		require.Equal(t, int64(11), owner.UserID)
		require.Equal(t, int64(22), owner.ID)
		c.Status(http.StatusOK)
	})
	return router, &touches, &reached
}

func batchReplayAuthRequest(router *gin.Engine, method, path, credential string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = "192.0.2.20:12345"
	if credential != "" {
		req.Header.Set("x-api-key", credential)
	}
	router.ServeHTTP(w, req)
	return w
}

func TestAPIKeyAuthBatchReplayExactMethodAndPathOnly(t *testing.T) {
	for _, tc := range []struct {
		method, path string
		allowed      bool
	}{
		{http.MethodPost, "/v1/images/batches/replay", true},
		{http.MethodPost, "/v1/images/batches/replay?trace=synthetic", true},
		{http.MethodGet, "/v1/images/batches/replay", false},
		{http.MethodPut, "/v1/images/batches/replay", false},
		{http.MethodPatch, "/v1/images/batches/replay", false},
		{http.MethodDelete, "/v1/images/batches/replay", false},
		{http.MethodHead, "/v1/images/batches/replay", false},
		{http.MethodPost, "/v1/images/batches/replay/", false},
		{http.MethodPost, "/v1/images/batches/replay/child", false},
		{http.MethodPost, "/v1/images/batches/replay-other", false},
		{http.MethodPost, "/images/batches/replay", false},
		{http.MethodPost, "/v1/images/batches", false},
		{http.MethodPost, "/v1/images/batches/id/cancel", false},
		{http.MethodGet, "/v1/images/batches/id", false},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			key := batchReplayAuthKey()
			router, touches, reached := batchReplayAuthRouter(t, key, nil)
			w := batchReplayAuthRequest(router, tc.method, tc.path, key.Key)
			if tc.allowed {
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				require.Equal(t, 1, *reached)
				require.Equal(t, 1, *touches, "the existing last-used audit update is preserved")
			} else {
				require.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
				require.Zero(t, *reached)
				require.Zero(t, *touches)
			}
		})
	}
}

func TestAPIKeyAuthBatchReplayReadsAfterQuotaOrExpiryButSubmitStillRejects(t *testing.T) {
	for _, condition := range []string{"no balance", "quota status", "expired status", "expired time", "used quota"} {
		t.Run(condition, func(t *testing.T) {
			key := batchReplayAuthKey()
			wantRejected := http.StatusForbidden
			switch condition {
			case "quota status":
				key.Status = service.StatusAPIKeyQuotaExhausted
				wantRejected = http.StatusTooManyRequests
			case "expired status":
				key.Status = service.StatusAPIKeyExpired
			case "expired time":
				past := time.Now().Add(-time.Hour)
				key.ExpiresAt = &past
			case "used quota":
				key.Quota, key.QuotaUsed = 1, 1
				wantRejected = http.StatusTooManyRequests
			}
			router, touches, reached := batchReplayAuthRouter(t, key, nil)
			w := batchReplayAuthRequest(router, http.MethodPost, "/v1/images/batches/replay", key.Key)
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			require.Equal(t, 1, *reached)
			require.Equal(t, 1, *touches)
			w = batchReplayAuthRequest(router, http.MethodPost, "/v1/images/batches", key.Key)
			require.Equal(t, wantRejected, w.Code, w.Body.String())
			require.Equal(t, 1, *reached)
			require.Equal(t, 1, *touches)
		})
	}
}

func TestAPIKeyAuthBatchReplayStillRequiresFullAuthentication(t *testing.T) {
	for _, condition := range []string{"missing key", "invalid key", "disabled key", "missing user", "disabled user", "IP denied", "disabled group", "deleted group", "exclusive group denied"} {
		t.Run(condition, func(t *testing.T) {
			key := batchReplayAuthKey()
			credential, wantStatus, wantCode := key.Key, http.StatusUnauthorized, "API_KEY_REQUIRED"
			switch condition {
			case "missing key":
				credential = ""
			case "invalid key":
				credential, wantCode = "invalid-synthetic", "INVALID_API_KEY"
			case "disabled key":
				key.Status, wantCode = "disabled", "API_KEY_DISABLED"
			case "missing user":
				// APIKeyService rejects an orphan before middleware gets a principal.
				key.User, wantCode = nil, "INVALID_API_KEY"
			case "disabled user":
				key.User.Status, wantCode = "disabled", "USER_INACTIVE"
			case "IP denied":
				key.IPWhitelist, wantStatus, wantCode = []string{"10.0.0.1"}, http.StatusForbidden, "ACCESS_DENIED"
			case "disabled group", "deleted group", "exclusive group denied":
				group := &service.Group{ID: 7, Status: service.StatusActive, Hydrated: true}
				key.Group, key.GroupID, wantStatus = group, &group.ID, http.StatusForbidden
				switch condition {
				case "disabled group":
					group.Status, wantCode = "disabled", "GROUP_DISABLED"
				case "deleted group":
					key.Group, wantCode = nil, "GROUP_DELETED"
				case "exclusive group denied":
					group.IsExclusive, wantCode = true, "GROUP_NOT_ALLOWED"
				}
			}
			router, touches, reached := batchReplayAuthRouter(t, key, nil)
			w := batchReplayAuthRequest(router, http.MethodPost, "/v1/images/batches/replay", credential)
			require.Equal(t, wantStatus, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), wantCode)
			require.Zero(t, *reached)
			require.Zero(t, *touches)
		})
	}
}

func TestAPIKeyAuthBatchReplayReadsSubscriptionWithoutWindowMaintenance(t *testing.T) {
	key := batchReplayAuthKey()
	limit, dailyUsed := 1.0, 100.0
	group := &service.Group{ID: 7, Status: service.StatusActive, Hydrated: true, SubscriptionType: service.SubscriptionTypeSubscription, DailyLimitUSD: &limit}
	key.Group, key.GroupID = group, &group.ID
	key.Status = service.StatusAPIKeyQuotaExhausted
	past, future := time.Now().Add(-48*time.Hour), time.Now().Add(24*time.Hour)
	sub := &service.UserSubscription{ID: 33, UserID: key.UserID, GroupID: group.ID, Status: service.SubscriptionStatusActive,
		ExpiresAt: future, DailyWindowStart: &past, DailyUsageUSD: dailyUsed}
	reads, mutations := 0, 0
	repo := &stubUserSubscriptionRepo{
		getActive:      func(context.Context, int64, int64) (*service.UserSubscription, error) { reads++; return sub, nil },
		updateStatus:   func(context.Context, int64, string) error { mutations++; return nil },
		activateWindow: func(context.Context, int64, time.Time, time.Time) error { mutations++; return nil },
		resetDaily:     func(context.Context, int64, time.Time) error { mutations++; return nil },
		resetWeekly:    func(context.Context, int64, time.Time) error { mutations++; return nil },
		resetMonthly:   func(context.Context, int64, time.Time) error { mutations++; return nil },
	}
	cfg := &config.Config{RunMode: config.RunModeStandard}
	subscriptions := service.NewSubscriptionService(nil, repo, nil, nil, cfg)
	t.Cleanup(subscriptions.Stop)
	router, touches, reached := batchReplayAuthRouter(t, key, subscriptions)
	w := batchReplayAuthRequest(router, http.MethodPost, "/v1/images/batches/replay", key.Key)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	require.Equal(t, 1, reads)
	require.Zero(t, mutations)
	require.Equal(t, 1, *touches)
	require.Equal(t, 1, *reached)
}

func TestAPIKeyAuthBatchRecoveryExactResourceReadOnly(t *testing.T) {
	for _, tc := range []struct {
		method, path string
		allow        bool
	}{
		{http.MethodGet, "/v1/images/batches/root/recovery", true},
		{http.MethodGet, "/v1/images/batches/legacy.id_~-/recovery?trace=synthetic", true},
		{http.MethodGet, "/v1/images/batches/" + strings.Repeat("a", 64) + "/recovery", true},
		{http.MethodGet, "/v1/images/batches/" + strings.Repeat("a", 65) + "/recovery", false},
		{http.MethodGet, "/v1/images/batches//recovery", false},
		{http.MethodGet, "/v1/images/batches/./recovery", false},
		{http.MethodGet, "/v1/images/batches/../recovery", false},
		{http.MethodGet, "/v1/images/batches/a%2Fb/recovery", false},
		{http.MethodGet, "/v1/images/batches/a%5Cb/recovery", false},
		{http.MethodGet, "/v1/images/batches/a%252Fb/recovery", false},
		{http.MethodGet, "/v1/images/batches/root/recovery/", false},
		{http.MethodGet, "/v1/images/batches/root/recovery/child", false},
		{http.MethodGet, "/v1/images/batches/root/items/recovery", false},
		{http.MethodGet, "/images/batches/root/recovery", false},
		{http.MethodPost, "/v1/images/batches/root/recovery", false},
		{http.MethodHead, "/v1/images/batches/root/recovery", false},
		{http.MethodPut, "/v1/images/batches/root/recovery", false},
		{http.MethodDelete, "/v1/images/batches/root/recovery", false},
		{http.MethodGet, "/v1/images/batches/root", false},
		{http.MethodGet, "/v1/images/batches/root/items", false},
		{http.MethodGet, "/v1/images/batches/root/download", false},
		{http.MethodPost, "/v1/images/batches/root/cancel", false},
		{http.MethodPost, "/v1/images/batches", false},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			key := batchReplayAuthKey()
			router, touched, reached := batchReplayAuthRouter(t, key, nil)
			w := batchReplayAuthRequest(router, tc.method, tc.path, key.Key)
			if tc.allow {
				require.Equal(t, http.StatusOK, w.Code, w.Body.String())
				require.Equal(t, 1, *reached)
				require.Equal(t, 1, *touched)
			} else {
				require.Equal(t, http.StatusForbidden, w.Code, w.Body.String())
				require.Zero(t, *reached)
				require.Zero(t, *touched)
			}
		})
	}
}

func TestAPIKeyAuthBatchRecoveryPreservesAuthenticationAndGroupGuards(t *testing.T) {
	for _, scenario := range []string{"invalid key", "disabled key", "disabled user", "IP denied", "group disabled", "group deleted", "exclusive group denied"} {
		t.Run(scenario, func(t *testing.T) {
			key := batchReplayAuthKey()
			credential := key.Key
			expected, code := http.StatusUnauthorized, "INVALID_API_KEY"
			switch scenario {
			case "invalid key":
				credential = "invalid-synthetic"
			case "disabled key":
				key.Status, code = "disabled", "API_KEY_DISABLED"
			case "disabled user":
				key.User.Status, code = "disabled", "USER_INACTIVE"
			case "IP denied":
				key.IPWhitelist, expected, code = []string{"10.0.0.1"}, http.StatusForbidden, "ACCESS_DENIED"
			default:
				group := &service.Group{ID: 7, Hydrated: true, Status: service.StatusActive}
				key.Group, key.GroupID, expected = group, &group.ID, http.StatusForbidden
				switch scenario {
				case "group disabled":
					group.Status, code = "disabled", "GROUP_DISABLED"
				case "group deleted":
					key.Group, code = nil, "GROUP_DELETED"
				case "exclusive group denied":
					group.IsExclusive, code = true, "GROUP_NOT_ALLOWED"
				}
			}
			router, touched, reached := batchReplayAuthRouter(t, key, nil)
			w := batchReplayAuthRequest(router, http.MethodGet, "/v1/images/batches/root/recovery", credential)
			require.Equal(t, expected, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), code)
			require.Zero(t, *reached)
			require.Zero(t, *touched)
		})
	}
	for _, status := range []string{service.StatusAPIKeyExpired, service.StatusAPIKeyQuotaExhausted} {
		key := batchReplayAuthKey()
		key.Status = status
		router, touched, reached := batchReplayAuthRouter(t, key, nil)
		w := batchReplayAuthRequest(router, http.MethodGet, "/v1/images/batches/root/recovery", key.Key)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, 1, *reached)
		require.Equal(t, 1, *touched)
	}
}
