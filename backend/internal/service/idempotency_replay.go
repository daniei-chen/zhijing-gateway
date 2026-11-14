package service

import (
	"context"
	"strings"
	"time"

	infraerrors "github.com/daniei-chen/zhijing-gateway/internal/pkg/errors"
)

var ErrIdempotencyResultUnconfirmed = infraerrors.Conflict("IDEMPOTENCY_RESULT_UNCONFIRMED", "the previous operation result cannot be confirmed; review operation history before starting another operation")

// Replay reads a completed result without creating, reclaiming or executing an
// operation. It is safe to use after an uncertain write even when its record
// has expired, been cleaned up or the server uses a shorter configured TTL.
func (c *IdempotencyCoordinator) Replay(ctx context.Context, opts IdempotencyExecuteOptions) (*IdempotencyExecuteResult, error) {
	key, err := NormalizeIdempotencyKey(opts.IdempotencyKey)
	if err != nil {
		return nil, err
	}
	if key == "" {
		return nil, ErrIdempotencyKeyRequired
	}
	if c == nil || c.repo == nil {
		return nil, ErrIdempotencyStoreUnavail
	}
	if opts.Scope == "" {
		return nil, infraerrors.BadRequest("IDEMPOTENCY_SCOPE_REQUIRED", "idempotency scope is required")
	}
	fingerprint, err := BuildIdempotencyFingerprint(opts.Method, opts.Route, opts.ActorScope, opts.Payload)
	if err != nil {
		return nil, err
	}
	keyHash := HashIdempotencyKey(key)
	existing, err := c.repo.GetByScopeAndKeyHash(ctx, opts.Scope, keyHash)
	if err != nil {
		return nil, ErrIdempotencyStoreUnavail.WithCause(err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	// Validate after the storage wait, rather than using its start time.
	now := time.Now()
	if existing == nil || !existing.ExpiresAt.After(now) {
		return nil, ErrIdempotencyResultUnconfirmed
	}
	if existing.RequestFingerprint != fingerprint {
		return nil, ErrIdempotencyKeyConflict
	}
	switch existing.Status {
	case IdempotencyStatusSucceeded:
		if existing.ResponseStatus == nil || *existing.ResponseStatus != 200 || existing.ResponseBody == nil || strings.TrimSpace(*existing.ResponseBody) == "" {
			return nil, ErrIdempotencyResultUnconfirmed
		}
		data, decodeErr := c.decodeStoredResponse(existing.ResponseBody)
		if decodeErr != nil {
			return nil, ErrIdempotencyStoreUnavail.WithCause(decodeErr)
		}
		recordIdempotencyReplay(opts.Route, opts.Scope, nil)
		logIdempotencyAudit(opts.Route, opts.Scope, keyHash, "succeeded->read_only_replayed", true, nil)
		return &IdempotencyExecuteResult{Data: data, Replayed: true}, nil
	case IdempotencyStatusProcessing:
		return nil, c.conflictWithRetryAfter(ErrIdempotencyInProgress, existing.LockedUntil, now)
	default:
		return nil, ErrIdempotencyResultUnconfirmed
	}
}
