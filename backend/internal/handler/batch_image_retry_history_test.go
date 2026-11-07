//go:build unit

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type retryHistoryHandlerRepository struct {
	service.BatchImageRepository
	jobs  []*service.BatchImageJob
	fault error
	calls int
}

func (r *retryHistoryHandlerRepository) GetBatchImageJobByBatchID(_ context.Context, id string) (*service.BatchImageJob, error) {
	r.calls++
	if r.fault != nil {
		return nil, r.fault
	}
	for _, job := range r.jobs {
		if job.BatchID == id {
			return job, nil
		}
	}
	return nil, service.ErrBatchImageJobNotFound
}
func (r *retryHistoryHandlerRepository) GetBatchImageJobByBatchIDForOwner(ctx context.Context, user, key int64, id string) (*service.BatchImageJob, error) {
	job, err := r.GetBatchImageJobByBatchID(ctx, id)
	if err != nil {
		return nil, err
	}
	if job.UserID != user || job.APIKeyID == nil || *job.APIKeyID != key || job.UserDeletedAt != nil {
		return nil, service.ErrBatchImageJobNotFound
	}
	return job, nil
}
func (r *retryHistoryHandlerRepository) ListBatchImageJobsForOwner(_ context.Context, user, key int64, filter service.BatchImageJobFilter) ([]*service.BatchImageJob, error) {
	r.calls++
	var result []*service.BatchImageJob
	for _, job := range r.jobs {
		if job.UserID == user && job.APIKeyID != nil && *job.APIKeyID == key && (!filter.ExcludeDeleted || job.UserDeletedAt == nil) {
			result = append(result, job)
		}
	}
	return result, nil
}
func (r *retryHistoryHandlerRepository) ListBatchImageItems(_ context.Context, id string, filter service.BatchImageItemFilter) ([]*service.BatchImageItem, error) {
	r.calls++
	if filter.Offset > 0 {
		return nil, nil
	}
	status, count := service.BatchImageItemStatusFailed, 0
	if id == "child" {
		status, count = service.BatchImageItemStatusSuccess, 1
	}
	prompt := "Synthetic complete original prompt"
	return []*service.BatchImageItem{{JobID: id, CustomID: "source-id", Status: status, ImageCount: count, PromptPreview: &prompt}}, nil
}

func TestBatchImageRetryHistoryHandlerHTTPContract(t *testing.T) {
	gin.SetMode(gin.TestMode)
	keyID, rootID, now := int64(22), "root", time.Now()
	root := &service.BatchImageJob{BatchID: rootID, UserID: 11, APIKeyID: &keyID, Status: service.BatchImageJobStatusFailed, ItemCount: 1}
	child := &service.BatchImageJob{BatchID: "child", UserID: 11, APIKeyID: &keyID, ParentBatchID: &rootID, Status: service.BatchImageJobStatusCompleted, ItemCount: 1, UserDeletedAt: &now}
	for _, scenario := range []string{"owner", "no children", "unauthenticated", "other user", "other key", "missing", "nil service", "store failure"} {
		t.Run(scenario, func(t *testing.T) {
			repo := &retryHistoryHandlerRepository{jobs: []*service.BatchImageJob{root, child}}
			h := NewBatchImageHandler(&service.BatchImagePublicService{Repo: repo}, nil, nil)
			user, key, path, expected := int64(11), int64(22), "/v1/images/batches/root/recovery", http.StatusOK
			switch scenario {
			case "no children":
				repo.jobs = []*service.BatchImageJob{root}
			case "unauthenticated":
				expected = http.StatusUnauthorized
			case "other user":
				user++
				expected = http.StatusConflict
			case "other key":
				key++
				expected = http.StatusConflict
			case "missing":
				path, expected = "/v1/images/batches/missing/recovery", http.StatusConflict
			case "nil service":
				h.service, expected = nil, http.StatusServiceUnavailable
			case "store failure":
				repo.fault, expected = errors.New("synthetic private DB failure"), http.StatusServiceUnavailable
			}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				if scenario != "unauthenticated" {
					c.Set(string(middleware.ContextKeyAPIKey), &service.APIKey{ID: key, UserID: user})
				}
				c.Next()
			})
			router.GET("/v1/images/batches/:id/recovery", h.RetryHistory)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
			require.Equal(t, expected, w.Code, w.Body.String())
			if expected != http.StatusOK {
				require.NotContains(t, w.Body.String(), `"complete":true`)
				require.NotContains(t, w.Body.String(), `"target_items"`)
				if scenario == "unauthenticated" {
					require.Zero(t, repo.calls)
				}
				return
			}
			var got service.BatchImageRetryHistoryResponse
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
			require.True(t, got.Complete)
			require.Equal(t, "image.batch.recovery", got.Object)
			require.Equal(t, rootID, got.BatchID)
			require.Equal(t, rootID, got.RootBatchID)
			require.Equal(t, "prompt_only", got.InputMode)
			require.Equal(t, []string{"source-id"}, got.RootCustomIDs)
			require.Len(t, got.TargetItems, 1)
			require.NotNil(t, got.TargetItems[0].PromptPreview)
			require.Equal(t, "Synthetic complete original prompt", *got.TargetItems[0].PromptPreview)
			require.NotNil(t, got.SuccessfulItems)
			if scenario == "no children" {
				require.Empty(t, got.SuccessfulItems)
				require.Contains(t, w.Body.String(), `"successful_items":[]`)
			} else {
				require.Equal(t, []service.BatchImageRecoverySuccess{{BatchID: "child", CustomID: "source-id", ImageCount: 1}}, got.SuccessfulItems)
			}
			require.NotNil(t, got.PendingItems)
			require.Empty(t, got.PendingItems)
			require.NotContains(t, w.Body.String(), "request_hash")
		})
	}
}
