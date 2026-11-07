package middleware

import (
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ip"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// Logger 请求日志中间件
func Logger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 开始时间
		startTime := time.Now()

		// 请求路径
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/v1/") || strings.HasPrefix(path, "/backend-api/codex/") || strings.HasPrefix(path, "/responses") || strings.HasPrefix(path, "/openai/") {
			c.Request = c.Request.WithContext(gatewaytiming.Start(c.Request.Context()))
			gatewaytiming.ObserveBody(c.Request)
			c.Writer = &gatewayOutputTimingWriter{ResponseWriter: c.Writer, ctx: c.Request.Context()}
		}

		// 处理请求
		c.Next()

		// 跳过健康检查等高频探针路径的日志
		if path == "/health" || path == "/setup/status" {
			return
		}

		endTime := time.Now()
		latency := endTime.Sub(startTime)

		method := c.Request.Method
		statusCode := c.Writer.Status()
		clientIP := ip.GetClientIP(c)
		protocol := c.Request.Proto
		accountID, hasAccountID := c.Request.Context().Value(ctxkey.AccountID).(int64)
		platform, _ := c.Request.Context().Value(ctxkey.Platform).(string)
		model, _ := c.Request.Context().Value(ctxkey.Model).(string)
		reason, rejected := GetIngressRejectReason(c)
		if rejected {
			recordIngressReject(c, reason)
			allowed, droppedSummary := globalIngressRejectAccessSampler.allow(endTime)
			if droppedSummary > 0 {
				logger.FromContext(c.Request.Context()).Info("ingress rejection access logs dropped",
					zap.String("component", "http.access"),
					zap.Uint64("dropped_count", droppedSummary),
					zap.Bool(logger.OpsSystemLogSkipField, true),
				)
			}
			if !allowed {
				return
			}
		}

		fields := []zap.Field{
			zap.String("component", "http.access"),
			zap.Int("status_code", statusCode),
			zap.Int64("latency_ms", latency.Milliseconds()),
			zap.String("client_ip", clientIP),
			zap.String("protocol", protocol),
			zap.String("method", method),
			zap.String("path", path),
		}
		if rejected {
			fields = append(fields,
				zap.String("ingress_reject_reason", string(reason)),
				zap.Bool(logger.OpsSystemLogSkipField, true),
			)
		}
		if hasAccountID && accountID > 0 {
			fields = append(fields, zap.Int64("account_id", accountID))
		}
		if platform != "" {
			fields = append(fields, zap.String("platform", platform))
		}
		if model != "" {
			fields = append(fields, zap.String("model", model))
		}

		if timings := gatewaytiming.Snapshot(c.Request.Context()); len(timings) > 0 {
			fields = append(fields, zap.Any("gateway_timing", timings))
			publishGatewayTiming(c, timings)
		}
		l := logger.FromContext(c.Request.Context()).With(fields...)
		l.Info("http request completed", zap.Time("completed_at", endTime))

		if len(c.Errors) > 0 {
			l.Warn("http request contains gin errors", zap.String("errors", c.Errors.String()))
		}
	}
}

func publishGatewayTiming(c *gin.Context, timings map[string]any) {
	if c.Request.Method != "POST" {
		return // WebSocket connection lifetime is not an individual inference request.
	}
	apiKey, ok := GetAPIKeyFromContext(c)
	if !ok || apiKey == nil {
		return
	}
	requestID, _ := c.Request.Context().Value(ctxkey.RequestID).(string)
	clientID, _ := c.Request.Context().Value(ctxkey.ClientRequestID).(string)
	billingID := ""
	if clientID = strings.TrimSpace(clientID); clientID != "" {
		billingID = "client:" + clientID
	} else if requestID = strings.TrimSpace(requestID); requestID != "" {
		billingID = "local:" + requestID
	}
	gatewaytiming.Recent.Publish(gatewaytiming.Scope{UserID: apiKey.UserID, APIKeyID: apiKey.ID}, []string{requestID, billingID}, timings)
}
