package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

const fixtureBrowserID = "12345678-1234-4234-8234-123456789abc"

var fixtureBrowserHandle = browserSessionHandle{fixtureBrowserID, strings.Repeat("a", 32)}

func browserFixtureRouter(handler gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(BrowserSession(nil))
	r.Any("/api/v1/*path", handler)
	return r
}
func browserRequest(path, mode, body string) *http.Request {
	req := httptest.NewRequest("POST", "https://gateway.example"+path, strings.NewReader(body))
	req.Header.Set(browserSessionHeader, mode)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://gateway.example")
	return req
}
func fixtureBrowserCookies(req *http.Request, h browserSessionHandle) {
	req.AddCookie(&http.Cookie{Name: h.name("at", true), Value: "fixture-access-secret"})
	req.AddCookie(&http.Cookie{Name: h.name("rt", true), Value: "fixture-refresh-secret"})
}

func TestBrowserSessionLoginStoresOnlyPublicSelectorsInJSON(t *testing.T) {
	for _, wrapped := range []bool{false, true} {
		t.Run(map[bool]string{false: "root", true: "wrapped"}[wrapped], func(t *testing.T) {
			r := browserFixtureRouter(func(c *gin.Context) {
				data := gin.H{"access_token": "fixture-access-secret", "refresh_token": "fixture-refresh-secret", "expires_in": 3600, "user": gin.H{"id": 7, "role": "user"}}
				if wrapped {
					c.JSON(200, gin.H{"code": 0, "data": data})
				} else {
					c.JSON(200, data)
				}
			})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, browserRequest("/api/v1/auth/login", "init."+fixtureBrowserID, `{}`))
			require.Equal(t, 200, w.Code)
			require.NotContains(t, w.Body.String(), "fixture-access-secret")
			require.NotContains(t, w.Body.String(), "fixture-refresh-secret")
			var envelope map[string]any
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
			data := envelope
			if wrapped {
				wrappedData, ok := envelope["data"].(map[string]any)
				if !ok {
					t.Fatal("wrapped response data has unexpected shape")
				}
				data = wrappedData
			}
			accessToken, ok := data["access_token"].(string)
			if !ok {
				t.Fatal("access token has unexpected shape")
			}
			handle, ok := parseBrowserSessionHandle(accessToken)
			require.True(t, ok)
			require.Equal(t, fixtureBrowserID, handle.id)
			require.Equal(t, handle.refresh(), data["refresh_token"])
			cookies := w.Result().Cookies()
			require.Len(t, cookies, 2)
			for _, cookie := range cookies {
				require.True(t, cookie.HttpOnly)
				require.True(t, cookie.Secure)
				require.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
				require.Equal(t, "/api/v1", cookie.Path)
				require.Empty(t, cookie.Domain)
				require.Positive(t, cookie.MaxAge)
			}
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			require.Equal(t, "1", w.Header().Get("X-Zhijing-Session-Supported"))
			followup := browserFixtureRouter(func(c *gin.Context) {
				require.Equal(t, "Bearer fixture-access-secret", c.GetHeader("Authorization"))
				c.Status(204)
			})
			req := browserRequest("/api/v1/auth/me", handle.access(), "")
			req.Method = "GET"
			for _, cookie := range cookies {
				req.AddCookie(cookie)
			}
			out := httptest.NewRecorder()
			followup.ServeHTTP(out, req)
			require.Equal(t, 204, out.Code)
			// Copying localStorage selectors into another browser provides no credential.
			isolated := browserFixtureRouter(func(c *gin.Context) { require.Empty(t, c.GetHeader("Authorization")); c.Status(401) })
			out = httptest.NewRecorder()
			isolated.ServeHTTP(out, browserRequest("/api/v1/auth/me", handle.access(), ""))
			require.Equal(t, 401, out.Code)
		})
	}
}

func TestBrowserSessionRejectsCrossOriginAndCookieAmbiguity(t *testing.T) {
	cases := []struct {
		name, origin, site, mode string
		duplicate                bool
	}{
		{"cross origin", "https://attacker.example", "", fixtureBrowserHandle.access(), false},
		{"same site other origin", "https://sub.gateway.example", "same-site", fixtureBrowserHandle.access(), false},
		{"null origin", "null", "", fixtureBrowserHandle.access(), false},
		{"cross site metadata", "https://gateway.example", "cross-site", fixtureBrowserHandle.access(), false},
		{"selector injection", "https://gateway.example", "", "zjs.invalid.invalid", false},
		{"duplicate selected cookie", "https://gateway.example", "", fixtureBrowserHandle.access(), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			r := browserFixtureRouter(func(c *gin.Context) { called = true; c.Status(200) })
			req := browserRequest("/api/v1/profile", tc.mode, `{}`)
			fixtureBrowserCookies(req, fixtureBrowserHandle)
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Sec-Fetch-Site", tc.site)
			if tc.duplicate {
				req.AddCookie(&http.Cookie{Name: fixtureBrowserHandle.name("at", true), Value: "shadow"})
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			require.False(t, called)
			require.GreaterOrEqual(t, w.Code, 400)
		})
	}
}

func TestBrowserSessionRefreshRotatesNamesAndExpiresOnlyConsumedPair(t *testing.T) {
	newer := browserSessionHandle{fixtureBrowserID, strings.Repeat("b", 32)}
	r := browserFixtureRouter(func(c *gin.Context) {
		body, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		require.Contains(t, string(body), "fixture-refresh-secret")
		require.NotContains(t, string(body), fixtureBrowserHandle.refresh())
		c.JSON(200, gin.H{"code": 0, "data": gin.H{"access_token": "rotated-access-secret", "refresh_token": "rotated-refresh-secret", "expires_in": 60}})
	})
	req := browserRequest("/api/v1/auth/refresh", fixtureBrowserHandle.access(), `{"refresh_token":"`+fixtureBrowserHandle.refresh()+`"}`)
	fixtureBrowserCookies(req, fixtureBrowserHandle)
	fixtureBrowserCookies(req, newer)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, 200, w.Code)
	require.NotContains(t, w.Body.String(), "rotated-access-secret")
	require.NotContains(t, w.Body.String(), "rotated-refresh-secret")
	expired := 0
	newNames := []string{}
	for _, cookie := range w.Result().Cookies() {
		require.NotEqual(t, newer.name("at", true), cookie.Name)
		require.NotEqual(t, newer.name("rt", true), cookie.Name)
		if cookie.MaxAge < 0 {
			expired++
		} else {
			newNames = append(newNames, cookie.Name)
			require.NotEqual(t, fixtureBrowserHandle.name("at", true), cookie.Name)
			require.NotEqual(t, fixtureBrowserHandle.name("rt", true), cookie.Name)
		}
	}
	require.Equal(t, 2, expired)
	require.Len(t, newNames, 2)
}

func TestBrowserSessionDoesNotAlterBearerClientsOrStreaming(t *testing.T) {
	r := browserFixtureRouter(func(c *gin.Context) {
		require.Equal(t, "Bearer explicit-secret", c.GetHeader("Authorization"))
		c.JSON(200, gin.H{"access_token": "legacy-token", "expires_in": 3600})
	})
	req := browserRequest("/api/v1/auth/login", "", `{}`)
	req.Header.Set("Authorization", "Bearer explicit-secret")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Contains(t, w.Body.String(), "legacy-token")
	require.Empty(t, w.Result().Cookies())
	r = browserFixtureRouter(func(c *gin.Context) { _, _ = c.Writer.Write([]byte("data: fixture\n\n")); c.Writer.Flush() })
	req = browserRequest("/api/v1/admin/accounts/1/test", fixtureBrowserHandle.access(), `{}`)
	fixtureBrowserCookies(req, fixtureBrowserHandle)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.True(t, w.Flushed)
	require.Equal(t, "data: fixture\n\n", w.Body.String())
}

func TestBrowserSessionWebsocketSelectorRequiresOriginAndCookie(t *testing.T) {
	r := browserFixtureRouter(func(c *gin.Context) {
		require.Equal(t, "Bearer fixture-access-secret", c.GetHeader("Authorization"))
		require.Equal(t, "sub2api-admin", c.GetHeader("Sec-WebSocket-Protocol"))
		c.Status(204)
	})
	req := browserRequest("/api/v1/admin/ops/ws/qps", "", "")
	req.Method = "GET"
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Sec-WebSocket-Protocol", "sub2api-admin, jwt."+fixtureBrowserHandle.access())
	fixtureBrowserCookies(req, fixtureBrowserHandle)
	missingOrigin := req.Clone(req.Context())
	missingOrigin.Header.Del("Origin")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, 204, w.Code)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, missingOrigin)
	require.Equal(t, 403, w.Code)
}

func TestBrowserSessionRejectsMismatchedRefreshAndUnboundedAuthResponse(t *testing.T) {
	called := false
	r := browserFixtureRouter(func(c *gin.Context) { called = true; c.Status(204) })
	req := browserRequest("/api/v1/auth/refresh", fixtureBrowserHandle.access(), `{"refresh_token":"wrong-selector"}`)
	fixtureBrowserCookies(req, fixtureBrowserHandle)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, 400, w.Code)
	require.False(t, called)
	for _, body := range []string{`{"access_token":"secret-without-expiry"}`, strings.Repeat("fixture", 20000)} {
		r = browserFixtureRouter(func(c *gin.Context) { _, _ = io.Copy(c.Writer, bytes.NewBufferString(body)) })
		w = httptest.NewRecorder()
		r.ServeHTTP(w, browserRequest("/api/v1/auth/login", "init."+fixtureBrowserID, `{}`))
		require.Equal(t, 500, w.Code)
		require.NotContains(t, w.Body.String(), "secret-without-expiry")
		require.Less(t, w.Body.Len(), 200)
	}
}
