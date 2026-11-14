package middleware

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ctxkey"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/gatewaytiming"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestLoggerPublishesScopedTimingWithBillingAndErrorAliases(t *testing.T) {
	gin.SetMode(gin.TestMode)
	initMiddlewareTestLogger(t)
	r := gin.New()
	r.Use(Logger())
	r.POST("/v1/responses", func(c *gin.Context) {
		c.Set(string(ContextKeyAPIKey), &service.APIKey{ID: 990201, UserID: 990101})
		ctx := context.WithValue(c.Request.Context(), ctxkey.RequestID, "synthetic-history-local")
		ctx = context.WithValue(ctx, ctxkey.ClientRequestID, "synthetic-history-client")
		c.Request = c.Request.WithContext(ctx)
		_, _ = io.ReadAll(c.Request.Body)
		gatewaytiming.MarkIngressStage(ctx, "body_ready")
		c.JSON(200, gin.H{"ok": true})
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader("synthetic body")))
	require.Equal(t, 200, rec.Code)
	scope := gatewaytiming.Scope{UserID: 990101, APIKeyID: 990201}
	for _, id := range []string{"synthetic-history-local", "client:synthetic-history-client"} {
		record := gatewaytiming.Recent.Lookup(scope, id, time.Now())
		require.NotNil(t, record)
		require.EqualValues(t, len("synthetic body"), record.Metrics["body_wire_bytes"])
		require.Equal(t, "complete", record.BodyReadResult)
		require.NotContains(t, record.Metrics, "user_wait_ms")
	}
}

func TestTimingHistoryDoesNotPublishUnauthenticatedOrWebSocketLifetime(t *testing.T) {
	gin.SetMode(gin.TestMode)
	initMiddlewareTestLogger(t)
	r := gin.New()
	r.Use(Logger())
	for _, method := range []string{"POST", "GET"} {
		r.Handle(method, "/v1/responses", func(c *gin.Context) {
			ctx := context.WithValue(c.Request.Context(), ctxkey.RequestID, "synthetic-no-history")
			c.Request = c.Request.WithContext(ctx)
			if c.Request.Method == "GET" {
				c.Set(string(ContextKeyAPIKey), &service.APIKey{ID: 990202, UserID: 990102})
			}
			gatewaytiming.MarkIngressStage(ctx, "body_ready")
			c.Status(200)
		})
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(method, "/v1/responses", nil))
	}
	require.Nil(t, gatewaytiming.Recent.Lookup(gatewaytiming.Scope{UserID: 990102, APIKeyID: 990202}, "synthetic-no-history", time.Now()))
}
