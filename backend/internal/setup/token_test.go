package setup

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newSetupTestEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	RegisterRoutes(engine)
	return engine
}

func withSetupToken(t *testing.T) string {
	t.Helper()
	t.Setenv("DATA_DIR", t.TempDir())
	t.Setenv("SKIP_SETUP", "")
	InvalidateSetupToken()
	t.Cleanup(InvalidateSetupToken)

	token, err := EnsureSetupToken()
	require.NoError(t, err)
	require.NotEmpty(t, token)
	return token
}

func TestSetupWriteRoutesRejectRequestsWithoutToken(t *testing.T) {
	withSetupToken(t)

	engine := newSetupTestEngine(t)
	for _, path := range []string{"/setup/test-db", "/setup/test-redis", "/setup/install"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(rec, req)

		require.Equal(t, http.StatusUnauthorized, rec.Code, "POST %s without a setup token", path)
		require.Contains(t, rec.Body.String(), "Setup token is missing or invalid")
	}
}

func TestSetupInstallRejectsWrongToken(t *testing.T) {
	token := withSetupToken(t)

	engine := newSetupTestEngine(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/setup/install", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SetupTokenHeader, token+"-wrong")
	engine.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestSetupInstallPassesTokenGuardWithCorrectToken(t *testing.T) {
	token := withSetupToken(t)

	engine := newSetupTestEngine(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/setup/install", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SetupTokenHeader, token)
	engine.ServeHTTP(rec, req)

	// The guard is satisfied, so the request reaches the handler and fails on
	// its own validation instead of being rejected with 401.
	require.NotEqual(t, http.StatusUnauthorized, rec.Code)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSetupStatusStaysPublicAndReportsTokenRequirement(t *testing.T) {
	withSetupToken(t)

	engine := newSetupTestEngine(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/setup/status", nil)
	engine.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Contains(t, rec.Body.String(), `"requires_token":true`)
}

func TestEnsureSetupTokenWritesOwnerOnlyFile(t *testing.T) {
	token := withSetupToken(t)

	info, err := os.Stat(GetSetupTokenPath())
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	content, err := os.ReadFile(GetSetupTokenPath())
	require.NoError(t, err)
	require.Equal(t, token, strings.TrimSpace(string(content)))
}

func TestInvalidateSetupTokenRevokesTokenAndFile(t *testing.T) {
	token := withSetupToken(t)

	require.True(t, SetupTokenMatches(token))
	InvalidateSetupToken()

	require.Empty(t, CurrentSetupToken())
	_, err := os.Stat(GetSetupTokenPath())
	require.True(t, os.IsNotExist(err), "setup token file must be removed once the token is revoked")

	engine := newSetupTestEngine(t)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/setup/install", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SetupTokenHeader, token)
	engine.ServeHTTP(rec, req)

	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestEnsureSetupTokenIsStableUntilRevoked(t *testing.T) {
	first := withSetupToken(t)

	second, err := EnsureSetupToken()
	require.NoError(t, err)
	require.Equal(t, first, second, "the active token must stay the one printed at startup")

	InvalidateSetupToken()
	rotated, err := EnsureSetupToken()
	require.NoError(t, err)
	require.NotEqual(t, first, rotated)
	require.False(t, SetupTokenMatches(first))
	require.True(t, SetupTokenMatches(rotated))
}
