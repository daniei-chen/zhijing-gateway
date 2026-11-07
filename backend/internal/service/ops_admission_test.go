package service

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestOpsConcurrencyScopeUsesCodesAndAnchoredTemplates(t *testing.T) {
	require.Equal(t, "user", OpsConcurrencyScope(GatewayUserConcurrencyLimitCode, "localized message"))
	require.Equal(t, "user", OpsConcurrencyScope("gateway_concurrency_limit", "Concurrency limit exceeded for user, please retry later"))
	require.Equal(t, "global", OpsConcurrencyScope("", "网关并发已达上限，请稍后重试"))
	require.Equal(t, "", OpsConcurrencyScope("rate_limit_exceeded", "upstream says 个人并发已达上限"))
	require.Equal(t, "", OpsConcurrencyScope("rate_limit_exceeded", "organization rate limit reached"))
}
