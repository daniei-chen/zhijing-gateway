// Optional local request compression. No credentials, services, or client
// configuration are installed or changed by this executable.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func discardLogger() *log.Logger { return log.New(io.Discard, "", 0) }

func defaultTransport() *http.Transport {
	return &http.Transport{
		Proxy:             currentSystemProxy,
		DialContext:       (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		ForceAttemptHTTP2: true, DisableCompression: true,
		TLSHandshakeTimeout: 10 * time.Second, IdleConnTimeout: 120 * time.Second,
		MaxIdleConns: 8, MaxIdleConnsPerHost: 4, MaxConnsPerHost: 6,
	}
}

func runMain() error {
	flags := flag.NewFlagSet("zhijing-client-relay", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	port := flags.Int("port", 18887, "Loopback port; upstream is fixed to the ZHIJING Japan gateway")
	origin := flags.String("allow-origin", "", "Optional exact trusted http(s) browser origin; never *")
	if err := flags.Parse(os.Args[1:]); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Println("ZHIJING local relay: --port 18887 [--allow-origin EXACT_HTTP_OR_HTTPS_ORIGIN]")
			return nil
		}
		return fmt.Errorf("invalid_command_line")
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected_arguments")
	}
	if *port < 1024 || *port > 65535 {
		return fmt.Errorf("invalid_loopback_port")
	}
	origins := map[string]bool{}
	if *origin != "" {
		parsed, err := url.Parse(*origin)
		if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			return fmt.Errorf("exact_browser_origin_required")
		}
		origins[*origin] = true
	}
	target, _ := url.Parse(upstreamURL)
	transport := defaultTransport()
	defer transport.CloseIdleConnections()
	var output sync.Mutex
	printEvent := func(value any) {
		output.Lock()
		defer output.Unlock()
		_ = json.NewEncoder(os.Stdout).Encode(value)
	}
	relay := newLocalRelay(target, transport, relayOptions{allowOrigins: origins,
		logEvent: func(event relayEvent) { printEvent(event) }})
	listener, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		return fmt.Errorf("loopback_port_unavailable")
	}
	server := &http.Server{Handler: relay, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10, ErrorLog: discardLogger()}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	printEvent(map[string]any{"ready": true, "base_url": fmt.Sprintf("http://127.0.0.1:%d/v1", *port),
		"proxy": "current_system", "credential_storage": false, "local_concurrency": 3,
		"model_requests_replayed": false, "version": "0.1.0-local-preview"})
	interrupt, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	select {
	case err := <-done:
		if err != http.ErrServerClosed {
			return fmt.Errorf("local_server_failed")
		}
		return nil
	case <-interrupt.Done():
		stop()
		printEvent(map[string]any{"draining": true, "maximum_wait_seconds": 1920})
		ctx, cancel := context.WithTimeout(context.Background(), 32*time.Minute)
		defer cancel()
		if server.Shutdown(ctx) != nil {
			_ = server.Close()
		}
		return nil
	}
}

func main() {
	if err := runMain(); err != nil {
		// Deliberately no raw network error, URL, Authorization or request body.
		fmt.Fprintln(os.Stderr, "ZHIJING local relay stopped:", err.Error())
		os.Exit(1)
	}
}
