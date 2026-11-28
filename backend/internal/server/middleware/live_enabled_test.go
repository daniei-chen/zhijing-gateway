package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestLiveEnabledGuardStopsBeforeHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handlerReached := false
	router := gin.New()
	router.POST("/v1/live", LiveEnabledGuard(false), func(c *gin.Context) {
		handlerReached = true
		c.Status(http.StatusOK)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/live", strings.NewReader(`{"sdp":"v=0\r\n"}`))
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusNotFound, recorder.Code)
	require.JSONEq(t,
		`{"error":{"type":"not_found_error","message":"Live is not enabled"}}`,
		recorder.Body.String(),
	)
	require.False(t, handlerReached, "a disabled Live route must never reach the handler")
}

func TestLiveEnabledGuardPassesThroughWhenEnabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handlerReached := false
	router := gin.New()
	router.POST("/v1/live", LiveEnabledGuard(true), func(c *gin.Context) {
		handlerReached = true
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/live", strings.NewReader(`{"sdp":"v=0\r\n"}`))
	router.ServeHTTP(recorder, request)

	require.True(t, handlerReached, "an enabled Live route must reach the handler unchanged")
	require.Equal(t, http.StatusNoContent, recorder.Code)
}
