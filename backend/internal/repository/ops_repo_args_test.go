//go:build unit

package repository

import (
	"database/sql"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/stretchr/testify/require"
)

func TestOpsInsertErrorLogArgsPreservesExplicitZeroUpstreamStatus(t *testing.T) {
	zero := 0
	args := opsInsertErrorLogArgs(&service.OpsInsertErrorLogInput{UpstreamStatusCode: &zero})

	require.Len(t, args, 39)
	encoded, ok := args[27].(sql.NullInt64)
	require.True(t, ok)
	require.True(t, encoded.Valid)
	require.Zero(t, encoded.Int64)
}

// retry_after_seconds 紧跟在 time_to_first_token_ms 之后，两者都是「这次请求实际
// 发生了什么」的记录，放在同一段里便于对照。
func TestOpsInsertErrorLogArgsCarriesRetryAfter(t *testing.T) {
	seconds := 30
	args := opsInsertErrorLogArgs(&service.OpsInsertErrorLogInput{RetryAfterSeconds: &seconds})

	require.Len(t, args, 39)
	encoded, ok := args[36].(sql.NullInt64)
	require.True(t, ok)
	require.True(t, encoded.Valid)
	require.EqualValues(t, 30, encoded.Int64)
}

// 未设置时必须写成 NULL，不能落成 0 —— 0 会被读成「要求客户端等 0 秒」。
func TestOpsInsertErrorLogArgsOmitsAbsentRetryAfter(t *testing.T) {
	args := opsInsertErrorLogArgs(&service.OpsInsertErrorLogInput{})

	encoded, ok := args[36].(sql.NullInt64)
	require.True(t, ok)
	require.False(t, encoded.Valid)
}

func TestOpsNullableIntPointerDistinguishesNilZeroAndStatus(t *testing.T) {
	missing := opsNullableIntPointer(nil).(sql.NullInt64)
	require.False(t, missing.Valid)

	zeroValue := 0
	zero := opsNullableIntPointer(&zeroValue).(sql.NullInt64)
	require.True(t, zero.Valid)
	require.Zero(t, zero.Int64)

	statusValue := 503
	status := opsNullableIntPointer(&statusValue).(sql.NullInt64)
	require.True(t, status.Valid)
	require.EqualValues(t, 503, status.Int64)
}
