package routes

import (
	"github.com/daniei-chen/zhijing-gateway/internal/handler"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/gin-gonic/gin"
)

// 管理密钥生命周期只接受管理员会话；写操作沿用二次验证。
func registerScopedAdminKeyRoutes(settings *gin.RouterGroup, h *handler.Handlers, forcedStepUp middleware.ForcedStepUpAuthMiddleware) {
	keys := settings.Group("/admin-api-keys")
	keys.GET("", h.Admin.Setting.ListScopedAdminKeys)
	keys.POST("", gin.HandlerFunc(forcedStepUp), h.Admin.Setting.CreateScopedAdminKey)
	keys.PUT("/:id", gin.HandlerFunc(forcedStepUp), h.Admin.Setting.UpdateScopedAdminKey)
	keys.POST("/:id/rotate", gin.HandlerFunc(forcedStepUp), h.Admin.Setting.RotateScopedAdminKey)
	keys.DELETE("/:id", gin.HandlerFunc(forcedStepUp), h.Admin.Setting.RevokeScopedAdminKey)
	keys.DELETE("/:id/record", gin.HandlerFunc(forcedStepUp), h.Admin.Setting.DeleteScopedAdminKeyRecord)
}
