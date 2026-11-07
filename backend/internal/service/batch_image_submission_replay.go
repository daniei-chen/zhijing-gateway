package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

var (
	ErrBatchImageReplayKeyRequired = infraerrors.New(http.StatusBadRequest, "BATCH_IMAGE_IDEMPOTENCY_KEY_REQUIRED", "original batch image idempotency key is required")
	ErrBatchImageReplayUnavailable = infraerrors.New(http.StatusServiceUnavailable, "BATCH_IMAGE_REPLAY_UNAVAILABLE", "batch image submission history is unavailable")
	ErrBatchImageResultUnconfirmed = infraerrors.New(http.StatusConflict, "BATCH_IMAGE_RESULT_UNCONFIRMED", "original batch image submission result cannot be confirmed")
)

// ReplaySubmission only reads a saved command. In particular, Submit's recovery
// behavior (including re-enqueueing submitted jobs) must never run on this path.
func (s *BatchImagePublicService) ReplaySubmission(ctx context.Context, owner BatchImageOwner, req BatchImageSubmitRequest, idempotencyKey string) (*BatchImagePublicBatch, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || s.Repo == nil {
		return nil, ErrBatchImageReplayUnavailable
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" {
		return nil, ErrBatchImageReplayKeyRequired
	}
	if owner.UserID <= 0 || owner.APIKeyID <= 0 {
		return nil, infraerrors.New(http.StatusUnauthorized, "API_KEY_REQUIRED", "API key is required")
	}
	job, err := s.Repo.GetBatchImageJobByIdempotencyKey(ctx, owner.UserID, owner.APIKeyID, idempotencyKey)
	// A repository may return successfully even after the request was cancelled.
	if contextErr := ctx.Err(); contextErr != nil {
		return nil, contextErr
	}
	if errors.Is(err, ErrBatchImageJobNotFound) {
		return nil, ErrBatchImageResultUnconfirmed
	}
	if err != nil {
		return nil, ErrBatchImageReplayUnavailable.WithCause(err)
	}
	if job == nil || job.UserDeletedAt != nil || strings.TrimSpace(job.BatchID) == "" ||
		job.UserID != owner.UserID || job.APIKeyID == nil || *job.APIKeyID != owner.APIKeyID ||
		job.IdempotencyKey == nil || strings.TrimSpace(*job.IdempotencyKey) != idempotencyKey ||
		strings.TrimSpace(batchImageDerefString(job.RequestHash)) == "" {
		return nil, ErrBatchImageResultUnconfirmed
	}
	if strings.TrimSpace(req.TaskName) == "" {
		// The original default includes the submission time. Never regenerate it
		// using this retry's clock or a new command could appear to be confirmed.
		req.TaskName = job.TaskName
		if strings.TrimSpace(req.TaskName) == "" {
			return nil, ErrBatchImageResultUnconfirmed
		}
	}
	// The existing normalizer edits item/reference slices; keep this read-only
	// check from changing a caller's reusable draft or racing another check.
	req.Items = append([]BatchImageSubmitItem(nil), req.Items...)
	for i := range req.Items {
		req.Items[i].ReferenceImages = append([]BatchImageReferenceInput(nil), req.Items[i].ReferenceImages...)
	}
	normalized, err := s.validateSubmitRequest(req)
	if err != nil {
		return nil, err
	}
	if HashBatchImageSubmitRequest(normalized) != *job.RequestHash {
		return nil, ErrBatchImageIdempotencyConflict
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return BatchImageJobToPublic(job), nil
}
