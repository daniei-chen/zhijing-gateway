package gatewaytiming

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestHistoryRetirementIsBoundedAndRecoversAfterOverlap(t *testing.T) {
	h := NewHistory(2, time.Hour)
	now := time.Unix(1800000000, 0)
	h.now = func() time.Time { return now }
	scope := Scope{101, 201}
	for i := 0; i < 20; i++ {
		h.Publish(scope, []string{fmt.Sprint(i)}, map[string]any{"user_wait_ms": int64(0)})
		require.LessOrEqual(t, len(h.retiredIndex), 4)
		require.LessOrEqual(t, h.retired.Len(), 4)
		require.LessOrEqual(t, h.entries.Len(), 2)
	}
	require.False(t, h.blockedUntil.IsZero())
	require.Nil(t, h.Lookup(scope, "19", now))
	now = h.blockedUntil.Add(time.Nanosecond)
	h.Publish(scope, []string{"after-overlap"}, map[string]any{"user_wait_ms": int64(0)})
	require.NotNil(t, h.Lookup(scope, "after-overlap", now))
}

func TestHistoryExpiredAliasCannotBorrowNewMetrics(t *testing.T) {
	h := NewHistory(2, time.Second)
	now := time.Unix(1800000000, 0)
	h.now = func() time.Time { return now }
	old := now
	scope := Scope{101, 201}
	h.Publish(scope, []string{"same"}, map[string]any{"user_wait_ms": int64(1)})
	now = now.Add(2 * time.Second)
	h.Publish(scope, []string{"same"}, map[string]any{"user_wait_ms": int64(9)})
	require.Nil(t, h.Lookup(scope, "same", old))
}

func TestHistoryLookupRejectsUnboundedOrInvalidIDs(t *testing.T) {
	h := NewHistory(2, time.Hour)
	scope := Scope{101, 201}
	now := time.Now()
	h.Publish(scope, []string{"valid"}, map[string]any{"user_wait_ms": int64(0)})
	for _, id := range []string{"", strings.Repeat(" ", 1<<20), strings.Repeat("x", 161), "valid\n", "valid\x00"} {
		require.Nil(t, h.Lookup(scope, id, now))
	}
	require.NotNil(t, h.Lookup(scope, " valid ", now))
}
