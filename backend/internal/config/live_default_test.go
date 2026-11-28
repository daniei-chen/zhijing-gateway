package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestLiveDisabledByDefault 锁定升级后的默认状态：没有任何显式配置时 Live 关闭。
// 把 setDefaults 里的 gateway.live.enabled 改回 true，这条会红。
func TestLiveDisabledByDefault(t *testing.T) {
	resetViperWithJWTSecret(t)
	cfg, err := Load()
	require.NoError(t, err)
	require.False(t, cfg.Gateway.Live.Enabled, "gateway.live.enabled must default to false")
	require.Equal(t, 3600, cfg.Gateway.Live.MaxSessionDurationSeconds,
		"the existing max session duration default must not change")
}

func TestLiveEnabledReachableByEnv(t *testing.T) {
	resetViperWithJWTSecret(t)
	t.Setenv("GATEWAY_LIVE_ENABLED", "true")
	cfg, err := Load()
	require.NoError(t, err)
	require.True(t, cfg.Gateway.Live.Enabled, "GATEWAY_LIVE_ENABLED=true must turn Live on")
}
