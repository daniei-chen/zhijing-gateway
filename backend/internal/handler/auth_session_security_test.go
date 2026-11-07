package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// The gate sits after the Redis read. It makes both reported races
// deterministic while all mutations still use the real Redis Lua adapter.
type securityFlowCache struct {
	service.RefreshTokenCache
	reached                     chan struct{}
	release                     chan struct{}
	unavailable                 atomic.Bool
	revocationReadUnavailable   atomic.Bool
	familyRevocationUnavailable atomic.Bool
}

func (s *securityFlowCache) GetRefreshToken(ctx context.Context, key string) (*service.RefreshTokenData, error) {
	data, err := s.RefreshTokenCache.GetRefreshToken(ctx, key)
	if err == nil && s.release != nil {
		s.reached <- struct{}{}
		<-s.release
	}
	return data, err
}
func (s *securityFlowCache) GetRefreshTokenForRevocation(ctx context.Context, key string) (*service.RefreshTokenData, error) {
	if s.unavailable.Load() || s.revocationReadUnavailable.Load() {
		return nil, errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.GetRefreshTokenForRevocation(ctx, key)
}
func (s *securityFlowCache) ValidateSession(ctx context.Context, uid int64, family, generation string) error {
	if s.unavailable.Load() {
		return errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.ValidateSession(ctx, uid, family, generation)
}
func (s *securityFlowCache) GetSessionGeneration(ctx context.Context, uid int64) (string, error) {
	if s.unavailable.Load() {
		return "", errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.GetSessionGeneration(ctx, uid)
}
func (s *securityFlowCache) RotateRefreshToken(ctx context.Context, old, next string, data *service.RefreshTokenData, ttl time.Duration) error {
	if s.unavailable.Load() {
		return errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.RotateRefreshToken(ctx, old, next, data, ttl)
}
func (s *securityFlowCache) DeleteUserRefreshTokens(ctx context.Context, uid int64) error {
	if s.unavailable.Load() {
		return errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.DeleteUserRefreshTokens(ctx, uid)
}
func (s *securityFlowCache) DeleteTokenFamily(ctx context.Context, family string, ttl time.Duration) error {
	if s.unavailable.Load() || s.familyRevocationUnavailable.Load() {
		return errors.New("synthetic cache outage")
	}
	return s.RefreshTokenCache.DeleteTokenFamily(ctx, family, ttl)
}

func securityFlowSetup(t *testing.T, additionalEmails ...string) (*gin.Engine, *AuthHandler, *securityFlowCache) {
	t.Helper()
	cache := &securityFlowCache{RefreshTokenCache: newBrowserSessionRedisCache(t)}
	h, client := newOAuthPendingFlowTestHandlerWithDependencies(t, oauthPendingFlowTestHandlerOptions{refreshCache: cache})
	hash, err := bcrypt.GenerateFromPassword([]byte("SyntheticPassword2026!"), bcrypt.MinCost)
	require.NoError(t, err)
	_, err = client.User.Create().SetEmail("session-security@example.invalid").SetPasswordHash(string(hash)).SetRole(service.RoleAdmin).SetStatus(service.StatusActive).Save(context.Background())
	require.NoError(t, err)
	for _, email := range additionalEmails {
		_, err = client.User.Create().SetEmail(email).SetPasswordHash(string(hash)).SetRole(service.RoleUser).SetStatus(service.StatusActive).Save(context.Background())
		require.NoError(t, err)
	}
	r := gin.New()
	r.Use(middleware2.BrowserSession(nil))
	r.POST("/api/v1/auth/login", h.Login)
	r.POST("/api/v1/auth/refresh", h.RefreshToken)
	r.POST("/api/v1/auth/logout", h.Logout)
	jwt := gin.HandlerFunc(middleware2.NewJWTAuthMiddleware(h.authService, h.userService, h.settingSvc, nil))
	r.POST("/api/v1/auth/revoke-all-sessions", jwt, h.RevokeAllSessions)
	r.GET("/api/v1/auth/me", jwt, h.GetCurrentUser)
	r.GET("/api/v1/admin/test", gin.HandlerFunc(middleware2.NewAdminAuthMiddleware(h.authService, h.userService, h.settingSvc, nil)), func(c *gin.Context) { c.Status(204) })
	r.GET("/api/v1/optional/test", gin.HandlerFunc(middleware2.NewOptionalJWTAuthMiddleware(h.authService, h.userService, h.settingSvc, nil)), func(c *gin.Context) { c.Status(204) })
	return r, h, cache
}
func securityFlowCall(r *gin.Engine, path, handle, body string, cookies []*http.Cookie) *httptest.ResponseRecorder {
	method := "POST"
	if path == "/api/v1/auth/me" || strings.HasSuffix(path, "/test") {
		method = "GET"
	}
	req := httptest.NewRequest(method, "https://gateway.example"+path, strings.NewReader(body))
	req.Header.Set("Origin", "https://gateway.example")
	req.Header.Set("Content-Type", "application/json")
	if strings.HasPrefix(handle, "zjs.") || strings.HasPrefix(handle, "init.") {
		req.Header.Set("X-Zhijing-Session", handle)
	} else if handle != "" {
		req.Header.Set("Authorization", "Bearer "+handle)
	}
	for _, cookie := range cookies {
		if cookie.MaxAge >= 0 {
			req.AddCookie(cookie)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}
func securityFlowLogin(t *testing.T, r *gin.Engine) (string, string, []*http.Cookie) {
	t.Helper()
	w := securityFlowCall(r, "/api/v1/auth/login", "init.12345678123442348234123456789abc", `{"email":"session-security@example.invalid","password":"SyntheticPassword2026!"}`, nil)
	require.Equal(t, 200, w.Code, w.Body.String())
	data := decodeJSONResponseData(t, w)
	return data["access_token"].(string), data["refresh_token"].(string), w.Result().Cookies()
}
func securityWaitForReads(t *testing.T, cache *securityFlowCache, count int) {
	t.Helper()
	for i := 0; i < count; i++ {
		select {
		case <-cache.reached:
		case <-time.After(5 * time.Second):
			t.Fatal("refresh did not reach read barrier")
		}
	}
}

func TestSessionSecurityRevokeAllInvalidatesCookieBearerAndAdmin(t *testing.T) {
	r, h, _ := securityFlowSetup(t)
	handle, _, cookies := securityFlowLogin(t, r)
	var actualJWT string
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie.Name, "__Secure-zj_at_") {
			actualJWT = cookie.Value
		}
	}
	claims, err := h.authService.ValidateToken(actualJWT)
	require.NoError(t, err)
	require.Empty(t, claims.SessionGeneration, "legacy generation remains compatible before the first revoke")
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/me", actualJWT, "", nil).Code)
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/revoke-all-sessions", handle, `{}`, cookies).Code)
	for _, credential := range []string{handle, actualJWT} {
		for _, path := range []string{"/api/v1/auth/me", "/api/v1/admin/test", "/api/v1/optional/test"} {
			require.Equal(t, 401, securityFlowCall(r, path, credential, "", cookies).Code, path)
		}
	}
	newHandle, _, newCookies := securityFlowLogin(t, r)
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/me", newHandle, "", newCookies).Code, "new password login is allowed after revocation")
}

func TestSessionSecurityConcurrentRefreshConsumesOnlyOnce(t *testing.T) {
	r, _, cache := securityFlowSetup(t)
	handle, refresh, cookies := securityFlowLogin(t, r)
	cache.reached = make(chan struct{}, 2)
	cache.release = make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() {
			results <- securityFlowCall(r, "/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies)
		}()
	}
	securityWaitForReads(t, cache, 2)
	close(cache.release)
	successes, rejections := 0, 0
	for i := 0; i < 2; i++ {
		select {
		case w := <-results:
			if w.Code == 200 {
				successes++
			} else if w.Code == 401 {
				rejections++
			}
		case <-time.After(5 * time.Second):
			t.Fatal("refresh did not finish")
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, rejections)
}

func TestSessionSecurityRevokeAllPreventsInflightRefreshResurrection(t *testing.T) {
	r, _, cache := securityFlowSetup(t)
	handle, refresh, cookies := securityFlowLogin(t, r)
	cache.reached = make(chan struct{}, 1)
	cache.release = make(chan struct{})
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		result <- securityFlowCall(r, "/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies)
	}()
	securityWaitForReads(t, cache, 1)
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/revoke-all-sessions", handle, `{}`, cookies).Code)
	close(cache.release)
	select {
	case w := <-result:
		require.Equal(t, 401, w.Code, w.Body.String())
	case <-time.After(5 * time.Second):
		t.Fatal("refresh did not finish")
	}
}

func TestSessionSecurityLogoutPreventsInflightRefreshResurrection(t *testing.T) {
	r, _, cache := securityFlowSetup(t)
	handle, refresh, cookies := securityFlowLogin(t, r)
	cache.reached = make(chan struct{}, 1)
	cache.release = make(chan struct{})
	result := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		result <- securityFlowCall(r, "/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies)
	}()
	securityWaitForReads(t, cache, 1)
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/logout", handle, `{"refresh_token":"`+refresh+`"}`, cookies).Code)
	close(cache.release)
	select {
	case w := <-result:
		require.Equal(t, 401, w.Code, w.Body.String())
	case <-time.After(5 * time.Second):
		t.Fatal("refresh did not finish")
	}
	require.Equal(t, 401, securityFlowCall(r, "/api/v1/auth/me", handle, "", cookies).Code)
}

func TestSessionSecurityCacheOutageFailsClosed(t *testing.T) {
	r, _, cache := securityFlowSetup(t)
	handle, refresh, cookies := securityFlowLogin(t, r)
	cache.unavailable.Store(true)
	for _, path := range []string{"/api/v1/auth/me", "/api/v1/admin/test", "/api/v1/optional/test", "/api/v1/auth/revoke-all-sessions"} {
		require.Equal(t, 503, securityFlowCall(r, path, handle, `{}`, cookies).Code, path)
	}
	require.Equal(t, 503, securityFlowCall(r, "/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies).Code)
	require.Equal(t, 503, securityFlowCall(r, "/api/v1/auth/logout", handle, `{"refresh_token":"`+refresh+`"}`, cookies).Code)
	require.Equal(t, 503, securityFlowCall(r, "/api/v1/auth/login", "init.abcdefabcdefabcdefabcdefabcdefab", `{"email":"session-security@example.invalid","password":"SyntheticPassword2026!"}`, nil).Code)
	cache.unavailable.Store(false)
	require.Equal(t, 200, securityFlowCall(r, "/api/v1/auth/me", handle, "", cookies).Code, "failed revocation must not be reported as success")
}

func TestSessionSecurityLogoutOfConsumedRefreshWithoutAccessCookie(t *testing.T) {
	r, _, _ := securityFlowSetup(t)
	handle, refresh, cookies := securityFlowLogin(t, r)
	rotated := securityFlowCall(r, "/api/v1/auth/refresh", handle, `{"refresh_token":"`+refresh+`"}`, cookies)
	require.Equal(t, 200, rotated.Code, rotated.Body.String())
	data := decodeJSONResponseData(t, rotated)
	var refreshOnly []*http.Cookie
	for _, cookie := range cookies {
		if strings.HasPrefix(cookie.Name, "__Secure-zj_rt_") {
			refreshOnly = append(refreshOnly, cookie)
		}
	}
	logout := securityFlowCall(r, "/api/v1/auth/logout", handle, `{"refresh_token":"`+refresh+`"}`, refreshOnly)
	require.Equal(t, 200, logout.Code, logout.Body.String())
	require.Equal(t, 401, securityFlowCall(r, "/api/v1/auth/me", data["access_token"].(string), "", rotated.Result().Cookies()).Code, "the late replacement pair must be revoked even when the old access cookie was absent")
}

func securityFlowLegacyLogin(t *testing.T, r *gin.Engine, email string) (string, string) {
	t.Helper()
	w := securityFlowCall(r, "/api/v1/auth/login", "", `{"email":"`+email+`","password":"SyntheticPassword2026!"}`, nil)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	data := decodeJSONResponseData(t, w)
	return data["access_token"].(string), data["refresh_token"].(string)
}

func TestSessionSecurityLogoutRejectsMixedBearerFamiliesBeforeAnyRevocation(t *testing.T) {
	for _, differentUser := range []bool{false, true} {
		for _, consumed := range []bool{false, true} {
			t.Run(fmt.Sprintf("different_user=%t/consumed_refresh=%t", differentUser, consumed), func(t *testing.T) {
				emailB := "session-security@example.invalid"
				var additionalEmails []string
				if differentUser {
					emailB = "session-security-other@example.invalid"
					additionalEmails = append(additionalEmails, emailB)
				}
				r, _, _ := securityFlowSetup(t, additionalEmails...)
				accessA, refreshA := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
				currentRefreshA := refreshA
				if consumed {
					rotation := securityFlowCall(r, "/api/v1/auth/refresh", accessA, `{"refresh_token":"`+refreshA+`"}`, nil)
					require.Equal(t, http.StatusOK, rotation.Code, rotation.Body.String())
					currentRefreshA = decodeJSONResponseData(t, rotation)["refresh_token"].(string)
				}
				accessB, refreshB := securityFlowLegacyLogin(t, r, emailB)
				logout := securityFlowCall(r, "/api/v1/auth/logout", accessB, `{"refresh_token":"`+refreshA+`"}`, nil)
				require.Equal(t, http.StatusBadRequest, logout.Code, "mixed credentials must be rejected before choosing either session")
				require.Contains(t, logout.Body.String(), "does not match")
				require.Empty(t, logout.Result().Cookies(), "a rejected old operation must not clear another pending OAuth flow")
				for _, access := range []string{accessA, accessB} {
					require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", access, "", nil).Code)
				}
				for _, pair := range [][2]string{{accessA, currentRefreshA}, {accessB, refreshB}} {
					w := securityFlowCall(r, "/api/v1/auth/refresh", pair[0], `{"refresh_token":"`+pair[1]+`"}`, nil)
					require.Equal(t, http.StatusOK, w.Code, "neither family's refresh credential may be consumed by the rejected logout")
				}
			})
		}
	}
}

func TestSessionSecurityLogoutPreservesSameFamilyAndLegacyCompatibility(t *testing.T) {
	for _, scenario := range []string{"old_access_new_refresh", "new_access_consumed_refresh", "no_access_consumed_refresh", "expired_access_new_refresh", "expired_access_consumed_refresh", "no_access_current_refresh", "legacy_no_sid_current_refresh", "access_only"} {
		t.Run(scenario, func(t *testing.T) {
			r, h, _ := securityFlowSetup(t)
			oldAccess, oldRefresh := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
			rotation := securityFlowCall(r, "/api/v1/auth/refresh", oldAccess, `{"refresh_token":"`+oldRefresh+`"}`, nil)
			require.Equal(t, http.StatusOK, rotation.Code, rotation.Body.String())
			data := decodeJSONResponseData(t, rotation)
			newAccess, newRefresh := data["access_token"].(string), data["refresh_token"].(string)
			access, refresh := oldAccess, newRefresh
			switch scenario {
			case "new_access_consumed_refresh":
				access, refresh = newAccess, oldRefresh
			case "no_access_consumed_refresh":
				access, refresh = "", oldRefresh
			case "no_access_current_refresh":
				access = ""
			case "expired_access_new_refresh", "expired_access_consumed_refresh", "legacy_no_sid_current_refresh":
				claims, err := h.authService.ValidateToken(oldAccess)
				require.NoError(t, err)
				if scenario == "legacy_no_sid_current_refresh" {
					claims.SessionID = ""
				} else {
					claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
				}
				// This is the synthetic signing key from the OAuth flow fixture.
				access, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
				require.NoError(t, err)
				if scenario == "expired_access_consumed_refresh" {
					refresh = oldRefresh
				}
			case "access_only":
				refresh = ""
			}
			logout := securityFlowCall(r, "/api/v1/auth/logout", access, `{"refresh_token":"`+refresh+`"}`, nil)
			require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())
			require.Equal(t, http.StatusUnauthorized, securityFlowCall(r, "/api/v1/auth/me", newAccess, "", nil).Code, "the family's current access token must be revoked")
		})
	}
}

func TestSessionSecurityLogoutRejectsDifferentUserWithLegacyJWTWithoutFamily(t *testing.T) {
	r, h, _ := securityFlowSetup(t, "session-security-other@example.invalid")
	accessA, refreshA := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
	accessB, refreshB := securityFlowLegacyLogin(t, r, "session-security-other@example.invalid")
	claims, err := h.authService.ValidateToken(accessB)
	require.NoError(t, err)
	claims.SessionID = ""
	legacyAccessB, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
	require.NoError(t, err)
	logout := securityFlowCall(r, "/api/v1/auth/logout", legacyAccessB, `{"refresh_token":"`+refreshA+`"}`, nil)
	require.Equal(t, http.StatusBadRequest, logout.Code, logout.Body.String())
	require.Empty(t, logout.Result().Cookies())
	for _, pair := range [][2]string{{accessA, refreshA}, {accessB, refreshB}} {
		require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", pair[0], "", nil).Code)
		refreshed := securityFlowCall(r, "/api/v1/auth/refresh", pair[0], `{"refresh_token":"`+pair[1]+`"}`, nil)
		require.Equal(t, http.StatusOK, refreshed.Code, refreshed.Body.String())
	}
}

func TestSessionSecurityLogoutExpiredBearerKeepsRefreshTokenTarget(t *testing.T) {
	for _, consumed := range []bool{false, true} {
		t.Run(fmt.Sprintf("consumed_refresh=%t", consumed), func(t *testing.T) {
			r, h, _ := securityFlowSetup(t)
			accessA, refreshA := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
			currentAccessA, currentRefreshA := accessA, refreshA
			if consumed {
				rotated := securityFlowCall(r, "/api/v1/auth/refresh", accessA, `{"refresh_token":"`+refreshA+`"}`, nil)
				require.Equal(t, http.StatusOK, rotated.Code, rotated.Body.String())
				data := decodeJSONResponseData(t, rotated)
				currentAccessA, currentRefreshA = data["access_token"].(string), data["refresh_token"].(string)
			}
			accessB, refreshB := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
			claims, err := h.authService.ValidateToken(accessB)
			require.NoError(t, err)
			claims.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Hour))
			expiredAccessB, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
			require.NoError(t, err)
			logout := securityFlowCall(r, "/api/v1/auth/logout", expiredAccessB, `{"refresh_token":"`+refreshA+`"}`, nil)
			require.Equal(t, http.StatusOK, logout.Code, logout.Body.String())
			require.Equal(t, http.StatusUnauthorized, securityFlowCall(r, "/api/v1/auth/me", currentAccessA, "", nil).Code)
			require.Equal(t, http.StatusUnauthorized, securityFlowCall(r, "/api/v1/auth/refresh", "", `{"refresh_token":"`+currentRefreshA+`"}`, nil).Code)
			require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", accessB, "", nil).Code, "the expired bearer cannot redirect logout to its former family")
			refreshedB := securityFlowCall(r, "/api/v1/auth/refresh", accessB, `{"refresh_token":"`+refreshB+`"}`, nil)
			require.Equal(t, http.StatusOK, refreshedB.Code, refreshedB.Body.String())
		})
	}
}

func TestSessionSecurityLogoutIdentityLookupOutageDoesNotRevokeEitherFamily(t *testing.T) {
	r, _, cache := securityFlowSetup(t)
	accessA, refreshA := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
	accessB, refreshB := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
	// Only the identity lookup fails; a premature family revocation would work.
	cache.revocationReadUnavailable.Store(true)
	logout := securityFlowCall(r, "/api/v1/auth/logout", accessB, `{"refresh_token":"`+refreshA+`"}`, nil)
	require.Equal(t, http.StatusServiceUnavailable, logout.Code, logout.Body.String())
	require.Empty(t, logout.Result().Cookies())
	cache.revocationReadUnavailable.Store(false)
	for _, pair := range [][2]string{{accessA, refreshA}, {accessB, refreshB}} {
		require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", pair[0], "", nil).Code)
		refreshed := securityFlowCall(r, "/api/v1/auth/refresh", pair[0], `{"refresh_token":"`+pair[1]+`"}`, nil)
		require.Equal(t, http.StatusOK, refreshed.Code, refreshed.Body.String())
	}
}

func TestSessionSecurityLogoutCookieRejectsMixedSelectorsWithoutChangingEitherSession(t *testing.T) {
	r, _, _ := securityFlowSetup(t)
	accessA, refreshA, cookiesA := securityFlowLogin(t, r)
	accessB, _, cookiesB := securityFlowLogin(t, r)
	logout := securityFlowCall(r, "/api/v1/auth/logout", accessB, `{"refresh_token":"`+refreshA+`"}`, cookiesB)
	require.Equal(t, http.StatusBadRequest, logout.Code)
	require.Empty(t, logout.Result().Cookies())
	require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", accessA, "", cookiesA).Code)
	require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", accessB, "", cookiesB).Code)
}

func TestSessionSecurityLogoutFamilyWriteFailureCannotBecomeRefreshNoopSuccess(t *testing.T) {
	for _, credential := range []string{"current_refresh", "consumed_alias", "missing_refresh", "no_refresh"} {
		t.Run(credential, func(t *testing.T) {
			r, _, cache := securityFlowSetup(t)
			access, refresh := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
			currentAccess := access
			submittedRefresh := refresh
			switch credential {
			case "consumed_alias":
				rotated := securityFlowCall(r, "/api/v1/auth/refresh", access, `{"refresh_token":"`+refresh+`"}`, nil)
				require.Equal(t, http.StatusOK, rotated.Code, rotated.Body.String())
				currentAccess = decodeJSONResponseData(t, rotated)["access_token"].(string)
			case "missing_refresh":
				submittedRefresh = "rt_" + strings.Repeat("0", len(refresh)-3)
			case "no_refresh":
				submittedRefresh = ""
			}
			// Reads remain healthy, so a missing RT is a successful revocation
			// no-op. It cannot replace the selected Bearer family's write error.
			cache.familyRevocationUnavailable.Store(true)
			body := `{"refresh_token":"` + submittedRefresh + `"}`
			logout := securityFlowCall(r, "/api/v1/auth/logout", access, body, nil)
			require.Equal(t, http.StatusServiceUnavailable, logout.Code, logout.Body.String())
			require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", currentAccess, "", nil).Code, "failed family revocation did not revoke the current access token")
			cache.familyRevocationUnavailable.Store(false)
			retried := securityFlowCall(r, "/api/v1/auth/logout", access, body, nil)
			require.Equal(t, http.StatusOK, retried.Code, retried.Body.String())
			require.Equal(t, http.StatusUnauthorized, securityFlowCall(r, "/api/v1/auth/me", currentAccess, "", nil).Code, "a successful retry must revoke the selected family")
		})
	}
}

func TestSessionSecurityLogoutWithoutBearerFamilyStillUsesRefreshRevocation(t *testing.T) {
	for _, credential := range []string{"no_access", "legacy_no_sid"} {
		for _, consumed := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/consumed_alias=%t", credential, consumed), func(t *testing.T) {
				r, h, cache := securityFlowSetup(t)
				access, refresh := securityFlowLegacyLogin(t, r, "session-security@example.invalid")
				currentAccess := access
				if consumed {
					rotated := securityFlowCall(r, "/api/v1/auth/refresh", access, `{"refresh_token":"`+refresh+`"}`, nil)
					require.Equal(t, http.StatusOK, rotated.Code, rotated.Body.String())
					currentAccess = decodeJSONResponseData(t, rotated)["access_token"].(string)
				}
				submittedAccess := ""
				if credential == "legacy_no_sid" {
					claims, err := h.authService.ValidateToken(access)
					require.NoError(t, err)
					claims.SessionID = ""
					submittedAccess, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("test-secret"))
					require.NoError(t, err)
				}
				body := `{"refresh_token":"` + refresh + `"}`
				cache.familyRevocationUnavailable.Store(true)
				failed := securityFlowCall(r, "/api/v1/auth/logout", submittedAccess, body, nil)
				require.Equal(t, http.StatusServiceUnavailable, failed.Code, failed.Body.String())
				require.Equal(t, http.StatusOK, securityFlowCall(r, "/api/v1/auth/me", currentAccess, "", nil).Code)
				cache.familyRevocationUnavailable.Store(false)
				retried := securityFlowCall(r, "/api/v1/auth/logout", submittedAccess, body, nil)
				require.Equal(t, http.StatusOK, retried.Code, retried.Body.String())
				require.Equal(t, http.StatusUnauthorized, securityFlowCall(r, "/api/v1/auth/me", currentAccess, "", nil).Code)
			})
		}
	}
}
