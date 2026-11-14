package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func sessionCachePair(t *testing.T) (service.RefreshTokenCache, service.RefreshTokenCache, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	one := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	two := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	t.Cleanup(func() { _ = one.Close(); _ = two.Close() })
	return NewRefreshTokenCache(one), NewRefreshTokenCache(two), server
}
func sessionTestData(generation string) *service.RefreshTokenData {
	return &service.RefreshTokenData{UserID: 101, FamilyID: "synthetic-family", TokenVersion: 7, SessionGeneration: generation, CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
}

func TestRefreshSessionRedisTwoClientsConsumeExactlyOnce(t *testing.T) {
	one, two, _ := sessionCachePair(t)
	ctx := context.Background()
	require.NoError(t, one.StoreRefreshToken(ctx, "old", sessionTestData(""), time.Hour))
	start := make(chan struct{})
	var done sync.WaitGroup
	var successes atomic.Int32
	errors := make(chan error, 20)
	for i := 0; i < 20; i++ {
		done.Add(1)
		go func(i int) {
			defer done.Done()
			<-start
			cache := one
			if i%2 == 0 {
				cache = two
			}
			err := cache.RotateRefreshToken(ctx, "old", fmt.Sprintf("next-%d", i), sessionTestData(""), time.Hour)
			if err == nil {
				successes.Add(1)
			} else {
				errors <- err
			}
		}(i)
	}
	close(start)
	done.Wait()
	close(errors)
	require.Equal(t, int32(1), successes.Load())
	for err := range errors {
		require.ErrorIs(t, err, service.ErrRefreshTokenNotFound)
	}
	_, err := one.GetRefreshToken(ctx, "old")
	require.ErrorIs(t, err, service.ErrRefreshTokenNotFound)
	old, err := two.GetRefreshTokenForRevocation(ctx, "old")
	require.NoError(t, err)
	require.Equal(t, "synthetic-family", old.FamilyID)
	userHashes, err := one.GetUserTokenHashes(ctx, 101)
	require.NoError(t, err)
	require.Len(t, userHashes, 1)
	familyHashes, err := two.GetFamilyTokenHashes(ctx, "synthetic-family")
	require.NoError(t, err)
	require.Equal(t, userHashes, familyHashes)
}

func TestRefreshSessionRedisRevocationFencesOtherClient(t *testing.T) {
	one, two, _ := sessionCachePair(t)
	ctx := context.Background()
	require.NoError(t, one.StoreRefreshToken(ctx, "old", sessionTestData(""), time.Hour))
	snapshot, err := one.GetRefreshToken(ctx, "old")
	require.NoError(t, err)
	require.NoError(t, two.DeleteUserRefreshTokens(ctx, 101))
	require.ErrorIs(t, one.ValidateSession(ctx, 101, "synthetic-family", ""), service.ErrTokenRevoked)
	require.ErrorIs(t, one.RotateRefreshToken(ctx, "old", "late", snapshot, time.Hour), service.ErrTokenRevoked)
	require.ErrorIs(t, one.StoreRefreshToken(ctx, "late-login", snapshot, time.Hour), service.ErrTokenRevoked)
	generation, err := one.GetSessionGeneration(ctx, 101)
	require.NoError(t, err)
	require.NotEmpty(t, generation)
	require.NoError(t, one.StoreRefreshToken(ctx, "new-login", sessionTestData(generation), time.Hour))
	require.NoError(t, two.ValidateSession(ctx, 101, "synthetic-family", generation))
}

func TestRefreshSessionRedisFamilyRevocationFencesOtherClient(t *testing.T) {
	one, two, _ := sessionCachePair(t)
	ctx := context.Background()
	require.NoError(t, one.StoreRefreshToken(ctx, "old", sessionTestData(""), time.Hour))
	snapshot, err := one.GetRefreshToken(ctx, "old")
	require.NoError(t, err)
	require.NoError(t, two.DeleteTokenFamily(ctx, "synthetic-family", 2*time.Hour))
	require.ErrorIs(t, one.ValidateSession(ctx, 101, "synthetic-family", ""), service.ErrTokenRevoked)
	require.ErrorIs(t, one.RotateRefreshToken(ctx, "old", "late", snapshot, time.Hour), service.ErrTokenRevoked)
	require.ErrorIs(t, one.StoreRefreshToken(ctx, "late-login", snapshot, time.Hour), service.ErrTokenRevoked)
}

func TestRefreshSessionRedisFamilyRevocationKeepsPreviouslyIssuedLifetime(t *testing.T) {
	one, two, server := sessionCachePair(t)
	ctx := context.Background()
	data := sessionTestData("")
	data.AccessExpiresAt = time.Now().Add(10 * time.Hour)
	require.NoError(t, one.StoreRefreshToken(ctx, "old", data, time.Hour))
	require.NoError(t, two.DeleteTokenFamily(ctx, data.FamilyID, time.Hour))
	server.FastForward(2 * time.Hour)
	require.ErrorIs(t, one.ValidateSession(ctx, 101, data.FamilyID, ""), service.ErrTokenRevoked, "shorter current config must not resurrect an earlier long-lived access JWT")
	require.NoError(t, two.DeleteTokenFamily(ctx, data.FamilyID, time.Minute))
	server.FastForward(2 * time.Hour)
	require.ErrorIs(t, one.ValidateSession(ctx, 101, data.FamilyID, ""), service.ErrTokenRevoked, "a repeated revoke must not shorten the existing marker")
}

func TestRefreshSessionRedisLegacyFamilyNeverGuessesExpiration(t *testing.T) {
	one, two, server := sessionCachePair(t)
	ctx := context.Background()
	data := sessionTestData("")
	raw, err := json.Marshal(data)
	require.NoError(t, err)
	_ = server.Set(refreshTokenKey("legacy"), string(raw))
	server.SetTTL(refreshTokenKey("legacy"), time.Hour)
	require.NoError(t, one.RotateRefreshToken(ctx, "legacy", "next", data, time.Hour))
	require.NoError(t, two.DeleteTokenFamily(ctx, data.FamilyID, time.Hour))
	server.FastForward(365 * 24 * time.Hour)
	require.ErrorIs(t, one.ValidateSession(ctx, 101, data.FamilyID, ""), service.ErrTokenRevoked, "legacy access expiration is unknown, so its family marker must persist")
}

func TestRefreshSessionRedisRevocationAliasCoversRotationAtOldExpiry(t *testing.T) {
	one, two, server := sessionCachePair(t)
	ctx := context.Background()
	old := sessionTestData("")
	old.ExpiresAt = time.Now().Add(time.Second)
	require.NoError(t, one.StoreRefreshToken(ctx, "old-near-expiry", old, time.Second))
	require.NoError(t, two.RotateRefreshToken(ctx, "old-near-expiry", "replacement", sessionTestData(""), time.Hour))
	server.FastForward(2 * time.Second)
	_, err := one.GetRefreshToken(ctx, "old-near-expiry")
	require.ErrorIs(t, err, service.ErrRefreshTokenNotFound)
	previous, err := one.GetRefreshTokenForRevocation(ctx, "old-near-expiry")
	require.NoError(t, err)
	require.Equal(t, "synthetic-family", previous.FamilyID)
}
