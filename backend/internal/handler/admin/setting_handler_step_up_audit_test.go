//go:build unit

package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// settingsAuditCacheStub 只实现 HasStepUpGrant，其余 TotpCache 方法走内嵌 nil 接口。
type settingsAuditCacheStub struct {
	service.TotpCache
	granted bool
}

func (s settingsAuditCacheStub) HasStepUpGrant(context.Context, int64, string) (bool, error) {
	return s.granted, nil
}

// doUpdateSettingsWithContext 与 doUpdateSettings 相同，但把 gin 上下文交回给调用方读审计字段。
func doUpdateSettingsWithContext(t *testing.T, h *SettingHandler, body map[string]any) *gin.Context {
	t.Helper()
	rawBody, err := json.Marshal(body)
	require.NoError(t, err)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/api/v1/admin/settings", bytes.NewReader(rawBody))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 1})
	c.Set("auth_method", service.AuditAuthMethodJWT)
	h.UpdateSettings(c)
	return c
}

func newSettingsAuditHandler(t *testing.T, granted bool) *SettingHandler {
	t.Helper()
	gin.SetMode(gin.TestMode)
	repo := &settingHandlerRepoStub{values: map[string]string{}}
	svc := service.NewSettingService(repo, &config.Config{Default: config.DefaultConfig{UserConcurrency: 5}})
	h := NewSettingHandler(svc, nil, nil, nil, nil, nil, nil)
	totp := service.NewTotpService(nil, nil, settingsAuditCacheStub{granted: granted}, svc, nil, nil)
	h.SetStepUpDeps(totp, nil)
	return h
}

// TestUpdateSettingsAuditsMissingStepUpGrant 是「PUT /admin/settings 不拦」这条残留风险的看守：
// 没有 step-up 授权的设置写入必须在审计里留下标记，否则事后无法区分是谁改的。
func TestUpdateSettingsAuditsMissingStepUpGrant(t *testing.T) {
	h := newSettingsAuditHandler(t, false)

	c := doUpdateSettingsWithContext(t, h, map[string]any{"default_concurrency": 6})

	extra, ok := c.Get("audit_extra")
	require.True(t, ok, "没有 step-up 授权的设置写入必须写审计标记")
	fields, ok := extra.(map[string]any)
	require.True(t, ok)
	require.Equal(t, true, fields["settings_write_without_step_up"])
}

// 有 step-up 授权的设置写入不写这条标记（它只标记「未经 step-up」）。
func TestUpdateSettingsWithStepUpGrantWritesNoResidualMarker(t *testing.T) {
	h := newSettingsAuditHandler(t, true)

	c := doUpdateSettingsWithContext(t, h, map[string]any{"default_concurrency": 6})

	extra, ok := c.Get("audit_extra")
	if !ok {
		return
	}
	fields, ok := extra.(map[string]any)
	require.True(t, ok)
	_, marked := fields["settings_write_without_step_up"]
	require.False(t, marked)
}
