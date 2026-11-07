package routes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/handler"
	"github.com/Wei-Shaw/sub2api/internal/securityaudit"
	servermiddleware "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestEveryGatewayPOSTRouteIsClassifiedForPromptAuditCoverage(t *testing.T) {
	routeSource, err := os.ReadFile("gateway.go")
	require.NoError(t, err)
	pattern := regexp.MustCompile(`(?:gateway|gemini|r|codexDirect|antigravityV1|antigravityV1Beta)\.POST\("([^"]+)"`)
	matches := pattern.FindAllStringSubmatch(string(routeSource), -1)
	actual := map[string]struct{}{}
	for _, match := range matches {
		actual[match[1]] = struct{}{}
	}

	audited := map[string][]string{
		"/messages":                 {"gateway_handler.go", "openai_gateway_handler.go"},
		"/systemone":                {"gateway_systemone.go"},
		"/responses":                {"gateway_handler_responses.go", "openai_gateway_handler.go"},
		"/responses/*subpath":       {"gateway_handler_responses.go", "openai_gateway_handler.go"},
		"/chat/completions":         {"gateway_handler_chat_completions.go", "openai_chat_completions.go"},
		"/embeddings":               {"openai_embeddings.go"},
		"/alpha/search":             {"openai_alpha_search.go"},
		"/live":                     {"openai_live.go"},
		"/realtime/calls":           {"openai_live.go"},
		"/images/generations":       {"openai_images.go", "grok_media.go"},
		"/images/edits":             {"openai_images.go", "grok_media.go"},
		"/images/generations/async": {"image_task_handler.go"},
		"/images/edits/async":       {"image_task_handler.go"},
		"/images/batches":           {"batch_image_handler.go"},
		"/videos":                   {"grok_media.go"},
		"/videos/generations":       {"grok_media.go"},
		"/videos/edits":             {"grok_media.go"},
		"/videos/extensions":        {"grok_media.go"},
		"/models/*modelAction":      {"gemini_v1beta_handler.go"},
		"/cachedContents":           {"gemini_cached_contents_handler.go"},
		"/tts":                      {"grok_audio.go"},
		"/web_search":               {"gateway_web_search.go"},
		"/x_search":                 {"gateway_web_search.go"},
	}
	excluded := map[string]string{
		"/messages/count_tokens":     "tokenization only; it does not execute a model request",
		"/images/batches/replay":     "read-only scoped saved submission fingerprint check; it never executes a new prompt",
		"/images/batches/:id/cancel": "control-plane cancellation with no user prompt",
		"/stt":                       "speech transcription is not a text-generation prompt",
		"/custom-voices":             "voice profile management has no model prompt",
	}

	unclassified := make([]string, 0)
	for route := range actual {
		if _, ok := audited[route]; ok {
			continue
		}
		if _, ok := excluded[route]; ok {
			continue
		}
		unclassified = append(unclassified, route)
	}
	sort.Strings(unclassified)
	require.Empty(t, unclassified, "new gateway POST routes must be audited or explicitly classified with a no-prompt reason")

	for route, files := range audited {
		_, exists := actual[route]
		require.Truef(t, exists, "stale prompt-audit route manifest entry %s", route)
		for _, filename := range files {
			source, readErr := os.ReadFile(filepath.Join("..", "..", "handler", filename))
			require.NoError(t, readErr)
			require.Containsf(t, string(source), "checkSecurityAudit", "%s route handler %s bypasses Coordinator", route, filename)
		}
	}

	for route, reason := range excluded {
		require.NotEmpty(t, strings.TrimSpace(reason))
		_, exists := actual[route]
		require.Truef(t, exists, "stale excluded route %s", route)
	}
}

func TestResponsesWebSocketHasFirstAndSubsequentTurnPromptGates(t *testing.T) {
	routeSource, err := os.ReadFile("gateway.go")
	require.NoError(t, err)
	require.GreaterOrEqual(t, strings.Count(string(routeSource), `.GET("/responses"`), 2)
	handlerSource, err := os.ReadFile(filepath.Join("..", "..", "handler", "openai_gateway_handler.go"))
	require.NoError(t, err)
	require.Contains(t, string(handlerSource), `checkSecurityAuditStage`)
	require.Contains(t, string(handlerSource), `"first_turn"`)
	require.Contains(t, string(handlerSource), `"subsequent_turn"`)
	wsStart := strings.Index(string(handlerSource), `func (h *OpenAIGatewayHandler) ResponsesWebSocket`)
	require.NotEqual(t, -1, wsStart)
	wsSource := string(handlerSource)[wsStart:]
	require.Less(t,
		strings.Index(wsSource, `"first_turn"`),
		strings.Index(wsSource, `TryAcquireUserSlotForAPIKey`),
		"the first response.create gate must precede per-request user/account slots",
	)
}

func TestPromptAuditAdminRoutesRejectUnauthenticatedAndNonAdminRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	handlers := &handler.Handlers{Admin: &handler.AdminHandlers{
		PromptAudit: securityaudit.NewPromptAdminHandler(nil),
	}}
	adminAuth := servermiddleware.AdminAuthMiddleware(func(c *gin.Context) {
		if c.GetHeader("Authorization") == "" {
			servermiddleware.AbortWithError(c, http.StatusUnauthorized, "UNAUTHORIZED", "Authorization required")
			return
		}
		servermiddleware.AbortWithError(c, http.StatusForbidden, "FORBIDDEN", "Admin access required")
	})
	auditLog := servermiddleware.AuditLogMiddleware(func(c *gin.Context) { c.Next() })
	stepUp := servermiddleware.StepUpAuthMiddleware(func(c *gin.Context) { c.Next() })
	RegisterAdminRoutes(router.Group("/api/v1"), handlers, adminAuth, auditLog, stepUp, nil, nil)

	for _, tc := range []struct {
		name       string
		auth       string
		wantStatus int
	}{
		{name: "unauthenticated", wantStatus: http.StatusUnauthorized},
		{name: "non-admin", auth: "Bearer user-token", wantStatus: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/prompt-audit/config", nil)
			if tc.auth != "" {
				request.Header.Set("Authorization", tc.auth)
			}
			router.ServeHTTP(recorder, request)
			require.Equal(t, tc.wantStatus, recorder.Code)
		})
	}
}

type batchReplayGatewayRepository struct {
	service.BatchImageRepository
	job   *service.BatchImageJob
	calls int
}

func (r *batchReplayGatewayRepository) GetBatchImageJobByIdempotencyKey(_ context.Context, userID, keyID int64, key string) (*service.BatchImageJob, error) {
	r.calls++
	if r.job.UserID != userID || *r.job.APIKeyID != keyID || *r.job.IdempotencyKey != key {
		return nil, service.ErrBatchImageJobNotFound
	}
	return r.job, nil
}

type batchReplayGatewayCompositeRepository struct {
	service.CompositeModelRouteRepository
	calls int
}

func (r *batchReplayGatewayCompositeRepository) ListByGroup(context.Context, int64, bool) ([]service.CompositeModelRoute, error) {
	r.calls++
	return []service.CompositeModelRoute{{
		ID: 1, GroupID: 7, PublicModel: "gemini-2.5-flash-image", UpstreamModel: "rewritten-execution-model",
		TargetPlatform: service.PlatformGemini, Endpoint: service.CompositeRouteEndpointAny,
		MatchType: service.CompositeRouteMatchExact, Enabled: true,
	}}, nil
}

func TestBatchImageSubmissionReplayGatewayReadOnlyRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	req := service.BatchImageSubmitRequest{
		Model: "gemini-2.5-flash-image", TaskName: "Saved synthetic task", Provider: service.BatchImageProviderGeminiAPI,
		ResponseMimeType: "image/png", ImageSize: "1K", Items: []service.BatchImageSubmitItem{{CustomID: "one", Prompt: "synthetic"}},
	}
	keyID, nonce, hash := int64(22), "synthetic-original-nonce", service.HashBatchImageSubmitRequest(req)
	repo := &batchReplayGatewayRepository{job: &service.BatchImageJob{
		BatchID: "imgbatch_saved", UserID: 11, APIKeyID: &keyID, IdempotencyKey: &nonce, RequestHash: &hash,
		TaskName: req.TaskName, Model: req.Model, Provider: req.Provider, Status: service.BatchImageJobStatusSubmitted,
	}}
	compositeRepo := &batchReplayGatewayCompositeRepository{}
	group := &service.Group{ID: 7, Platform: service.PlatformComposite,
		ModelAllowlist: service.GroupModelAllowlist{Enabled: true, Models: []string{"different-current-model"}}}
	batchHandler := handler.NewBatchImageHandler(&service.BatchImagePublicService{Repo: repo}, nil, nil)
	handlers := &handler.Handlers{
		Gateway: &handler.GatewayHandler{}, OpenAIGateway: &handler.OpenAIGatewayHandler{},
		AsyncImage: handler.NewAsyncImageHandler(nil, nil), BatchImage: batchHandler,
	}
	router := gin.New()
	authCalls := 0
	RegisterGatewayRoutes(router, handlers, servermiddleware.APIKeyAuthMiddleware(func(c *gin.Context) {
		authCalls++
		credential := c.GetHeader("Authorization")
		if credential == "" {
			servermiddleware.AbortWithError(c, http.StatusUnauthorized, "API_KEY_REQUIRED", "API key required")
			return
		}
		userID, apiKeyID := int64(11), int64(22)
		if credential == "Bearer other-user" {
			userID++
		}
		if credential == "Bearer other-key" {
			apiKeyID++
		}
		c.Set(string(servermiddleware.ContextKeyAPIKey), &service.APIKey{ID: apiKeyID, UserID: userID, GroupID: &group.ID, Group: group})
		c.Next()
	}), nil, nil, nil, nil, service.NewCompositeRouteResolver(compositeRepo), &config.Config{Gateway: config.GatewayConfig{MaxBodySize: 4096, TextMaxBodySize: 4096}})
	raw, err := json.Marshal(req)
	require.NoError(t, err)
	request := func(path, auth, body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Authorization", auth)
		r.Header.Set("Idempotency-Key", nonce)
		r.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, r)
		return w
	}
	t.Run("unauthenticated does not read", func(t *testing.T) {
		w := request("/v1/images/batches/replay", "", string(raw))
		require.Equal(t, http.StatusUnauthorized, w.Code)
		require.Zero(t, repo.calls)
		require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
	})
	t.Run("same owner reads saved fingerprint despite new execution restrictions", func(t *testing.T) {
		for _, allowlist := range []bool{true, false} {
			group.ModelAllowlist.Enabled = allowlist
			w := request("/v1/images/batches/replay", "Bearer owner", string(raw))
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			require.Equal(t, "true", w.Header().Get("X-Idempotency-Replayed"))
			require.Contains(t, w.Body.String(), `"id":"imgbatch_saved"`)
			require.Zero(t, compositeRepo.calls, "historical fingerprint must not undergo new composite rewriting")
		}
	})
	t.Run("cross owner cannot read saved result", func(t *testing.T) {
		for _, auth := range []string{"Bearer other-user", "Bearer other-key"} {
			w := request("/v1/images/batches/replay", auth, string(raw))
			require.Equal(t, http.StatusConflict, w.Code)
			require.Contains(t, w.Body.String(), "BATCH_IMAGE_RESULT_UNCONFIRMED")
			require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
			require.NotContains(t, w.Body.String(), "imgbatch_saved")
		}
	})
	t.Run("original submit still applies allowlist and composite execution middleware", func(t *testing.T) {
		reads := repo.calls
		group.ModelAllowlist.Enabled = true
		w := request("/v1/images/batches", "Bearer owner", string(raw))
		require.Equal(t, http.StatusNotFound, w.Code)
		require.Contains(t, w.Body.String(), "not available for this group")
		require.Zero(t, compositeRepo.calls)
		group.ModelAllowlist.Enabled = false
		w = request("/v1/images/batches", "Bearer owner", string(raw))
		require.Equal(t, http.StatusNotFound, w.Code)
		require.Contains(t, w.Body.String(), "BATCH_IMAGE_DISABLED")
		require.Equal(t, 1, compositeRepo.calls)
		require.Equal(t, reads, repo.calls)
	})
	t.Run("body limit still bounds the readonly request", func(t *testing.T) {
		reads := repo.calls
		w := request("/v1/images/batches/replay", "Bearer owner", `{"model":"`+strings.Repeat("x", 5000)+`"}`)
		require.Equal(t, http.StatusBadRequest, w.Code)
		require.Empty(t, w.Header().Get("X-Idempotency-Replayed"))
		require.Equal(t, reads, repo.calls)
	})
	require.Equal(t, 8, authCalls)
}

type batchRecoveryGatewayKeys struct {
	service.APIKeyRepository
	touches int
}

func (r *batchRecoveryGatewayKeys) GetByKeyForAuth(_ context.Context, key string) (*service.APIKey, error) {
	user, id := int64(11), int64(22)
	switch key {
	case "synthetic-owner":
	case "synthetic-other-user":
		user++
		id = 23
	case "synthetic-other-key":
		id = 24
	default:
		return nil, service.ErrAPIKeyNotFound
	}
	return &service.APIKey{ID: id, UserID: user, Key: key, Status: service.StatusActive, User: &service.User{ID: user, Role: service.RoleUser, Status: service.StatusActive, Balance: 0}}, nil
}
func (r *batchRecoveryGatewayKeys) GetByKey(ctx context.Context, key string) (*service.APIKey, error) {
	return r.GetByKeyForAuth(ctx, key)
}
func (r *batchRecoveryGatewayKeys) UpdateLastUsed(context.Context, int64, time.Time) error {
	r.touches++
	return nil
}

type batchRecoveryGatewayRepository struct {
	service.BatchImageRepository
	jobs  []*service.BatchImageJob
	calls int
}

func (r *batchRecoveryGatewayRepository) GetBatchImageJobByBatchID(_ context.Context, id string) (*service.BatchImageJob, error) {
	r.calls++
	for _, job := range r.jobs {
		if job.BatchID == id {
			return job, nil
		}
	}
	return nil, service.ErrBatchImageJobNotFound
}
func (r *batchRecoveryGatewayRepository) GetBatchImageJobByBatchIDForOwner(ctx context.Context, user, key int64, id string) (*service.BatchImageJob, error) {
	job, err := r.GetBatchImageJobByBatchID(ctx, id)
	if err != nil {
		return nil, err
	}
	if job.UserID != user || job.APIKeyID == nil || *job.APIKeyID != key || job.UserDeletedAt != nil {
		return nil, service.ErrBatchImageJobNotFound
	}
	return job, nil
}
func (r *batchRecoveryGatewayRepository) ListBatchImageJobsForOwner(_ context.Context, user, key int64, filter service.BatchImageJobFilter) ([]*service.BatchImageJob, error) {
	r.calls++
	var data []*service.BatchImageJob
	for _, job := range r.jobs {
		if job.UserID == user && job.APIKeyID != nil && *job.APIKeyID == key && (!filter.ExcludeDeleted || job.UserDeletedAt == nil) {
			data = append(data, job)
		}
	}
	return data, nil
}
func (r *batchRecoveryGatewayRepository) ListBatchImageItems(_ context.Context, id string, filter service.BatchImageItemFilter) ([]*service.BatchImageItem, error) {
	r.calls++
	if filter.Offset != 0 {
		return nil, nil
	}
	status, count := service.BatchImageItemStatusFailed, 0
	if id == "child" {
		status, count = service.BatchImageItemStatusSuccess, 1
	}
	prompt := "Synthetic full prompt"
	return []*service.BatchImageItem{{JobID: id, CustomID: "source", Status: status, ImageCount: count, PromptPreview: &prompt}}, nil
}

func TestBatchImageRecoveryGatewayRouteUsesRealKeyAuthAndOnlyReads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key, rootID, now := int64(22), "root", time.Now()
	repo := &batchRecoveryGatewayRepository{jobs: []*service.BatchImageJob{
		{BatchID: rootID, UserID: 11, APIKeyID: &key, Status: service.BatchImageJobStatusFailed, ItemCount: 1},
		{BatchID: "child", ParentBatchID: &rootID, UserID: 11, APIKeyID: &key, Status: service.BatchImageJobStatusCompleted, ItemCount: 1, UserDeletedAt: &now},
	}}
	keys := &batchRecoveryGatewayKeys{}
	cfg := &config.Config{RunMode: config.RunModeStandard, Gateway: config.GatewayConfig{MaxBodySize: 4096, TextMaxBodySize: 4096}}
	keyService := service.NewAPIKeyService(keys, nil, nil, nil, nil, nil, cfg)
	h := &handler.Handlers{Gateway: &handler.GatewayHandler{}, OpenAIGateway: &handler.OpenAIGatewayHandler{}, AsyncImage: handler.NewAsyncImageHandler(nil, nil), BatchImage: handler.NewBatchImageHandler(&service.BatchImagePublicService{Repo: repo}, nil, nil)}
	router := gin.New()
	RegisterGatewayRoutes(router, h, servermiddleware.NewAPIKeyAuthMiddleware(keyService, nil, cfg), keyService, nil, nil, nil, nil, cfg)
	request := func(method, path, token string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(w, req)
		return w
	}
	w := request(http.MethodGet, "/v1/images/batches/root/recovery", "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	require.Zero(t, repo.calls)
	w = request(http.MethodGet, "/v1/images/batches/root/recovery", "synthetic-owner")
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var body service.BatchImageRetryHistoryResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.True(t, body.Complete)
	require.Equal(t, rootID, body.BatchID)
	require.Equal(t, "image.batch.recovery", body.Object)
	require.Equal(t, "prompt_only", body.InputMode)
	require.Equal(t, []service.BatchImageRecoverySuccess{{BatchID: "child", CustomID: "source", ImageCount: 1}}, body.SuccessfulItems)
	require.Greater(t, keys.touches, 0, "normal key last-used audit is retained")
	for _, credential := range []string{"synthetic-other-user", "synthetic-other-key"} {
		w = request(http.MethodGet, "/v1/images/batches/root/recovery", credential)
		require.Equal(t, http.StatusConflict, w.Code, w.Body.String())
		require.NotContains(t, w.Body.String(), `"complete":true`)
	}
	reads := repo.calls
	w = request(http.MethodPost, "/v1/images/batches", "synthetic-owner")
	require.Equal(t, http.StatusForbidden, w.Code)
	require.Contains(t, w.Body.String(), "INSUFFICIENT_BALANCE")
	require.Equal(t, reads, repo.calls)
}
