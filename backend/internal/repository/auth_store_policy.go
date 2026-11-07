package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/redis/go-redis/v9"
)

type authStorePolicyClient interface {
	ConfigGet(context.Context, string) *redis.MapStringStringCmd
	Info(context.Context, ...string) *redis.StringCmd
}

func provideRedisWithAuthPolicy(ctx context.Context, cfg *config.Config) (*redis.Client, error) {
	// The normal shared pool keeps its configured request timeouts. Startup
	// inspection has its own one-connection, no-retry pool whose socket deadlines
	// honor this total deadline; go-redis otherwise ignores context timeouts for
	// socket reads unless ContextTimeoutEnabled is explicitly enabled.
	options := buildRedisOptions(cfg)
	options.ContextTimeoutEnabled = true
	options.MaxRetries = -1
	options.PoolSize = 1
	options.MinIdleConns = 0
	policyClient := redis.NewClient(options)
	defer policyClient.Close()
	// A socket deadline alone does not interrupt a read on early cancellation.
	// Only this temporary pool is closed; the shared business pool is separate.
	stopCancellation := context.AfterFunc(ctx, func() { _ = policyClient.Close() })
	defer stopCancellation()
	if err := validateAuthStoreDurability(ctx, policyClient); err != nil {
		return nil, err
	}
	return InitRedis(cfg), nil
}

// Session generations and revocation tombstones are security state rather than
// disposable cache entries. Refuse to start an API instance against a store that
// can evict them or acknowledge writes before its AOF has been synced. This is a
// startup precondition, not protection against restoring an old database/backup;
// recovery must invalidate all old auth material before serving traffic again.
func validateAuthStoreDurability(ctx context.Context, client authStorePolicyClient) error {
	if client == nil {
		return fmt.Errorf("auth store policy: unavailable")
	}
	for _, requirement := range []struct{ key, value string }{
		{"maxmemory-policy", "noeviction"},
		{"appendonly", "yes"},
		{"appendfsync", "always"},
		{"no-appendfsync-on-rewrite", "no"},
	} {
		values, err := client.ConfigGet(ctx, requirement.key).Result()
		if err != nil {
			// Redis errors can include transport addresses or untrusted text.
			return fmt.Errorf("auth store policy: cannot inspect %s", requirement.key)
		}
		if values[requirement.key] != requirement.value {
			return fmt.Errorf("auth store policy: %s must be %s", requirement.key, requirement.value)
		}
	}
	info, err := client.Info(ctx, "persistence").Result()
	if err != nil {
		return fmt.Errorf("auth store policy: cannot inspect persistence status")
	}
	fields := make(map[string]string)
	for _, line := range strings.Split(info, "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), ":")
		if found {
			fields[key] = value
		}
	}
	if fields["loading"] != "0" || fields["aof_enabled"] != "1" || fields["aof_last_write_status"] != "ok" {
		return fmt.Errorf("auth store policy: persistent store is not ready")
	}
	return ctx.Err()
}
