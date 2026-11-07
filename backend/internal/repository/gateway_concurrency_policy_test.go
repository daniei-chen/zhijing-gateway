package repository

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func gatewayPolicyFixture(t *testing.T, member, global int) (*concurrencyCache, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = client.Close() })
	if address := os.Getenv("ZHIJING_ISOLATED_REDIS_ADDR"); address != "" {
		if address != "127.0.0.1:6379" || os.Getenv("ZHIJING_ISOLATED_REDIS_CONFIRM") != "disposable-network-namespace" {
			t.Fatal("external Redis tests require the disposable container namespace")
		}
		_ = client.Close()
		client = redis.NewClient(&redis.Options{Addr: address, MaxRetries: -1})
		t.Cleanup(func() { _ = client.Close() })
		require.NoError(t, client.Ping(context.Background()).Err())
		require.NoError(t, client.FlushDB(context.Background()).Err())
	}
	cache := NewConcurrencyCache(client, 30, 60).(*concurrencyCache)
	cache.memberLimit, cache.globalLimit = member, global
	return cache, server
}

func TestGatewayConcurrencyPolicyAtomicAllMembers(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 9)
	ctx := context.Background()
	var mu sync.Mutex
	admitted := make(map[int64][]string)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range 160 {
		wg.Go(func() {
			<-start
			user := int64(i%8 + 1)
			id := fmt.Sprintf("synthetic-key-%d", i)
			ok, err := c.AcquireUserSlot(ctx, user, 20, id)
			if !ok {
				var limited *service.GatewayConcurrencyLimitError
				require.ErrorAs(t, err, &limited)
				return
			}
			require.NoError(t, err)
			mu.Lock()
			admitted[user] = append(admitted[user], id)
			mu.Unlock()
		})
	}
	close(start)
	wg.Wait()
	total := 0
	for user, ids := range admitted {
		require.LessOrEqual(t, len(ids), 3)
		total += len(ids)
		count, err := c.GetUserConcurrency(ctx, user)
		require.NoError(t, err)
		require.Equal(t, len(ids), count)
	}
	require.Equal(t, 9, total)
	for user, ids := range admitted {
		for _, id := range ids {
			require.NoError(t, c.ReleaseUserSlot(ctx, user, id))
			require.NoError(t, c.ReleaseUserSlot(ctx, user, id))
		}
	}
	ok, err := c.AcquireUserSlot(ctx, 99, 3, "after-release")
	require.NoError(t, err)
	require.True(t, ok)
}

func TestGatewayConcurrencyPolicyUserGlobalAndExpiry(t *testing.T) {
	if os.Getenv("ZHIJING_ISOLATED_REDIS_ADDR") != "" {
		t.Skip("controlled time travel requires miniredis; real Redis is covered by the other policy cases")
	}
	c, server := gatewayPolicyFixture(t, 3, 9)
	ctx := context.Background()
	for i := range 3 {
		ok, err := c.AcquireUserSlot(ctx, 1, 999, fmt.Sprint(i))
		require.NoError(t, err)
		require.True(t, ok)
	}
	ok, err := c.AcquireUserSlot(ctx, 1, 999, "fourth-key")
	require.False(t, ok)
	var limit *service.GatewayConcurrencyLimitError
	require.ErrorAs(t, err, &limit)
	require.Equal(t, "user", limit.Scope)
	for user := int64(2); user <= 3; user++ {
		for i := range 3 {
			ok, err := c.AcquireUserSlot(ctx, user, 3, fmt.Sprint(i))
			require.NoError(t, err)
			require.True(t, ok)
		}
	}
	ok, err = c.AcquireUserSlot(ctx, 4, 3, "tenth")
	require.False(t, ok)
	require.ErrorAs(t, err, &limit)
	require.Equal(t, "global", limit.Scope)
	// Idempotent refresh must not consume a tenth reservation.
	ok, err = c.AcquireUserSlot(ctx, 1, 3, "0")
	require.NoError(t, err)
	require.True(t, ok)
	server.FastForward(31 * time.Minute)
	ok, err = c.AcquireUserSlot(ctx, 4, 3, "after-crash-expiry")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, int64(1), c.rdb.ZCard(ctx, gatewayUserIndexKey).Val())
}

func TestGatewayConcurrencyPolicyIncludesLegacyAndLiveWithoutIndex(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 9)
	ctx := context.Background()
	now := float64(c.rdb.Time(ctx).Val().Unix())
	// The original Live implementation does not maintain the ordinary index.
	for i := range 9 {
		key := liveUserSlotKey(int64(i + 1))
		if i%2 == 0 {
			key = userSlotKey(int64(i + 1))
		}
		require.NoError(t, c.rdb.ZAdd(ctx, key, redis.Z{Score: now, Member: "old-peer"}).Err())
	}
	ok, err := c.AcquireUserSlot(ctx, 20, 3, "new-peer")
	require.False(t, ok)
	var limit *service.GatewayConcurrencyLimitError
	require.ErrorAs(t, err, &limit)
	require.Equal(t, "global", limit.Scope)
	require.Equal(t, int64(1), c.rdb.ZCard(ctx, userSlotKey(1)).Val(), "startup must not erase peer work")
}

func TestGatewayConcurrencyPolicyLiveHandoffAndDirectAdmission(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 9)
	ctx := context.Background()
	for user := int64(1); user <= 3; user++ {
		for i := range 3 {
			ok, err := c.AcquireUserSlot(ctx, user, 3, fmt.Sprint(i))
			require.NoError(t, err)
			require.True(t, ok)
		}
	}
	ok, err := c.AcquireAccountSlot(ctx, 10, 8, "ordinary-account")
	require.NoError(t, err)
	require.True(t, ok)
	ok, err = c.AcquireLiveLease(ctx, 10, 8, 1, 3, 100, "0", true)
	require.NoError(t, err)
	require.True(t, ok, "handoff at global ceiling must not allocate another request")
	ok, err = c.AcquireUserSlot(ctx, 4, 3, "tenth-during-handoff")
	require.False(t, ok)
	var limit *service.GatewayConcurrencyLimitError
	require.ErrorAs(t, err, &limit)
	require.NoError(t, c.ReleaseUserSlot(ctx, 1, "0"))
	require.NoError(t, c.ReleaseAccountSlot(ctx, 10, "ordinary-account"))
	ok, err = c.AcquireLiveLease(ctx, 10, 8, 4, 3, 101, "direct-live", false)
	require.False(t, ok)
	require.ErrorAs(t, err, &limit)
	ok, err = c.AcquireLiveLease(ctx, 10, 8, 4, 3, 101, "forged-handoff", true)
	require.False(t, ok)
	require.ErrorContains(t, err, "existing user reservation")
	require.NoError(t, c.ReleaseLiveLease(ctx, 10, 1, 100, "0"))
	ok, err = c.AcquireLiveLease(ctx, 10, 8, 4, 3, 101, "direct-live", false)
	require.NoError(t, err)
	require.True(t, ok)
	refreshed, err := c.RefreshLiveLease(ctx, 10, 4, 101, "direct-live")
	require.NoError(t, err)
	require.True(t, refreshed)
	ok, err = c.AcquireUserSlot(ctx, 5, 3, "tenth-after-handoff")
	require.False(t, ok)
	require.ErrorAs(t, err, &limit)
}

func TestGatewayConcurrencyPolicyKeepsAccountLimitsIndependent(t *testing.T) {
	c, _ := gatewayPolicyFixture(t, 3, 9)
	for _, account := range []struct {
		id    int64
		limit int
	}{{10, 8}, {20, 10}, {30, 9}} {
		for i := range account.limit + 1 {
			ok, err := c.AcquireAccountSlot(context.Background(), account.id, account.limit, fmt.Sprint(i))
			require.NoError(t, err)
			require.Equal(t, i < account.limit, ok)
		}
	}
}

func TestGatewayConcurrencyPolicyRedisFailureAndBoundFailClosed(t *testing.T) {
	t.Run("redis unavailable", func(t *testing.T) {
		if os.Getenv("ZHIJING_ISOLATED_REDIS_ADDR") != "" {
			t.Skip("closing the in-memory server cannot stop the separate disposable Redis")
		}
		c, server := gatewayPolicyFixture(t, 3, 9)
		server.Close()
		ok, err := c.AcquireUserSlot(context.Background(), 1, 3, "never-admitted")
		require.Error(t, err)
		require.False(t, ok)
	})
	t.Run("bounded registry", func(t *testing.T) {
		c, _ := gatewayPolicyFixture(t, 3, 9)
		ctx := context.Background()
		for i := range 4097 {
			require.NoError(t, c.rdb.ZAdd(ctx, gatewayUserIndexKey, redis.Z{Member: fmt.Sprint(i + 1)}).Err())
		}
		ok, err := c.AcquireUserSlot(ctx, 1, 3, "never-admitted")
		require.False(t, ok)
		require.ErrorContains(t, err, "index bound exceeded")
	})
}

func TestGatewayConcurrencyPolicyIndependentInstancesShareOneCeiling(t *testing.T) {
	first, _ := gatewayPolicyFixture(t, 3, 9)
	otherClient := redis.NewClient(&redis.Options{Addr: first.rdb.Options().Addr, MaxRetries: -1})
	t.Cleanup(func() { _ = otherClient.Close() })
	second := NewConcurrencyCache(otherClient, 30, 60).(*concurrencyCache)
	second.memberLimit, second.globalLimit = 3, 9
	instances := []*concurrencyCache{first, second}
	ctx := context.Background()
	var admitted sync.Map
	var workers sync.WaitGroup
	start := make(chan struct{})
	for i := range 160 {
		workers.Go(func() {
			<-start
			user := int64(i%8 + 1)
			requestID := fmt.Sprintf("instance-%d-key-%d", i%2, i)
			ok, err := instances[i%2].AcquireUserSlot(ctx, user, 3, requestID)
			if ok {
				require.NoError(t, err)
				admitted.Store(requestID, user)
				return
			}
			var limited *service.GatewayConcurrencyLimitError
			require.ErrorAs(t, err, &limited)
		})
	}
	close(start)
	workers.Wait()
	count, perMember := 0, make(map[int64]int)
	admitted.Range(func(requestID, user any) bool {
		count++
		perMember[user.(int64)]++
		// A different API instance may perform completion cleanup.
		require.NoError(t, second.ReleaseUserSlot(ctx, user.(int64), requestID.(string)))
		return true
	})
	require.Equal(t, 9, count)
	for _, count := range perMember {
		require.LessOrEqual(t, count, 3)
	}
	ok, err := first.AcquireUserSlot(ctx, 99, 3, "after-cross-instance-release")
	require.NoError(t, err)
	require.True(t, ok)
}

func TestGatewayConcurrencyPolicyRefreshedLiveLeaseStaysCounted(t *testing.T) {
	if os.Getenv("ZHIJING_ISOLATED_REDIS_ADDR") != "" {
		t.Skip("scaled expiry requires a controllable clock")
	}
	c, server := gatewayPolicyFixture(t, 3, 1)
	ctx := context.Background()
	ok, err := c.AcquireLiveLease(ctx, 10, 8, 1, 3, 100, "long-live", false)
	require.NoError(t, err)
	require.True(t, ok)
	// The user registry score is not refreshed by the existing Live refresh
	// script. Counting must follow the owned lease, not expire that registry.
	for range 100 {
		server.FastForward(20 * time.Second)
		owned, err := c.RefreshLiveLease(ctx, 10, 1, 100, "long-live")
		require.NoError(t, err)
		require.True(t, owned)
	}
	ok, err = c.AcquireUserSlot(ctx, 2, 3, "must-still-be-blocked")
	require.False(t, ok)
	var limited *service.GatewayConcurrencyLimitError
	require.ErrorAs(t, err, &limited)
	require.Equal(t, "global", limited.Scope)
	require.NoError(t, c.ReleaseLiveLease(ctx, 10, 1, 100, "long-live"))
	ok, err = c.AcquireUserSlot(ctx, 2, 3, "after-real-live-completion")
	require.NoError(t, err)
	require.True(t, ok)
}
