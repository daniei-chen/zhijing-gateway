//go:build unit

package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// 硬门默认必须关死：enabled=false 且只放行回环。
func TestLoadAdminSystemUpdateGateDefaultsClosed(t *testing.T) {
	resetViperWithJWTSecret(t)

	cfg, err := Load()
	require.NoError(t, err)
	require.False(t, cfg.Security.AdminSystemUpdate.Enabled)
	require.Equal(t, []string{"127.0.0.1/32", "::1/128"}, cfg.Security.AdminSystemUpdate.AllowCIDRs)
}

func TestLoadAdminSystemUpdateGateFromConfigFile(t *testing.T) {
	resetViperWithJWTSecret(t)
	configFile := filepath.Join(t.TempDir(), "gate.yaml")
	require.NoError(t, os.WriteFile(configFile, []byte(`security:
  admin_system_update:
    enabled: true
    allow_cidrs:
      - 127.0.0.1/32
      - 175.27.132.225/32
`), 0o600))
	t.Setenv("CONFIG_FILE", configFile)

	cfg, err := Load()
	require.NoError(t, err)
	require.True(t, cfg.Security.AdminSystemUpdate.Enabled)
	require.Equal(t, []string{"127.0.0.1/32", "175.27.132.225/32"}, cfg.Security.AdminSystemUpdate.AllowCIDRs)
}

// 显式配置空列表表示谁都不放行，不能回落到默认的回环白名单。
func TestLoadAdminSystemUpdateGateExplicitEmptyAllowCIDRs(t *testing.T) {
	resetViperWithJWTSecret(t)
	configFile := filepath.Join(t.TempDir(), "gate.yaml")
	require.NoError(t, os.WriteFile(configFile, []byte(`security:
  admin_system_update:
    enabled: true
    allow_cidrs: []
`), 0o600))
	t.Setenv("CONFIG_FILE", configFile)

	cfg, err := Load()
	require.NoError(t, err)
	require.Empty(t, cfg.Security.AdminSystemUpdate.AllowCIDRs)
}

// 非法条目直接启动失败：静默忽略会让门看起来配好了、实际把来源全挡在门外。
func TestLoadRejectsInvalidAdminSystemUpdateAllowCIDR(t *testing.T) {
	resetViperWithJWTSecret(t)
	configFile := filepath.Join(t.TempDir(), "gate.yaml")
	require.NoError(t, os.WriteFile(configFile, []byte(`security:
  admin_system_update:
    enabled: true
    allow_cidrs:
      - 175.27.132.225/33
`), 0o600))
	t.Setenv("CONFIG_FILE", configFile)

	_, err := Load()
	require.ErrorContains(t, err, "security.admin_system_update.allow_cidrs")
	require.ErrorContains(t, err, "175.27.132.225/33")
}

func TestLoadAdminSystemUpdateGateNormalizesAllowCIDRs(t *testing.T) {
	resetViperWithJWTSecret(t)
	configFile := filepath.Join(t.TempDir(), "gate.yaml")
	require.NoError(t, os.WriteFile(configFile, []byte(`security:
  admin_system_update:
    enabled: true
    allow_cidrs:
      - " 175.27.132.225/32 "
      - ""
      - 175.27.132.225/32
      - 2001:db8::1
`), 0o600))
	t.Setenv("CONFIG_FILE", configFile)

	cfg, err := Load()
	require.NoError(t, err)
	require.Equal(t, []string{"175.27.132.225/32", "2001:db8::1"}, cfg.Security.AdminSystemUpdate.AllowCIDRs)
}

// 部署文档给出的环境变量写法必须真的生效（viper 只认已注册默认值的键）。
func TestLoadAdminSystemUpdateGateFromEnvironment(t *testing.T) {
	resetViperWithJWTSecret(t)
	t.Setenv("SECURITY_ADMIN_SYSTEM_UPDATE_ENABLED", "true")
	t.Setenv("SECURITY_ADMIN_SYSTEM_UPDATE_ALLOW_CIDRS", "127.0.0.1/32,175.27.132.225/32")

	cfg, err := Load()
	require.NoError(t, err)
	require.True(t, cfg.Security.AdminSystemUpdate.Enabled)
	require.Equal(t, []string{"127.0.0.1/32", "175.27.132.225/32"}, cfg.Security.AdminSystemUpdate.AllowCIDRs)
}
