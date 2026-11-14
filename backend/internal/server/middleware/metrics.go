package middleware

import (
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/metrics"
	"github.com/gin-gonic/gin"
)

// Metrics 记录每个响应的状态码分类，供 /metrics 抓取。
//
// 放在中间件链最外层：它只做两次 atomic 加法（纳秒级），不应该被任何后续
// 中间件短路掉——被 CORS 或鉴权提前拒绝的请求同样值得计数。
func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
		status := 0
		if c.Writer != nil {
			status = c.Writer.Status()
		}
		metrics.ObserveRequest(status)
	}
}
