package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const syntheticAuthorization = "Bearer synthetic-local-fixture-only"

type tripFunc func(*http.Request) (*http.Response, error)

func (f tripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return f(request) }

func relayFixture(t *testing.T, handler http.Handler, options relayOptions, h2 bool) (*httptest.Server, *httptest.Server) {
	t.Helper()
	upstream := httptest.NewUnstartedServer(handler)
	upstream.EnableHTTP2 = h2
	if h2 {
		upstream.StartTLS()
	} else {
		upstream.Start()
	}
	target, _ := url.Parse(upstream.URL)
	transport := upstream.Client().Transport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.ForceAttemptHTTP2 = h2
	transport.DisableCompression = true
	relay := httptest.NewServer(newLocalRelay(target, transport, options))
	t.Cleanup(func() {
		relay.CloseClientConnections()
		relay.Close()
		transport.CloseIdleConnections()
		upstream.CloseClientConnections()
		upstream.Close()
	})
	return relay, upstream
}

func doRelay(t *testing.T, base, method, path, encoding string, body []byte) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, base+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", syntheticAuthorization)
	request.Header.Set("Content-Type", "application/json")
	if encoding != "" {
		request.Header.Set("Content-Encoding", encoding)
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func TestRelayLosslessJSONCompressionEveryPOSTRoute(t *testing.T) {
	plain := []byte(`{"source":"` + strings.Repeat("export const value = 42; ", 16000) + `"}`)
	for _, path := range []string{"/v1/responses", "/v1/chat/completions", "/v1/responses/compact"} {
		t.Run(path, func(t *testing.T) {
			var calls atomic.Int32
			received := make(chan []byte, 1)
			relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Content-Encoding") != "gzip" || r.Header.Get("Authorization") != syntheticAuthorization || r.URL.Path != path {
					t.Error("route, authorization or compression changed incorrectly")
				}
				decoder, err := gzip.NewReader(r.Body)
				if err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				defer decoder.Close()
				got, _ := io.ReadAll(decoder)
				received <- got
				_, _ = io.WriteString(w, "synthetic-ok")
			}), relayOptions{}, false)
			response := doRelay(t, relay.URL, "POST", path, "identity", plain)
			result, _ := io.ReadAll(response.Body)
			if response.StatusCode != 200 || string(result) != "synthetic-ok" || !bytes.Equal(<-received, plain) || calls.Load() != 1 {
				t.Fatal("request not forwarded exactly once with identical decoded content")
			}
		})
	}
}

func TestRelayPreservesSmallSignedNonJSONAndAlreadyEncodedBodies(t *testing.T) {
	for _, item := range []struct {
		name, encoding, contentType, signature string
		body                                   []byte
	}{
		{"small", "", "application/json", "", []byte(`{"input":"synthetic"}`)},
		{"signature", "identity", "application/json", "synthetic-digest", bytes.Repeat([]byte("x"), minimumCompress+100)},
		{"non_json", "identity", "application/octet-stream", "", bytes.Repeat([]byte("x"), minimumCompress+100)},
		{"gzip", "gzip", "application/json", "", []byte("opaque-precompressed-gzip")},
		{"zstd", "zstd", "application/json", "", []byte("opaque-precompressed-zstd")},
	} {
		t.Run(item.name, func(t *testing.T) {
			relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got, _ := io.ReadAll(r.Body)
				if !bytes.Equal(got, item.body) || r.Header.Get("Content-Encoding") != item.encoding || r.Header.Get("Content-Digest") != item.signature {
					t.Error("opaque input changed")
				}
				w.WriteHeader(204)
			}), relayOptions{}, false)
			request, _ := http.NewRequest("POST", relay.URL+"/v1/responses", bytes.NewReader(item.body))
			request.Header.Set("Authorization", syntheticAuthorization)
			request.Header.Set("Content-Type", item.contentType)
			request.Header.Set("Content-Encoding", item.encoding)
			request.Header.Set("Content-Digest", item.signature)
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != 204 {
				t.Fatalf("status %d", response.StatusCode)
			}
		})
	}
}

func TestRelayRejectsBeforeAnyUpstreamDispatch(t *testing.T) {
	var calls atomic.Int32
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }), relayOptions{}, false)
	for _, item := range []struct {
		name, method, path, header, value string
		status                            int
	}{
		{"auth", "POST", "/v1/responses", "Authorization", "", 401},
		{"origin", "POST", "/v1/responses", "Origin", "https://untrusted.invalid", 403},
		{"path", "POST", "/admin/users", "", "", 404},
		{"upgrade", "POST", "/v1/responses", "Upgrade", "websocket", 404},
		{"encoding", "POST", "/v1/responses", "Content-Encoding", "br", 415},
		{"host", "POST", "/v1/responses", "Host", "rebound.invalid", 400},
		{"method", "DELETE", "/v1/models", "", "", 404},
	} {
		t.Run(item.name, func(t *testing.T) {
			request, _ := http.NewRequest(item.method, relay.URL+item.path, strings.NewReader("{}"))
			request.Header.Set("Authorization", syntheticAuthorization)
			if item.header == "Host" {
				request.Host = item.value
			} else if item.header != "" {
				request.Header.Set(item.header, item.value)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != item.status {
				t.Fatalf("want %d, got %d", item.status, response.StatusCode)
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("rejected request reached upstream")
	}
}

func TestRelayForwardsQuotaErrorAndTraceExactlyOnceWithoutBodyRewind(t *testing.T) {
	var calls atomic.Int32
	transport := tripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.GetBody != nil || r.Host != "fixed.synthetic.invalid" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Forwarded-For") != "" {
			t.Error("unsafe forwarding or replayable body")
		}
		return &http.Response{StatusCode: 429, Header: http.Header{
			"Content-Type": {"application/json"}, "Retry-After": {"2"},
			"X-Zhijing-Trace-Id": {"synthetic-trace"}, "Set-Cookie": {"do-not-store"}},
			Body: io.NopCloser(strings.NewReader(`{"error":{"code":"gateway_global_concurrency_limit"}}`)), Request: r}, nil
	})
	target, _ := url.Parse("https://fixed.synthetic.invalid")
	server := httptest.NewServer(newLocalRelay(target, transport, relayOptions{}))
	defer server.Close()
	request, _ := http.NewRequest("POST", server.URL+"/v1/responses", strings.NewReader("{}"))
	request.Header.Set("Authorization", syntheticAuthorization)
	request.Header.Set("Cookie", "synthetic-private-cookie")
	request.Header.Set("X-Forwarded-For", "synthetic-address")
	request.Header.Set("Idempotency-Key", "synthetic-do-not-replay")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 429 || calls.Load() != 1 || response.Header.Get("Retry-After") != "2" || response.Header.Get("X-Zhijing-Trace-ID") != "synthetic-trace" || response.Header.Get("Set-Cookie") != "" || string(body) != `{"error":{"code":"gateway_global_concurrency_limit"}}` {
		t.Fatal("upstream rejection was modified or replayed")
	}
}

func TestRelayEOFDoesNotReplayDispatchedPOSTOrLeakRawError(t *testing.T) {
	var calls atomic.Int32
	var events = make(chan relayEvent, 1)
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			_ = conn.Close()
		}
	}), relayOptions{logEvent: func(event relayEvent) { events <- event }}, false)
	response := doRelay(t, relay.URL, "POST", "/v1/chat/completions", "identity", []byte("{}"))
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 502 || calls.Load() != 1 || bytes.Contains(body, []byte(syntheticAuthorization)) || bytes.Contains(body, []byte("127.0.0.1")) {
		t.Fatal("EOF replay or raw error exposure")
	}
	select {
	case event := <-events:
		serialized, _ := json.Marshal(event)
		if event.ErrorClass != "upstream_transport" || bytes.Contains(serialized, []byte(syntheticAuthorization)) {
			t.Fatal("sensitive event or wrong error category")
		}
	case <-time.After(time.Second):
		t.Fatal("missing numeric event")
	}
}

func TestRelayHTTP2SSEFlushesBeforeCompletionAndPreservesTerminalUsage(t *testing.T) {
	finish := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(finish) }) }
	t.Cleanup(unblock)
	const first = "data: {\"type\":\"response.created\",\"synthetic\":true}\n\n"
	const last = "data: {\"type\":\"response.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}\n\n"
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ProtoMajor != 2 {
			t.Error("not HTTP/2")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, first)
		w.(http.Flusher).Flush()
		select {
		case <-finish:
			_, _ = io.WriteString(w, last)
		case <-r.Context().Done():
		}
	}), relayOptions{}, true)
	response := doRelay(t, relay.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil || line != strings.Split(first, "\n")[0]+"\n" {
		t.Fatal("first SSE event was buffered until completion")
	}
	unblock()
	rest, err := io.ReadAll(reader)
	if err != nil || line+string(rest) != first+last {
		t.Fatal("SSE or terminal usage changed")
	}
}

func TestRelayMidStreamHTTP2FailureIsNotReplayedOrForgedComplete(t *testing.T) {
	var calls atomic.Int32
	abort := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(abort) }) }
	t.Cleanup(unblock)
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"response.created\"}\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-abort:
		case <-r.Context().Done():
		}
		panic(http.ErrAbortHandler)
	}), relayOptions{}, true)
	response := doRelay(t, relay.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	reader := bufio.NewReader(response.Body)
	_, err := reader.ReadString('\n')
	if err != nil {
		t.Fatal("missing initial SSE event")
	}
	unblock()
	body, err := io.ReadAll(reader)
	if err == nil || calls.Load() != 1 || bytes.Contains(body, []byte("response.completed")) || bytes.Contains(body, []byte("client_relay_error")) {
		t.Fatal("partial SSE was hidden, replayed or forged")
	}
}

func TestRelayClientDisconnectCancelsLocalUpstream(t *testing.T) {
	canceled := make(chan struct{})
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"synthetic\":true}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(canceled)
	}), relayOptions{}, true)
	response := doRelay(t, relay.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	_ = response.Body.Close()
	select {
	case <-canceled:
	case <-time.After(2 * time.Second):
		t.Fatal("client disconnect did not cancel local forwarding")
	}
}

func TestRelayThreeLocalSlotsAndFourthIsNotDispatched(t *testing.T) {
	started := make(chan struct{}, 3)
	finish := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(finish) }) }
	defer unblock()
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started <- struct{}{}
		select {
		case <-finish:
		case <-r.Context().Done():
		}
		w.WriteHeader(204)
	}), relayOptions{}, false)
	results := make(chan error, 3)
	for range 3 {
		go func() {
			request, _ := http.NewRequest("POST", relay.URL+"/v1/responses", strings.NewReader("{}"))
			request.Header.Set("Authorization", syntheticAuthorization)
			response, err := http.DefaultClient.Do(request)
			if err == nil {
				_ = response.Body.Close()
			}
			results <- err
		}()
	}
	for range 3 {
		select {
		case <-started:
		case <-time.After(2 * time.Second):
			t.Fatal("fixture did not fill three local slots")
		}
	}
	response := doRelay(t, relay.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	if response.StatusCode != 429 {
		t.Fatal("fourth local request not rejected")
	}
	unblock()
	for range 3 {
		if err := <-results; err != nil {
			t.Error(err)
		}
	}
}

func TestRelayPartialLocalUploadTimesOutWithoutUpstreamDispatch(t *testing.T) {
	var calls atomic.Int32
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }), relayOptions{uploadTimeout: 70 * time.Millisecond}, false)
	parsed, _ := url.Parse(relay.URL)
	conn, err := net.DialTimeout("tcp", parsed.Host, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	_, _ = fmt.Fprintf(conn, "POST /v1/responses HTTP/1.1\r\nHost: %s\r\nAuthorization: %s\r\nContent-Length: 1000000\r\nContent-Type: application/json\r\n\r\n{", parsed.Host, syntheticAuthorization)
	response, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 408 || calls.Load() != 0 {
		t.Fatal("partial local upload escaped its deadline or reached upstream")
	}
}

func TestRelayTransportErrorDoesNotExposeRequestOrErrorText(t *testing.T) {
	target, _ := url.Parse("https://fixed.synthetic.invalid")
	r := newLocalRelay(target, tripFunc(func(*http.Request) (*http.Response, error) {
		return nil, fmt.Errorf("private-error-synthetic-prompt-key-%s", syntheticAuthorization)
	}), relayOptions{})
	server := httptest.NewServer(r)
	defer server.Close()
	response := doRelay(t, server.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	body, _ := io.ReadAll(response.Body)
	if bytes.Contains(body, []byte("private-error")) || bytes.Contains(body, []byte(syntheticAuthorization)) {
		t.Fatal("raw error escaped")
	}
}

func TestRelayForwardDeadlineHasNoRetry(t *testing.T) {
	var calls atomic.Int32
	target, _ := url.Parse("https://fixed.synthetic.invalid")
	r := newLocalRelay(target, tripFunc(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		<-request.Context().Done()
		return nil, context.DeadlineExceeded
	}), relayOptions{forwardLimit: 50 * time.Millisecond})
	server := httptest.NewServer(r)
	defer server.Close()
	response := doRelay(t, server.URL, "POST", "/v1/responses", "identity", []byte("{}"))
	if response.StatusCode != 504 || calls.Load() != 1 {
		t.Fatal("deadline not bounded or request replayed")
	}
}

func TestRelayOversizeLengthAndAbsoluteProxyFormNeverDispatch(t *testing.T) {
	var calls atomic.Int32
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }), relayOptions{}, false)
	parsed, _ := url.Parse(relay.URL)
	for _, item := range []struct {
		line   string
		size   int
		status int
	}{
		{"POST /v1/responses HTTP/1.1", maxRequestBytes + 1, 413},
		{"POST https://not-a-proxy.invalid/v1/responses HTTP/1.1", 2, 400},
	} {
		conn, err := net.DialTimeout("tcp", parsed.Host, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
		_, _ = fmt.Fprintf(conn, "%s\r\nHost: %s\r\nAuthorization: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n{}", item.line, parsed.Host, syntheticAuthorization, item.size)
		response, err := http.ReadResponse(bufio.NewReader(conn), nil)
		if err != nil {
			_ = conn.Close()
			t.Fatal(err)
		}
		_ = response.Body.Close()
		_ = conn.Close()
		if response.StatusCode != item.status {
			t.Fatalf("want %d got %d", item.status, response.StatusCode)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid input dispatched")
	}
}

func TestRelayHealthModelsAndExplicitOriginPreflight(t *testing.T) {
	var calls atomic.Int32
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1/models" || r.Method != "GET" {
			t.Error("incorrect models request")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[]}`)
	}), relayOptions{allowOrigins: map[string]bool{"https://trusted.synthetic.invalid": true}}, false)
	health, err := http.Get(relay.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	_ = health.Body.Close()
	if health.StatusCode != 200 || calls.Load() != 0 {
		t.Fatal("local health unexpectedly touched upstream")
	}
	preflight, _ := http.NewRequest("OPTIONS", relay.URL+"/v1/responses", nil)
	preflight.Header.Set("Origin", "https://trusted.synthetic.invalid")
	preflight.Header.Set("Access-Control-Request-Method", "POST")
	response, err := http.DefaultClient.Do(preflight)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 204 || response.Header.Get("Access-Control-Allow-Origin") != "https://trusted.synthetic.invalid" || calls.Load() != 0 {
		t.Fatal("origin preflight failed or dispatched")
	}
	models := doRelay(t, relay.URL, "GET", "/v1/models", "", nil)
	_, _ = io.ReadAll(models.Body)
	if models.StatusCode != 200 || calls.Load() != 1 {
		t.Fatal("models forwarding failed")
	}
}

func TestRelayUnreadDownstreamCannotHoldSlotForever(t *testing.T) {
	events := make(chan relayEvent, 1)
	relay, _ := relayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		buffer := make([]byte, 64<<10)
		for range 1024 {
			if _, err := w.Write(buffer); err != nil {
				return
			}
		}
	}), relayOptions{forwardLimit: 500 * time.Millisecond, writeGrace: 100 * time.Millisecond,
		logEvent: func(event relayEvent) { events <- event }}, false)
	parsed, _ := url.Parse(relay.URL)
	conn, err := net.DialTimeout("tcp", parsed.Host, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_, _ = fmt.Fprintf(conn, "POST /v1/responses HTTP/1.1\r\nHost: %s\r\nAuthorization: %s\r\nContent-Length: 2\r\nContent-Type: application/json\r\n\r\n{}", parsed.Host, syntheticAuthorization)
	// Intentionally never read the response, exercising a blocked TCP write.
	select {
	case event := <-events:
		if event.HandlerDone || event.ErrorClass != "response_copy_interrupted" {
			t.Fatal("blocked downstream was reported as a completed response")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("unread downstream kept the local slot beyond its write deadline")
	}
}
