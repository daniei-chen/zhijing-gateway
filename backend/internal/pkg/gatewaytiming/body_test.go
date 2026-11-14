package gatewaytiming

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type delayedBody struct {
	started chan struct{}
	ready   chan struct{}
	closed  bool
	read    bool
	err     error
}

func (body *delayedBody) Read(p []byte) (int, error) {
	if body.read {
		return 0, io.EOF
	}
	body.read = true
	close(body.started)
	<-body.ready
	return copy(p, "synthetic-private"), body.err
}

func (body *delayedBody) Close() error { body.closed = true; return nil }

func TestBodyObservationRecordsBlockingNotPayload(t *testing.T) {
	ctx := Start(context.Background())
	body := &delayedBody{started: make(chan struct{}), ready: make(chan struct{})}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://example.invalid", body)
	ObserveBody(req)
	wrapped := req.Body
	ObserveBody(req)
	if req.Body != wrapped {
		t.Fatal("body wrapped twice")
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = io.ReadAll(req.Body)
	}()
	<-body.started
	MarkIngressStage(ctx, "handler_enter")
	MarkIngressStage(ctx, "secret-untrusted-stage")
	time.Sleep(25 * time.Millisecond)
	close(body.ready)
	<-done
	_ = req.Body.Close()
	MarkIngressStage(ctx, "body_ready")
	RecordBodyNormalization(ctx, time.Now())
	MarkIngressStage(ctx, "security_complete")
	MarkIngressStage(ctx, "routing_start")
	snapshot := Snapshot(ctx)
	if snapshot["body_wire_bytes"] != int64(len("synthetic-private")) || snapshot["body_read_result"] != "complete" {
		t.Fatalf("bad body counters: %v", snapshot)
	}
	blocked, ok := snapshot["body_read_block_ms"].(int64)
	if !ok || blocked < 20 {
		t.Fatal("blocking was not measured")
	}
	encoded, _ := json.Marshal(snapshot)
	if strings.Contains(string(encoded), "synthetic") || strings.Contains(string(encoded), "secret-untrusted") {
		t.Fatal("payload/stage leaked")
	}
	if !body.closed {
		t.Fatal("close not delegated")
	}
}

func TestBodyObservationPreservesErrorCancellationAndNil(t *testing.T) {
	ObserveBody(nil)
	req, _ := http.NewRequest(http.MethodPost, "http://example.invalid", nil)
	ObserveBody(req)
	ctx, cancel := context.WithCancel(Start(context.Background()))
	cancel()
	body := &delayedBody{started: make(chan struct{}), ready: make(chan struct{}), err: context.Canceled}
	close(body.ready)
	req, _ = http.NewRequestWithContext(ctx, http.MethodPost, "http://example.invalid", body)
	ObserveBody(req)
	_, err := io.ReadAll(req.Body)
	if !errors.Is(err, context.Canceled) || req.Context().Err() != context.Canceled {
		t.Fatal("cancellation changed")
	}
	if Snapshot(ctx)["body_read_result"] != "error" {
		t.Fatal("failed read was counted complete")
	}
}
