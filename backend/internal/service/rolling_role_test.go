//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/stretchr/testify/require"
)

type rollingCache struct {
	stubConcurrencyCacheForTest
	startupCleanupCalls int
}

func (c *rollingCache) CleanupStaleProcessSlots(context.Context, string) error {
	c.startupCleanupCalls++
	return nil
}

func TestRollingRoleNeverClearsPeerLeases(t *testing.T) {
	for _, role := range []string{"1", "0"} {
		t.Run(role, func(t *testing.T) {
			t.Setenv("ZHIJING_API_ONLY", role)
			cache := &rollingCache{}
			ProvideConcurrencyService(cache, nil, &config.Config{})
			if role == "1" {
				require.Zero(t, cache.startupCleanupCalls)
			} else {
				require.Equal(t, 1, cache.startupCleanupCalls)
			}
		})
	}
}
