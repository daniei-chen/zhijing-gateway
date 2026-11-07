package config

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// This file is maintained by ZHIJING on top of upstream sub2api.
// It guards two upgrade traps found in the v0.2.20 release notes:
//
//  1. The notes advertise `security.request_body_memory_budget_bytes` and
//     friends, but the code defines them under `gateway.*`. Writing the
//     documented (wrong) key is silently ignored by viper and falls back to the
//     defaults, so a deployment can believe it tightened the budget while still
//     running with 1 GiB.
//  2. The container memory limit is far below that 1 GiB default, so the wrong
//     key also means the budget never triggers before the kernel OOM killer.
//
// The test pins the real key path and the intended production values.

func loadWithBaseEnv(t *testing.T) *Config {
	t.Helper()
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("JWT_SECRET", strings.Repeat("x", 32))
	cfg, err := Load()
	require.NoError(t, err)
	return cfg
}

func TestLoadGatewayRequestBodySafetyFromEnv(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_BODY_MEMORY_BUDGET_BYTES", "268435456") // 256 MiB
	t.Setenv("GATEWAY_REQUEST_BODY_READ_TIMEOUT_SECONDS", "120")
	t.Setenv("GATEWAY_DOWNSTREAM_WRITE_TIMEOUT_SECONDS", "120")
	t.Setenv("GATEWAY_DISABLE_OPENAI_TRANSPORT_ERROR_COOLDOWN", "true")
	cfg := loadWithBaseEnv(t)

	require.EqualValues(t, 268435456, cfg.Gateway.RequestBodyMemoryBudgetBytes,
		"gateway.request_body_memory_budget_bytes must be settable through its real key")
	require.Equal(t, 120, cfg.Gateway.RequestBodyReadTimeoutSeconds)
	require.Equal(t, 120, cfg.Gateway.DownstreamWriteTimeoutSeconds)
	require.True(t, cfg.Gateway.DisableOpenAITransportErrorCooldown)
}

func TestReleaseNotesSecurityPrefixIsNotEffective(t *testing.T) {
	// If a future operator copies the release notes verbatim, these variables are
	// inert. This test documents that and fails loudly if upstream ever renames
	// the keys to security.* without us noticing.
	t.Setenv("SECURITY_REQUEST_BODY_MEMORY_BUDGET_BYTES", "1024")
	t.Setenv("SECURITY_REQUEST_BODY_READ_TIMEOUT_SECONDS", "1")
	t.Setenv("SECURITY_DOWNSTREAM_WRITE_TIMEOUT_SECONDS", "1")
	cfg := loadWithBaseEnv(t)

	require.EqualValues(t, 1024*1024*1024, cfg.Gateway.RequestBodyMemoryBudgetBytes,
		"security.* prefix must not reach the gateway budget; update the docs if upstream renames it")
	require.Equal(t, 120, cfg.Gateway.RequestBodyReadTimeoutSeconds)
	require.Equal(t, 120, cfg.Gateway.DownstreamWriteTimeoutSeconds)
}

func TestGatewayRequestBodyDefaultsAreContainerUnsafe(t *testing.T) {
	// Documents why production must override the budget: the upstream default
	// (1 GiB) exceeds the 768 MiB container limit used by this deployment.
	cfg := loadWithBaseEnv(t)
	require.EqualValues(t, 1024*1024*1024, cfg.Gateway.RequestBodyMemoryBudgetBytes)
	require.Greater(t, cfg.Gateway.RequestBodyMemoryBudgetBytes, int64(768*1024*1024),
		"default budget must stay above the container limit; production override is mandatory")
}
