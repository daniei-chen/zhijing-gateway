package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/securityaudit"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestOpsLocalContentPolicyClassification(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	decision := &securityaudit.Decision{
		Kind: securityaudit.DecisionBlock, HTTPStatus: http.StatusForbidden, ErrorCode: "content_policy_violation",
		Legacy: &securityaudit.LegacyDecision{Blocked: true, StatusCode: http.StatusForbidden, ErrorCode: "content_policy_violation"},
	}
	markLocalContentPolicyError(c, decision)
	errType := normalizeOpsErrorType("api_error", "content_policy_violation")
	require.Equal(t, "permission_error", errType)
	phase, limited, owner, source := classifyOpsErrorLog(c, errType, "custom local policy message", "content_policy_violation", http.StatusForbidden)
	require.Equal(t, "request", phase)
	require.True(t, limited)
	require.Equal(t, "client", owner)
	require.Equal(t, "gateway_content_policy", source)
	require.Equal(t, "P3", classifyOpsSeverity(errType, http.StatusForbidden))
}

func TestOpsUpstreamContentPolicyIsNotLocalBusinessLimit(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set(service.OpsUpstreamStatusCodeKey, http.StatusForbidden)
	errType := normalizeOpsErrorType("api_error", "content_policy_violation")
	phase, limited, _, source := classifyOpsErrorLog(c, errType, "upstream refused", "content_policy_violation", http.StatusForbidden)
	require.Equal(t, "upstream", phase)
	require.False(t, limited)
	require.NotEqual(t, "gateway_content_policy", source)
}

func TestOpsLocalContentPolicyResponseClassification(t *testing.T) {
	gin.SetMode(gin.TestMode)
	decision := &securityaudit.Decision{
		Kind: securityaudit.DecisionBlock, HTTPStatus: http.StatusForbidden, ErrorCode: "content_policy_violation",
		Legacy: &securityaudit.LegacyDecision{Blocked: true, StatusCode: http.StatusForbidden, ErrorCode: "content_policy_violation"},
	}
	for name, respond := range map[string]func(*gin.Context, *securityaudit.Decision){
		"openai":           (&OpenAIGatewayHandler{}).openAISecurityAuditError,
		"chat":             (&GatewayHandler{}).openAISecurityAuditError,
		"responses":        (&GatewayHandler{}).responsesSecurityAuditError,
		"anthropic":        (&GatewayHandler{}).anthropicSecurityAuditError,
		"openai-anthropic": (&OpenAIGatewayHandler{}).anthropicSecurityAuditError,
		"google":           googleSecurityAuditError,
	} {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			respond(c, decision)
			require.Equal(t, http.StatusForbidden, w.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			typ, code := service.OpsLocalErrorType(c)
			require.Equal(t, "permission_error", typ)
			require.Equal(t, "content_policy_violation", code)
			require.True(t, service.IsOpsRequestScopedError(c))
			phase, limited, _, source := classifyOpsErrorLog(c, typ, "", code, w.Code)
			require.Equal(t, "request", phase)
			require.True(t, limited)
			require.Equal(t, "gateway_content_policy", source)
		})
	}
}
