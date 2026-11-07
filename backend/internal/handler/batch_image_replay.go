package handler

import (
	"encoding/json"
	"io"
	"net/http"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

// ReplaySubmission confirms a saved submission; it cannot submit a new prompt.
func (h *BatchImageHandler) ReplaySubmission(c *gin.Context) {
	owner, ok := batchImageOwnerFromContext(c)
	if !ok {
		batchImageError(c, infraerrors.New(http.StatusUnauthorized, "API_KEY_REQUIRED", "API key is required"))
		return
	}
	var req *service.BatchImageSubmitRequest
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil || req == nil {
		batchImageError(c, service.ErrBatchImageInvalidItems)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		batchImageError(c, service.ErrBatchImageInvalidItems)
		return
	}
	var replayService *service.BatchImagePublicService
	if h != nil {
		replayService = h.service
	}
	got, err := replayService.ReplaySubmission(c.Request.Context(), owner, *req, c.GetHeader("Idempotency-Key"))
	if err != nil {
		batchImageError(c, err)
		return
	}
	c.Header("X-Idempotency-Replayed", "true")
	c.JSON(http.StatusOK, got)
}
