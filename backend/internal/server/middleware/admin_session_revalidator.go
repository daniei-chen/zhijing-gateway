package middleware

import (
	"context"
	"crypto/subtle"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/adminaccess"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type adminSessionRevalidatorKey struct{}

// AdminSessionRevalidator returns the verifier selected by the successful
// handshake authentication method. It retains no Gin context or writer.
func AdminSessionRevalidator(ctx context.Context) func(context.Context) error {
	verify, _ := ctx.Value(adminSessionRevalidatorKey{}).(func(context.Context) error)
	return verify
}
func bindAdminSessionRevalidator(c *gin.Context, verify func(context.Context) error) {
	c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), adminSessionRevalidatorKey{}, verify))
}

func adminJWTRevalidator(auth *service.AuthService, users *service.UserService, claims *service.JWTClaims) func(context.Context) error {
	return func(ctx context.Context) error {
		if claims.ExpiresAt == nil || !time.Now().Before(claims.ExpiresAt.Time) {
			return service.ErrTokenExpired
		}
		user, err := users.GetByID(ctx, claims.UserID)
		if err != nil {
			return err
		}
		if user == nil || !user.IsActive() || !user.IsAdmin() || user.TokenVersion != claims.TokenVersion {
			return service.ErrTokenRevoked
		}
		if err := auth.ValidateSession(ctx, claims); err != nil {
			return err
		}
		if !time.Now().Before(claims.ExpiresAt.Time) {
			return service.ErrTokenExpired
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return nil
	}
}

func adminAPIKeyRevalidator(settings *service.SettingService, users *service.UserService, key string, uid int64) func(context.Context) error {
	return func(ctx context.Context) error {
		user, err := users.GetByID(ctx, uid)
		if err != nil {
			return err
		}
		if user == nil || !user.IsActive() || !user.IsAdmin() {
			return service.ErrScopedAdminKeyInvalid
		}
		current, err := settings.GetAdminAPIKey(ctx)
		if err != nil {
			return err
		}
		if current == "" || subtle.ConstantTimeCompare([]byte(current), []byte(key)) != 1 {
			return service.ErrScopedAdminKeyInvalid
		}
		return ctx.Err()
	}
}

func scopedAdminKeyRevalidator(settings *service.SettingService, users *service.UserService, key, ip, method, path string) func(context.Context) error {
	return func(ctx context.Context) error {
		item, err := settings.ValidateScopedAdminKey(ctx, key, ip)
		if err != nil {
			return err
		}
		if item == nil || !adminaccess.RouteAllowed(item.Policy, method, path) {
			return service.ErrScopedAdminKeyInvalid
		}
		user, err := users.GetByID(ctx, item.CreatedBy)
		if err != nil {
			return err
		}
		if user == nil || !user.IsActive() || !user.IsAdmin() {
			return service.ErrScopedAdminKeyInvalid
		}
		current, err := settings.ValidateScopedAdminKey(ctx, key, ip)
		if err != nil {
			return err
		}
		if current == nil || current.CreatedBy != item.CreatedBy || !adminaccess.RouteAllowed(current.Policy, method, path) {
			return service.ErrScopedAdminKeyInvalid
		}
		return ctx.Err()
	}
}
