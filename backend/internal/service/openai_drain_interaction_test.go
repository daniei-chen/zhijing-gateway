package service

import (
	"context"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	pkghttputil "github.com/daniei-chen/zhijing-gateway/internal/pkg/httputil"
	"github.com/stretchr/testify/require"
)

// The merged code layers two drain mechanisms:
//
//  1. the local forwarding lifetime (max duration + client-disconnect drain),
//  2. the upstream per-attempt drain installed by NewUpstreamAttemptContext.
//
// Inside the local lifetime, detachUpstreamContext returns the lifetime's bounded
// context instead of calling DetachUpstreamContext, so the attempt layer has no
// drain policy of its own and must follow the bounded context. These tests pin
// that precedence: the local window (30s by default) wins over the upstream
// default (180s), and a long per-attempt default cannot extend it.

func TestBoundedLifetimeOverridesUpstreamAttemptDefault(t *testing.T) {
	client, cancelClient := context.WithCancel(context.Background())
	defer cancelClient()

	ctx, finish := beginOpenAIForwardLifetimeWithTimeouts(client, 5*time.Second, 80*time.Millisecond)
	defer finish()

	upstream, releaseConstruction := detachUpstreamContext(ctx)
	releaseConstruction()

	// A one-hour attempt budget must not leak into the attempt layer.
	attempt, releaseAttempt := pkghttputil.NewUpstreamAttemptContext(upstream, time.Hour)
	defer releaseAttempt()

	cancelClient()
	require.ErrorIs(t, ctx.Err(), context.Canceled, "handler context follows the client immediately")
	require.NoError(t, attempt.Err(), "attempt must survive the disconnect to collect late usage")

	start := time.Now()
	select {
	case <-attempt.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("attempt context did not follow the bounded local drain")
	}
	elapsed := time.Since(start)
	require.GreaterOrEqual(t, elapsed, 40*time.Millisecond, "attempt must not be cancelled before the local drain window")
	require.Less(t, elapsed, time.Second, "attempt was bounded by the local drain, not the one-hour attempt default")
}

func TestConfiguredDisconnectDrainBoundsUpstream(t *testing.T) {
	client, cancelClient := context.WithCancel(context.Background())
	defer cancelClient()

	cfg := &config.Config{}
	cfg.Gateway.OpenAIForwardMaxSeconds = 5
	cfg.Gateway.OpenAIDisconnectDrainSeconds = 1
	ctx, finish := BeginOpenAIForwardLifetime(client, cfg)
	defer finish()

	upstream, releaseConstruction := detachUpstreamContext(ctx)
	releaseConstruction()

	cancelClient()
	require.NoError(t, upstream.Err(), "bounded upstream must not die with the client")
	select {
	case <-upstream.Done():
		t.Fatal("drain fired immediately; configured 1s window was not honoured")
	case <-time.After(150 * time.Millisecond):
	}
	select {
	case <-upstream.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("configured drain did not bound the upstream context")
	}
}
