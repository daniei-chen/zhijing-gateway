package gatewaytiming

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTraceReusesConnectionAndExportsNoContents(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = w.Write([]byte("synthetic-private-response"))
	}))
	defer server.Close()
	ctx := Start(context.Background())
	for range 2 {
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/private-path", strings.NewReader("synthetic-private-prompt"))
		req.Header.Set("Authorization", "Bearer synthetic-secret")
		req, finish := Trace(req)
		resp, err := server.Client().Do(req)
		finish(resp, err)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}
	snapshot := Snapshot(ctx)
	if snapshot["connections_new"] != int64(1) || snapshot["connections_reused"] != int64(1) || snapshot["upstream_attempts"] != int64(2) {
		t.Fatalf("unexpected counters: %v", snapshot)
	}
	encoded, _ := json.Marshal(snapshot)
	for _, secret := range []string{"synthetic", "private", "Bearer", "127.0.0.1", "Authorization"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("unexpected metadata: %s", secret)
		}
	}
	snapshot["connections_new"] = "changed"
	if Snapshot(ctx)["connections_new"] != int64(1) {
		t.Fatal("snapshot aliases collector")
	}
}

func TestCountersSafeDuringConcurrentSnapshotsAndFailures(t *testing.T) {
	ctx := Start(context.Background())
	var workers sync.WaitGroup
	for range 30 {
		workers.Go(func() {
			RecordSlot(ctx, "user", time.Now(), 2, "acquired")
			RecordSlot(ctx, "account", time.Now(), 1, "timeout")
			MarkChatEvent(ctx, false)
			MarkChatEvent(ctx, true)
			_ = Snapshot(ctx)
		})
	}
	workers.Wait()
	RecordSlot(ctx, "private-value", time.Now(), 1, "acquired")
	RecordSlot(ctx, "user", time.Now(), 1, "private-value")
	snapshot := Snapshot(ctx)
	if snapshot["user_wait_count"] != int64(30) || snapshot["account_poll_attempts"] != int64(30) || snapshot["user_poll_attempts"] != int64(60) {
		t.Fatalf("counter mismatch: %v", snapshot)
	}
	if snapshot["chat_first_event_ingress_ms"] == nil || snapshot["chat_first_text_event_ingress_ms"] == nil {
		t.Fatal("missing first-event distinction")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://example.invalid", nil)
	_, finish := Trace(req)
	finish(nil, context.Canceled)
	if Snapshot(ctx)["upstream_transport_errors"] != int64(1) {
		t.Fatal("missing failure observation")
	}
}

func TestTraceDisabledAndCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(Start(context.Background()))
	cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "http://example.invalid", nil)
	traced, _ := Trace(req)
	if traced.Context().Err() != context.Canceled {
		t.Fatal("trace discarded cancellation")
	}
	plain, _ := http.NewRequest(http.MethodPost, "http://example.invalid", nil)
	traced, finish := Trace(plain)
	if traced != plain {
		t.Fatal("inactive trace cloned request")
	}
	finish(nil, nil)
	if Snapshot(plain.Context()) != nil {
		t.Fatal("inactive collector has data")
	}
}

func TestOutputAndTierTimingsNeverStoreContent(t *testing.T) {
	ctx := Start(context.Background())
	RecordTier(ctx, "outbound", "FAST")
	RecordTier(ctx, "response", "default")
	RecordTier(ctx, "contract", "oauth_unverified")
	RecordTier(ctx, "private-stage", "private-value")
	RecordTier(ctx, "contract", "private-contract")
	MarkOutput(ctx, "upstream_semantic", "tool")
	MarkOutput(ctx, "downstream_semantic_flush", "tool")
	MarkOutput(ctx, "private-stage", "text")
	MarkOutput(ctx, "upstream_semantic", "private-kind")
	RecordDownstreamWrite(ctx, time.Now(), 42, nil)
	RecordDownstreamWrite(ctx, time.Now(), 0, context.Canceled)
	snapshot := Snapshot(ctx)
	if snapshot["service_tier_outbound"] != "priority" || snapshot["service_tier_response"] != "default" || snapshot["service_tier_contract"] != "oauth_unverified" {
		t.Fatal("tier provenance missing")
	}
	if snapshot["downstream_wire_bytes"] != int64(42) || snapshot["downstream_write_errors"] != int64(1) {
		t.Fatal("bad downstream counts")
	}
	if snapshot["upstream_semantic_kind"] != "tool" || snapshot["downstream_semantic_flush_kind"] != "tool" {
		t.Fatal("missing semantic distinction")
	}
	before := snapshot["upstream_semantic_ingress_ms"]
	MarkOutput(ctx, "upstream_semantic", "text")
	if Snapshot(ctx)["upstream_semantic_ingress_ms"] != before || Snapshot(ctx)["upstream_semantic_kind"] != "tool" {
		t.Fatal("first semantic event was overwritten")
	}
	encoded, _ := json.Marshal(snapshot)
	if strings.Contains(string(encoded), "private") {
		t.Fatal("untrusted diagnostic enum leaked")
	}
	RecordTier(ctx, "response", "untrusted-response-content")
	if Snapshot(ctx)["service_tier_response"] != "unrecognized" {
		t.Fatal("unknown tier was exported")
	}
	RecordTier(ctx, "response", "")
	if Snapshot(ctx)["service_tier_response"] != "not_reported" {
		t.Fatal("missing tier was called default")
	}
}
