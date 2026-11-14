package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/adminaccess"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionExtendReplayReadsOriginalAdjustmentWithoutBusinessService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := newMemoryIdempotencyRepoStub()
	coordinator := service.NewIdempotencyCoordinator(repo, service.DefaultIdempotencyConfig())
	service.SetDefaultIdempotencyCoordinator(coordinator)
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	payload := struct {
		SubscriptionID int64                     `json:"subscription_id"`
		Body           AdjustSubscriptionRequest `json:"body"`
	}{SubscriptionID: 41, Body: AdjustSubscriptionRequest{Days: 3}}
	writes := 0
	_, err := coordinator.Execute(context.Background(), service.IdempotencyExecuteOptions{
		Scope: "admin.subscriptions.extend", ActorScope: "admin:7", Method: "POST",
		Route: "/api/v1/admin/subscriptions/:id/extend", IdempotencyKey: "synthetic-adjust-key", Payload: payload,
	}, func(context.Context) (any, error) {
		writes++
		return gin.H{"id": 41, "expires_at": "2026-12-01T00:00:00Z", "notes": "synthetic note", "user": gin.H{"email": "synthetic@example.test"}}, nil
	})
	require.NoError(t, err)
	h := &SubscriptionHandler{} // There is no business service to accidentally invoke.
	r := gin.New()
	r.Use(func(c *gin.Context) {
		actor := int64(7)
		if c.GetHeader("X-Synthetic-Other-Actor") == "1" {
			actor = 8
		}
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: actor})
		if c.GetHeader("X-Synthetic-Scoped") == "1" {
			c.Request = c.Request.WithContext(adminaccess.WithPrincipal(c.Request.Context(), &adminaccess.Principal{Policy: adminaccess.Policy{GlobalPermissions: []string{"subscriptions.extend"}}}))
		}
		c.Next()
	})
	r.POST("/api/v1/admin/subscriptions/:id/extend/replay", h.ReplayExtend)
	request := func(path, body string, other, scoped bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "synthetic-adjust-key")
		if other {
			req.Header.Set("X-Synthetic-Other-Actor", "1")
		}
		if scoped {
			req.Header.Set("X-Synthetic-Scoped", "1")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	const path = "/api/v1/admin/subscriptions/41/extend/replay"
	w := request(path, `{"days":3}`, false, false)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "true", w.Header().Get("X-Idempotency-Replayed"))
	require.Contains(t, w.Body.String(), "2026-12-01")
	w = request(path, `{"days":3}`, false, true)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.JSONEq(t, `{"code":0,"message":"success","data":{"id":41}}`, w.Body.String())
	for _, tc := range []struct {
		path, body string
		other      bool
	}{
		{path, `{"days":3}`, true},
		{path, `{"days":4}`, false},
		{"/api/v1/admin/subscriptions/42/extend/replay", `{"days":3}`, false},
	} {
		w = request(tc.path, tc.body, tc.other, false)
		require.Equal(t, 409, w.Code, w.Body.String())
		require.Contains(t, w.Body.String(), "IDEMPOTENCY_KEY_CONFLICT")
	}
	repo.mu.Lock()
	for _, record := range repo.data {
		record.ExpiresAt = time.Now().Add(-time.Minute)
	}
	repo.mu.Unlock()
	w = request(path, `{"days":3}`, false, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "IDEMPOTENCY_RESULT_UNCONFIRMED")
	repo.mu.Lock()
	clear(repo.data)
	repo.mu.Unlock()
	w = request(path, `{"days":3}`, false, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	for _, body := range []string{`{}`, `{"days":0}`, `{"days":36501}`} {
		w = request(path, body, false, false)
		require.Equal(t, 400, w.Code, w.Body.String())
	}
	require.Equal(t, 1, writes)
	require.Empty(t, repo.data)
}

func TestSubscriptionExtendReplayRequiresExactAdjustmentPermission(t *testing.T) {
	path := "/api/v1/admin/subscriptions/:id/extend/replay"
	require.True(t, adminaccess.RouteAllowed(adminaccess.Policy{GlobalPermissions: []string{"subscriptions.extend"}}, "POST", path))
	for _, permission := range []string{"subscriptions.read", "users.read", "subscriptions.assign", "users.balance.write"} {
		require.False(t, adminaccess.RouteAllowed(adminaccess.Policy{GlobalPermissions: []string{permission}}, "POST", path))
	}
	require.False(t, adminaccess.RouteAllowed(adminaccess.Policy{GlobalPermissions: []string{"subscriptions.extend"}}, "GET", path))
}
