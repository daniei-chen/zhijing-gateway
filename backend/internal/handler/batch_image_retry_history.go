package handler

import (
	"net/http"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

func (h *BatchImageHandler) RetryHistory(c *gin.Context) {
	owner, ok := batchImageOwnerFromContext(c)
	if !ok {
		batchImageError(c, infraerrors.New(http.StatusUnauthorized, "API_KEY_REQUIRED", "API key is required"))
		return
	}
	var historyService *service.BatchImagePublicService
	if h != nil {
		historyService = h.service
	}
	history, err := historyService.RetryHistory(c.Request.Context(), owner, c.Param("id"))
	if err != nil {
		batchImageError(c, err)
		return
	}
	c.JSON(http.StatusOK, history)
}
