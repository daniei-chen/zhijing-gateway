package service_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	adminhandler "github.com/Wei-Shaw/sub2api/internal/handler/admin"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type timingHTTPRepo struct {
	service.OpsRepository
	rows []*service.OpsRequestDetail
}

func (r *timingHTTPRepo) ListRequestDetails(context.Context, *service.OpsRequestDetailFilter) ([]*service.OpsRequestDetail, int64, error) {
	return r.rows, int64(len(r.rows)), nil
}

// Real logger, collector, ops service, HTTP handler and response envelope;
// synthetic identity/data replace auth/storage/provider dependencies here.
func TestOpsTimingHTTPRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &timingHTTPRepo{}
	ops := service.NewOpsService(repo, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil)
	router := gin.New()
	router.Use(middleware.Logger())
	user, key := int64(991101), int64(991201)
	router.POST("/v1/responses", func(c *gin.Context) {
		c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{ID: key, UserID: user})
		ctx := context.WithValue(c.Request.Context(), ctxkey.RequestID, "synthetic-http-timing")
		c.Request = c.Request.WithContext(ctx)
		_, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		gatewaytiming.MarkIngressStage(ctx, "body_ready")
		gatewaytiming.RecordSlot(ctx, "user", time.Now(), 1, "acquired")
		first, duration := 23, 90
		repo.rows = []*service.OpsRequestDetail{{Kind: service.OpsRequestKindSuccess,
			CreatedAt: time.Now(), RequestID: "local:synthetic-http-timing", UserID: &user, APIKeyID: &key,
			FirstTokenMs: &first, DurationMs: &duration}}
		c.JSON(200, gin.H{"synthetic": true})
	})
	router.GET("/api/v1/admin/ops/requests", adminhandler.NewOpsHandler(ops).ListRequestDetails)
	forward := httptest.NewRecorder()
	router.ServeHTTP(forward, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("synthetic context")))
	require.Equal(t, 200, forward.Code)
	details := httptest.NewRecorder()
	router.ServeHTTP(details, httptest.NewRequest(http.MethodGet, "/api/v1/admin/ops/requests?kind=all", nil))
	require.Equal(t, 200, details.Code)
	var result struct {
		Code int
		Data service.OpsRequestDetailList
	}
	require.NoError(t, json.Unmarshal(details.Body.Bytes(), &result))
	require.Zero(t, result.Code)
	require.Len(t, result.Data.Items, 1)
	row := result.Data.Items[0]
	require.Equal(t, 23, *row.FirstTokenMs)
	require.Equal(t, 90, *row.DurationMs)
	require.NotNil(t, row.GatewayTiming)
	require.EqualValues(t, len("synthetic context"), row.GatewayTiming.Metrics["body_wire_bytes"])
	require.Contains(t, row.GatewayTiming.Metrics, "user_wait_ms")
	require.NotContains(t, row.GatewayTiming.Metrics, "account_wait_ms")
	require.NotContains(t, details.Body.String(), "synthetic context")
}
