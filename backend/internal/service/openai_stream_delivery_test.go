package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type semanticFlushWriter struct {
	gin.ResponseWriter
	flushed chan struct{}
	once    sync.Once
}

func (w *semanticFlushWriter) Flush() {
	w.ResponseWriter.Flush()
	w.once.Do(func() { close(w.flushed) })
}

func TestChatSemanticOutputFlushesBeforeTerminalForLargeBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, kind := range []string{"text", "tool", "reasoning"} {
		t.Run(kind, func(t *testing.T) {
			ctx := gatewaytiming.Start(context.Background())
			reader, writer := io.Pipe()
			t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			output := &semanticFlushWriter{ResponseWriter: c.Writer, flushed: make(chan struct{})}
			c.Writer = output
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(ctx)
			terminal := make(chan struct{})
			defer close(terminal)
			written := make(chan struct{})
			go func() {
				defer writer.Close()
				_, _ = io.WriteString(writer, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"synthetic\",\"model\":\"gpt-5.4\"}}\n\n")
				payload := map[string]string{
					"text":      `{"type":"response.output_text.delta","delta":"hello","output_index":0,"content_index":0}`,
					"tool":      `{"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"item-synthetic","call_id":"call-synthetic","name":"test","arguments":""}}`,
					"reasoning": `{"type":"response.reasoning_summary_text.delta","delta":"checking","output_index":0,"summary_index":0}`,
				}[kind]
				_, _ = io.WriteString(writer, "data: "+payload+"\n\n")
				close(written)
				<-terminal
				_, _ = io.WriteString(writer, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"synthetic\",\"model\":\"gpt-5.4\",\"status\":\"completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n")
			}()
			done := make(chan error, 1)
			svc := &OpenAIGatewayService{cfg: &config.Config{}}
			go func() {
				_, err := svc.handleChatStreamingResponse(&http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: reader}, c,
					&Account{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeOAuth}, "gpt-5.4", "gpt-5.4", "gpt-5.4", time.Now(), 100*1024)
				done <- err
			}()
			select {
			case <-written:
			case <-time.After(2 * time.Second):
				t.Fatal("synthetic upstream stalled")
			}
			select {
			case <-output.flushed:
			case <-time.After(2 * time.Second):
				t.Fatal("semantic output was buffered until terminal")
			}
			select {
			case <-done:
				t.Fatal("test should still be awaiting terminal usage")
			default:
			}
			// The same mutex protects both diagnostic writes and the snapshot.
			require.Eventually(t, func() bool {
				return gatewaytiming.Snapshot(ctx)["downstream_semantic_flush_kind"] == kind
			}, time.Second, time.Millisecond)
			_ = writer.Close()
			select {
			case err := <-done:
				require.Error(t, err, "fixture intentionally ended before terminal")
				require.Contains(t, recorder.Body.String(), "data:")
				require.False(t, strings.Contains(recorder.Body.String(), "response.completed"))
			case <-time.After(2 * time.Second):
				t.Fatal("stream cleanup did not finish")
			}
		})
	}
}
