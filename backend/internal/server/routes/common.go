package routes

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// RegisterCommonRoutes 注册通用路由（健康检查、状态等）。
//
// redisClient 可为 nil（届时 /readyz 只报告未配置，不判失败）。
// businessCheck 只在 /readyz?deep=1 时调用，用于回答「有没有账号可用」；
// 为 nil 时深度探针报告 not_configured 而不是判失败。
func RegisterCommonRoutes(r *gin.Engine, redisClient *redis.Client, dbCheck func(context.Context) error, businessCheck func(context.Context) (map[string]any, error)) {
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

		// DB 探针（2026-11-12 第 3 轮审计 P0-4）：原实现写死 not_probed，
		// 导致 DB 挂掉时 /readyz 仍报 ready。现由调用方注入真实查库回调。
		if dbCheck == nil {
			checks["database"] = "not_configured"
		} else if err := dbCheck(ctx); err != nil {
			checks["database"] = "error"
			checks["database_error"] = err.Error()
			ready = false
		} else {
			checks["database"] = "ok"
		}

		// 业务就绪（2026-11-15 第 8 轮）：只在 ?deep=1 时执行。
		//
		// 默认探针只能证明「进程 + 依赖活着」。2026-11-14 19:10 那次事故里，
		// /readyz 全绿、账号 active、5xx 还是 0，但用户请求全部 503——因为 key 指向
		// 已删除的分组，调度池为空。深度探针让部署脚本能在切流量之前先问一句
		// 「你真有账号可用吗」，而不是等用户把 503 打出来。
		//
		// 刻意不默认启用：它每次都要查一次账号表，而且「没有账号」对某些只做
		// 管理面/支付用途的部署并不算故障。
		if deepReadinessRequested(c) {
			if businessCheck == nil {
				checks["business"] = "not_configured"
			} else if detail, err := businessCheck(ctx); err != nil {
				checks["business"] = "error"
				checks["business_error"] = err.Error()
				for k, v := range detail {
					checks[k] = v
				}
				ready = false
			} else {
				checks["business"] = "ok"
				for k, v := range detail {
					checks[k] = v
				}
			}
		}

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

// deepReadinessRequested 识别 ?deep=1 / ?deep=true / ?deep=yes（大小写与空白不敏感）。
// 任何其他取值（包括空）都视为浅探针，保持 /readyz 的既有语义。
func deepReadinessRequested(c *gin.Context) bool {
	if c == nil {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(c.Query("deep"))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}
