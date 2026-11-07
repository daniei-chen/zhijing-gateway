// Package gatewaytiming records request-local timings without request content or credentials.
package gatewaytiming

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"
)

type contextKey struct{}

type Collector struct {
	mu      sync.Mutex
	started time.Time
	values  map[string]any
}

func Start(ctx context.Context) context.Context {
	return context.WithValue(ctx, contextKey{}, &Collector{started: time.Now(), values: make(map[string]any)})
}

func collector(ctx context.Context) *Collector {
	if ctx == nil {
		return nil
	}
	c, _ := ctx.Value(contextKey{}).(*Collector)
	return c
}

func Snapshot(ctx context.Context) map[string]any {
	c := collector(ctx)
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	result := make(map[string]any, len(c.values))
	for key, value := range c.values {
		result[key] = value
	}
	return result
}

func (c *Collector) add(key string, value int64) {
	current, _ := c.values[key].(int64)
	c.values[key] = current + value
}

// ObserveBody measures actual wire reads without buffering, decoding or changing
// cancellation. A body copied by later middleware is still observed only once.
func ObserveBody(req *http.Request) {
	if req == nil || req.Body == nil || req.Body == http.NoBody || collector(req.Context()) == nil {
		return
	}
	if _, observed := req.Body.(*observedBody); observed {
		return
	}
	req.Body = &observedBody{ReadCloser: req.Body, collector: collector(req.Context())}
}

type observedBody struct {
	io.ReadCloser
	collector *Collector
}

func (body *observedBody) Read(buffer []byte) (int, error) {
	started := time.Now()
	n, err := body.ReadCloser.Read(buffer)
	c := body.collector
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.values["body_first_read_ingress_ms"]; !exists {
		c.values["body_first_read_ingress_ms"] = started.Sub(c.started).Milliseconds()
	}
	c.add("body_read_block_ms", time.Since(started).Milliseconds())
	c.add("body_wire_bytes", int64(n))
	c.values["body_last_read_ingress_ms"] = time.Since(c.started).Milliseconds()
	if err == io.EOF {
		c.values["body_read_result"] = "complete"
	} else if err != nil {
		c.values["body_read_result"] = "error"
	}
	return n, err
}

func MarkIngressStage(ctx context.Context, stage string) {
	switch stage {
	case "handler_enter", "body_ready", "security_complete", "routing_start":
	default:
		return
	}
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := stage + "_ingress_ms"
	if _, exists := c.values[key]; !exists {
		c.values[key] = time.Since(c.started).Milliseconds()
	}
}

func RecordBodyNormalization(ctx context.Context, started time.Time) {
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.add("body_normalize_ms", time.Since(started).Milliseconds())
}

func RecordSlot(ctx context.Context, slot string, started time.Time, attempts int, outcome string) {
	c := collector(ctx)
	if c == nil || (slot != "user" && slot != "account") {
		return
	}
	switch outcome {
	case "acquired", "canceled", "timeout", "error":
	default:
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.add(slot+"_wait_ms", time.Since(started).Milliseconds())
	c.add(slot+"_poll_attempts", int64(attempts))
	c.add(slot+"_wait_count", 1)
	c.values[slot+"_wait_result"] = outcome
}

func MarkChatEvent(ctx context.Context, visible bool) {
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := "chat_first_event_ingress_ms"
	if visible {
		key = "chat_first_text_event_ingress_ms"
	}
	if _, exists := c.values[key]; !exists {
		c.values[key] = time.Since(c.started).Milliseconds()
	}
}

// Only bounded enums are recorded; requested and reported tiers remain distinct
// and neither is labeled an independently verified acceleration entitlement.
func RecordTier(ctx context.Context, stage, value string) {
	key := ""
	if stage == "contract" {
		key = "service_tier_contract"
		if value != "api_response" && value != "oauth_unverified" {
			return
		}
	} else {
		switch stage {
		case "outbound", "response":
			key = "service_tier_" + stage
		default:
			return
		}
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "":
			value = "not_reported"
		case "fast", "priority":
			value = "priority"
		case "default", "auto", "flex", "scale", "ultrafast":
			value = strings.ToLower(strings.TrimSpace(value))
		default:
			value = "unrecognized"
		}
	}
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.values[key] = value
}

func MarkOutput(ctx context.Context, stage, kind string) {
	if stage != "upstream_semantic" && stage != "downstream_semantic_flush" {
		return
	}
	if kind != "text" && kind != "tool" && kind != "reasoning" {
		return
	}
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	key := stage + "_ingress_ms"
	if _, exists := c.values[key]; !exists {
		c.values[key] = time.Since(c.started).Milliseconds()
		c.values[stage+"_kind"] = kind
	}
}

// MarkResponseEvent distinguishes provider preamble from actual usable output.
// Only a timestamp is retained, never the upstream event or response content.
func MarkResponseEvent(ctx context.Context) {
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.values["upstream_first_event_ingress_ms"]; !exists {
		c.values["upstream_first_event_ingress_ms"] = time.Since(c.started).Milliseconds()
	}
}

func RecordDownstreamWrite(ctx context.Context, started time.Time, written int, err error) {
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.add("downstream_write_block_ms", time.Since(started).Milliseconds())
	if written > 0 {
		c.add("downstream_wire_bytes", int64(written))
		if _, exists := c.values["downstream_first_write_ingress_ms"]; !exists {
			c.values["downstream_first_write_ingress_ms"] = time.Since(c.started).Milliseconds()
		}
	}
	if err != nil {
		c.add("downstream_write_errors", 1)
	}
}

func RecordDownstreamFlush(ctx context.Context, started time.Time) {
	c := collector(ctx)
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.add("downstream_flush_block_ms", time.Since(started).Milliseconds())
}

// Trace returns a request clone; cancellation, body and transport policy stay unchanged.
// finish records the response-header stage, including transport/plugin failures.
func Trace(req *http.Request) (*http.Request, func(*http.Response, error)) {
	c := collector(req.Context())
	if c == nil {
		return req, func(*http.Response, error) {}
	}
	started := time.Now()
	var getConn, dns, tlsStart time.Time
	connects := make(map[string]time.Time)
	trace := &httptrace.ClientTrace{
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err != nil {
				return
			}
			c.mu.Lock()
			defer c.mu.Unlock()
			c.add("upstream_request_write_ms", time.Since(started).Milliseconds())
		},
		GotFirstResponseByte: func() {
			c.mu.Lock()
			defer c.mu.Unlock()
			c.add("upstream_first_byte_ms", time.Since(started).Milliseconds())
		},
		GetConn: func(string) { c.mu.Lock(); getConn = time.Now(); c.mu.Unlock() },
		GotConn: func(info httptrace.GotConnInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			if !getConn.IsZero() {
				c.add("connection_wait_ms", time.Since(getConn).Milliseconds())
			}
			if info.Reused {
				c.add("connections_reused", 1)
			} else {
				c.add("connections_new", 1)
			}
		},
		DNSStart: func(httptrace.DNSStartInfo) { c.mu.Lock(); dns = time.Now(); c.mu.Unlock() },
		DNSDone: func(httptrace.DNSDoneInfo) {
			c.mu.Lock()
			defer c.mu.Unlock()
			if !dns.IsZero() {
				c.add("dns_ms", time.Since(dns).Milliseconds())
				dns = time.Time{}
			}
		},
		ConnectStart: func(network, address string) {
			c.mu.Lock()
			defer c.mu.Unlock()
			connects[network+"\x00"+address] = time.Now()
		},
		ConnectDone: func(network, address string, _ error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			key := network + "\x00" + address
			if at, ok := connects[key]; ok {
				c.add("tcp_connect_ms", time.Since(at).Milliseconds())
				delete(connects, key)
			}
		},
		TLSHandshakeStart: func() { c.mu.Lock(); tlsStart = time.Now(); c.mu.Unlock() },
		TLSHandshakeDone: func(tls.ConnectionState, error) {
			c.mu.Lock()
			defer c.mu.Unlock()
			if !tlsStart.IsZero() {
				c.add("tls_ms", time.Since(tlsStart).Milliseconds())
				tlsStart = time.Time{}
			}
		},
	}
	return req.WithContext(httptrace.WithClientTrace(req.Context(), trace)), func(resp *http.Response, err error) {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.add("upstream_attempts", 1)
		c.add("upstream_headers_ms", time.Since(started).Milliseconds())
		if err != nil {
			c.add("upstream_transport_errors", 1)
		}
		if resp != nil {
			if resp.ProtoMajor == 2 {
				c.add("http2_responses", 1)
			} else if resp.ProtoMajor == 1 {
				c.add("http1_responses", 1)
			}
		}
	}
}
