package admin

import (
	"context"
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/repository"
	servermiddleware "github.com/daniei-chen/zhijing-gateway/internal/server/middleware"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

type wsSessionUsers struct {
	service.UserRepository
	mu   sync.RWMutex
	user service.User
}

func (r *wsSessionUsers) GetByID(context.Context, int64) (*service.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	clone := r.user
	return &clone, nil
}
func (r *wsSessionUsers) GetFirstAdmin(ctx context.Context) (*service.User, error) {
	return r.GetByID(ctx, r.user.ID)
}
func (r *wsSessionUsers) GetUserAvatar(context.Context, int64) (*service.UserAvatar, error) {
	return nil, nil
}
func (r *wsSessionUsers) change(fn func(*service.User)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	fn(&r.user)
}

type wsSessionSettings struct {
	service.SettingRepository
	mu  sync.RWMutex
	key string
}

func (r *wsSessionSettings) GetValue(context.Context, string) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.key, nil
}
func (r *wsSessionSettings) rotate() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.key = "synthetic-replacement-key"
}

func TestOpsWSSessionRevocationAndCurrentAdminPrivileges(t *testing.T) {
	previous := qpsWSCache.getPayload()
	qpsWSCache.payload.Store([]byte(`{"type":"qps_update","data":{"synthetic":1}}`))
	t.Cleanup(func() { qpsWSCache.payload.Store(previous) })
	for _, scenario := range []string{"cookie_revoke", "bearer_revoke", "demotion", "disable", "password_change", "expiry", "cache_outage", "api_key_rotation", "api_key_demotion"} {
		t.Run(scenario, func(t *testing.T) {
			server := miniredis.RunT(t)
			rdb := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1, ReadTimeout: time.Second, WriteTimeout: time.Second, DialTimeout: time.Second})
			t.Cleanup(func() { _ = rdb.Close() })
			users := &wsSessionUsers{user: service.User{ID: 101, Email: "ws-session@example.invalid", Role: service.RoleAdmin, Status: service.StatusActive, PasswordHash: "synthetic-password-hash"}}
			settingsRepo := &wsSessionSettings{key: "synthetic-admin-key"}
			settings := service.NewSettingService(settingsRepo, nil)
			cfg := &config.Config{JWT: config.JWTConfig{Secret: "synthetic-ws-secret", AccessTokenExpireMinutes: 60, RefreshTokenExpireDays: 7}}
			auth := service.NewAuthService(nil, users, nil, repository.NewRefreshTokenCache(rdb), cfg, nil, nil, nil, nil, nil, nil, nil, nil)
			userService := service.NewUserService(users, nil, nil, nil)
			user, err := users.GetByID(context.Background(), 101)
			require.NoError(t, err)
			token, err := auth.GenerateToken(context.Background(), user)
			require.NoError(t, err)
			if scenario == "expiry" {
				claims, err := auth.ValidateToken(token)
				require.NoError(t, err)
				claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(1500 * time.Millisecond))
				token, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(cfg.JWT.Secret))
				require.NoError(t, err)
			}
			r := gin.New()
			r.Use(servermiddleware.BrowserSession(cfg))
			r.GET("/api/v1/admin/ops/ws/qps", gin.HandlerFunc(servermiddleware.NewAdminAuthMiddleware(auth, userService, nil, nil)), func(c *gin.Context) {
				conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
				if err != nil {
					return
				}
				defer func() { _ = conn.Close() }()
				handleQPSWebSocket(c.Request.Context(), conn, servermiddleware.AdminSessionRevalidator(c.Request.Context()))
			})
			// API-key handshakes use their original settings-backed authentication.
			if strings.HasPrefix(scenario, "api_key") {
				r = gin.New()
				r.GET("/api/v1/admin/ops/ws/qps", gin.HandlerFunc(servermiddleware.NewAdminAuthMiddleware(auth, userService, settings, nil)), func(c *gin.Context) {
					conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
					if err != nil {
						return
					}
					defer func() { _ = conn.Close() }()
					handleQPSWebSocket(c.Request.Context(), conn, servermiddleware.AdminSessionRevalidator(c.Request.Context()))
				})
			}
			httpServer := httptest.NewTLSServer(r)
			defer httpServer.Close()
			headers := http.Header{"Origin": []string{httpServer.URL}}
			protocols := []string{"sub2api-admin", "jwt." + token}
			if scenario == "cookie_revoke" {
				const id = "12345678123442348234123456789abc"
				const version = "abcdefabcdefabcdefabcdefabcdefab"
				protocols = []string{"sub2api-admin", "jwt.zjs." + id + "." + version}
				headers.Set("Cookie", "__Secure-zj_at_"+id+"_"+version+"="+token)
			}
			if strings.HasPrefix(scenario, "api_key") {
				protocols = []string{"sub2api-admin"}
				headers.Set("x-api-key", "synthetic-admin-key")
			}
			// The server is a local httptest TLS endpoint with a synthetic certificate.
			dialer := websocket.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, Subprotocols: protocols} //nolint:gosec // local test server only
			conn, _, err := dialer.Dial("wss"+strings.TrimPrefix(httpServer.URL, "https")+"/api/v1/admin/ops/ws/qps", headers)
			require.NoError(t, err)
			defer func() { _ = conn.Close() }()
			require.NoError(t, conn.SetReadDeadline(time.Now().Add(8*time.Second)))
			if scenario != "expiry" {
				kind, payload, err := conn.ReadMessage()
				require.NoError(t, err)
				require.Equal(t, websocket.TextMessage, kind)
				require.Contains(t, string(payload), "synthetic")
			}
			switch scenario {
			case "cookie_revoke", "bearer_revoke":
				require.NoError(t, auth.RevokeAllUserTokens(context.Background(), 101))
			case "demotion", "api_key_demotion":
				users.change(func(u *service.User) { u.Role = service.RoleUser })
			case "disable":
				users.change(func(u *service.User) { u.Status = "disabled" })
			case "password_change":
				users.change(func(u *service.User) { u.PasswordHash = "synthetic-new-password-hash" })
			case "cache_outage":
				server.Close()
			case "api_key_rotation":
				settingsRepo.rotate()
			}
			_, _, err = conn.ReadMessage()
			require.True(t, websocket.IsCloseError(err, websocket.ClosePolicyViolation), "must close before delivering more monitoring data; got %v", err)
		})
	}
}
