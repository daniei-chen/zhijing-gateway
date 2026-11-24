package main

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestShutdownTimeoutDefaultsWhenUnset(t *testing.T) {
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "")

	require.Equal(t, defaultShutdownTimeout, shutdownTimeout())
	// 必须小于 Docker 默认的 10 秒停止超时，否则进程还没退出就被 SIGKILL，
	// 那段等待就白做了。
	require.Less(t, defaultShutdownTimeout, 10*time.Second)
}

func TestShutdownTimeoutHonoursConfiguredSeconds(t *testing.T) {
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "30")

	require.Equal(t, 30*time.Second, shutdownTimeout())
}

func TestShutdownTimeoutTrimsSurroundingSpace(t *testing.T) {
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "  45  ")

	require.Equal(t, 45*time.Second, shutdownTimeout())
}

func TestShutdownTimeoutFallsBackOnBadValue(t *testing.T) {
	for _, raw := range []string{"0", "-1", "abc", "12s", ""} {
		t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", raw)
		require.Equal(t, defaultShutdownTimeout, shutdownTimeout(), "value %q should fall back", raw)
	}
}

func TestShutdownTimeoutCapsAbsurdValue(t *testing.T) {
	t.Setenv("SHUTDOWN_TIMEOUT_SECONDS", "99999")

	require.Equal(t, maxShutdownTimeout, shutdownTimeout())
}
