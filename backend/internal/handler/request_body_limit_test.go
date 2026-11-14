package handler

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/gatewaytiming"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestRequestBodyLimitTooLarge(t *testing.T) {
	gin.SetMode(gin.TestMode)

	limit := int64(16)
	router := gin.New()
	router.Use(middleware.RequestBodyLimit(limit))
	router.POST("/test", func(c *gin.Context) {
		_, err := io.ReadAll(c.Request.Body)
		if err != nil {
			status, message := requestBodyReadFailure(nil, c.Request, err)
			c.JSON(status, gin.H{"error": message})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	payload := bytes.Repeat([]byte("a"), int(limit+1))
	req := httptest.NewRequest(http.MethodPost, "/test", bytes.NewReader(payload))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)

	require.Equal(t, http.StatusRequestEntityTooLarge, recorder.Code)
	require.Contains(t, recorder.Body.String(), buildBodyTooLargeMessage(limit))
}

func TestBodyTimingKeepsCompressedAndPrereadSemantics(t *testing.T) {
	payload := []byte("{\"model\":\"synthetic\",\"input\":\"line\nnext\"}")
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	_, err := writer.Write(payload)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(compressed.Bytes()))
	req = req.WithContext(gatewaytiming.Start(context.Background()))
	req.Header.Set("Content-Encoding", "gzip")
	gatewaytiming.ObserveBody(req)
	body, err := readLenientJSONRequestBodyWithPrealloc(req, &config.Config{})
	require.NoError(t, err)
	require.JSONEq(t, `{"model":"synthetic","input":"line\nnext"}`, string(body))
	require.Empty(t, req.Header.Get("Content-Encoding"))
	snapshot := gatewaytiming.Snapshot(req.Context())
	require.Equal(t, int64(compressed.Len()), snapshot["body_wire_bytes"])
	require.Contains(t, snapshot, "body_ready_ingress_ms")
	require.Contains(t, snapshot, "body_normalize_ms")
}

func TestHandleRequestBodyReadErrorCancellation(t *testing.T) {
	for _, tc := range []struct {
		name      string
		cancelled bool
		committed bool
		readErr   error
		handled   bool
	}{
		{name: "cancelled", cancelled: true, handled: true},
		{name: "cancelled_after_commit", cancelled: true, committed: true, handled: true},
		{name: "ordinary_read_error"},
		// An HTTP/1 read deadline also cancels the request context; the
		// timeout must reach requestBodyReadFailure (408).
		{name: "read_timeout_with_cancelled_context", cancelled: true, readErr: &net.OpError{Op: "read", Net: "tcp", Err: os.ErrDeadlineExceeded}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancelled {
				cancel()
			}
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
			if tc.committed {
				_, err := c.Writer.WriteString("already committed")
				require.NoError(t, err)
			}
			bodyBefore := recorder.Body.String()
			readErr := tc.readErr
			if readErr == nil {
				readErr = io.ErrUnexpectedEOF
			}
			require.Equal(t, tc.handled, handleRequestBodyReadError(c, nil, readErr))
			require.Equal(t, tc.handled, c.IsAborted())
			status := http.StatusOK
			if tc.handled && !tc.committed {
				status = statusClientClosedRequest
			}
			require.Equal(t, status, c.Writer.Status())
			require.Equal(t, bodyBefore, recorder.Body.String(), "cancelled clients must not receive an error body")
		})
	}
}
