package gatewaytiming

import (
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHistoryPrivacyIsolationAndMeasuredZero(t *testing.T) {
	h := NewHistory(4, time.Hour)
	now := time.Now()
	h.now = func() time.Time { return now }
	scope := Scope{UserID: 101, APIKeyID: 201}
	input := map[string]any{"body_read_block_ms": int64(120), "user_wait_ms": int64(0),
		"body_read_result": "complete", "request_body": "synthetic-private-text", "model": "synthetic-model",
		"account_wait_ms": int64(-1), "connection_wait_ms": "not-a-number"}
	h.Publish(scope, []string{"synthetic-request", "local:synthetic-request"}, input)
	input["body_read_block_ms"] = int64(999)
	record := h.Lookup(scope, "local:synthetic-request", now)
	require.NotNil(t, record)
	require.Equal(t, map[string]int64{"body_read_block_ms": 120, "user_wait_ms": 0}, record.Metrics)
	require.Equal(t, "complete", record.BodyReadResult)
	require.Equal(t, "process_memory", record.Source)
	record.Metrics["body_read_block_ms"] = 888
	require.EqualValues(t, 120, h.Lookup(scope, "synthetic-request", now).Metrics["body_read_block_ms"])
	require.Nil(t, h.Lookup(Scope{102, 201}, "synthetic-request", now))
	require.Nil(t, h.Lookup(Scope{101, 202}, "synthetic-request", now))
	require.Nil(t, h.Lookup(scope, "synthetic-request", now.Add(-6*time.Minute)))
	require.Nil(t, h.Lookup(scope, "synthetic-request", time.Time{}))
}

func TestHistoryBoundsExpiryAndAmbiguousIDs(t *testing.T) {
	h := NewHistory(2, time.Hour)
	now := time.Now()
	h.now = func() time.Time { return now }
	scope := Scope{101, 201}
	metrics := map[string]any{"body_read_block_ms": int64(1)}
	h.Publish(scope, []string{"a", "client:reused"}, metrics)
	h.Publish(scope, []string{"b", "client:reused"}, metrics)
	require.Nil(t, h.Lookup(scope, "client:reused", now))
	require.NotNil(t, h.Lookup(scope, "a", now))
	h.Publish(scope, []string{"c"}, metrics)
	require.Nil(t, h.Lookup(scope, "a", now))
	require.Nil(t, h.Lookup(scope, "client:reused", now))
	require.Equal(t, 2, h.entries.Len())
	require.LessOrEqual(t, len(h.index), 4)
	now = now.Add(time.Hour)
	require.Nil(t, h.Lookup(scope, "c", now))
	h.Publish(scope, []string{"d"}, metrics)
	require.Equal(t, 1, h.entries.Len())
}

func TestHistoryRejectsUnauthenticatedAndUnboundedAliases(t *testing.T) {
	h := NewHistory(2, time.Hour)
	metrics := map[string]any{"body_read_block_ms": int64(1)}
	h.Publish(Scope{}, []string{"request"}, metrics)
	h.Publish(Scope{101, 201}, []string{"bad\nidentifier"}, metrics)
	h.Publish(Scope{101, 201}, []string{"x"}, map[string]any{"request_body": "private"})
	require.Zero(t, h.entries.Len())
	h.Publish(Scope{101, 201}, []string{"a", "b", "c"}, metrics)
	require.Equal(t, 2, len(h.index))
}

func TestHistoryRepeatedAliasRemainsUnknownWhenPreviousEntryIsEvicted(t *testing.T) {
	h := NewHistory(1, time.Hour)
	scope := Scope{101, 201}
	metrics := map[string]any{"body_read_block_ms": int64(1)}
	h.Publish(scope, []string{"reused"}, metrics)
	h.Publish(scope, []string{"reused"}, metrics)
	require.Nil(t, h.Lookup(scope, "reused", time.Now()))
}

func TestHistoryConcurrentAccess(t *testing.T) {
	h := NewHistory(32, time.Hour)
	var wg sync.WaitGroup
	for i := int64(1); i <= 20; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			scope := Scope{id, id + 100}
			for j := 0; j < 10; j++ {
				h.Publish(scope, []string{"request"}, map[string]any{"body_read_block_ms": int64(j)})
				h.Lookup(scope, "request", time.Now())
			}
		}(i)
	}
	wg.Wait()
	require.LessOrEqual(t, h.entries.Len(), 32)
	require.LessOrEqual(t, len(h.index), 64)
}
