package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 本文件是敏感操作门禁（step-up）的防回归门禁，锁住一条不变量：
// 关闭 step-up 开关本身就是敏感操作，它必须由「不读开关」的无条件门执行——
// 否则门控内部二次读取开关失败时（IsStepUpEnabled 返回 false）会直接放行。
//
// 这里走的是装配级路径：真实的 service.SettingService（只把数据源换成内存桩）+
// 真实的 handler，不是给门控塞一个返回 false 的开关桩。

// stepUpSwitchReadFailureRepoStub 让读开关失败、但全量设置仍然报「已开启」，
// 复现「持久化状态说开启、门控二次读取失败」的那个 fail-open 口子。
type stepUpSwitchReadFailureRepoStub struct {
	*settingHandlerRepoStub
}

func (s *stepUpSwitchReadFailureRepoStub) GetValue(ctx context.Context, key string) (string, error) {
	if key == service.SettingKeyStepUpEnabled {
		return "", errors.New("settings store unavailable")
	}
	return s.settingHandlerRepoStub.GetValue(ctx, key)
}

func newSwitchReadFailureHandler(t *testing.T) (*SettingHandler, *stepUpSwitchReadFailureRepoStub, *service.SettingService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	repo := &stepUpSwitchReadFailureRepoStub{settingHandlerRepoStub: &settingHandlerRepoStub{values: map[string]string{
		service.SettingKeyStepUpEnabled: "true",
	}}}
	svc := service.NewSettingService(repo, &config.Config{})
	return NewSettingHandler(svc, nil, nil, nil, nil, nil, nil), repo, svc
}

// 前提：开关二次读失败时 IsStepUpEnabled 返回 false。这正是「开关关闭 → 放行」的
// 门控会 fail-open 的那一刻；关闭开关的操作必须仍然被拦下。
func TestSecurityInvariantDisablingStepUpRejectsWhenSwitchReadFails(t *testing.T) {
	h, repo, svc := newSwitchReadFailureHandler(t)

	require.False(t, svc.IsStepUpEnabled(context.Background()),
		"前提：读开关失败时 IsStepUpEnabled 返回 false（默认关闭）")

	t.Run("machine credential", func(t *testing.T) {
		rec := doUpdateSettings(t, h, map[string]any{"step_up_enabled": false}, func(c *gin.Context) {
			c.Set("auth_method", service.AuditAuthMethodAdminAPIKey)
		})

		require.Equal(t, http.StatusForbidden, rec.Code)
		require.Contains(t, rec.Body.String(), "STEP_UP_ADMIN_API_KEY_FORBIDDEN")
		require.Equal(t, "true", repo.values[service.SettingKeyStepUpEnabled],
			"被门禁拦下的请求不得落库，否则等于关掉了最后一层校验")
	})

	t.Run("no browser session", func(t *testing.T) {
		rec := doUpdateSettings(t, h, map[string]any{"step_up_enabled": false}, nil)

		require.Equal(t, http.StatusUnauthorized, rec.Code)
		require.Equal(t, "true", repo.values[service.SettingKeyStepUpEnabled])
	})
}

// 对照组：同一份请求经过「读开关」的普通 step-up 中间件时会被直接放行。
// 这条在同一个测试里跑，是为了让上面那条不变量有对照——如果哪天有人把
// EnforceStepUpAlways 换成普通门控，上面变红、这里仍然绿，diff 里一眼能看出来。
func TestSecurityInvariantSwitchGatedStepUpWouldAllowTheSameRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	_, _, svc := newSwitchReadFailureHandler(t)
	require.False(t, svc.IsStepUpEnabled(context.Background()))

	served := false
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("auth_method", service.AuditAuthMethodAdminAPIKey)
		c.Next()
	})
	router.PUT("/api/v1/admin/settings", gin.HandlerFunc(middleware.NewStepUpAuthMiddleware(nil, nil, svc)), func(c *gin.Context) {
		served = true
		c.Status(http.StatusOK)
	})

	rawBody, err := json.Marshal(map[string]any{"step_up_enabled": false})
	require.NoError(t, err)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(rawBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code,
		"开关关闭时普通 step-up 门控放行是既有语义，本测试用它做对照")
	require.True(t, served)
}
