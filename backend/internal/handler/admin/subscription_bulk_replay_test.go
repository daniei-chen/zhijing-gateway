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

func TestSubscriptionBulkReplayReturnsTheSavedPartialBatchWithoutRetryingItems(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := newMemoryIdempotencyRepoStub()
	coordinator := service.NewIdempotencyCoordinator(repo, service.DefaultIdempotencyConfig())
	service.SetDefaultIdempotencyCoordinator(coordinator)
	t.Cleanup(func() { service.SetDefaultIdempotencyCoordinator(nil) })
	req := service.BulkSubscriptionActionInput{SubscriptionIDs: []int64{41, 42}, Action: "extend", Days: 7}
	writes := 0
	_, err := coordinator.Execute(context.Background(), service.IdempotencyExecuteOptions{
		Scope: "admin.subscriptions.bulk-action", ActorScope: "admin:7", Method: "POST",
		Route: "/api/v1/admin/subscriptions/bulk-action", IdempotencyKey: "synthetic-bulk-key", Payload: req,
	}, func(context.Context) (any, error) {
		writes++
		return service.BulkSubscriptionActionResult{SuccessCount: 1, FailedCount: 1,
			Results: []service.BulkSubscriptionActionItemResult{{SubscriptionID: 41, Success: true}, {SubscriptionID: 42, Success: false, Error: "synthetic item failed"}}}, nil
	})
	require.NoError(t, err)
	h := &SubscriptionHandler{} // No subscription service exists to execute a batch.
	r := gin.New()
	r.Use(func(c *gin.Context) {
		actor := int64(7)
		if c.GetHeader("X-Synthetic-Other-Actor") == "1" {
			actor = 8
		}
		c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: actor})
		c.Next()
	})
	r.POST("/api/v1/admin/subscriptions/bulk-action/replay", h.ReplayBulkAction)
	request := func(body string, other bool) *httptest.ResponseRecorder {
		raw := httptest.NewRequest(http.MethodPost, "/api/v1/admin/subscriptions/bulk-action/replay", strings.NewReader(body))
		raw.Header.Set("Content-Type", "application/json")
		raw.Header.Set("Idempotency-Key", "synthetic-bulk-key")
		if other {
			raw.Header.Set("X-Synthetic-Other-Actor", "1")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, raw)
		return w
	}
	const body = `{"subscription_ids":[41,42],"action":"extend","days":7}`
	w := request(body, false)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "true", w.Header().Get("X-Idempotency-Replayed"))
	require.JSONEq(t, `{"code":0,"message":"success","data":{"success_count":1,"failed_count":1,"results":[{"subscription_id":41,"success":true},{"subscription_id":42,"success":false,"error":"synthetic item failed"}]}}`, w.Body.String())
	w = request(body, true)
	require.Equal(t, 409, w.Code, w.Body.String())
	for _, changed := range []string{
		`{"subscription_ids":[41,42],"action":"extend","days":8}`,
		`{"subscription_ids":[41],"action":"extend","days":7}`,
		`{"subscription_ids":[41,42],"action":"revoke"}`,
	} {
		w = request(changed, false)
		require.Equal(t, 409, w.Code, w.Body.String())
	}
	repo.mu.Lock()
	for _, record := range repo.data {
		record.ExpiresAt = time.Now().Add(-time.Minute)
	}
	repo.mu.Unlock()
	w = request(body, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	require.Contains(t, w.Body.String(), "IDEMPOTENCY_RESULT_UNCONFIRMED")
	repo.mu.Lock()
	clear(repo.data)
	repo.mu.Unlock()
	w = request(body, false)
	require.Equal(t, 409, w.Code, w.Body.String())
	w = request(`{"subscription_ids":[41],"action":"extend","days":0}`, false)
	require.Equal(t, 400, w.Code, w.Body.String())
	require.Equal(t, 1, writes)
	require.Empty(t, repo.data)
}

func TestSubscriptionBulkReplayKeepsScopedKeyDefaultDeny(t *testing.T) {
	// The existing bulk write does not grant scoped-key access by any of the
	// single-item permissions. The read-only route must not widen that policy.
	policy := adminaccess.Policy{GlobalPermissions: []string{"subscriptions.read", "subscriptions.assign", "subscriptions.extend", "subscriptions.revoke", "subscriptions.restore", "subscriptions.reset"}}
	require.False(t, adminaccess.RouteAllowed(policy, "POST", "/api/v1/admin/subscriptions/bulk-action"))
	require.False(t, adminaccess.RouteAllowed(policy, "POST", "/api/v1/admin/subscriptions/bulk-action/replay"))
}
