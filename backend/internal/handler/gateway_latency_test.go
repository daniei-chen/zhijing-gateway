package handler

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestOpenAIPollConfigurationAndBounds(t *testing.T) {
	handler := NewOpenAIGatewayHandler(nil, nil, nil, nil, nil, nil, nil, nil, &config.Config{Concurrency: config.ConcurrencyConfig{OpenAIPollMaxIntervalMS: 250}})
	require.Equal(t, 250*time.Millisecond, handler.concurrencyHelper.pollMaxInterval)
	current := initialBackoff
	for range 1000 {
		current = nextBackoffWithMax(current, handler.concurrencyHelper.pollMaxInterval)
		require.GreaterOrEqual(t, current, initialBackoff)
		require.LessOrEqual(t, current, 250*time.Millisecond)
	}
	for _, value := range []time.Duration{0, -1, 99 * time.Millisecond, 3 * time.Second} {
		helper := NewConcurrencyHelper(nil, SSEPingFormatNone, 0).withPollMaxInterval(value)
		require.Equal(t, maxBackoff, helper.pollMaxInterval)
	}
}

func TestFastPollingKeepsDeadlineQueueAndReleaseSemantics(t *testing.T) {
	cache := &helperConcurrencyCacheStub{waitAllowed: true}
	for range 10 {
		cache.userSeq = append(cache.userSeq, false)
	}
	cache.userSeq = append(cache.userSeq, true)
	helper := NewConcurrencyHelper(service.NewConcurrencyService(cache), SSEPingFormatNone, 0).withPollMaxInterval(100 * time.Millisecond)
	c, _ := newHelperTestContext(http.MethodPost, "/v1/responses")
	c.Request = c.Request.WithContext(gatewaytiming.Start(c.Request.Context()))
	streamStarted := false
	release, err := helper.acquireUserSlotWithWaitTimeout(c, 1, 2, 3*time.Second, false, &streamStarted)
	require.NoError(t, err)
	require.NotNil(t, release)
	release()
	require.Equal(t, 1, cache.userReleaseCalls)
	require.Equal(t, 1, cache.waitIncrementCalls)
	require.Equal(t, 1, cache.waitDecrementCalls)
	require.Equal(t, 11, cache.userAcquireCalls)
	metrics := gatewaytiming.Snapshot(c.Request.Context())
	require.Equal(t, "acquired", metrics["user_wait_result"])
	require.Equal(t, int64(10), metrics["user_poll_attempts"])
	require.False(t, streamStarted)
}

func TestCanceledPollingDoesNotAcquireOrLeakQueue(t *testing.T) {
	cache := &helperConcurrencyCacheStub{waitAllowed: true}
	helper := NewConcurrencyHelper(service.NewConcurrencyService(cache), SSEPingFormatNone, 0).withPollMaxInterval(250 * time.Millisecond)
	c, _ := newHelperTestContext(http.MethodPost, "/v1/responses")
	ctx, cancel := context.WithCancel(gatewaytiming.Start(c.Request.Context()))
	c.Request = c.Request.WithContext(ctx)
	cache.waitIncrementHook = cancel
	streamStarted := false
	release, err := helper.acquireUserSlotWithWaitTimeout(c, 1, 2, time.Second, false, &streamStarted)
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, release)
	require.Equal(t, 1, cache.userAcquireCalls)
	require.Equal(t, 1, cache.waitDecrementCalls)
	require.Equal(t, "canceled", gatewaytiming.Snapshot(ctx)["user_wait_result"])
}

type latencyExperimentCache struct {
	helperConcurrencyCacheStub
	available time.Time
	checks    int
}

func (s *latencyExperimentCache) AcquireAccountSlot(ctx context.Context, accountID int64, maximum int, requestID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checks++
	return !time.Now().Before(s.available), ctx.Err()
}

func TestPollingReleaseLatencyExperiment(t *testing.T) {
	// Independent account IDs isolate wake-up latency from account contention.
	for _, maximum := range []time.Duration{2 * time.Second, 250 * time.Millisecond} {
		t.Run(maximum.String(), func(t *testing.T) {
			cache := &latencyExperimentCache{available: time.Now().Add(3 * time.Second)}
			helper := NewConcurrencyHelper(service.NewConcurrencyService(cache), SSEPingFormatNone, 0).withPollMaxInterval(maximum)
			var workers sync.WaitGroup
			var mu sync.Mutex
			lags := []time.Duration{}
			for id := range 16 {
				workers.Go(func() {
					c, _ := newHelperTestContext(http.MethodPost, "/v1/responses")
					started := false
					release, err := helper.AcquireAccountSlotWithWaitTimeout(c, int64(id+1), 8, 8*time.Second, false, &started)
					if err != nil {
						t.Error(err)
						return
					}
					defer release()
					mu.Lock()
					lags = append(lags, time.Since(cache.available))
					mu.Unlock()
				})
			}
			workers.Wait()
			require.Len(t, lags, 16)
			sort.Slice(lags, func(i, j int) bool { return lags[i] < lags[j] })
			t.Logf("synthetic_requests=16 maximum_poll=%s wakeup_p50=%s wakeup_p95=%s total_redis_acquire_calls=%d", maximum, lags[8], lags[15], cache.checks)
			// Real clocks can be delayed by the OS; verify strict interval bounds separately.
			require.Less(t, cache.checks, 16*82)
		})
	}
}
