//go:build unit

package middleware

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/adminaccess"
	"github.com/Wei-Shaw/sub2api/internal/repository"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type sessionReviewBlockedUsers struct {
	service.UserRepository
	user    service.User
	entered chan struct{}
	release chan struct{}
}

func (r *sessionReviewBlockedUsers) GetByID(context.Context, int64) (*service.User, error) {
	close(r.entered)
	<-r.release
	clone := r.user
	return &clone, nil
}
func (*sessionReviewBlockedUsers) GetUserAvatar(context.Context, int64) (*service.UserAvatar, error) {
	return nil, nil
}

type sessionReviewSettings struct {
	service.SettingRepository
	key atomic.Value
}

func (r *sessionReviewSettings) GetValue(context.Context, string) (string, error) {
	return r.key.Load().(string), nil
}

func TestAdminJWTRevalidatorRejectsRevocationDuringUserLookup(t *testing.T) {
	ctx := context.Background()
	server := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	defer rdb.Close()
	cfg := &config.Config{JWT: config.JWTConfig{Secret: "synthetic-independent-secret", AccessTokenExpireMinutes: 60, RefreshTokenExpireDays: 7}}
	user := service.User{ID: 101, Role: service.RoleAdmin, Status: service.StatusActive, TokenVersion: 7, TokenVersionResolved: true}
	users := &sessionReviewBlockedUsers{user: user, entered: make(chan struct{}), release: make(chan struct{})}
	auth := service.NewAuthService(nil, users, nil, repository.NewRefreshTokenCache(rdb), cfg, nil, nil, nil, nil, nil, nil, nil, nil)
	raw, err := auth.GenerateToken(ctx, &user)
	require.NoError(t, err)
	claims, err := auth.ValidateToken(raw)
	require.NoError(t, err)
	verify := adminJWTRevalidator(auth, service.NewUserService(users, nil, nil, nil), claims)
	done := make(chan error, 1)
	go func() { done <- verify(ctx) }()
	select {
	case <-users.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("user lookup not reached")
	}
	require.NoError(t, auth.RevokeAllUserSessions(ctx, user.ID))
	close(users.release)
	require.ErrorIs(t, <-done, service.ErrTokenRevoked, "revoke-all completed while the authorization lookup was blocked")
}

func TestAdminAPIKeyRevalidatorRejectsRotationDuringUserLookup(t *testing.T) {
	ctx := context.Background()
	users := &sessionReviewBlockedUsers{user: service.User{ID: 101, Role: service.RoleAdmin, Status: service.StatusActive}, entered: make(chan struct{}), release: make(chan struct{})}
	settingRepo := &sessionReviewSettings{}
	settingRepo.key.Store("synthetic-old-global-key")
	settings := service.NewSettingService(settingRepo, nil)
	verify := adminAPIKeyRevalidator(settings, service.NewUserService(users, nil, nil, nil), "synthetic-old-global-key", 101)
	done := make(chan error, 1)
	go func() { done <- verify(ctx) }()
	select {
	case <-users.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("user lookup not reached")
	}
	settingRepo.key.Store("synthetic-replacement-key")
	close(users.release)
	require.ErrorIs(t, <-done, service.ErrScopedAdminKeyInvalid, "the old key was rotated before its push authorization completed")
}

type sessionReviewScopedKeys struct {
	service.ScopedAdminKeyRepository
	mu      sync.Mutex
	item    *service.ScopedAdminKey
	touches atomic.Int32
}

func (r *sessionReviewScopedKeys) InsertScopedAdminKey(_ context.Context, item *service.ScopedAdminKey) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	clone := *item
	r.item = &clone
	return nil
}
func (r *sessionReviewScopedKeys) GetScopedAdminKey(context.Context, string) (*service.ScopedAdminKey, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	clone := *r.item
	clone.Policy.GlobalPermissions = append([]string(nil), r.item.Policy.GlobalPermissions...)
	return &clone, nil
}
func (r *sessionReviewScopedKeys) TouchScopedAdminKey(context.Context, string, string, time.Time, string, time.Time) error {
	r.touches.Add(1)
	return nil
}
func (r *sessionReviewScopedKeys) change(fn func(*service.ScopedAdminKey)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	fn(r.item)
}

func TestScopedAdminKeyRevalidatorRechecksKeyAndPolicyAfterUserLookup(t *testing.T) {
	for _, scenario := range []string{"unchanged", "revoked", "policy_removed", "expired", "rotated", "owner_changed", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			users := &sessionReviewBlockedUsers{user: service.User{ID: 101, Role: service.RoleAdmin, Status: service.StatusActive}, entered: make(chan struct{}), release: make(chan struct{})}
			keys := &sessionReviewScopedKeys{}
			settings := service.NewSettingService(nil, nil)
			settings.SetScopedAdminKeyRepository(keys)
			key, _, err := settings.CreateScopedAdminKey(ctx, service.ScopedAdminKeyInput{Name: "synthetic-monitor-key", Enabled: true, Policy: adminaccess.Policy{GlobalPermissions: []string{"users.read"}}}, 101)
			require.NoError(t, err)
			verify := scopedAdminKeyRevalidator(settings, service.NewUserService(users, nil, nil, nil), key, "192.0.2.10", "GET", "/api/v1/admin/users")
			done := make(chan error, 1)
			go func() { done <- verify(ctx) }()
			select {
			case <-users.entered:
			case <-time.After(5 * time.Second):
				t.Fatal("user lookup not reached")
			}
			keys.change(func(item *service.ScopedAdminKey) {
				switch scenario {
				case "revoked":
					now := time.Now()
					item.RevokedAt = &now
				case "policy_removed":
					item.Policy.GlobalPermissions = nil
				case "expired":
					past := time.Now().Add(-time.Minute)
					item.ExpiresAt = &past
				case "rotated":
					item.Hash = "synthetic-replacement-hash"
				case "owner_changed":
					item.CreatedBy = 202
				}
			})
			if scenario == "cancelled" {
				cancel()
			}
			close(users.release)
			result := <-done
			switch scenario {
			case "unchanged":
				require.NoError(t, result)
			case "cancelled":
				require.ErrorIs(t, result, context.Canceled)
			default:
				require.ErrorIs(t, result, service.ErrScopedAdminKeyInvalid)
			}
			require.Zero(t, keys.touches.Load(), "monitoring validation must not touch the key on every push")
		})
	}
}
