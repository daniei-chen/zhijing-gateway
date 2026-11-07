// This isolated diagnostic never connects to a provider, a database, or Redis.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
)

const maxBytes = 16 << 20

type configuration struct {
	Token      string `json:"token"`
	TTLSeconds int    `json:"ttl_seconds"`
}

type countingBody struct {
	io.ReadCloser
	count int
}

func (b *countingBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.count += n
	return n, err
}

func handler(token, path string) http.Handler {
	slots := make(chan struct{}, 2)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != path || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Zhijing-Probe")), []byte(token)) != 1 {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		start := time.Now()
		counter := &countingBody{ReadCloser: http.MaxBytesReader(w, r.Body, maxBytes)}
		r.Body = counter
		body, err := httputil.ReadRequestBodyWithPrealloc(r)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(body) > maxBytes {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		if !json.Valid(body) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		digest := sha256.Sum256(body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"wire_bytes": counter.count, "decoded_bytes": len(body),
			"decoded_sha256": hex.EncodeToString(digest[:]),
			"receive_ms":     float64(time.Since(start).Microseconds()) / 1000,
			"synthetic_only": true,
		})
	})
}

func run() error {
	input := bufio.NewScanner(io.LimitReader(os.Stdin, 4096))
	if !input.Scan() {
		return fmt.Errorf("missing_configuration")
	}
	var config configuration
	if json.Unmarshal(input.Bytes(), &config) != nil || !regexp.MustCompile(`^[a-f0-9]{48}$`).MatchString(config.Token) || config.TTLSeconds < 30 || config.TTLSeconds > 900 {
		return fmt.Errorf("invalid_configuration")
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("loopback_listener_failed")
	}
	path := "/__zhijing_upload_probe_" + config.Token
	server := &http.Server{
		Handler: handler(config.Token, path), ReadHeaderTimeout: 8 * time.Second,
		ReadTimeout: 180 * time.Second, WriteTimeout: 185 * time.Second,
		IdleTimeout: 15 * time.Second, MaxHeaderBytes: 8192, ErrorLog: log.New(io.Discard, "", 0),
	}
	var once sync.Once
	stop := func() {
		once.Do(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if server.Shutdown(ctx) != nil {
				_ = server.Close()
			}
		})
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	go func() { input.Scan(); stop() }()
	timer := time.AfterFunc(time.Duration(config.TTLSeconds)*time.Second, stop)
	defer timer.Stop()
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"ready": true, "port": listener.Addr().(*net.TCPAddr).Port})
	err = <-done
	if err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("probe_server_failed")
	}
	return nil
}

func main() {
	if run() != nil {
		fmt.Fprintln(os.Stderr, "isolated_upload_probe_failed")
		os.Exit(1)
	}
}
