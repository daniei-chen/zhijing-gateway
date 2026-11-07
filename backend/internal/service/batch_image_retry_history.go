package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

var ErrBatchImageRecoveryUnavailable = infraerrors.New(http.StatusServiceUnavailable, "BATCH_IMAGE_RECOVERY_UNAVAILABLE", "batch image recovery history is unavailable")

type BatchImageRecoverySuccess struct {
	BatchID    string `json:"batch_id"`
	CustomID   string `json:"custom_id"`
	ImageCount int    `json:"image_count"`
}

type BatchImageRecoveryPending struct {
	BatchID  string `json:"batch_id"`
	CustomID string `json:"custom_id"`
}

type BatchImageRetryHistoryResponse struct {
	Object          string                      `json:"object"`
	BatchID         string                      `json:"batch_id"`
	RootBatchID     string                      `json:"root_batch_id"`
	RootCustomIDs   []string                    `json:"root_custom_ids"`
	TargetItems     []BatchImagePublicItem      `json:"target_items"`
	SuccessfulItems []BatchImageRecoverySuccess `json:"successful_items"`
	PendingItems    []BatchImageRecoveryPending `json:"pending_items"`
	InputMode       string                      `json:"input_mode"`
	Complete        bool                        `json:"complete"`
}

// RetryHistory reads the persisted lineage, including hidden child records.
// Complete means every read page finished, not an execution lock or reservation
// against another command submitted after these reads.
func (s *BatchImagePublicService) RetryHistory(ctx context.Context, owner BatchImageOwner, batchID string) (*BatchImageRetryHistoryResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || s.Repo == nil {
		return nil, ErrBatchImageRecoveryUnavailable
	}
	batchID = strings.TrimSpace(batchID)
	if batchID == "" {
		return nil, infraerrors.New(http.StatusBadRequest, "BATCH_IMAGE_ID_REQUIRED", "batch image id is required")
	}
	if owner.UserID <= 0 || owner.APIKeyID <= 0 {
		return nil, infraerrors.New(http.StatusUnauthorized, "API_KEY_REQUIRED", "API key is required")
	}
	target, err := s.Repo.GetBatchImageJobByBatchIDForOwner(ctx, owner.UserID, owner.APIKeyID, batchID)
	if err := batchImageRecoveryReadError(ctx, err); err != nil {
		return nil, err
	}
	if !batchImageRecoveryOwnedJob(target, owner) || target.BatchID != batchID || target.UserDeletedAt != nil {
		return nil, ErrBatchImageResultUnconfirmed
	}
	root := target
	ancestors := map[string]bool{root.BatchID: true}
	for parentID := strings.TrimSpace(batchImageDerefString(root.ParentBatchID)); parentID != ""; parentID = strings.TrimSpace(batchImageDerefString(root.ParentBatchID)) {
		if ancestors[parentID] {
			return nil, ErrBatchImageResultUnconfirmed
		}
		ancestors[parentID] = true
		root, err = s.Repo.GetBatchImageJobByBatchID(ctx, parentID)
		if err := batchImageRecoveryReadError(ctx, err); err != nil {
			return nil, err
		}
		if !batchImageRecoveryOwnedJob(root, owner) || root.BatchID != parentID {
			return nil, ErrBatchImageResultUnconfirmed
		}
	}

	// The public list intentionally hides deleted rows. Internal owner-scoped
	// reads retain their already-paid recovery evidence instead of treating a
	// hidden record as a cancelled provider execution.
	const pageSize = 100
	all := make([]*BatchImageJob, 0)
	byID := make(map[string]*BatchImageJob)
	for offset := 0; ; offset += pageSize {
		page, readErr := s.Repo.ListBatchImageJobsForOwner(ctx, owner.UserID, owner.APIKeyID, BatchImageJobFilter{Limit: pageSize, Offset: offset, ExcludeDeleted: false})
		if err := batchImageRecoveryReadError(ctx, readErr); err != nil {
			return nil, err
		}
		if len(page) > pageSize {
			return nil, ErrBatchImageResultUnconfirmed
		}
		for _, job := range page {
			if !batchImageRecoveryOwnedJob(job, owner) || byID[job.BatchID] != nil {
				return nil, ErrBatchImageResultUnconfirmed
			}
			byID[job.BatchID] = job
			all = append(all, job)
		}
		if len(page) < pageSize {
			break
		}
	}
	if byID[root.BatchID] == nil || byID[batchID] == nil || byID[batchID].UserDeletedAt != nil || strings.TrimSpace(batchImageDerefString(byID[root.BatchID].ParentBatchID)) != "" {
		return nil, ErrBatchImageResultUnconfirmed
	}
	children := make(map[string][]string)
	for _, job := range all {
		if parent := strings.TrimSpace(batchImageDerefString(job.ParentBatchID)); parent != "" && byID[parent] == nil {
			// A dangling lineage could hide evidence from the requested family.
			return nil, ErrBatchImageResultUnconfirmed
		}
		parent := strings.TrimSpace(batchImageDerefString(job.ParentBatchID))
		children[parent] = append(children[parent], job.BatchID)
	}
	family := map[string]bool{root.BatchID: true}
	queue := []string{root.BatchID}
	for index := 0; index < len(queue); index++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, childID := range children[queue[index]] {
			if !family[childID] {
				family[childID] = true
				queue = append(queue, childID)
			}
		}
	}
	if !family[batchID] {
		return nil, ErrBatchImageResultUnconfirmed
	}
	response := &BatchImageRetryHistoryResponse{
		Object: "image.batch.recovery", BatchID: batchID, RootBatchID: root.BatchID, InputMode: "prompt_only",
		RootCustomIDs: []string{}, TargetItems: []BatchImagePublicItem{},
		SuccessfulItems: []BatchImageRecoverySuccess{}, PendingItems: []BatchImageRecoveryPending{},
	}
	for _, job := range all {
		if !family[job.BatchID] {
			continue
		}
		current, readErr := s.Repo.GetBatchImageJobByBatchID(ctx, job.BatchID)
		if err := batchImageRecoveryReadError(ctx, readErr); err != nil {
			return nil, err
		}
		if !batchImageRecoveryOwnedJob(current, owner) || current.BatchID != job.BatchID || current.ItemCount != job.ItemCount || batchImageDerefString(current.ParentBatchID) != batchImageDerefString(job.ParentBatchID) {
			return nil, ErrBatchImageResultUnconfirmed
		}
		job = current
		items, readErr := s.batchImageRecoveryItems(ctx, job)
		if readErr != nil {
			return nil, readErr
		}
		for _, item := range items {
			if job.BatchID == root.BatchID {
				response.RootCustomIDs = append(response.RootCustomIDs, item.CustomID)
			}
			if job.BatchID == batchID {
				response.TargetItems = append(response.TargetItems, BatchImageItemToPublic(item))
			}
			if job.BatchID == root.BatchID {
				continue
			}
			if item.Status == BatchImageItemStatusSuccess && item.ImageCount > 0 {
				response.SuccessfulItems = append(response.SuccessfulItems, BatchImageRecoverySuccess{BatchID: job.BatchID, CustomID: item.CustomID, ImageCount: item.ImageCount})
			}
			if item.Status == BatchImageItemStatusPending && !IsTerminalBatchImageJobStatus(job.Status) {
				response.PendingItems = append(response.PendingItems, BatchImageRecoveryPending{BatchID: job.BatchID, CustomID: item.CustomID})
			}
		}
	}
	currentTarget, readErr := s.Repo.GetBatchImageJobByBatchIDForOwner(ctx, owner.UserID, owner.APIKeyID, batchID)
	if err := batchImageRecoveryReadError(ctx, readErr); err != nil {
		return nil, err
	}
	if !batchImageRecoveryOwnedJob(currentTarget, owner) || currentTarget.BatchID != batchID || currentTarget.UserDeletedAt != nil || currentTarget.ItemCount != byID[batchID].ItemCount || batchImageDerefString(currentTarget.ParentBatchID) != batchImageDerefString(byID[batchID].ParentBatchID) {
		return nil, ErrBatchImageResultUnconfirmed
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	response.Complete = true
	return response, nil
}

func batchImageRecoveryOwnedJob(job *BatchImageJob, owner BatchImageOwner) bool {
	return job != nil && strings.TrimSpace(job.BatchID) != "" && job.UserID == owner.UserID && job.APIKeyID != nil && *job.APIKeyID == owner.APIKeyID
}

func batchImageRecoveryReadError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, ErrBatchImageJobNotFound) {
		return ErrBatchImageResultUnconfirmed
	}
	if err != nil {
		return ErrBatchImageRecoveryUnavailable.WithCause(err)
	}
	return nil
}

func (s *BatchImagePublicService) batchImageRecoveryItems(ctx context.Context, job *BatchImageJob) ([]*BatchImageItem, error) {
	if job.ItemCount <= 0 {
		return nil, ErrBatchImageResultUnconfirmed
	}
	const pageSize = 100
	items := make([]*BatchImageItem, 0, pageSize)
	seen := make(map[string]bool)
	for offset := 0; ; offset += pageSize {
		page, err := s.Repo.ListBatchImageItems(ctx, job.BatchID, BatchImageItemFilter{Limit: pageSize, Offset: offset})
		if err := batchImageRecoveryReadError(ctx, err); err != nil {
			return nil, err
		}
		if len(page) > pageSize {
			return nil, ErrBatchImageResultUnconfirmed
		}
		for _, item := range page {
			if item == nil || item.JobID != job.BatchID || strings.TrimSpace(item.CustomID) == "" || seen[item.CustomID] {
				return nil, ErrBatchImageResultUnconfirmed
			}
			if item.Status != BatchImageItemStatusPending && item.Status != BatchImageItemStatusSuccess && item.Status != BatchImageItemStatusFailed {
				return nil, ErrBatchImageResultUnconfirmed
			}
			seen[item.CustomID] = true
			items = append(items, item)
		}
		if len(items) > job.ItemCount {
			return nil, ErrBatchImageResultUnconfirmed
		}
		if len(page) < pageSize {
			break
		}
	}
	if len(items) != job.ItemCount {
		return nil, ErrBatchImageResultUnconfirmed
	}
	return items, nil
}
