//go:build unit

package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/handler/admin"
	"github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 本文件是 /admin/system/update 应用层硬门的装配级门禁。
//
// 单测桩能证明「门函数在参数为关闭时拒绝」，证明不了「装配把这份配置接进了路由」，
// 也证明不了「关掉全局 step-up 开关不会顺手把这个门关掉」。这里用真实的装配函数
// ProvideSystemHandler 与真实的路由装配来断言这两件事。
//
// 默认值本身（security.admin_system_update.enabled=false、allow_cidrs 只含回环）由
// internal/config 的 admin_system_update_config_test.go 锁定，这里不重复。

const systemUpdateRoutePath = "/api/v1/admin/system/update"

type securityInvariantSettingsRepoStub struct {
	values map[string]string
}

func (s *securityInvariantSettingsRepoStub) Get(context.Context, string) (*service.Setting, error) {
	panic("unexpected Get call")
}

func (s *securityInvariantSettingsRepoStub) GetValue(_ context.Context, key string) (string, error) {
	if value, ok := s.values[key]; ok {
		return value, nil
	}
	return "", service.ErrSettingNotFound
}

func (s *securityInvariantSettingsRepoStub) Set(context.Context, string, string) error {
	panic("unexpected Set call")
}

func (s *securityInvariantSettingsRepoStub) GetMultiple(_ context.Context, keys []string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	for _, key := range keys {
		if value, ok := s.values[key]; ok {
			out[key] = value
		}
	}
	return out, nil
}

func (s *securityInvariantSettingsRepoStub) SetMultiple(context.Context, map[string]string) error {
	panic("unexpected SetMultiple call")
}

func (s *securityInvariantSettingsRepoStub) GetAll(context.Context) (map[string]string, error) {
	out := make(map[string]string, len(s.values))
	for key, value := range s.values {
		out[key] = value
	}
	return out, nil
}

func (s *securityInvariantSettingsRepoStub) Delete(context.Context, string) error {
	panic("unexpected Delete call")
}

func postSystemUpdateThrough(t *testing.T, router *gin.Engine, remoteAddr string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, systemUpdateRoutePath, nil)
	req.RemoteAddr = remoteAddr
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// 装配后的默认配置必须直接拒绝：任何能拿到管理员 JWT 的人都不能靠这个端点把
// 主机上的二进制换掉。
func TestSecurityInvariantAdminSystemUpdateGateWiredClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)

	for _, peer := range []string{"127.0.0.1:41234", "203.0.113.9:41234"} {
		t.Run(peer, func(t *testing.T) {
			// 与 config.Load 的默认值同形：门关闭、白名单只含回环。
			cfg := &config.Config{Security: config.SecurityConfig{AdminSystemUpdate: config.AdminSystemUpdateConfig{
				Enabled:    false,
				AllowCIDRs: []string{"127.0.0.1/32", "::1/128"},
			}}}
			h := ProvideSystemHandler(nil, nil, cfg, nil, nil)

			served := false
			router := gin.New()
			router.POST(systemUpdateRoutePath, h.UpdateGate(), func(c *gin.Context) {
				served = true
				c.Status(http.StatusOK)
			})

			rec := postSystemUpdateThrough(t, router, peer)

			require.Equal(t, http.StatusForbidden, rec.Code)
			require.Contains(t, rec.Body.String(), middleware.SystemUpdateGateForbiddenCode)
			require.False(t, served, "门关闭时 handler 不得执行")
		})
	}
}

// 全局 step-up 开关关闭时，普通 step-up 门控直接放行；而 /admin/system/update 的
// 硬门仍然拒绝。两条对照在同一个测试里，改坏其中一条都会让这里变红。
func TestSecurityInvariantAdminSystemUpdateGateIgnoresStepUpSwitch(t *testing.T) {
	gin.SetMode(gin.TestMode)

	settings := service.NewSettingService(&securityInvariantSettingsRepoStub{values: map[string]string{}}, &config.Config{})
	require.False(t, settings.IsStepUpEnabled(context.Background()),
		"前提：库里没有 step_up_enabled 行时开关为关闭（默认关闭）")

	served := false
	switchGated := gin.New()
	switchGated.POST(systemUpdateRoutePath, gin.HandlerFunc(middleware.NewStepUpAuthMiddleware(nil, nil, settings)), func(c *gin.Context) {
		served = true
		c.Status(http.StatusOK)
	})
	rec := postSystemUpdateThrough(t, switchGated, "127.0.0.1:41234")
	require.Equal(t, http.StatusOK, rec.Code,
		"对照：开关关闭时，读开关的普通 step-up 门控会放行——这正是硬门必须独立存在的原因")
	require.True(t, served)

	opened := &config.Config{Security: config.SecurityConfig{AdminSystemUpdate: config.AdminSystemUpdateConfig{
		Enabled:    true,
		AllowCIDRs: []string{"127.0.0.1/32"},
	}}}
	h := ProvideSystemHandler(nil, nil, opened, nil, nil)

	served = false
	hardGate := gin.New()
	hardGate.POST(systemUpdateRoutePath, h.UpdateGate(), func(c *gin.Context) {
		served = true
		c.Status(http.StatusOK)
	})

	rec = postSystemUpdateThrough(t, hardGate, "127.0.0.1:41234")

	require.Equal(t, http.StatusUnauthorized, rec.Code,
		"门开着、对端在 allow_cidrs 里，但没有 step-up 会话：必须拒绝，且与全局开关无关")
	require.False(t, served)
}

// 装配缺失（忘了 SetUpdateGate）不能变成放行：这个端点默认必须是关的。
func TestSecurityInvariantAdminSystemUpdateGateFailsClosedWhenUnwired(t *testing.T) {
	gin.SetMode(gin.TestMode)

	h := admin.NewSystemHandler(nil, nil)

	served := false
	router := gin.New()
	router.POST(systemUpdateRoutePath, h.UpdateGate(), func(c *gin.Context) {
		served = true
		c.Status(http.StatusOK)
	})

	rec := postSystemUpdateThrough(t, router, "127.0.0.1:41234")

	require.Equal(t, http.StatusForbidden, rec.Code)
	require.Contains(t, rec.Body.String(), middleware.SystemUpdateGateForbiddenCode)
	require.False(t, served)
}
