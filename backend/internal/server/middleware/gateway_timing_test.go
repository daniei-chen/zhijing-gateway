package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
)

func TestGatewayOutputWriterForwardsImmediatelyAndPreservesInterfaces(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	ctx := gatewaytiming.Start(context.Background())
	w := &gatewayOutputTimingWriter{ResponseWriter: c.Writer, ctx: ctx}
	_, err := w.Write([]byte("synthetic-text"))
	if err != nil || recorder.Body.String() != "synthetic-text" {
		t.Fatal("diagnostics buffered or changed the response")
	}
	_, err = w.WriteString("-tail")
	if err != nil || recorder.Body.String() != "synthetic-text-tail" {
		t.Fatal("string write changed response")
	}
	w.Flush()
	if !recorder.Flushed || w.Size() != len("synthetic-text-tail") || !w.Written() {
		t.Fatal("writer interface not preserved")
	}
	metrics := gatewaytiming.Snapshot(ctx)
	if metrics["downstream_wire_bytes"] != int64(len("synthetic-text-tail")) {
		t.Fatal("wrong byte count")
	}
	if _, ok := metrics["downstream_semantic_flush_ingress_ms"]; ok {
		t.Fatal("arbitrary bytes must not be labeled visible content")
	}
}

func TestLoggerIncludesGatewayTimingsOnlyOnInferenceRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	sink := initMiddlewareTestLogger(t)
	r := gin.New()
	r.Use(Logger())
	for _, path := range []string{"/v1/responses", "/api/v1/keys"} {
		r.POST(path, func(c *gin.Context) {
			gatewaytiming.RecordSlot(c.Request.Context(), "user", time.Now(), 3, "timeout")
			c.Status(http.StatusTooManyRequests)
		})
	}
	for _, path := range []string{"/v1/responses", "/api/v1/keys"} {
		r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, path, nil))
	}
	events := sink.list()
	if len(events) != 2 {
		t.Fatalf("events=%d, want 2", len(events))
	}
	if _, ok := events[0].Fields["gateway_timing"]; !ok {
		t.Fatal("missing gateway timing on rejected inference")
	}
	if _, ok := events[1].Fields["gateway_timing"]; ok {
		t.Fatal("unexpected instrumentation on management route")
	}
}
