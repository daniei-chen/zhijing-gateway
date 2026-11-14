package service

import (
	"context"
	"sync"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
)

type openAIForwardLifetimeKey struct{}

type openAIForwardLifetime struct {
	upstream context.Context
}

// BeginOpenAIForwardLifetime lets the HTTP handler share one bound across all
// account-selection attempts. It does not replace the client's cancellation.
func BeginOpenAIForwardLifetime(ctx context.Context, cfg *config.Config) (context.Context, func()) {
	return beginOpenAIForwardLifetime(ctx, cfg)
}

// Hold the upstream independently of the disconnected client long enough to
// collect terminal usage, but never beyond a bounded local cleanup lifetime.
// This does not prove a remote provider stops executing when we close transport.
func beginOpenAIForwardLifetime(ctx context.Context, cfg *config.Config) (context.Context, func()) {
	if ctx == nil {
		ctx = context.Background()
	}
	if lifetime, _ := ctx.Value(openAIForwardLifetimeKey{}).(*openAIForwardLifetime); lifetime != nil {
		return ctx, func() {}
	}
	maximum := 25 * time.Minute
	drain := 30 * time.Second
	if cfg != nil {
		if cfg.Gateway.OpenAIForwardMaxSeconds > 0 {
			maximum = time.Duration(cfg.Gateway.OpenAIForwardMaxSeconds) * time.Second
		}
		if cfg.Gateway.OpenAIDisconnectDrainSeconds > 0 {
			drain = time.Duration(cfg.Gateway.OpenAIDisconnectDrainSeconds) * time.Second
		}
	}
	return beginOpenAIForwardLifetimeWithTimeouts(ctx, maximum, drain)
}

func beginOpenAIForwardLifetimeWithTimeouts(ctx context.Context, maximum, drain time.Duration) (context.Context, func()) {
	upstream, cancel := context.WithTimeout(context.WithoutCancel(ctx), maximum)
	var mu sync.Mutex
	var timer *time.Timer
	closed := false
	stopClient := context.AfterFunc(ctx, func() {
		mu.Lock()
		defer mu.Unlock()
		if !closed {
			timer = time.AfterFunc(drain, cancel)
		}
	})
	finish := sync.OnceFunc(func() {
		stopClient()
		mu.Lock()
		closed = true
		if timer != nil {
			timer.Stop()
		}
		mu.Unlock()
		cancel()
	})
	return context.WithValue(ctx, openAIForwardLifetimeKey{}, &openAIForwardLifetime{upstream: upstream}), finish
}

func boundedOpenAIUpstreamContext(ctx context.Context) context.Context {
	if ctx != nil {
		if lifetime, _ := ctx.Value(openAIForwardLifetimeKey{}).(*openAIForwardLifetime); lifetime != nil {
			return lifetime.upstream
		}
	}
	return nil
}
