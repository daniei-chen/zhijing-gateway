package routes

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/handler"
	servermiddleware "github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const liveDisabledBody = `{"error":{"type":"not_found_error","message":"Live is not enabled"}}`

// newLiveRoutesTestRouter mounts the real gateway chain with a fake API key auth
// and a bare OpenAIGatewayHandler. The bare handler is deliberate: it can answer
// but never creates an upstream session, so any response that is not the guard's
// 404 proves the request reached the handler.
func newLiveRoutesTestRouter(t *testing.T, cfg *config.Config) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	groupID := int64(1)
	group := &service.Group{Platform: service.PlatformOpenAI, AllowLive: true}
	router := gin.New()
	RegisterGatewayRoutes(
		router,
		&handler.Handlers{
			Gateway:       &handler.GatewayHandler{},
			OpenAIGateway: &handler.OpenAIGatewayHandler{},
			AsyncImage:    handler.NewAsyncImageHandler(nil, nil),
		},
		servermiddleware.APIKeyAuthMiddleware(func(c *gin.Context) {
			c.Set(string(servermiddleware.ContextKeyAPIKey), &service.APIKey{
				ID:      1,
				GroupID: &groupID,
				Group:   group,
			})
			c.Set(string(servermiddleware.ContextKeyUser), servermiddleware.AuthSubject{UserID: 1, Concurrency: 1})
			c.Next()
		}),
		nil,
		nil,
		nil,
		nil,
		nil,
		cfg,
	)
	return router
}

// loadDefaultConfigForLiveTest loads the configuration exactly the way the
// server boots, so this test fails if gateway.live.enabled's default is flipped
// back to true.
func loadDefaultConfigForLiveTest(t *testing.T) *config.Config {
	t.Helper()
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	if value, ok := os.LookupEnv("GATEWAY_LIVE_ENABLED"); ok {
		t.Cleanup(func() { _ = os.Setenv("GATEWAY_LIVE_ENABLED", value) })
		require.NoError(t, os.Unsetenv("GATEWAY_LIVE_ENABLED"))
	}
	cfg, err := config.Load()
	require.NoError(t, err)
	return cfg
}

func liveTestRequest(method, path, body string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	return request
}

// TestGatewayRoutesLiveDisabledByDefault is the upgrade contract: with no Live
// setting at all, every Live entry point answers the explicit disabled error and
// the handler is never reached (the bare handler would answer 503/404 with a
// different body, and would never open an upstream session either way).
func TestGatewayRoutesLiveDisabledByDefault(t *testing.T) {
	cfg := loadDefaultConfigForLiveTest(t)
	require.False(t, cfg.Gateway.Live.Enabled, "gateway.live.enabled must default to false")

	router := newLiveRoutesTestRouter(t, cfg)
	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"create", http.MethodPost, "/v1/live", `{"sdp":"v=0\r\n","session":{"model":"gpt-live-test"}}`},
		{"sideband", http.MethodGet, "/v1/live/call_abc", ""},
		{"codex create", http.MethodPost, "/backend-api/codex/realtime/calls", `{"sdp":"v=0\r\n","session":{"model":"gpt-live-test"}}`},
		{"codex sideband", http.MethodGet, "/backend-api/codex/call_abc", ""},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, liveTestRequest(testCase.method, testCase.path, testCase.body))

			require.Equal(t, http.StatusNotFound, recorder.Code, recorder.Body.String())
			require.JSONEq(t, liveDisabledBody, recorder.Body.String(),
				"a disabled Live route must answer the explicit disabled error")
		})
	}
}

// TestGatewayRoutesLiveEnabledKeepsHandlerBehavior proves the guard is a pure
// pass-through when enabled: the handler's own responses (billing service
// unavailable for create, call not found for sideband) are what the client sees,
// not the disabled error.
func TestGatewayRoutesLiveEnabledKeepsHandlerBehavior(t *testing.T) {
	cfg := &config.Config{
		Gateway: config.GatewayConfig{
			MaxBodySize:     1024 * 1024,
			TextMaxBodySize: 1024 * 1024,
			Live: config.GatewayLiveConfig{
				Enabled:                   true,
				MaxSessionDurationSeconds: 3600,
			},
		},
	}
	router := newLiveRoutesTestRouter(t, cfg)

	createRecorder := httptest.NewRecorder()
	router.ServeHTTP(createRecorder, liveTestRequest(http.MethodPost, "/v1/live",
		`{"sdp":"v=0\r\n","session":{"model":"gpt-live-test"}}`))
	require.Equal(t, http.StatusServiceUnavailable, createRecorder.Code, createRecorder.Body.String())
	require.Contains(t, createRecorder.Body.String(), "Billing service unavailable")
	require.NotContains(t, createRecorder.Body.String(), "Live is not enabled")

	sidebandRecorder := httptest.NewRecorder()
	router.ServeHTTP(sidebandRecorder, liveTestRequest(http.MethodGet, "/v1/live/call_abc", ""))
	require.Equal(t, http.StatusNotFound, sidebandRecorder.Code, sidebandRecorder.Body.String())
	require.Contains(t, sidebandRecorder.Body.String(), "Live call not found")
	require.NotContains(t, sidebandRecorder.Body.String(), "Live is not enabled")
}

// TestGatewayRoutesEveryLiveRegistrationCarriesTheGuard is the drift guard: a
// new Live route added without liveGuard would silently bypass the kill switch.
func TestGatewayRoutesEveryLiveRegistrationCarriesTheGuard(t *testing.T) {
	sourceBytes, err := os.ReadFile("gateway.go")
	require.NoError(t, err)
	source := string(sourceBytes)

	require.Contains(t, source, "liveGuard := middleware.LiveEnabledGuard(cfg.Gateway.Live.Enabled)",
		"the Live guard must be driven by gateway.live.enabled")

	registrations := 0
	for index, line := range strings.Split(source, "\n") {
		if !strings.Contains(line, "h.OpenAIGateway.Live") {
			continue
		}
		registrations++
		require.Contains(t, line, "liveGuard",
			"gateway.go:%d registers a Live handler without liveGuard", index+1)
	}
	require.Equal(t, 4, registrations, "expected the four Live/LiveSideband registrations")
}
