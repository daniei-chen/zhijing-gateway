package handler

import (
	"fmt"
	"net/http"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	pkghttputil "github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// handleRequestBodyReadError handles cancellation and temporary capacity errors
// before callers classify malformed or oversized request bodies.
//
// A read deadline on HTTP/1 also cancels the request context, so a body read
// timeout is left to requestBodyReadFailure (408) instead of being reported as
// a client that went away (499).
func handleRequestBodyReadError(c *gin.Context, reqLog *zap.Logger, err error) bool {
	if err != nil && !pkghttputil.IsRequestBodyReadTimeout(err) && failoverClientGone(c) {
		logRequestBodyReadFailure(reqLog, pkghttputil.DescribeRequestBodyReadFailure(c.Request, err))
		c.Abort()
		return true
	}
	return middleware2.RejectRequestBodyMemoryOverload(c, err)
}

func formatBodyLimit(limit int64) string {
	const mb = 1024 * 1024
	if limit >= mb {
		return fmt.Sprintf("%dMB", limit/mb)
	}
	return fmt.Sprintf("%dB", limit)
}

func buildBodyTooLargeMessage(limit int64) string {
	return fmt.Sprintf("Request body too large, limit is %s", formatBodyLimit(limit))
}

// readLenientJSONRequestBodyWithPrealloc keeps the local call-site name but
// delegates read+normalize to the upstream budget-aware helper. Upstream releases
// the raw buffer once the normalized copy is charged, so one request no longer
// reserves body memory twice (which would trip the 503 budget earlier than
// necessary). The split body_ready / normalize timings cannot be observed
// separately through the combined helper, so body_normalize_ms now covers
// read+normalize and body_ready is marked at the combined boundary.
func readLenientJSONRequestBodyWithPrealloc(req *http.Request, cfg *config.Config) ([]byte, error) {
	if req == nil {
		return nil, nil
	}
	started := time.Now()
	body, err := pkghttputil.ReadLenientJSONRequestBodyWithPrealloc(req, gatewayMaxBodySize(cfg))
	if err != nil {
		return nil, err
	}
	ctx := req.Context()
	gatewaytiming.MarkIngressStage(ctx, "body_ready")
	gatewaytiming.RecordBodyNormalization(ctx, started)
	return body, nil
}

func gatewayMaxBodySize(cfg *config.Config) int64 {
	if cfg == nil {
		return 0
	}
	return cfg.Gateway.MaxBodySize
}
