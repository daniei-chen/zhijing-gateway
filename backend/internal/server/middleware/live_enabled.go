package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// LiveEnabledGuard 是 Live 会话的部署级开关闸门。enabled 为 false 时请求在
// handler 之前终止：不解析请求体、不取并发槽位（lease）、不建立上游会话。
//
// 必须挂在每一条 Live / LiveSideband 路由的最前面。关闭是升级后的默认状态：
// Live 尚未接入计费管道，开着等于把不计费的上游成本暴露给任何持有 Key 的人。
//
// 关闭时返回 404 而不是 403：这是"本部署没有这个能力"，与分组未开通 Live 的
// 403 permission_error 区分开，也不向未授权客户端透露部署配置。
func LiveEnabledGuard(enabled bool) gin.HandlerFunc {
	if enabled {
		return func(c *gin.Context) {
			c.Next()
		}
	}
	return func(c *gin.Context) {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{
			"error": gin.H{
				"type":    "not_found_error",
				"message": "Live is not enabled",
			},
		})
	}
}
