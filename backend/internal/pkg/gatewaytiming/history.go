package gatewaytiming

import (
	"container/list"
	"crypto/sha256"
	"strings"
	"sync"
	"time"
)

// Recent is diagnostic-only, bounded, process-local and never used for billing,
// admission, routing, retries or health scores. No request/Gin/context is retained.
var Recent = NewHistory(4096, 24*time.Hour)

type Scope struct{ UserID, APIKeyID int64 }

type Record struct {
	SchemaVersion    int              `json:"schema_version"`
	Source           string           `json:"source"`
	ObservedAt       time.Time        `json:"observed_at"`
	RetentionSeconds int64            `json:"retention_seconds"`
	Capacity         int              `json:"capacity"`
	Metrics          map[string]int64 `json:"metrics"`
	BodyReadResult   string           `json:"body_read_result,omitempty"`
}

type historyKey struct {
	Scope
	ID [sha256.Size]byte
}
type historyEntry struct {
	keys   []historyKey
	record Record
}
type historyIndex struct {
	entry     *list.Element
	ambiguous bool
}

// A retired alias must remain ambiguous for the whole overlap of two +/-5m
// matching windows. Tombstones are bounded too: on exhaustion attribution stops
// until the overlap has elapsed rather than forgetting an alias and guessing.
const historyMatchWindow = 5 * time.Minute

type retiredAlias struct {
	key   historyKey
	until time.Time
}
type History struct {
	mu           sync.Mutex
	capacity     int
	ttl          time.Duration
	entries      *list.List
	index        map[historyKey]historyIndex
	retired      *list.List
	retiredIndex map[historyKey]*list.Element
	blockedUntil time.Time
	now          func() time.Time
}

func NewHistory(capacity int, ttl time.Duration) *History {
	if capacity < 1 || capacity > 4096 {
		capacity = 4096
	}
	if ttl <= 0 || ttl > 24*time.Hour {
		ttl = 24 * time.Hour
	}
	return &History{capacity: capacity, ttl: ttl, entries: list.New(), index: make(map[historyKey]historyIndex),
		retired: list.New(), retiredIndex: make(map[historyKey]*list.Element), now: time.Now}
}

func boundedHistoryKey(scope Scope, id string) (historyKey, bool) {
	if len(id) > 160 || strings.ContainsAny(id, "\r\n\x00") {
		return historyKey{}, false
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return historyKey{}, false
	}
	return historyKey{Scope: scope, ID: sha256.Sum256([]byte(id))}, true
}

func (h *History) pruneRetired(now time.Time) {
	for front := h.retired.Front(); front != nil; front = h.retired.Front() {
		item, ok := front.Value.(retiredAlias)
		if !ok {
			h.retired.Remove(front)
			continue
		}
		if !now.After(item.until) {
			break
		}
		delete(h.retiredIndex, item.key)
		h.retired.Remove(front)
	}
}

var historyMetricAllowlist = map[string]bool{
	"body_read_block_ms": true, "body_wire_bytes": true, "body_normalize_ms": true,
	"body_first_read_ingress_ms": true, "body_last_read_ingress_ms": true,
	"handler_enter_ingress_ms": true, "body_ready_ingress_ms": true,
	"security_complete_ingress_ms": true, "routing_start_ingress_ms": true,
	"user_wait_ms": true, "account_wait_ms": true,
	"upstream_headers_ms": true, "connection_wait_ms": true,
	"chat_first_event_ingress_ms": true, "chat_first_text_event_ingress_ms": true,
	"upstream_semantic_ingress_ms": true, "downstream_semantic_flush_ingress_ms": true,
	"downstream_write_block_ms": true, "downstream_flush_block_ms": true,
	"upstream_attempts":         true,
	"upstream_request_write_ms": true, "upstream_first_byte_ms": true,
	"upstream_first_event_ingress_ms": true,
}

func (h *History) Publish(scope Scope, ids []string, snapshot map[string]any) {
	if h == nil || scope.UserID <= 0 || scope.APIKeyID <= 0 {
		return
	}
	metrics := make(map[string]int64)
	for name, value := range snapshot {
		if n, ok := value.(int64); ok && historyMetricAllowlist[name] && n >= 0 && n <= 1<<40 {
			metrics[name] = n
		}
	}
	if len(metrics) == 0 {
		return
	}
	keys := make([]historyKey, 0, 2)
	for _, id := range ids {
		key, valid := boundedHistoryKey(scope, id)
		if !valid {
			continue
		}
		if len(keys) > 0 && keys[0] == key {
			continue
		}
		keys = append(keys, key)
		if len(keys) == 2 {
			break
		}
	}
	if len(keys) == 0 {
		return
	}
	bodyResult, _ := snapshot["body_read_result"].(string)
	if bodyResult != "complete" && bodyResult != "error" {
		bodyResult = ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	if !h.blockedUntil.IsZero() && !now.After(h.blockedUntil) {
		return
	}
	h.pruneRetired(now)
	collisions := make(map[historyKey]bool, len(keys))
	for _, key := range keys {
		_, collisions[key] = h.retiredIndex[key]
		if previous, exists := h.index[key]; exists {
			previousEntry, ok := previous.entry.Value.(*historyEntry)
			if !ok {
				collisions[key] = true
				continue
			}
			collisions[key] = collisions[key] || now.Sub(previousEntry.record.ObservedAt) < h.ttl
		}
	}
	for front := h.entries.Front(); front != nil; front = h.entries.Front() {
		entry, ok := front.Value.(*historyEntry)
		if !ok {
			h.entries.Remove(front)
			continue
		}
		if h.entries.Len() < h.capacity && now.Sub(entry.record.ObservedAt) < h.ttl {
			break
		}
		if !h.remove(front, now) {
			return
		}
	}
	for _, key := range keys {
		_, retired := h.retiredIndex[key]
		collisions[key] = collisions[key] || retired
	}
	entry := h.entries.PushBack(&historyEntry{keys: keys, record: Record{
		SchemaVersion: 1, Source: "process_memory", ObservedAt: now,
		RetentionSeconds: int64(h.ttl.Seconds()), Capacity: h.capacity,
		Metrics: metrics, BodyReadResult: bodyResult,
	}})
	for _, key := range keys {
		h.index[key] = historyIndex{entry: entry, ambiguous: collisions[key]}
	}
}

func (h *History) Lookup(scope Scope, id string, createdAt time.Time) *Record {
	if h == nil || scope.UserID <= 0 || scope.APIKeyID <= 0 || createdAt.IsZero() {
		return nil
	}
	key, valid := boundedHistoryKey(scope, id)
	if !valid {
		return nil
	}
	h.mu.Lock()
	indexed, found := h.index[key]
	if !found || indexed.ambiguous {
		h.mu.Unlock()
		return nil
	}
	entry, ok := indexed.entry.Value.(*historyEntry)
	if !ok {
		delete(h.index, key)
		h.mu.Unlock()
		return nil
	}
	if h.now().Sub(entry.record.ObservedAt) >= h.ttl {
		h.remove(indexed.entry, h.now())
		h.mu.Unlock()
		return nil
	}
	// Reused identifiers or a delayed, unrelated row must not receive this sample.
	delta := createdAt.Sub(entry.record.ObservedAt)
	if delta < -historyMatchWindow || delta > historyMatchWindow {
		h.mu.Unlock()
		return nil
	}
	result := entry.record
	h.mu.Unlock()
	// Cached records are immutable after publication. Copying this snapshot
	// outside the lock cannot race with eviction or a caller's returned map.
	result.Metrics = make(map[string]int64, len(entry.record.Metrics))
	for name, value := range entry.record.Metrics {
		result.Metrics[name] = value
	}
	return &result
}

func (h *History) remove(element *list.Element, now time.Time) bool {
	entry, ok := element.Value.(*historyEntry)
	if !ok {
		return false
	}
	until := entry.record.ObservedAt.Add(2 * historyMatchWindow)
	for _, key := range entry.keys {
		if !now.After(until) {
			if retired := h.retiredIndex[key]; retired != nil {
				previous, ok := retired.Value.(retiredAlias)
				if !ok || until.After(previous.until) {
					retired.Value = retiredAlias{key, until}
					h.retired.MoveToBack(retired)
				}
			} else {
				if len(h.retiredIndex) >= 2*h.capacity {
					h.entries.Init()
					clear(h.index)
					h.retired.Init()
					clear(h.retiredIndex)
					h.blockedUntil = now.Add(2 * historyMatchWindow)
					return false
				}
				h.retiredIndex[key] = h.retired.PushBack(retiredAlias{key, until})
			}
		}
		if h.index[key].entry == element {
			delete(h.index, key)
		}
	}
	h.entries.Remove(element)
	return true
}
