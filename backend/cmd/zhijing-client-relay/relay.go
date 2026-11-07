package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	upstreamURL     = "https://154-36-187-147.sslip.io"
	maxRequestBytes = 16 << 20
	minimumCompress = 64 << 10
)

type relayOptions struct {
	uploadTimeout time.Duration
	forwardLimit  time.Duration
	writeGrace    time.Duration
	allowOrigins  map[string]bool
	logEvent      func(relayEvent)
}

type relayEvent struct {
	Request     uint64 `json:"relay_request"`
	Route       string `json:"route"`
	Encoding    string `json:"encoding"`
	InputBytes  int    `json:"input_bytes"`
	WireBytes   int    `json:"wire_bytes"`
	CompressMS  int64  `json:"compress_ms"`
	ElapsedMS   int64  `json:"elapsed_ms"`
	Status      int    `json:"status"`
	ErrorClass  string `json:"error_class,omitempty"`
	HandlerDone bool   `json:"handler_done"`
}

type relayStateKey struct{}

type localRelay struct {
	proxy   *httputil.ReverseProxy
	options relayOptions
	slots   chan struct{}
	next    atomic.Uint64
}

type measuredWriter struct {
	http.ResponseWriter
	status int
}

func (w *measuredWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *measuredWriter) WriteHeader(code int) {
	if code >= 100 && code < 200 {
		w.ResponseWriter.WriteHeader(code)
		return
	}
	if w.status == 0 {
		w.status = code
		w.ResponseWriter.WriteHeader(code)
	}
}
func (w *measuredWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(p)
}
func (w *measuredWriter) Flush() {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func newLocalRelay(target *url.URL, transport http.RoundTripper, options relayOptions) *localRelay {
	if options.uploadTimeout <= 0 {
		options.uploadTimeout = 30 * time.Second
	}
	if options.forwardLimit <= 0 {
		options.forwardLimit = 32 * time.Minute
	}
	if options.writeGrace <= 0 {
		options.writeGrace = 5 * time.Second
	}
	r := &localRelay{options: options, slots: make(chan struct{}, 3)}
	r.proxy = &httputil.ReverseProxy{
		Transport: transport, FlushInterval: -1,
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.URL.RawQuery = p.In.URL.RawQuery
			p.Out.Host = target.Host
			p.Out.GetBody = nil
			for _, name := range []string{"Cookie", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", "Proxy-Authorization", "Origin", "Referer", "Expect"} {
				p.Out.Header.Del(name)
			}
		},
		ModifyResponse: func(response *http.Response) error {
			response.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, request *http.Request, err error) {
			event, _ := request.Context().Value(relayStateKey{}).(*relayEvent)
			if request.Context().Err() != nil && !errors.Is(request.Context().Err(), context.DeadlineExceeded) {
				if event != nil {
					event.ErrorClass = "client_canceled"
				}
				return
			}
			code, label := http.StatusBadGateway, "upstream_transport"
			if errors.Is(err, context.DeadlineExceeded) {
				code, label = http.StatusGatewayTimeout, "forward_deadline"
			}
			if event != nil {
				event.ErrorClass = label
			}
			localError(w, code, "relay_upstream_error", "日本网关连接未完成；适配器没有重放请求。")
		},
	}
	// ReverseProxy's default logger can include upstream URLs or raw errors.
	r.proxy.ErrorLog = discardLogger()
	return r
}

func localError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{
		"type": "client_relay_error", "code": code, "message": message,
	}})
}

func loopbackHost(host string) bool {
	hostname, _, err := net.SplitHostPort(host)
	return err == nil && (hostname == "127.0.0.1" || hostname == "localhost")
}

func routeName(path, method string) string {
	if method == http.MethodGet && path == "/v1/models" {
		return "models"
	}
	if method == http.MethodPost {
		switch path {
		case "/v1/responses":
			return "responses"
		case "/v1/responses/compact":
			return "compact"
		case "/v1/chat/completions":
			return "chat"
		}
	}
	return ""
}

func (r *localRelay) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	started := time.Now()
	w := &measuredWriter{ResponseWriter: writer}
	event := &relayEvent{Request: r.next.Add(1), Route: "other", Encoding: "identity"}
	defer func() {
		event.Status = w.status
		event.ElapsedMS = time.Since(started).Milliseconds()
		if !event.HandlerDone && event.Status == 200 && event.ErrorClass == "" {
			event.ErrorClass = "response_copy_interrupted"
		}
		if r.options.logEvent != nil {
			r.options.logEvent(*event)
		}
	}()
	w.Header().Set("X-Zhijing-Relay-Request", strconv.FormatUint(event.Request, 10))
	if request.URL.IsAbs() || request.URL.RawPath != "" || !loopbackHost(request.Host) {
		localError(w, 400, "relay_invalid_destination", "仅允许本机网关接口，不提供通用代理。")
		return
	}
	origin := request.Header.Get("Origin")
	if origin != "" && !r.options.allowOrigins[origin] {
		localError(w, 403, "relay_origin_denied", "未授权的浏览器来源。")
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Expose-Headers", "X-Zhijing-Trace-ID, X-Zhijing-Relay-Request, Retry-After")
	}
	if request.Method == http.MethodGet && request.URL.Path == "/health" {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, "{\"local_relay\":true,\"compression\":\"gzip\",\"provider_check\":false}\n")
		event.HandlerDone = true
		return
	}
	route := routeName(request.URL.Path, request.Method)
	if request.Method == http.MethodOptions && origin != "" {
		method := request.Header.Get("Access-Control-Request-Method")
		if routeName(request.URL.Path, method) == "" {
			localError(w, 404, "relay_route_unsupported", "不支持该接口。")
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, OpenAI-Beta, Idempotency-Key, X-Client-Request-ID, X-Zhijing-Session")
		w.WriteHeader(http.StatusNoContent)
		event.HandlerDone = true
		return
	}
	if route == "" || request.Header.Get("Upgrade") != "" {
		localError(w, 404, "relay_route_unsupported", "仅支持模型列表、Responses、compact 和 Chat Completions。")
		return
	}
	event.Route = route
	auth := request.Header.Get("Authorization")
	if len(auth) < 15 || len(auth) > 4096 || !strings.EqualFold(auth[:7], "Bearer ") || strings.ContainsAny(auth[7:], " \t\r\n") {
		localError(w, 401, "relay_bearer_required", "请在原客户端保留网关 API 密钥；不要写入适配器。")
		return
	}
	if len(request.Trailer) != 0 || len(request.Header.Values("Content-Encoding")) > 1 {
		localError(w, 400, "relay_body_headers_unsupported", "不支持请求尾部或多个内容编码。")
		return
	}
	if request.ContentLength > maxRequestBytes {
		localError(w, 413, "relay_body_too_large", "请求体超过 16 MiB，未发送到日本网关。")
		return
	}
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	default:
		localError(w, 429, "relay_local_concurrency_limit", "本机适配器并发已达上限（3）；没有排队或重试。")
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), r.options.forwardLimit)
	defer cancel()
	request = request.Clone(context.WithValue(ctx, relayStateKey{}, event))
	responseController := http.NewResponseController(w)
	deadline, _ := ctx.Deadline()
	if responseController.SetWriteDeadline(deadline.Add(r.options.writeGrace)) != nil {
		localError(w, 500, "relay_write_deadline_unavailable", "无法设置本机响应边界。")
		return
	}
	defer func() { _ = responseController.SetWriteDeadline(time.Time{}) }()
	if request.Method == http.MethodPost {
		encoding := strings.ToLower(strings.TrimSpace(request.Header.Get("Content-Encoding")))
		if encoding == "" {
			encoding = "identity"
		}
		if encoding != "identity" && encoding != "gzip" && encoding != "zstd" {
			localError(w, 415, "relay_encoding_unsupported", "仅支持 identity、gzip 或 zstd 请求编码。")
			return
		}
		controller := http.NewResponseController(w)
		if controller.SetReadDeadline(time.Now().Add(r.options.uploadTimeout)) != nil {
			localError(w, 500, "relay_upload_deadline_unavailable", "无法设置本机上传边界。")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, request.Body, maxRequestBytes))
		event.InputBytes = len(body)
		_ = request.Body.Close()
		_ = controller.SetReadDeadline(time.Time{})
		if err != nil {
			var tooLarge *http.MaxBytesError
			var network net.Error
			code, label := 400, "relay_upload_incomplete"
			if errors.As(err, &tooLarge) {
				code, label = 413, "relay_body_too_large"
			} else if errors.As(err, &network) && network.Timeout() {
				code, label = 408, "relay_upload_timeout"
			}
			event.ErrorClass = label
			localError(w, code, label, "本机请求体未完整接收，未发送到日本网关。")
			return
		}
		event.InputBytes, event.Encoding = len(body), encoding
		mediaType, _, _ := mime.ParseMediaType(request.Header.Get("Content-Type"))
		if encoding == "identity" && mediaType == "application/json" && len(body) >= minimumCompress && !hasContentSignature(request) {
			compressAt := time.Now()
			var compressed bytes.Buffer
			compressor, _ := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
			_, _ = compressor.Write(body)
			_ = compressor.Close()
			event.CompressMS = time.Since(compressAt).Milliseconds()
			if compressed.Len()+256 < len(body)*95/100 {
				body = compressed.Bytes()
				request.Header.Set("Content-Encoding", "gzip")
				event.Encoding = "gzip"
			}
		}
		event.WireBytes = len(body)
		request.Body = io.NopCloser(bytes.NewReader(body))
		request.ContentLength = int64(len(body))
		request.GetBody = nil
		request.Header.Del("Content-Length")
	} else if request.Body != nil && request.Body != http.NoBody {
		localError(w, 400, "relay_models_body_unsupported", "模型列表请求不能携带请求体。")
		return
	}
	r.proxy.ServeHTTP(w, request)
	event.HandlerDone = true
}

func hasContentSignature(request *http.Request) bool {
	for _, header := range []string{"Content-MD5", "Content-Digest", "Digest", "Signature", "Signature-Input"} {
		if request.Header.Get(header) != "" {
			return true
		}
	}
	return false
}
