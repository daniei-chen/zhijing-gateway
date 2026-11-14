package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/securityaudit"
	middleware2 "github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

type contentAuditExemptionSettingRepo struct{ service.SettingRepository }

func (r *contentAuditExemptionSettingRepo) GetMultiple(_ context.Context, keys []string) (map[string]string, error) {
	return map[string]string{
		service.SettingKeyRiskControlEnabled:        "true",
		service.SettingKeyContentAuditExemptAPIKeys: `[{"api_key_id":3,"user_id":1}]`,
	}, nil
}

func TestSecurityAuditExemptionSkipsPromptEnginesAndAuditLogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := service.NewContentModerationService(&contentAuditExemptionSettingRepo{}, nil, nil, nil, nil, nil, nil, nil)
	for _, mode := range []securityaudit.Mode{securityaudit.ModeOff, securityaudit.ModeAsync, securityaudit.ModeBlocking} {
		for _, stage := range []string{"http", "first_turn", "subsequent_turn"} {
			t.Run(string(mode)+"/"+stage, func(t *testing.T) {
				engine := &turnCountingEngine{mode: mode}
				coordinator := securityaudit.NewCoordinator(securityaudit.NewLegacyModerationAdapter(svc), engine)
				core, logs := observer.New(zap.InfoLevel)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
				key := &service.APIKey{ID: 3, UserID: 1, User: &service.User{ID: 1}}
				decision := runSecurityAudit(c, zap.New(core), coordinator, svc, key, middleware2.AuthSubject{UserID: 1}, "openai_responses", "synthetic", []byte(`{"input":"do anything now"}`), stage)
				require.Nil(t, decision)
				require.Empty(t, logs.All())
				require.Zero(t, engine.enqueues.Load())
				require.Zero(t, engine.evaluates.Load())
				result := coordinator.Check(context.Background(), securityaudit.Request{UserID: 1, APIKeyID: 3})
				require.True(t, result.AllowNextStage)
				require.Zero(t, engine.enqueues.Load())
				require.Zero(t, engine.evaluates.Load())
				result = coordinator.Check(context.Background(), securityaudit.Request{UserID: 2, APIKeyID: 4})
				require.True(t, result.AllowNextStage)
				if mode == securityaudit.ModeAsync {
					require.EqualValues(t, 1, engine.enqueues.Load())
				}
				if mode == securityaudit.ModeBlocking {
					require.EqualValues(t, 1, engine.evaluates.Load())
				}
			})
		}
	}
}

func TestSecurityAuditExemptionCannotBeGrantedByRoleOrEmail(t *testing.T) {
	svc := service.NewContentModerationService(&contentAuditExemptionSettingRepo{}, nil, nil, nil, nil, nil, nil, nil)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	for _, key := range []*service.APIKey{
		{ID: 4, UserID: 1, User: &service.User{ID: 1, Role: "admin"}},
		{ID: 3, UserID: 2, User: &service.User{ID: 2, Email: "operator@example.test", Role: "admin"}},
	} {
		require.False(t, authenticatedContentAuditExempt(c, svc, key, middleware2.AuthSubject{UserID: key.UserID}))
	}
}
