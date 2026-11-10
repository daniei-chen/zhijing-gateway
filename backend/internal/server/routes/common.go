package routes

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RegisterCommonRoutes 注册通用路由（健康检查、状态等）。
//
// redisClient 可为 nil（届时 /readyz 只报告未配置，不判失败）。
func RegisterCommonRoutes(r *gin.Engine, redisClient *redis.Client) {
	// 浅存活探针：只证明进程能响应 HTTP，不查依赖。
	// 注意：它无法区分 "full-role 正常" 与 "全部实例都是 API-only"，
	// 也不能发现 DB/Redis 故障，因此不能作为唯一判据（见审计 2026-11-09 后台停摆）。
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// 深度就绪探针：检查依赖可用性。
	// 必须显式注册，否则会落到 SPA catch-all 返回 200 + HTML，
	// 使任何外部监控探这些路径都"永远成功"——这个假象比没有探针更危险。
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		checks := gin.H{}
		ready := true

		if redisClient == nil {
			checks["redis"] = "not_configured"
		} else if err := redisClient.Ping(ctx).Err(); err != nil {
			checks["redis"] = "error"
			checks["redis_error"] = err.Error()
			ready = false
		} else {
			checks["redis"] = "ok"
		}

		// DB 探针未接入本函数（需要注入 *sql.DB）；显式标注而不是假装 ok。
		checks["database"] = "not_probed"

		if ready {
			c.JSON(http.StatusOK, gin.H{"status": "ready", "checks": checks})
			return
		}
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "not_ready", "checks": checks})
	})

	// Claude Code 遥测日志（忽略，直接返回200）
	r.POST("/api/event_logging/batch", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// Setup status endpoint (always returns needs_setup: false in normal mode)
	// This is used by the frontend to detect when the service has restarted after setup
	r.GET("/setup/status", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"needs_setup": false,
				"step":        "completed",
			},
		})
	})
}
