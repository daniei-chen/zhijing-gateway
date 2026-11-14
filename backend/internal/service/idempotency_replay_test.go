package service

import (
	"context"
	"errors"
	"testing"
	"time"

	infraerrors "github.com/daniei-chen/zhijing-gateway/internal/pkg/errors"
	"github.com/stretchr/testify/require"
)

// Only Get is implemented: any attempted mutation panics and fails the test.
type replayOnlyReadRepo struct {
	IdempotencyRepository
	record *IdempotencyRecord
	err    error
}

func (r replayOnlyReadRepo) GetByScopeAndKeyHash(context.Context, string, string) (*IdempotencyRecord, error) {
	return cloneRecord(r.record), r.err
}

func replayOptions() IdempotencyExecuteOptions {
	return IdempotencyExecuteOptions{Scope: "admin.users.balance.update", ActorScope: "admin:7", Method: "POST", Route: "/api/v1/admin/users/:id/balance", IdempotencyKey: "synthetic-balance-key", Payload: map[string]any{"user_id": 41, "amount": 1.25}}
}

func TestIdempotencyReplayNeverExecutesAnExpiredOrMissingWrite(t *testing.T) {
	ctx := context.Background()
	repo := newInMemoryIdempotencyRepo()
	c := NewIdempotencyCoordinator(repo, DefaultIdempotencyConfig())
	opts := replayOptions()
	writes := 0
	_, err := c.Execute(ctx, opts, func(context.Context) (any, error) { writes++; return map[string]any{"id": 41}, nil })
	require.NoError(t, err)
	result, err := c.Replay(ctx, opts)
	require.NoError(t, err)
	require.True(t, result.Replayed)
	require.Equal(t, 1, writes)
	repo.mu.Lock()
	repo.data[repo.key(opts.Scope, HashIdempotencyKey(opts.IdempotencyKey))].ExpiresAt = time.Now().Add(-time.Hour)
	repo.mu.Unlock()
	_, err = c.Replay(ctx, opts)
	require.Equal(t, "IDEMPOTENCY_RESULT_UNCONFIRMED", infraerrors.Reason(err))
	_, err = repo.DeleteExpired(ctx, time.Now(), 10)
	require.NoError(t, err)
	_, err = c.Replay(ctx, opts)
	require.Equal(t, "IDEMPOTENCY_RESULT_UNCONFIRMED", infraerrors.Reason(err))
	require.Equal(t, 1, writes)
	require.Empty(t, repo.data, "read-only replay must not recreate a cleaned-up record")
}

func TestIdempotencyReplayReadOnlyStates(t *testing.T) {
	opts := replayOptions()
	fingerprint, err := BuildIdempotencyFingerprint(opts.Method, opts.Route, opts.ActorScope, opts.Payload)
	require.NoError(t, err)
	body := `{"id":41}`
	status := 200
	for _, tc := range []struct {
		name, state, wantReason string
		expired                 bool
	}{
		{"completed", IdempotencyStatusSucceeded, "", false},
		{"processing", IdempotencyStatusProcessing, "IDEMPOTENCY_IN_PROGRESS", false},
		{"failed", IdempotencyStatusFailedRetryable, "IDEMPOTENCY_RESULT_UNCONFIRMED", false},
		{"unknown", "unknown", "IDEMPOTENCY_RESULT_UNCONFIRMED", false},
		{"expired success", IdempotencyStatusSucceeded, "IDEMPOTENCY_RESULT_UNCONFIRMED", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			expires := time.Now().Add(time.Minute)
			if tc.expired {
				expires = time.Now().Add(-time.Minute)
			}
			c := NewIdempotencyCoordinator(replayOnlyReadRepo{record: &IdempotencyRecord{RequestFingerprint: fingerprint, Status: tc.state, ExpiresAt: expires, ResponseBody: &body, ResponseStatus: &status}}, DefaultIdempotencyConfig())
			result, err := c.Replay(context.Background(), opts)
			require.Equal(t, tc.wantReason, infraerrors.Reason(err))
			if tc.wantReason == "" {
				require.True(t, result.Replayed)
				require.Equal(t, map[string]any{"id": float64(41)}, result.Data)
			}
		})
	}
}

func TestIdempotencyReplayRejectsMismatchedActorPayloadAndTarget(t *testing.T) {
	ctx := context.Background()
	repo := newInMemoryIdempotencyRepo()
	c := NewIdempotencyCoordinator(repo, DefaultIdempotencyConfig())
	opts := replayOptions()
	_, err := c.Execute(ctx, opts, func(context.Context) (any, error) { return map[string]any{"id": 41}, nil })
	require.NoError(t, err)
	for _, mutate := range []func(*IdempotencyExecuteOptions){
		func(o *IdempotencyExecuteOptions) { o.ActorScope = "admin:8" },
		func(o *IdempotencyExecuteOptions) { o.Payload = map[string]any{"user_id": 42, "amount": 1.25} },
		func(o *IdempotencyExecuteOptions) { o.Payload = map[string]any{"user_id": 41, "amount": 2.5} },
	} {
		changed := opts
		mutate(&changed)
		_, err := c.Replay(ctx, changed)
		require.Equal(t, "IDEMPOTENCY_KEY_CONFLICT", infraerrors.Reason(err))
	}
}

func TestIdempotencyReplayFailsClosedWithoutAKeyStoreOrValidResult(t *testing.T) {
	opts := replayOptions()
	var missing *IdempotencyCoordinator
	_, err := missing.Replay(context.Background(), opts)
	require.Equal(t, "IDEMPOTENCY_STORE_UNAVAILABLE", infraerrors.Reason(err))
	c := NewIdempotencyCoordinator(replayOnlyReadRepo{err: errors.New("synthetic store unavailable")}, DefaultIdempotencyConfig())
	_, err = c.Replay(context.Background(), opts)
	require.Equal(t, "IDEMPOTENCY_STORE_UNAVAILABLE", infraerrors.Reason(err))
	opts.IdempotencyKey = ""
	_, err = c.Replay(context.Background(), opts)
	require.Equal(t, "IDEMPOTENCY_KEY_REQUIRED", infraerrors.Reason(err), "ObserveOnly must never bypass replay safety")
}
