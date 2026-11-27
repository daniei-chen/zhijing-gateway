//go:build unit

package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/metrics"
)

func newDuplicateBillingKeyRouter() (*gin.Engine, *bool) {
	gin.SetMode(gin.TestMode)
	handlerCalled := false
	r := gin.New()
	r.Use(RejectDuplicateBillingKeys())
	r.POST("/v1/messages", func(c *gin.Context) {
		handlerCalled = true
		body, _ := c.GetRawData()
		var payload map[string]any
		_ = json.Unmarshal(body, &payload)
		c.JSON(http.StatusOK, gin.H{"model": payload["model"]})
	})
	return r, &handlerCalled
}

func postJSON(r *gin.Engine, path, contentType, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestRejectDuplicateBillingKeys_DuplicateModelIs400(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	before := metrics.DuplicateBillingKeyRejectedTotal()

	w := postJSON(r, "/v1/messages", "application/json",
		`{"model":"cheap-model","model":"expensive-model","max_tokens":16}`)

	require.Equal(t, http.StatusBadRequest, w.Code)
	require.False(t, *called, "命中后不得进入 handler（不产生 usage/billing、不发上游）")
	require.Contains(t, w.Body.String(), `"code":"duplicate_billing_parameter"`)
	require.Contains(t, w.Body.String(), `"param":"model"`)
	require.NotContains(t, w.Body.String(), "model_not_found")
	require.Equal(t, before+1, metrics.DuplicateBillingKeyRejectedTotal(), "拒绝必须可数")
}

func TestRejectDuplicateBillingKeys_CaseVariantIsRejected(t *testing.T) {
	// encoding/json 对字段名大小写不敏感、gjson 大小写敏感：Model/model 并存会让
	// 准入与计费看到不同的值。
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json", `{"model":"a","Model":"b"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.False(t, *called)
}

func TestRejectDuplicateBillingKeys_NestedSessionModelIsRejected(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json",
		`{"model":"a","session":{"model":"low","model":"high"}}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.False(t, *called)
}

func TestRejectDuplicateBillingKeys_ModelInDifferentObjectsIsAllowed(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json",
		`{"model":"a","messages":[{"role":"user","content":"hi"}],"extra":{"model":"not-routing"}}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, *called)
}

func TestRejectDuplicateBillingKeys_SingleModelUnchanged(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json", `{"model":"claude-sonnet-4","stream":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, *called)
	require.Contains(t, w.Body.String(), "claude-sonnet-4")
}

func TestRejectDuplicateBillingKeys_UnrelatedDuplicateAllowed(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json",
		`{"model":"a","metadata":{"trace":"1","trace":"2"}}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, *called)
}

func TestRejectDuplicateBillingKeys_MalformedJSONPassesThrough(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "application/json", `{"model":`)
	require.Equal(t, http.StatusOK, w.Code, "非法 JSON 交给 handler 返回原有错误")
	require.True(t, *called)
}

func TestRejectDuplicateBillingKeys_MultipartIsNotScanned(t *testing.T) {
	r, called := newDuplicateBillingKeyRouter()
	w := postJSON(r, "/v1/messages", "multipart/form-data; boundary=x",
		"--x\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\na\r\n--x--\r\n")
	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, *called)
}
