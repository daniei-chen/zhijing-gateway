//go:build unit

package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/securityaudit"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type batchReplayHandlerRepository struct {
	service.BatchImageRepository
	lookup func(context.Context, int64, int64, string) (*service.BatchImageJob, error)
	calls  int
}

func (r *batchReplayHandlerRepository) GetBatchImageJobByIdempotencyKey(ctx context.Context, userID, keyID int64, key string) (*service.BatchImageJob, error) {
	r.calls++
	return r.lookup(ctx, userID, keyID, key)
}

func batchReplayHandlerFixture(t *testing.T) (*BatchImageHandler, *batchReplayHandlerRepository, service.BatchImageSubmitRequest, *service.BatchImageJob) {
	t.Helper()
	keyID := int64(22)
	key := "synthetic-original-command"
	req := service.BatchImageSubmitRequest{
		Model: "gemini-2.5-flash-image", Provider: service.BatchImageProviderGeminiAPI,
		TaskName: "2000-01-02 03:04:05", ResponseMimeType: "image/png", ImageSize: "1K",
		Items: []service.BatchImageSubmitItem{{CustomID: "one", Prompt: "synthetic"}},
	}
	hash := service.HashBatchImageSubmitRequest(req)
	job := &service.BatchImageJob{
		BatchID: "imgbatch_synthetic", UserID: 11, APIKeyID: &keyID,
		IdempotencyKey: &key, RequestHash: &hash, TaskName: req.TaskName,
		Status: service.BatchImageJobStatusSubmitted, Model: req.Model, Provider: req.Provider,
		CreatedAt: time.Unix(946684800, 0), ItemCount: 1,
	}
	repo := &batchReplayHandlerRepository{lookup: func(_ context.Context, userID, apiKeyID int64, key string) (*service.BatchImageJob, error) {
		if userID != 11 || apiKeyID != 22 || key != "synthetic-original-command" {
			return nil, service.ErrBatchImageJobNotFound
		}
		return job, nil
	}}
	return NewBatchImageHandler(&service.BatchImagePublicService{Repo: repo}, nil, nil), repo, req, job
}

func batchReplayHandlerRequest(t *testing.T, h *BatchImageHandler, owner *service.APIKey, raw, key string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		if owner != nil {
			c.Set(string(middleware.ContextKeyAPIKey), owner)
		}
		c.Next()
	})
	router.POST("/v1/images/batches/replay", h.ReplaySubmission)
	request := httptest.NewRequest(http.MethodPost, "/v1/images/batches/replay", strings.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, request)
	return w
}

func TestBatchImageReplayHandlerSavedCommandACKWithoutExecutingPrompt(t *testing.T) {
	h, repo, req, _ := batchReplayHandlerFixture(t)
	engine := blockingHandlerPromptEngine()
	h.openAI = &OpenAIGatewayHandler{securityAuditCoordinator: securityaudit.NewCoordinator(nil, engine)}
	raw, err := json.Marshal(req)
	require.NoError(t, err)
	for i := 0; i < 3; i++ {
		w := batchReplayHandlerRequest(t, h, &service.APIKey{ID: 22, UserID: 11}, string(raw), "synthetic-original-command")
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, "true", w.Header().Get("X-Idempotency-Replayed"))
		require.Contains(t, w.Body.String(), `"id":"imgbatch_synthetic"`)
		require.NotContains(t, w.Body.String(), "request_hash")
		require.NotContains(t, w.Body.String(), "idempotency_key")
	}
	require.Equal(t, 3, repo.calls)
	evaluated, enqueued, _ := engine.snapshot()
	require.Zero(t, evaluated)
	require.Zero(t, enqueued, "fingerprint matching does not execute a new prompt or audit evaluation")
}

func TestBatchImageReplayHandlerRejectsUnauthenticatedAndExtraBodies(t *testing.T) {
	owner := &service.APIKey{ID: 22, UserID: 11}
	h, repo, req, _ := batchReplayHandlerFixture(t)
	w := batchReplayHandlerRequest(t, h, nil, "malformed", "synthetic-original-command")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
	require.Zero(t, repo.calls)
	raw, err := json.Marshal(req)
	require.NoError(t, err)
	for _, body := range []string{
		"null", "[]", "{}", string(raw) + " {}", string(raw) + " true",
		strings.TrimSuffix(string(raw), "}") + `,"unknown":true}`,
		strings.Replace(string(raw), `"custom_id":"one"`, `"custom_id":"one","unexpected":true`, 1),
	} {
		t.Run(body, func(t *testing.T) {
			w := batchReplayHandlerRequest(t, h, owner, body, "synthetic-original-command")
			require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
			require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
		})
	}
}

func TestBatchImageReplayHandlerFailsClosedWithoutAcknowledgement(t *testing.T) {
	for _, name := range []string{"missing key", "missing record", "different user", "different key", "changed payload", "repository fault", "nil service", "deleted", "missing hash", "cancelled lookup"} {
		t.Run(name, func(t *testing.T) {
			h, repo, req, job := batchReplayHandlerFixture(t)
			owner := &service.APIKey{ID: 22, UserID: 11}
			key, status := "synthetic-original-command", http.StatusConflict
			switch name {
			case "missing key":
				key, status = "", http.StatusBadRequest
			case "missing record":
				key = "missing-original"
			case "different user":
				owner.UserID++
			case "different key":
				owner.ID++
			case "changed payload":
				req.Items[0].Prompt = "changed"
			case "repository fault":
				status = http.StatusServiceUnavailable
				repo.lookup = func(context.Context, int64, int64, string) (*service.BatchImageJob, error) {
					return nil, errors.New("synthetic internal store failure")
				}
			case "nil service":
				h.service, status = nil, http.StatusServiceUnavailable
			case "deleted":
				now := time.Now()
				job.UserDeletedAt = &now
			case "missing hash":
				job.RequestHash = nil
			case "cancelled lookup":
				status = http.StatusInternalServerError
			}
			raw, err := json.Marshal(req)
			require.NoError(t, err)
			if name == "cancelled lookup" {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				repo.lookup = func(context.Context, int64, int64, string) (*service.BatchImageJob, error) { cancel(); return job, nil }
				router := gin.New()
				router.Use(func(c *gin.Context) { c.Set(string(middleware.ContextKeyAPIKey), owner); c.Next() })
				router.POST("/v1/images/batches/replay", h.ReplaySubmission)
				request := httptest.NewRequest(http.MethodPost, "/v1/images/batches/replay", strings.NewReader(string(raw))).WithContext(ctx)
				request.Header.Set("Idempotency-Key", key)
				w := httptest.NewRecorder()
				router.ServeHTTP(w, request)
				require.Equal(t, status, w.Code)
				require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
				return
			}
			w := batchReplayHandlerRequest(t, h, owner, string(raw), key)
			require.Equal(t, status, w.Code, w.Body.String())
			require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
			require.NotContains(t, w.Body.String(), "imgbatch_synthetic")
		})
	}
}
