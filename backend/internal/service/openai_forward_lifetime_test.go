package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOpenAIForwardLifetimeDrainsThenCancels(t *testing.T) {
	client, cancel := context.WithCancel(context.WithValue(context.Background(), "synthetic-key", "synthetic-value"))
	defer cancel()
	ctx, finish := beginOpenAIForwardLifetimeWithTimeouts(client, time.Second, 80*time.Millisecond)
	defer finish()
	upstream, constructionRelease := detachUpstreamContext(ctx)
	constructionRelease()
	require.Equal(t, "synthetic-value", upstream.Value("synthetic-key"))
	cancel()
	require.ErrorIs(t, ctx.Err(), context.Canceled)
	require.NoError(t, upstream.Err(), "client cancellation must permit terminal usage collection")
	select {
	case <-upstream.Done():
	case <-time.After(time.Second):
		t.Fatal("disconnect drain was not bounded")
	}
}

func TestOpenAIForwardLifetimeMaximumAndExplicitCleanup(t *testing.T) {
	ctx, finish := beginOpenAIForwardLifetimeWithTimeouts(context.Background(), 40*time.Millisecond, time.Second)
	defer finish()
	upstream, _ := detachUpstreamContext(ctx)
	select {
	case <-upstream.Done():
		require.ErrorIs(t, upstream.Err(), context.DeadlineExceeded)
	case <-time.After(time.Second):
		t.Fatal("forwarding maximum was not enforced")
	}
	ctx, finish = beginOpenAIForwardLifetimeWithTimeouts(context.Background(), time.Second, time.Second)
	upstream, _ = detachUpstreamContext(ctx)
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(finish)
	}
	wg.Wait()
	require.ErrorIs(t, upstream.Err(), context.Canceled)
}

func TestOpenAIForwardLifetimeNestedAndLegacyScopes(t *testing.T) {
	client, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx, finish := beginOpenAIForwardLifetimeWithTimeouts(client, time.Second, time.Second)
	defer finish()
	nested, releaseNested := beginOpenAIForwardLifetime(ctx, nil)
	releaseNested()
	require.Same(t, boundedOpenAIUpstreamContext(ctx), boundedOpenAIUpstreamContext(nested))
	require.NoError(t, boundedOpenAIUpstreamContext(nested).Err())
	legacy, releaseLegacy := detachUpstreamContext(client)
	defer releaseLegacy()
	cancel()
	require.NoError(t, legacy.Err(), "unrelated legacy protocols must not change implicitly")
}
