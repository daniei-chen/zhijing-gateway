package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"sync/atomic"
	"testing"
	"time"
)

// Opt-in operator lab. The transport maps every request to the nonce-protected
// synthetic receiver, strips Authorization, and has no model-route fallback.
func TestRelayJapanSyntheticNetwork(t *testing.T) {
	raw := os.Getenv("ZHIJING_RELAY_SYNTHETIC_PROBE")
	if raw == "" {
		t.Skip("requires an explicitly running isolated Japan upload receiver")
	}
	var config struct {
		Token string `json:"token"`
		Path  string `json:"path"`
	}
	if json.Unmarshal([]byte(raw), &config) != nil || !regexp.MustCompile(`^[a-f0-9]{48}$`).MatchString(config.Token) || config.Path != "/__zhijing_upload_probe_"+config.Token {
		t.Fatal("invalid isolated probe configuration")
	}
	target, _ := url.Parse(upstreamURL)
	sharedTransport := defaultTransport()
	defer sharedTransport.CloseIdleConnections()
	var connections atomic.Int32
	var lastReused atomic.Bool
	trace := &httptrace.ClientTrace{GotConn: func(info httptrace.GotConnInfo) {
		connections.Add(1)
		lastReused.Store(info.Reused)
	}}
	fixtureTransport := tripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host != target.Host || request.URL.Scheme != "https" {
			return nil, fmt.Errorf("unexpected_synthetic_host")
		}
		request.URL.Path, request.URL.RawPath, request.URL.RawQuery = config.Path, "", ""
		request.Header.Del("Authorization")
		request.Header.Set("X-Zhijing-Probe", config.Token)
		request = request.WithContext(httptrace.WithClientTrace(request.Context(), trace))
		response, err := sharedTransport.RoundTrip(request)
		if err == nil {
			response.Header.Set("X-Zhijing-Synthetic-Protocol", response.Proto)
		}
		return response, err
	})
	relay := httptest.NewServer(newLocalRelay(target, fixtureTransport, relayOptions{}))
	defer relay.CloseClientConnections()
	defer relay.Close()
	localTransport := &http.Transport{Proxy: nil, DisableCompression: true}
	defer localTransport.CloseIdleConnections()
	local := &http.Client{Transport: localTransport, Timeout: 50 * time.Second}
	direct := &http.Client{Transport: sharedTransport, Timeout: 50 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	failed := false
	for _, size := range []int{512 << 10, 5 << 20, 10 << 20} {
		body := syntheticNetworkBody(size)
		digest := sha256.Sum256(body)
		for round := 1; round <= 2; round++ {
			modes := []string{"identity", "relay_gzip"}
			if round == 2 {
				modes[0], modes[1] = modes[1], modes[0]
			}
			for _, mode := range modes {
				endpoint, client := upstreamURL+config.Path, direct
				if mode == "relay_gzip" {
					endpoint, client = relay.URL+"/v1/responses", local
				}
				request, _ := http.NewRequest("POST", endpoint, bytes.NewReader(body))
				request.Header.Set("Content-Type", "application/json")
				request.GetBody = nil
				if mode == "relay_gzip" {
					request.Header.Set("Authorization", syntheticAuthorization)
				} else {
					request.Header.Set("X-Zhijing-Probe", config.Token)
					request = request.WithContext(httptrace.WithClientTrace(request.Context(), trace))
				}
				beforeConnections := connections.Load()
				started := time.Now()
				response, err := client.Do(request)
				if err != nil {
					label := "transport"
					if errors.Is(err, context.DeadlineExceeded) {
						label = "deadline"
					}
					result, _ := json.Marshal(map[string]any{"mode": mode, "round": round,
						"decoded_bytes": len(body), "elapsed_ms": float64(time.Since(started).Microseconds()) / 1000,
						"integrity_verified": false, "error_class": label})
					t.Log(string(result))
					failed = true
					continue
				}
				var got struct {
					WireBytes     int     `json:"wire_bytes"`
					DecodedBytes  int     `json:"decoded_bytes"`
					DecodedSHA256 string  `json:"decoded_sha256"`
					ReceiveMS     float64 `json:"receive_ms"`
				}
				decodeErr := json.NewDecoder(io.LimitReader(response.Body, 8192)).Decode(&got)
				_, drainErr := io.Copy(io.Discard, io.LimitReader(response.Body, 8192))
				_ = response.Body.Close()
				if response.StatusCode != 200 || decodeErr != nil || drainErr != nil || got.DecodedBytes != len(body) || got.DecodedSHA256 != hex.EncodeToString(digest[:]) {
					result, _ := json.Marshal(map[string]any{"mode": mode, "round": round,
						"decoded_bytes": len(body), "elapsed_ms": float64(time.Since(started).Microseconds()) / 1000,
						"status": response.StatusCode, "integrity_verified": false, "error_class": "response_or_integrity"})
					t.Log(string(result))
					failed = true
					continue
				}
				protocol := response.Proto
				if mode == "relay_gzip" {
					protocol = response.Header.Get("X-Zhijing-Synthetic-Protocol")
				}
				if protocol != "HTTP/2.0" {
					t.Fatal("synthetic upstream did not use HTTP/2")
				}
				result, _ := json.Marshal(map[string]any{"mode": mode, "round": round,
					"decoded_bytes": len(body), "wire_bytes": got.WireBytes, "protocol": protocol,
					"elapsed_ms":  float64(time.Since(started).Microseconds()) / 1000,
					"receiver_ms": got.ReceiveMS, "integrity_verified": true,
					"shared_target_transport": true, "connection_attempts": connections.Load() - beforeConnections,
					"target_connection_reused": lastReused.Load()})
				t.Log(string(result))
			}
		}
	}
	if failed {
		t.Error("some bounded synthetic network samples failed; failures are retained, not retried")
	}
}

func syntheticNetworkBody(size int) []byte {
	const prefix, suffix = `{"synthetic_source":"`, `"}`
	var buffer bytes.Buffer
	buffer.Grow(size + 256)
	buffer.WriteString(prefix)
	for index := 0; buffer.Len() < size-len(suffix); index++ {
		digest := sha256.Sum256([]byte(strconv.Itoa(index)))
		fmt.Fprintf(&buffer, "export const item%d = { id: '%x', enabled: true, route: 'synthetic', value: null }; ", index, digest)
	}
	return append(buffer.Bytes()[:size-len(suffix)], []byte(suffix)...)
}
