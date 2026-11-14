package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

// dynamicActiveStub 用嵌入式 nil 接口满足 ConcurrencyCache（测试只会调用
// ActiveUserCount，其余方法不会被触达），避免为 20 多个方法写空实现。
type dynamicActiveStub struct {
	ConcurrencyCache
	active int
	err    error
}

func (s *dynamicActiveStub) ActiveUserCount(context.Context) (int, error) {
	return s.active, s.err
}

// TestEffectiveMemberLimit 覆盖 2026-11-14 的动态并发规则：
// 活跃用户 <= 1 时放宽到 peak（默认部署为 5），已有 2 人时回落到 base（3）；
// peak 未配置或读取失败时必须保持 base，绝不能因为异常放大配额。
func TestEffectiveMemberLimit(t *testing.T) {
	cases := []struct {
		name        string
		base        int
		peak        int
		active      int
		err         error
		want        int
	}{
		{name: "peak 未配置时保持 base", base: 3, peak: 0, active: 0, want: 3},
		{name: "peak 不大于 base 时视为未启用", base: 5, peak: 5, active: 0, want: 5},
		{name: "无活跃用户可取 peak", base: 3, peak: 5, active: 0, want: 5},
		{name: "单用户在跑仍可取 peak", base: 3, peak: 5, active: 1, want: 5},
		{name: "已有两人在跑回落到 base", base: 3, peak: 5, active: 2, want: 3},
		{name: "三人以上保持 base", base: 3, peak: 5, active: 7, want: 3},
		{name: "读取失败回退 base", base: 3, peak: 5, active: 0, err: errors.New("redis down"), want: 3},
		{name: "base 为 0 表示不限", base: 0, peak: 5, active: 0, want: 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &dynamicActiveStub{active: tc.active, err: tc.err}
			svc := NewConcurrencyService(stub)
			svc.memberLimit = tc.base
			svc.memberLimitPeak = tc.peak

			require.Equal(t, tc.want, svc.effectiveMemberLimit(context.Background()))
		})
	}
}

// TestEffectiveMemberLimitNilCache 证明缓存缺失时不会 panic，且回退到 base。
func TestEffectiveMemberLimitNilCache(t *testing.T) {
	svc := NewConcurrencyService(nil)
	svc.memberLimit = 3
	svc.memberLimitPeak = 5

	require.Equal(t, 3, svc.effectiveMemberLimit(context.Background()))
}
