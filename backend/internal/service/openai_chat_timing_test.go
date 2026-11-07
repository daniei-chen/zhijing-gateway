package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestChatTimingSeparatesFirstEventFromTextWithoutChangingOutput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := gatewaytiming.Start(context.Background())
	reader, writer := io.Pipe()
	t.Cleanup(func() { _ = reader.Close(); _ = writer.Close() })
	go func() {
		defer writer.Close()
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"synthetic\",\"model\":\"gpt-5.4\",\"status\":\"in_progress\"}}\n\n")
		time.Sleep(40 * time.Millisecond)
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\",\"output_index\":0,\"content_index\":0}\n\n")
		_, _ = io.WriteString(writer, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"synthetic\",\"model\":\"gpt-5.4\",\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n\n")
	}()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := []byte(`{"model":"gpt-5.4","messages":[{"role":"user","content":"hello"}],"stream":true}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body)).WithContext(ctx)
	upstream := &httpUpstreamRecorder{resp: &http.Response{StatusCode: 200, ProtoMajor: 2, Header: http.Header{"Content-Type": []string{"text/event-stream"}}, Body: reader}}
	svc := &OpenAIGatewayService{httpUpstream: upstream}
	account := &Account{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeOAuth, Concurrency: 8, Credentials: map[string]any{"access_token": "synthetic", "chatgpt_account_id": "synthetic"}}
	result, err := svc.ForwardAsChatCompletions(ctx, c, account, body, "", "gpt-5.4")
	require.NoError(t, err)
	require.Equal(t, 1, result.Usage.OutputTokens)
	require.True(t, strings.Contains(recorder.Body.String(), "hello"))
	require.Contains(t, recorder.Body.String(), "[DONE]")
	metrics := gatewaytiming.Snapshot(ctx)
	require.Greater(t, metrics["chat_first_text_event_ingress_ms"].(int64), metrics["chat_first_event_ingress_ms"].(int64))
	require.Equal(t, int64(1), metrics["upstream_attempts"])
	require.Equal(t, int64(1), metrics["http2_responses"])
	_, exists := c.Get(OpsUpstreamLatencyMsKey)
	require.True(t, exists)
}
