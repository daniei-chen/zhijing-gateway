package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/handler"
	servermiddleware "github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newGatewayRoutesTestRouterWithGroup(group *service.Group) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterGatewayRoutes(
		router,
		&handler.Handlers{
			Gateway:       &handler.GatewayHandler{},
			OpenAIGateway: &handler.OpenAIGatewayHandler{},
			AsyncImage:    handler.NewAsyncImageHandler(nil, nil),
		},
		servermiddleware.APIKeyAuthMiddleware(func(c *gin.Context) {
			groupID := int64(1)
			c.Set(string(servermiddleware.ContextKeyAPIKey), &service.APIKey{
				GroupID: &groupID,
				Group:   group,
			})
			c.Next()
		}),
		nil,
		nil,
		nil,
		nil,
		nil,
		&config.Config{
			Gateway: config.GatewayConfig{
				MaxBodySize:     1024 * 1024,
				TextMaxBodySize: 1024 * 1024,
			},
		},
	)
	return router
}

func allowlistGroup(platform string, enabled bool, models ...string) *service.Group {
	return &service.Group{
		Platform: platform,
		ModelAllowlist: service.GroupModelAllowlist{
			Enabled: enabled,
			Models:  models,
		},
	}
}

// TestGatewayRoutesGroupModelAllowlistMountedOnEveryGatewayRoute follows the
// source-level route assertion convention of prompt_audit_route_coverage_test.go:
// every gateway chain must mount groupModelAllowlist after api key auth and
// before the composite rewrite (gateway.go + rootRoute helper).
func TestGatewayRoutesGroupModelAllowlistMountedOnEveryGatewayRoute(t *testing.T) {
	routeSource, err := os.ReadFile("gateway.go")
	require.NoError(t, err)
	source := string(routeSource)

	// rootRoute helper：apiKeyAuth 之后、compositeTarget 之前。
	rootHelper := regexp.MustCompile(regexp.QuoteMeta(`r.Handle(method, path, limit, clientRequestID, opsErrorLogger, endpointNorm, gin.HandlerFunc(apiKeyAuth), groupModelAllowlist, duplicateBillingKeys, compositeTarget, requireGroupAnthropic, handler)`))
	require.Regexp(t, rootHelper, source,
		"root alias helper must place the allowlist between apiKeyAuth and compositeTarget")

	chains := []struct {
		group     string
		auth      string
		marker    string
		composite string
	}{
		{group: "gateway", auth: "gin.HandlerFunc(apiKeyAuth)", marker: "gateway.Use(groupModelAllowlist)", composite: "gateway.Use(compositeTarget)"},
		{group: "gemini", auth: "middleware.APIKeyAuthWithSubscriptionGoogle(apiKeyService, subscriptionService, cfg)", marker: "gemini.Use(groupModelAllowlist)", composite: "gemini.Use(compositeGeminiTarget)"},
		{group: "antigravityV1", auth: "gin.HandlerFunc(apiKeyAuth)", marker: "antigravityV1.Use(groupModelAllowlist)", composite: "antigravityV1.Use(requireGroupAnthropic)"},
		{group: "antigravityV1Beta", auth: "middleware.APIKeyAuthWithSubscriptionGoogle(apiKeyService, subscriptionService, cfg)", marker: "antigravityV1Beta.Use(groupModelAllowlist)", composite: "antigravityV1Beta.Use(requireGroupGoogle)"},
	}
	for _, chain := range chains {
		re := regexp.MustCompile(
			regexp.QuoteMeta(chain.group+".Use("+chain.auth) +
				`[\s\S]{0,400}?` + regexp.QuoteMeta(chain.marker) +
				`[\s\S]{0,400}?` + regexp.QuoteMeta(chain.composite))
		require.Regexp(t, re, source,
			"%s chain must mount groupModelAllowlist after auth and before %s", chain.group, chain.composite)
	}

	// codexDirect 链是一条 Use 调用，直接断言顺序。
	codexDirect := regexp.MustCompile(regexp.QuoteMeta(`codexDirect.Use(bodyLimit, clientRequestID, opsErrorLogger, endpointNorm, gin.HandlerFunc(apiKeyAuth), groupModelAllowlist, duplicateBillingKeys, compositeTarget, requireGroupAnthropic)`))
	require.Regexp(t, codexDirect, source, "codexDirect chain must mount the allowlist after auth and before compositeTarget")

	// 所有带 apiKeyAuth 的根路径路由必须收敛到 rootRoute，避免漏挂。
	stray := regexp.MustCompile(`\br\.(GET|POST|PUT|PATCH|DELETE)\("[^"]+",[^(]*apiKeyAuth`)
	require.NotRegexp(t, stray, source,
		"root alias routes must use rootRoute so the allowlist cannot be forgotten")
}

// TestGatewayRoutesDuplicateBillingKeysPosition 守两条不变式：
//  1. 重复键拒绝必须挂在白名单之后、合成改写之前——它只该覆盖要计费/转发的路由；
//  2. 白名单之前注册的 skipBilling 只读路由（billing info、batch replay/recovery）
//     不能经过它，否则这些路由的 body 语义（比如超限时返回 400 而不是 413）会被改掉。
func TestGatewayRoutesDuplicateBillingKeysPosition(t *testing.T) {
	routeSource, err := os.ReadFile("gateway.go")
	require.NoError(t, err)
	source := string(routeSource)

	// 只读路由必须先于网关级 Use 注册（Gin 的 Use 只作用于其后注册的路由）。
	readOnly := []string{
		`gateway.GET("/sub2api/billing"`,
		`gateway.POST("/images/batches/replay"`,
		`gateway.GET("/images/batches/:id/recovery"`,
	}
	guardAt := strings.Index(source, "gateway.Use(duplicateBillingKeys)")
	require.Positive(t, guardAt, "gateway chain must mount duplicateBillingKeys")
	for _, marker := range readOnly {
		at := strings.Index(source, marker)
		require.Positive(t, at, "missing read-only route %s", marker)
		require.Less(t, at, guardAt, "%s must stay outside the duplicate-key guard (registered before it)", marker)
	}

	chains := []struct {
		name   string
		before string
		after  string
	}{
		{"gateway", "gateway.Use(groupModelAllowlist)", "gateway.Use(compositeTarget)"},
		{"gemini", "gemini.Use(groupModelAllowlist)", "gemini.Use(compositeGeminiTarget)"},
		{"antigravityV1", "antigravityV1.Use(groupModelAllowlist)", "antigravityV1.Use(requireGroupAnthropic)"},
		{"antigravityV1Beta", "antigravityV1Beta.Use(groupModelAllowlist)", "antigravityV1Beta.Use(requireGroupGoogle)"},
	}
	for _, chain := range chains {
		group := chain.name
		if group == "gateway" || group == "gemini" {
			re := regexp.MustCompile(regexp.QuoteMeta(chain.before) +
				`[\s\S]{0,200}?` + regexp.QuoteMeta(group+".Use(duplicateBillingKeys)") +
				`[\s\S]{0,200}?` + regexp.QuoteMeta(chain.after))
			require.Regexp(t, re, source, "%s: duplicate-key guard must sit between allowlist and %s", group, chain.after)
			continue
		}
		re := regexp.MustCompile(regexp.QuoteMeta(chain.before) +
			`[\s\S]{0,200}?` + regexp.QuoteMeta(group+".Use(duplicateBillingKeys)"))
		require.Regexp(t, re, source, "%s: duplicate-key guard must follow the allowlist", group)
	}

	rootHelper := regexp.MustCompile(regexp.QuoteMeta(`gin.HandlerFunc(apiKeyAuth), groupModelAllowlist, duplicateBillingKeys, compositeTarget`))
	require.Regexp(t, rootHelper, source, "root alias helper must mount the duplicate-key guard after the allowlist and before the composite rewrite")
	codexDirect := regexp.MustCompile(regexp.QuoteMeta(`gin.HandlerFunc(apiKeyAuth), groupModelAllowlist, duplicateBillingKeys, compositeTarget`))
	require.Regexp(t, codexDirect, source, "codexDirect chain must mount the duplicate-key guard after the allowlist")
}

// TestGatewayRoutesGroupModelAllowlistBlocksCompositeModelBeforeRewrite asserts
// admission is decided on the client-written public model before the composite
// route middleware can rewrite it to an upstream model.
func TestGatewayRoutesGroupModelAllowlistBlocksCompositeModelBeforeRewrite(t *testing.T) {
	router := newGatewayRoutesTestRouterWithGroup(allowlistGroup(service.PlatformComposite, true, "claude-*"))

	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"grok-4.3","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusNotFound, w.Code)
	require.Contains(t, w.Body.String(), "not_found_error")
	require.Contains(t, w.Body.String(), "grok-4.3")
}

func TestGatewayRoutesGroupModelAllowlistAllowsListedCompositeModel(t *testing.T) {
	router := newGatewayRoutesTestRouterWithGroup(allowlistGroup(service.PlatformComposite, true, "claude-*"))

	req := httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(`{"model":"claude-sonnet-4.5","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.NotEqual(t, http.StatusNotFound, w.Code, "allowlisted model must pass admission: %s", w.Body.String())
}

func TestGatewayRoutesGroupModelAllowlistCoversRootAliasRoutes(t *testing.T) {
	router := newGatewayRoutesTestRouterWithGroup(allowlistGroup(service.PlatformOpenAI, true, "gpt-5.4"))

	paths := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/responses", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/responses/compact", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/chat/completions", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/embeddings", `{"model":"gpt-4.1","input":"hi"}`},
		{http.MethodPost, "/images/generations", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/images/edits", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/videos/generations", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/messages/count_tokens", `{"model":"gpt-4.1","messages":[]}`},
		{http.MethodPost, "/tts", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/stt", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/alpha/search", `{"model":"gpt-4.1"}`},
		{http.MethodGet, "/realtime?model=gpt-4.1", ""},
		{http.MethodPost, "/v1/responses", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/v1/messages", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/v1/systemone", `{"model":"gpt-4.1","state":"x","questions":{"q":{"type":"noul","instructions":"x"}}}`},
		{http.MethodPost, "/v1/messages/count_tokens", `{"model":"gpt-4.1","messages":[]}`},
		{http.MethodPost, "/v1/chat/completions", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/v1/embeddings", `{"model":"gpt-4.1","input":"hi"}`},
		{http.MethodPost, "/v1/images/generations", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/v1/videos/generations", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/api/v3/contents/generations/tasks", `{"model":"gpt-4.1","content":[{"type":"text","text":"waves"}]}`},
		{http.MethodPost, "/v3/contents/generations/tasks", `{"model":"gpt-4.1","content":[{"type":"text","text":"waves"}]}`},
		{http.MethodPost, "/v1/contents/generations/tasks", `{"model":"gpt-4.1","content":[{"type":"text","text":"waves"}]}`},
		{http.MethodPost, "/contents/generations/tasks", `{"model":"gpt-4.1","content":[{"type":"text","text":"waves"}]}`},
		{http.MethodPost, "/v1/live", `{"session":{"model":"gpt-4.1"},"sdp":"v=0"}`},
		{http.MethodPost, "/backend-api/codex/responses", `{"model":"gpt-4.1"}`},
		{http.MethodPost, "/backend-api/codex/realtime/calls", `{"session":{"model":"gpt-4.1"},"sdp":"v=0"}`},
		{http.MethodPost, "/antigravity/v1/messages", `{"model":"gemini-2.5-pro","messages":[]}`},
	}

	for _, tc := range paths {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		require.Equal(t, http.StatusNotFound, w.Code, "%s %s should be denied by the allowlist, got body: %s", tc.method, tc.path, w.Body.String())
		require.Contains(t, w.Body.String(), "not available for this group", "%s %s", tc.method, tc.path)
	}
}

func TestGatewayRoutesGroupModelAllowlistSkipsWebSocketUpgrade(t *testing.T) {
	router := newGatewayRoutesTestRouterWithGroup(allowlistGroup(service.PlatformOpenAI, true, "gpt-5.4"))

	req := httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.NotEqual(t, http.StatusNotFound, w.Code,
		"WS upgrade requests must be admitted and per-frame checked in the handler, got: %s", w.Body.String())
}

func TestGatewayRoutesGroupModelAllowlistModelFreeRoutesUnaffected(t *testing.T) {
	router := newGatewayRoutesTestRouterWithGroup(allowlistGroup(service.PlatformGrok, true, "grok-4.6"))

	// 不携带模型的入口天然不受白名单影响（状态查询/内容下载/模型列表）。
	for _, path := range []string{
		"/v1/videos/generations/req-1",
		"/v1/videos/req-1/content",
		"/v1/images/tasks/task-1",
		"/v1/custom-voices",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		require.NotContains(t, w.Body.String(), "not available for this group",
			"%s should not be blocked by the allowlist middleware, got: %s", path, w.Body.String())
	}
}
