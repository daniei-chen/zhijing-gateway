package repository

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/alicebob/miniredis/v2"
	redisserver "github.com/alicebob/miniredis/v2/server"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type authPolicyFixture struct {
	config map[string]string
	info   string
	fail   string
	calls  []string
}

func safeAuthPolicyFixture() *authPolicyFixture {
	return &authPolicyFixture{
		config: map[string]string{"maxmemory-policy": "noeviction", "appendonly": "yes", "appendfsync": "always", "no-appendfsync-on-rewrite": "no"},
		info:   "# Persistence\r\nloading:0\r\naof_enabled:1\r\naof_last_write_status:ok\r\n",
	}
}

func (f *authPolicyFixture) ConfigGet(ctx context.Context, name string) *redis.MapStringStringCmd {
	f.calls = append(f.calls, "CONFIG GET "+name)
	command := redis.NewMapStringStringCmd(ctx)
	if f.fail == name {
		command.SetErr(errors.New("synthetic transport failure with SYNTHETIC-SECRET"))
	} else {
		values := map[string]string{}
		if value, present := f.config[name]; present {
			values[name] = value
		}
		command.SetVal(values)
	}
	return command
}

func (f *authPolicyFixture) Info(ctx context.Context, sections ...string) *redis.StringCmd {
	f.calls = append(f.calls, "INFO "+strings.Join(sections, " "))
	command := redis.NewStringCmd(ctx)
	if f.fail == "info" {
		command.SetErr(errors.New("SYNTHETIC-SECRET"))
	} else {
		command.SetVal(f.info)
	}
	return command
}

func TestAuthStorePolicyAcceptsDurableNonEvictingStoreWithoutMutations(t *testing.T) {
	fixture := safeAuthPolicyFixture()
	require.NoError(t, validateAuthStoreDurability(context.Background(), fixture))
	require.Equal(t, []string{"CONFIG GET maxmemory-policy", "CONFIG GET appendonly", "CONFIG GET appendfsync", "CONFIG GET no-appendfsync-on-rewrite", "INFO persistence"}, fixture.calls)
}

func TestAuthStorePolicyRejectsLossyOrUnverifiableStores(t *testing.T) {
	for _, test := range []struct{ name, key, value string }{
		{"eviction", "maxmemory-policy", "allkeys-lru"},
		{"volatile eviction", "maxmemory-policy", "volatile-ttl"},
		{"AOF disabled", "appendonly", "no"},
		{"one-second loss window", "appendfsync", "everysec"},
		{"no fsync", "appendfsync", "no"},
		{"rewrite loss window", "no-appendfsync-on-rewrite", "yes"},
		{"missing setting", "appendfsync", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := safeAuthPolicyFixture()
			fixture.config[test.key] = test.value
			require.Error(t, validateAuthStoreDurability(context.Background(), fixture))
		})
	}
	for _, unavailable := range []string{"maxmemory-policy", "appendonly", "appendfsync", "no-appendfsync-on-rewrite", "info"} {
		t.Run("inspection unavailable "+unavailable, func(t *testing.T) {
			fixture := safeAuthPolicyFixture()
			fixture.fail = unavailable
			err := validateAuthStoreDurability(context.Background(), fixture)
			require.Error(t, err)
			require.NotContains(t, err.Error(), "SYNTHETIC-SECRET")
		})
	}
}

func TestAuthStorePolicyRejectsUnreadyOrFailedPersistence(t *testing.T) {
	for _, info := range []string{
		"loading:1\naof_enabled:1\naof_last_write_status:ok\n",
		"loading:0\naof_enabled:0\naof_last_write_status:ok\n",
		"loading:0\naof_enabled:1\naof_last_write_status:err\n",
		"loading:0\naof_enabled:1\n", "", "not an INFO response",
	} {
		fixture := safeAuthPolicyFixture()
		fixture.info = info
		require.Error(t, validateAuthStoreDurability(context.Background(), fixture))
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.ErrorIs(t, validateAuthStoreDurability(ctx, safeAuthPolicyFixture()), context.Canceled)
	require.Error(t, validateAuthStoreDurability(context.Background(), nil))
}

func policyRedisConfig(server *miniredis.Miniredis) *config.Config {
	return &config.Config{Redis: config.RedisConfig{Host: server.Host(), Port: server.Server().Addr().Port,
		DialTimeoutSeconds: 5, ReadTimeoutSeconds: 5, WriteTimeoutSeconds: 5, PoolSize: 3}}
}

func TestProvideRedisAuthPolicyChecksTheWireBeforeReturningBusinessPool(t *testing.T) {
	server := miniredis.RunT(t)
	fixture := safeAuthPolicyFixture()
	server.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
		switch command {
		case "CONFIG":
			if len(args) != 2 || strings.ToUpper(args[0]) != "GET" {
				peer.WriteError("ERR unexpected mutation")
				return true
			}
			peer.WriteLen(2)
			peer.WriteBulk(args[1])
			peer.WriteBulk(fixture.config[args[1]])
			return true
		case "INFO":
			peer.WriteBulk(fixture.info)
			return true
		}
		return false
	})
	client, err := provideRedisWithAuthPolicy(context.Background(), policyRedisConfig(server))
	require.NoError(t, err)
	require.NotNil(t, client)
	t.Cleanup(func() { _ = client.Close() })
	require.False(t, client.Options().ContextTimeoutEnabled, "startup inspection must not change the business pool configuration")
	require.Equal(t, 3, client.Options().PoolSize)
	require.NoError(t, client.Ping(context.Background()).Err())
}

func TestProvideRedisAuthPolicyHonorsTotalDeadlineDuringBlockedSocketRead(t *testing.T) {
	server := miniredis.RunT(t)
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	server.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
		if command != "CONFIG" {
			return false
		}
		close(entered)
		<-release
		peer.WriteError("ERR delayed fixture")
		return true
	})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	client, err := provideRedisWithAuthPolicy(ctx, policyRedisConfig(server))
	require.Error(t, err)
	require.Nil(t, client)
	require.Less(t, time.Since(started), time.Second, "5-second business socket timeout must not defeat the startup deadline")
	select {
	case <-entered:
	default:
		t.Fatal("fixture did not reach blocked CONFIG read")
	}
}

func TestProvideRedisAuthPolicyDeniesInspectionFailureWithoutReturningClient(t *testing.T) {
	server := miniredis.RunT(t)
	server.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
		if command != "CONFIG" {
			return false
		}
		peer.WriteError("NOPERM SYNTHETIC-SECRET")
		return true
	})
	client, err := provideRedisWithAuthPolicy(context.Background(), policyRedisConfig(server))
	require.Nil(t, client)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "SYNTHETIC-SECRET")
}

func TestProvideRedisAuthPolicyInterruptsEarlyCancellationDuringSocketRead(t *testing.T) {
	server := miniredis.RunT(t)
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	server.Server().SetPreHook(func(peer *redisserver.Peer, command string, args ...string) bool {
		if command != "CONFIG" {
			return false
		}
		close(entered)
		<-release
		peer.WriteError("ERR delayed fixture")
		return true
	})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		client, err := provideRedisWithAuthPolicy(ctx, policyRedisConfig(server))
		if client != nil {
			_ = client.Close()
			finished <- errors.New("unexpected business pool")
			return
		}
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("CONFIG read barrier was not reached")
	}
	cancel()
	select {
	case err := <-finished:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("early cancellation did not interrupt a blocked startup read")
	}
}
