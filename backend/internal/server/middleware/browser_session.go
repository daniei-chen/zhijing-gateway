package middleware

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/gin-gonic/gin"
)

const browserSessionHeader = "X-Zhijing-Session"

var browserSessionID = regexp.MustCompile(`^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$`)
var browserSessionVersion = regexp.MustCompile(`^[a-f0-9]{32}$`)

type browserSessionHandle struct{ id, version string }

func parseBrowserSessionHandle(value string) (browserSessionHandle, bool) {
	p := strings.Split(value, ".")
	if len(p) != 3 || p[0] != "zjs" || !browserSessionID.MatchString(p[1]) || !browserSessionVersion.MatchString(p[2]) {
		return browserSessionHandle{}, false
	}
	return browserSessionHandle{p[1], p[2]}, true
}
func (h browserSessionHandle) access() string  { return "zjs." + h.id + "." + h.version }
func (h browserSessionHandle) refresh() string { return "zjr." + h.id + "." + h.version }
func (h browserSessionHandle) name(kind string, secure bool) string {
	prefix := "zj_"
	if secure {
		prefix = "__Secure-zj_"
	}
	return prefix + kind + "_" + h.id + "_" + h.version
}

// BrowserSession keeps reusable credentials in HttpOnly cookies. The public
// zjs/zjr handles are selectors, never credentials: every use still needs the
// selected cookie and the ordinary JWT/role/session-version checks downstream.
// Existing bearer/API-key clients do not opt in and retain their wire contract.
// Each login AND rotation has a separate cookie name. A late response from an
// old login/refresh cannot overwrite cookies selected by a newer session.
func BrowserSession(cfg *config.Config) gin.HandlerFunc {
	refreshDays := 30
	if cfg != nil && cfg.JWT.RefreshTokenExpireDays > 0 {
		refreshDays = cfg.JWT.RefreshTokenExpireDays
	}
	if refreshDays > 90 {
		refreshDays = 90
	}
	return func(c *gin.Context) {
		if !strings.HasPrefix(c.Request.URL.Path, "/api/v1/") {
			c.Next()
			return
		}
		mode := c.GetHeader(browserSessionHeader)
		ws := isWebSocketUpgradeRequest(c)
		wsHandle := false
		if mode == "" && ws && c.Request.URL.Path == "/api/v1/admin/ops/ws/qps" {
			for _, p := range strings.Split(c.GetHeader("Sec-WebSocket-Protocol"), ",") {
				candidate := strings.TrimPrefix(strings.TrimSpace(p), "jwt.")
				if _, ok := parseBrowserSessionHandle(candidate); ok {
					mode = candidate
					wsHandle = true
					break
				}
			}
		}
		if mode == "" {
			c.Next()
			return
		}
		secure := c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https")
		if !secure && !browserLoopbackRequest(c.Request) {
			AbortWithError(c, 400, "BROWSER_SESSION_HTTPS_REQUIRED", "Browser sessions require HTTPS")
			return
		}
		if !browserSameOrigin(c.Request, secure, ws) {
			AbortWithError(c, 403, "BROWSER_SESSION_ORIGIN", "Browser session origin mismatch")
			return
		}
		current, cookieMode := parseBrowserSessionHandle(mode)
		loginID := ""
		if cookieMode {
			loginID = current.id
		} else if strings.HasPrefix(mode, "init.") && browserSessionID.MatchString(strings.TrimPrefix(mode, "init.")) {
			loginID = strings.TrimPrefix(mode, "init.")
		}
		if loginID == "" || len(mode) > 120 {
			AbortWithError(c, 400, "BROWSER_SESSION_INVALID", "Invalid browser session selector")
			return
		}
		c.Header("X-Zhijing-Session-Supported", "1")
		path := c.Request.URL.Path
		refreshPath := path == "/api/v1/auth/refresh" || path == "/api/v1/auth/logout"
		if cookieMode {
			access, unique := browserCookie(c.Request, current.name("at", secure))
			if !unique {
				AbortWithError(c, 401, "BROWSER_SESSION_AMBIGUOUS", "Ambiguous browser session")
				return
			}
			auth := strings.TrimSpace(c.GetHeader("Authorization"))
			if auth != "" && auth != "Bearer "+current.access() {
				AbortWithError(c, 401, "BROWSER_SESSION_MISMATCH", "Browser session credential mismatch")
				return
			}
			if access != "" {
				c.Request.Header.Set("Authorization", "Bearer "+access)
			} else {
				c.Request.Header.Del("Authorization")
			}
			if wsHandle {
				protocols := []string{}
				for _, p := range strings.Split(c.GetHeader("Sec-WebSocket-Protocol"), ",") {
					p = strings.TrimSpace(p)
					if p != "jwt."+current.access() {
						protocols = append(protocols, p)
					}
				}
				c.Request.Header.Set("Sec-WebSocket-Protocol", strings.Join(protocols, ", "))
			}
			if refreshPath {
				refresh, unique := browserCookie(c.Request, current.name("rt", secure))
				if !unique || refresh == "" {
					AbortWithError(c, 401, "BROWSER_SESSION_EXPIRED", "Browser session expired")
					return
				}
				raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 4097))
				var payload map[string]json.RawMessage
				var selector string
				if err != nil || len(raw) > 4096 || json.Unmarshal(raw, &payload) != nil || json.Unmarshal(payload["refresh_token"], &selector) != nil || selector != current.refresh() {
					AbortWithError(c, 400, "BROWSER_SESSION_MISMATCH", "Browser session refresh mismatch")
					return
				}
				payload["refresh_token"], _ = json.Marshal(refresh)
				body, _ := json.Marshal(payload)
				_ = c.Request.Body.Close()
				c.Request.Body = io.NopCloser(bytes.NewReader(body))
				c.Request.ContentLength = int64(len(body))
			}
		}
		// Streaming and other panel responses are never buffered by this adapter.
		capture := c.Request.Method == http.MethodPost && strings.HasPrefix(path, "/api/v1/auth/")
		if !capture {
			c.Next()
			return
		}
		original := c.Writer
		writer := &browserAuthWriter{ResponseWriter: original, status: http.StatusOK}
		c.Writer = writer
		c.Next()
		c.Writer = original
		body := writer.body.Bytes()
		status := writer.status
		if writer.overflow {
			status = http.StatusInternalServerError
			body = []byte(`{"code":500,"message":"Authentication response exceeds limit"}`)
		}
		if status >= 200 && status < 300 && !writer.overflow {
			var envelope map[string]json.RawMessage
			if json.Unmarshal(body, &envelope) == nil {
				tokenData := envelope
				wrapped := false
				if data := envelope["data"]; len(data) > 0 {
					var nested map[string]json.RawMessage
					if json.Unmarshal(data, &nested) == nil && nested != nil {
						tokenData = nested
						wrapped = true
					}
				}
				var access, refresh string
				_ = json.Unmarshal(tokenData["access_token"], &access)
				_ = json.Unmarshal(tokenData["refresh_token"], &refresh)
				if access != "" {
					var expires int
					var version [16]byte
					_, randomErr := rand.Read(version[:])
					if json.Unmarshal(tokenData["expires_in"], &expires) != nil || expires <= 0 || expires > 90*86400 || randomErr != nil {
						status = http.StatusInternalServerError
						body = []byte(`{"code":500,"message":"Unable to establish browser session"}`)
					} else {
						next := browserSessionHandle{loginID, hex.EncodeToString(version[:])}
						browserSetCookie(c, next.name("at", secure), access, expires, secure)
						tokenData["access_token"], _ = json.Marshal(next.access())
						if refresh != "" {
							browserSetCookie(c, next.name("rt", secure), refresh, refreshDays*86400, secure)
							tokenData["refresh_token"], _ = json.Marshal(next.refresh())
						}
						if cookieMode {
							browserClearPair(c, current, secure)
						}
						if wrapped {
							envelope["data"], _ = json.Marshal(tokenData)
						}
						body, _ = json.Marshal(envelope)
					}
				}
			}
		}
		if cookieMode && path == "/api/v1/auth/logout" {
			browserClearPair(c, current, secure)
		}
		c.Header("Cache-Control", "no-store")
		c.Header("Pragma", "no-cache")
		c.Header("Content-Length", strconv.Itoa(len(body)))
		original.WriteHeader(status)
		if len(body) > 0 {
			_, _ = original.Write(body)
		}
	}
}

func browserSameOrigin(r *http.Request, secure, websocket bool) bool {
	site := strings.ToLower(r.Header.Get("Sec-Fetch-Site"))
	if site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return !websocket
	}
	u, err := url.Parse(origin)
	scheme := "http"
	if secure {
		scheme = "https"
	}
	return err == nil && u.User == nil && u.Scheme == scheme && strings.EqualFold(u.Host, r.Host) && u.Path == "" && u.RawQuery == "" && u.Fragment == ""
}
func browserLoopbackRequest(r *http.Request) bool {
	host := r.Host
	if h, _, e := net.SplitHostPort(host); e == nil {
		host = h
	}
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	localIP := net.ParseIP(host)
	remoteIP := net.ParseIP(remote)
	return err == nil && (host == "localhost" || (localIP != nil && localIP.IsLoopback())) && remoteIP != nil && remoteIP.IsLoopback()
}
func browserCookie(r *http.Request, name string) (string, bool) {
	value := ""
	count := 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			count++
			value = cookie.Value
		}
	}
	return value, count <= 1 && len(value) <= 8192
}
func browserSetCookie(c *gin.Context, name, value string, maxAge int, secure bool) {
	http.SetCookie(c.Writer, &http.Cookie{Name: name, Value: value, Path: "/api/v1", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func browserClearPair(c *gin.Context, h browserSessionHandle, secure bool) {
	browserSetCookie(c, h.name("at", secure), "", -1, secure)
	browserSetCookie(c, h.name("rt", secure), "", -1, secure)
}

type browserAuthWriter struct {
	gin.ResponseWriter
	body              bytes.Buffer
	status            int
	written, overflow bool
}

func (w *browserAuthWriter) WriteHeader(code int) {
	if !w.written {
		w.status = code
	}
}
func (w *browserAuthWriter) WriteHeaderNow() { w.written = true }
func (w *browserAuthWriter) Status() int     { return w.status }
func (w *browserAuthWriter) Size() int {
	if !w.written {
		return -1
	}
	return w.body.Len()
}
func (w *browserAuthWriter) Written() bool { return w.written }
func (w *browserAuthWriter) Write(p []byte) (int, error) {
	w.written = true
	if w.overflow || w.body.Len()+len(p) > 128*1024 {
		w.overflow = true
		return len(p), nil
	}
	return w.body.Write(p)
}
func (w *browserAuthWriter) WriteString(s string) (int, error) { return w.Write([]byte(s)) }
func (w *browserAuthWriter) Flush()                            { w.overflow = true }
