package middleware

import (
	"context"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/gin-gonic/gin"
)

// Forward every write immediately. Never parse, copy or retain response content.
type gatewayOutputTimingWriter struct {
	gin.ResponseWriter
	ctx context.Context
}

func (w *gatewayOutputTimingWriter) Write(data []byte) (int, error) {
	started := time.Now()
	n, err := w.ResponseWriter.Write(data)
	gatewaytiming.RecordDownstreamWrite(w.ctx, started, n, err)
	return n, err
}

func (w *gatewayOutputTimingWriter) WriteString(data string) (int, error) {
	started := time.Now()
	n, err := w.ResponseWriter.WriteString(data)
	gatewaytiming.RecordDownstreamWrite(w.ctx, started, n, err)
	return n, err
}

func (w *gatewayOutputTimingWriter) Flush() {
	started := time.Now()
	w.ResponseWriter.Flush()
	gatewaytiming.RecordDownstreamFlush(w.ctx, started)
}
