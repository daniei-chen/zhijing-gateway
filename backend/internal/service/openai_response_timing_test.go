package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestResponsesOutputKindDoesNotCountPreambleOrEmptyContent(t *testing.T) {
	for _, tc := range []struct{ data, kind string }{
		{`{"type":"response.created"}`, ""},
		{`{"type":"response.output_item.added","item":{"type":"reasoning","summary":[]}}`, ""},
		{`{"type":"response.output_text.delta","delta":""}`, ""},
		{`{"type":"response.output_text.delta","delta":"fixture"}`, "text"},
		{`{"type":"response.function_call_arguments.delta","delta":"{"}`, "tool"},
		{`{"type":"response.reasoning_summary_text.delta","delta":"fixture"}`, "reasoning"},
		{`{"type":"response.failed","response":{"error":{"message":"fixture"}}}`, ""},
		{`{"type":"response.output_item.done","item":{"type":"function_call","arguments":"{}"}}`, "tool"},
		{`{"type":"response.output_item.done","item":{"type":"reasoning","summary":[{"text":"fixture"}]}}`, "reasoning"},
	} {
		require.Equal(t, tc.kind, openAIResponseOutputKind(tc.data, ""), tc.data)
	}
}

type semanticFlushRecorder struct {
	*httptest.ResponseRecorder
	semantic chan struct{}
	signaled bool
}

func (w *semanticFlushRecorder) Flush() {
	w.ResponseRecorder.Flush()
	if !w.signaled && strings.Contains(w.Body.String(), `"delta":"fixture"`) {
		w.signaled = true
		close(w.semantic)
	}
}

func TestResponsesUsefulOutputFlushesWhileUpstreamStillOpen(t *testing.T) {
	for _, passthrough := range []bool{false, true} {
		name := "forward"
		if passthrough {
			name = "passthrough"
		}
		t.Run(name, func(t *testing.T) {
			ctx := gatewaytiming.Start(context.Background())
			reader, writer := io.Pipe()
			defer func() { _ = reader.Close() }()
			release := make(chan struct{})
			defer close(release)
			writerDone := make(chan struct{})
			go func() {
				defer close(writerDone)
				defer func() { _ = writer.Close() }()
				_, _ = io.WriteString(writer, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"fixture\"}}\n\n")
				_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\n")
				<-release
			}()
			recorder := &semanticFlushRecorder{ResponseRecorder: httptest.NewRecorder(), semantic: make(chan struct{})}
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("POST", "/v1/responses", nil).WithContext(ctx)
			resp := &http.Response{StatusCode: 200, Header: http.Header{}, Body: reader}
			account := &Account{ID: 1, Platform: PlatformOpenAI}
			svc := &OpenAIGatewayService{cfg: &config.Config{Gateway: config.GatewayConfig{MaxLineSize: defaultMaxLineSize}}}
			done := make(chan struct{})
			go func() {
				defer close(done)
				if passthrough {
					_, _ = svc.handleStreamingResponsePassthrough(ctx, resp, c, account, time.Now(), "fixture", "fixture")
				} else {
					_, _ = svc.handleStreamingResponse(ctx, resp, c, account, time.Now(), "fixture", "fixture")
				}
			}()
			select {
			case <-recorder.semantic:
			case <-time.After(2 * time.Second):
				t.Fatal("useful event buffered until upstream EOF")
			}
			deadline := time.Now().Add(time.Second)
			var timing map[string]any
			for time.Now().Before(deadline) {
				timing = gatewaytiming.Snapshot(ctx)
				if timing["downstream_semantic_flush_ingress_ms"] != nil {
					break
				}
				time.Sleep(time.Millisecond)
			}
			require.Equal(t, "text", timing["upstream_semantic_kind"])
			require.Equal(t, "text", timing["downstream_semantic_flush_kind"])
			require.LessOrEqual(t, timing["upstream_first_event_ingress_ms"], timing["upstream_semantic_ingress_ms"])
			require.LessOrEqual(t, timing["upstream_semantic_ingress_ms"], timing["downstream_semantic_flush_ingress_ms"])
			require.NoError(t, writer.Close())
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Fatal("stream failed to exit")
			}
		})
	}
}
