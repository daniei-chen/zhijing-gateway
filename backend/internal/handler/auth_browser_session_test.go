package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/repository"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func newBrowserSessionRedisCache(t *testing.T) service.RefreshTokenCache {
	t.Helper()
	srv := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return repository.NewRefreshTokenCache(client)
}

func browserFlowHandler(t *testing.T) (*gin.Engine, *AuthHandler) {
	t.Helper()
	h, client := newOAuthPendingFlowTestHandlerWithDependencies(t, oauthPendingFlowTestHandlerOptions{refreshCache: newBrowserSessionRedisCache(t)})
	hash, err := bcrypt.GenerateFromPassword([]byte("SyntheticPassword2026!"), bcrypt.MinCost)
	require.NoError(t, err)
	_, err = client.User.Create().SetEmail("browser@example.invalid").SetUsername("Synthetic member").SetPasswordHash(string(hash)).SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(context.Background())
	require.NoError(t, err)
	r := gin.New()
	r.Use(middleware2.BrowserSession(&config.Config{JWT: config.JWTConfig{RefreshTokenExpireDays: 7}}))
	r.POST("/api/v1/auth/login", h.Login)
	r.POST("/api/v1/auth/refresh", h.RefreshToken)
	r.POST("/api/v1/auth/logout", h.Logout)
	jwt := gin.HandlerFunc(middleware2.NewJWTAuthMiddleware(h.authService, h.userService, h.settingSvc, nil))
	r.GET("/api/v1/auth/me", jwt, h.GetCurrentUser)
	r.GET("/api/v1/admin/test", jwt, func(c *gin.Context) {
		if role, _ := c.Get(string(middleware2.ContextKeyUserRole)); role != service.RoleAdmin {
			c.Status(403)
			return
		}
		c.Status(204)
	})
	return r, h
}

func TestBrowserSessionRealLoginJWTRefreshAndLogout(t *testing.T) {
	r, h := browserFlowHandler(t)
	const id = "12345678-1234-4234-8234-123456789abc"
	call := func(path, mode, body string, cookies []*http.Cookie) *httptest.ResponseRecorder {
		method := "POST"
		if path == "/api/v1/auth/me" || path == "/api/v1/admin/test" {
			method = "GET"
		}
		req := httptest.NewRequest(method, "https://gateway.example"+path, strings.NewReader(body))
		req.Header.Set("X-Zhijing-Session", mode)
		req.Header.Set("Origin", "https://gateway.example")
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			if cookie.MaxAge >= 0 {
				req.AddCookie(cookie)
			}
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	login := call("/api/v1/auth/login", "init."+id, `{"email":"browser@example.invalid","password":"SyntheticPassword2026!"}`, nil)
	require.Equal(t, 200, login.Code, login.Body.String())
	data := decodeJSONResponseData(t, login)
	handle := data["access_token"].(string)
	refresh := data["refresh_token"].(string)
	require.True(t, strings.HasPrefix(handle, "zjs."))
	require.True(t, strings.HasPrefix(refresh, "zjr."))
	cookies := login.Result().Cookies()
	var actualJWT string
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie.Name, "__Secure-zj_at_") {
			actualJWT = cookie.Value
		}
	}
	claims, err := h.authService.ValidateToken(actualJWT)
	require.NoError(t, err)
	require.Positive(t, claims.UserID)
	require.NotContains(t, login.Body.String(), actualJWT)
	me := call("/api/v1/auth/me", handle, "", cookies)
	require.Equal(t, 200, me.Code, me.Body.String())
	require.Equal(t, float64(claims.UserID), decodeJSONResponseData(t, me)["id"])
	require.Equal(t, 403, call("/api/v1/admin/test", handle, "", cookies).Code, "a member must remain a member")
	require.Equal(t, 401, call("/api/v1/auth/me", handle, "", nil).Code, "selector alone must not authenticate")
	rotation := call("/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies)
	require.Equal(t, 200, rotation.Code, rotation.Body.String())
	rotated := decodeJSONResponseData(t, rotation)
	require.NotEqual(t, handle, rotated["access_token"])
	require.NotEqual(t, refresh, rotated["refresh_token"])
	require.GreaterOrEqual(t, call("/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies).Code, 400, "old refresh credential must be consumed")
	newCookies := rotation.Result().Cookies()
	logout := call("/api/v1/auth/logout", rotated["access_token"].(string), `{"refresh_token":"`+rotated["refresh_token"].(string)+`"}`, newCookies)
	require.Equal(t, 200, logout.Code)
	require.GreaterOrEqual(t, call("/api/v1/auth/refresh", rotated["access_token"].(string), `{"refresh_token":"`+rotated["refresh_token"].(string)+`"}`, newCookies).Code, 400)
	// Public JSON remains ordinary data, with no JWT returned through /auth/me.
	var profile map[string]any
	require.NoError(t, json.Unmarshal(me.Body.Bytes(), &profile))
	require.NotContains(t, me.Body.String(), actualJWT)
}
