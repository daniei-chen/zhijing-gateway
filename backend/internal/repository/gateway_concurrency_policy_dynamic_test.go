package repository

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestGatewayConcurrencyPolicyDynamicPeak 覆盖 2026-11-14 的仓库层动态硬上限。
//
// 背景：service 层会按活跃用户数放宽单用户上限，但仓库层历史上用固定的
// c.memberLimit 再压一次，导致放宽值永远无效（线上表现：配了 PEAK=5，第 4 个
// 并发仍被拒并提示"上限 3"）。这里断言硬上限本身也会随活跃用户数变化。
func TestGatewayConcurrencyPolicyDynamicPeak(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 20)
	c.memberLimitPeak = 5
	ctx := context.Background()

	// 没有任何活跃用户时，硬上限放宽到 peak。
	require.Equal(t, 5, c.effectiveMemberHardLimit(ctx))

	// 单个用户可以真的占满 5 个槽位（旧行为会在第 4 个就拒绝）。
	for i := range 5 {
		ok, err := c.AcquireUserSlot(ctx, 1, 999, fmt.Sprint(i))
		require.NoError(t, err)
		require.True(t, ok, "第 %d 个槽位应被 peak 允许", i+1)
	}

	// 第 6 个必须被拒：peak 是上限，不是无限。
	ok, err := c.AcquireUserSlot(ctx, 1, 999, "sixth")
	require.False(t, ok)
	require.Error(t, err)

	// 第二个用户开始并发后，活跃用户数变为 2，硬上限回落到静态值 3。
	ok, err = c.AcquireUserSlot(ctx, 2, 999, "user2-first")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, 3, c.effectiveMemberHardLimit(ctx), "两个活跃用户必须回落到静态上限")
}

// TestGatewayConcurrencyPolicyDynamicPeakDisabled 证明 peak 未配置时行为与旧版一致。
func TestGatewayConcurrencyPolicyDynamicPeakDisabled(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 20)
	ctx := context.Background()

	require.Equal(t, 3, c.effectiveMemberHardLimit(ctx))

	for i := range 3 {
		ok, err := c.AcquireUserSlot(ctx, 1, 999, fmt.Sprint(i))
		require.NoError(t, err)
		require.True(t, ok)
	}
	// 未启用 peak 时第 4 个照旧被拒。
	ok, err := c.AcquireUserSlot(ctx, 1, 999, "fourth")
	require.False(t, ok)
	require.Error(t, err)
}
