package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/adminaccess"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type balanceReplayAdminStub struct {
	service.AdminService
	writes atomic.Int32
}

func (s *balanceReplayAdminStub) UpdateUserBalance(_ context.Context, id int64, _ float64, _, _ string) (*service.User, error) {
	s.writes.Add(1)
	return &service.User{ID: id, Email: "synthetic-member@example.test", Role: "user", Status: "active", Balance: 98.75, Notes: "synthetic private note"}, nil
}

func TestUserBalanceReplayConfirmsOriginalWithoutRepeatingExpiredWrite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := newMemoryIdempotencyRepoStub()
	service.SetDefaultIdempotencyCoordinator(service.NewIdempotencyCoordinator(repo, service.DefaultIdempotencyConfig()))
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	svc := &balanceReplayAdminStub{}
	h := NewUserHandler(svc, nil, nil, nil, nil, nil, nil)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		actor, _ := strconv.ParseInt(c.GetHeader("X-Synthetic-Actor"), 10, 64)
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: actor})
		if c.GetHeader("X-Synthetic-Scoped") == "1" {
			c.Request = c.Request.WithContext(adminaccess.WithPrincipal(c.Request.Context(), &adminaccess.Principal{}))
		}
		c.Next()
	})
	r.POST("/api/v1/admin/users/:id/balance", h.UpdateBalance)
	r.POST("/api/v1/admin/users/:id/balance/replay", h.ReplayBalanceUpdate)
	body := `{"balance":1.25,"operation":"subtract","notes":"synthetic"}`
	request := func(path, payload, actor, key string, scoped bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		req.Header.Set("X-Synthetic-Actor", actor)
		if scoped {
			req.Header.Set("X-Synthetic-Scoped", "1")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	const original = "/api/v1/admin/users/41/balance"
	const key = "synthetic-balance-operation"
	w := request(original, body, "7", key, false)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, int32(1), svc.writes.Load())
	w = request(original+"/replay", body, "7", key, false)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "true", w.Header().Get("X-Idempotency-Replayed"))
	require.Contains(t, w.Body.String(), "98.75")
	require.Equal(t, int32(1), svc.writes.Load())
	w = request(original+"/replay", body, "7", key, true)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.JSONEq(t, `{"code":0,"message":"success","data":{"id":41}}`, w.Body.String())
	for _, tc := range []struct{ path, payload, actor string }{
		{original + "/replay", body, "8"},
		{"/api/v1/admin/users/42/balance/replay", body, "7"},
		{original + "/replay", `{"balance":2.5,"operation":"subtract","notes":"synthetic"}`, "7"},
	} {
		w = request(tc.path, tc.payload, tc.actor, key, false)
		require.Equal(t, 409, w.Code, w.Body.String())
		require.Contains(t, w.Body.String(), "IDEMPOTENCY_KEY_CONFLICT")
	}
	repo.mu.Lock()
	for _, record := range repo.data {
		record.ExpiresAt = time.Now().Add(-time.Minute)
	}
	repo.mu.Unlock()
	w = request(original+"/replay", body, "7", key, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "IDEMPOTENCY_RESULT_UNCONFIRMED")
	repo.mu.Lock()
	clear(repo.data)
	repo.mu.Unlock()
	w = request(original+"/replay", body, "7", key, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	w = request(original+"/replay", body, "7", "", false)
	require.Equal(t, 400, w.Code, w.Body.String())
	w = request(original+"/replay", `{}`, "7", key, false)
	require.Equal(t, 400, w.Code, w.Body.String())
	require.Equal(t, int32(1), svc.writes.Load(), "replay must never invoke the business balance write")
	require.Empty(t, repo.data)
}

func TestUserBalanceReplayPermissionIsIndependentFromUserAndBalanceReads(t *testing.T) {
	path := "/api/v1/admin/users/:id/balance/replay"
	require.True(t, adminaccess.RouteAllowed(adminaccess.Policy{GlobalPermissions: []string{"users.balance.write"}}, "POST", path))
	for _, policy := range []adminaccess.Policy{{}, {GlobalPermissions: []string{"users.read"}}, {GlobalPermissions: []string{"users.balance.read"}}} {
		require.False(t, adminaccess.RouteAllowed(policy, "POST", path))
	}
	require.False(t, adminaccess.RouteAllowed(adminaccess.Policy{GlobalPermissions: []string{"users.balance.write"}}, "GET", path))
}
