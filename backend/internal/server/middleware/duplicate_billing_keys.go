package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/httputil"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/logger"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/metrics"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/requestmodel"
)

// duplicateBillingKeyNames 是影响计费或路由的 JSON 键。同一对象里出现两次即拒绝：
// gjson（首个值）与 encoding/json（末个值）会绑定到不同的模型/参数，攻击者可以
// 让「准入看到的」和「计费看到的」不是同一个值。大小写变体也要拦（encoding/json
// 对字段名大小写不敏感）。
//
// session：Live 入口的模型在 session.model；group/group_id/service_tier/
// reasoning_effort/stream 都参与计费口径或路由。
var duplicateBillingKeyNames = map[string]struct{}{
	"model":            {},
	"session":          {},
	"group":            {},
	"group_id":         {},
	"service_tier":     {},
	"reasoning_effort": {},
	"stream":           {},
}

// RejectDuplicateBillingKeys 在计费与转发之前拒绝含重复计费/路由键的 JSON 请求体。
//
// 只扫 JSON（multipart 的表单字段重复由各 handler 自己的解析处理）；请求体格式
// 错误时放行，让 handler 返回它原本的错误。命中时返回 400 与错误码
// duplicate_billing_parameter——与「模型不存在」「余额不足」「服务不可用」都可区分——
// 并累加 zhijing_gateway_duplicate_billing_key_rejected_total，避免只留一条日志。
func RejectDuplicateBillingKeys() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request == nil {
			c.Next()
			return
		}
		switch c.Request.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
		default:
			c.Next()
			return
		}
		if !requestMayBeJSON(c.GetHeader("Content-Type")) {
			c.Next()
			return
		}

		body, err := httputil.ReadRequestBodyWithPrealloc(c.Request)
		if err != nil {
			if RejectRequestBodyReadError(c, "middleware.duplicate_billing_keys", err) {
				return
			}
			AbortWithRequestBodyReadFailure(c, "middleware.duplicate_billing_keys", err)
			return
		}
		requestmodel.ResetRequestBody(c.Request, body)

		if key, duplicated := findDuplicateBillingKey(body); duplicated {
			metrics.ObserveDuplicateBillingKeyRejected()
			logger.LegacyPrintf("middleware.duplicate_billing_keys",
				"Rejected duplicate billing/routing key %q path=%s", key, c.Request.URL.Path)
			writeDuplicateBillingKeyError(c, key)
			c.Abort()
			return
		}
		c.Next()
	}
}

// requestMayBeJSON 只放行可能被 JSON 解析的请求；空 Content-Type 且首字节是
// `{` 的请求按 JSON 处理（部分 SDK 不带 Content-Type）。
func requestMayBeJSON(contentType string) bool {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if contentType == "" {
		return true
	}
	return strings.Contains(contentType, "json")
}

// findDuplicateBillingKey 流式扫描整个 JSON 文档，按对象层级统计目标键。
// 同一嵌套层级的对象互不影响；不同对象里各出现一次是合法的。
func findDuplicateBillingKey(body []byte) (string, bool) {
	trimmed := bytes.TrimLeft(body, " \t\r\n")
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return "", false
	}

	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()

	type objectFrame struct {
		isObject bool
		keys     map[string]struct{}
	}
	var stack []objectFrame
	expectKey := false

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return "", false
		}
		if err != nil {
			// 非法 JSON：交给 handler 自己的解析器报错，不在这里改变错误形态。
			return "", false
		}
		switch t := tok.(type) {
		case json.Delim:
			switch t {
			case '{':
				stack = append(stack, objectFrame{isObject: true, keys: make(map[string]struct{})})
				expectKey = true
			case '[':
				stack = append(stack, objectFrame{})
				expectKey = false
			case '}', ']':
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
				expectKey = len(stack) > 0 && stack[len(stack)-1].isObject
			}
		case string:
			if len(stack) == 0 || !stack[len(stack)-1].isObject {
				continue
			}
			if !expectKey {
				expectKey = true
				continue
			}
			key := strings.ToLower(t)
			if _, relevant := duplicateBillingKeyNames[key]; relevant {
				if _, seen := stack[len(stack)-1].keys[key]; seen {
					return key, true
				}
				stack[len(stack)-1].keys[key] = struct{}{}
			}
			expectKey = false
		default:
			if len(stack) > 0 && stack[len(stack)-1].isObject {
				expectKey = true
			}
		}
	}
}

// writeDuplicateBillingKeyError 按入口协议返回 400，并带上可分类的错误码。
func writeDuplicateBillingKeyError(c *gin.Context, key string) {
	message := "Request body contains duplicate \"" + key + "\" field; ambiguous billing/routing parameters are rejected."
	path := ""
	if c.Request != nil && c.Request.URL != nil {
		path = c.Request.URL.Path
	}
	switch {
	case strings.HasPrefix(path, "/v1beta") || strings.HasPrefix(path, "/antigravity/v1beta"):
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"code":    http.StatusBadRequest,
				"message": message,
				"status":  "INVALID_ARGUMENT",
			},
		})
	case strings.Contains(path, "/messages"):
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "invalid_request_error",
				"code":    "duplicate_billing_parameter",
				"param":   key,
				"message": message,
			},
		})
	default:
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": message,
				"type":    "invalid_request_error",
				"code":    "duplicate_billing_parameter",
				"param":   key,
			},
		})
	}
}
