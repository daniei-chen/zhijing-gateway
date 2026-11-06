package gatewaytiming

import (
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// This is an audit probe of the unmodified, published helper. It fails until a
// backend fix can reliably correlate a persisted row with one request instance.
func TestHistoryDoesNotAttachNewRequestTimingToEvictedOldRow(t *testing.T) {
	h := NewHistory(1, time.Hour)
	now := time.Unix(1800000000, 0)
	h.now = func() time.Time { return now }
	scope := Scope{UserID: 101, APIKeyID: 201}
	oldRowCreatedAt := now
	h.Publish(scope, []string{"client:reused"}, map[string]any{"body_read_block_ms": int64(10)})
	now = now.Add(time.Second)
	h.Publish(scope, []string{"client:intervening"}, map[string]any{"body_read_block_ms": int64(20)})
	now = now.Add(time.Second)
	h.Publish(scope, []string{"client:reused"}, map[string]any{"body_read_block_ms": int64(999)})
	if record := h.Lookup(scope, "client:reused", oldRowCreatedAt); record != nil {
		t.Fatalf("old persisted row incorrectly receives a newer request sample: body_read_block_ms=%d, observed_at=%s, old_row_created_at=%s",
			record.Metrics["body_read_block_ms"], record.ObservedAt, oldRowCreatedAt)
	}
}

func TestHistoryKeepsPrivacyAndCapacityBounds(t *testing.T) {
	h := NewHistory(4, time.Hour)
	now := time.Now()
	scope := Scope{UserID: 101, APIKeyID: 201}
	h.Publish(scope, []string{"request"}, map[string]any{"body_read_block_ms": int64(0), "prompt": "synthetic-private"})
	record := h.Lookup(scope, "request", now)
	if record == nil || len(record.Metrics) != 1 || record.Metrics["body_read_block_ms"] != 0 {
		t.Fatal("measured zero or metric allowlist was not preserved")
	}
	if h.Lookup(Scope{UserID: 102, APIKeyID: 201}, "request", now) != nil {
		t.Fatal("cross-user timing leaked")
	}
	record.Metrics["body_read_block_ms"] = 9
	if h.Lookup(scope, "request", now).Metrics["body_read_block_ms"] != 0 {
		t.Fatal("caller mutated the cached sample")
	}
	for i := 0; i < 20; i++ {
		h.Publish(scope, []string{strconv.Itoa(i)}, map[string]any{"body_read_block_ms": int64(i)})
	}
	if h.entries.Len() > 4 || len(h.index) > 8 {
		t.Fatal("bounded cache exceeded capacity")
	}
}

func TestHistoryConcurrentReadAndPublish(t *testing.T) {
	h := NewHistory(32, time.Hour)
	var workers sync.WaitGroup
	for worker := int64(1); worker <= 8; worker++ {
		workers.Add(1)
		go func(id int64) {
			defer workers.Done()
			scope := Scope{UserID: id, APIKeyID: id + 100}
			for iteration := 0; iteration < 100; iteration++ {
				key := strconv.Itoa(iteration)
				h.Publish(scope, []string{key}, map[string]any{"user_wait_ms": int64(iteration)})
				h.Lookup(scope, key, time.Now())
			}
		}(worker)
	}
	workers.Wait()
	if h.entries.Len() > 32 || len(h.index) > 64 {
		t.Fatal("concurrent cache exceeded capacity")
	}
}

func BenchmarkHistoryPublish(b *testing.B) {
	h := NewHistory(4096, time.Hour)
	scope := Scope{UserID: 101, APIKeyID: 201}
	metrics := map[string]any{"body_read_block_ms": int64(10), "user_wait_ms": int64(0)}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		h.Publish(scope, []string{strconv.Itoa(i)}, metrics)
	}
}

func BenchmarkHistoryLookup(b *testing.B) {
	h := NewHistory(4096, time.Hour)
	scope := Scope{UserID: 101, APIKeyID: 201}
	now := time.Now()
	h.Publish(scope, []string{"request"}, map[string]any{"body_read_block_ms": int64(10), "user_wait_ms": int64(0)})
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			h.Lookup(scope, "request", now)
		}
	})
}

func BenchmarkHistoryParallelPublishLookup(b *testing.B) {
	h := NewHistory(4096, time.Hour)
	var sequence int64
	metrics := map[string]any{"body_read_block_ms": int64(10), "user_wait_ms": int64(0)}
	b.ReportAllocs()
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		id := atomic.AddInt64(&sequence, 1)
		scope := Scope{UserID: id, APIKeyID: id + 100}
		i := 0
		for pb.Next() {
			key := strconv.Itoa(i)
			h.Publish(scope, []string{key}, metrics)
			h.Lookup(scope, key, time.Now())
			i++
		}
	})
}

// Publish rejects aliases over 160 bytes; Lookup should have a comparable bound.
// Backend reachability of an oversized persisted identifier is not established.
func BenchmarkHistoryLookupIDLength(b *testing.B) {
	for _, size := range []int{160, 1024 * 1024} {
		b.Run(strconv.Itoa(size), func(b *testing.B) {
			h := NewHistory(4096, time.Hour)
			scope := Scope{UserID: 101, APIKeyID: 201}
			id := strings.Repeat("x", size)
			now := time.Now()
			b.ReportAllocs()
			b.ResetTimer()
			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					h.Lookup(scope, id, now)
				}
			})
		})
	}
}
