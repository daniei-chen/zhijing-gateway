//go:build e2e

package integration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// E2E 用户流程测试
// 测试完整的用户操作链路：注册 → 登录 → 创建 API Key → 调用网关 → 查询用量
//
// 所有面板路径都带 /api/v1 前缀：路由挂在 internal/server/router.go:149 的
// r.Group("/api/v1") 下——注册/登录见 internal/server/routes/auth.go:29，当前
// 用户信息是 user.GET("/profile")（routes/user.go:31），API Key 是
// keys.POST("")（routes/user.go:87），用量看板是 usage.GET("/dashboard/stats")
// （routes/user.go:115）。
//
// 这套测试此前打的是 /api/auth/... 这类不带 v1 的路径，路由根本不存在，于是
// 每一轮都是 404；而 404 又被当成「继续尝试」，最后整条测试降级成 skip。
// 这正是它自接入 CI 起从未绿过、却始终没人发现的原因：它一直在把自己跳过。
// 现在起，路径不对、认证过不去、响应里没有 token，一律 t.Fatalf。
const apiPrefix = "/api/v1"

var (
	testUserEmail    = "e2e-test-" + fmt.Sprintf("%d", time.Now().UnixMilli()) + "@test.local"
	testUserPassword = "E2eTest@12345"
	testUserName     = "e2e-test-user"
)

// TestUserRegistrationAndLogin 测试用户注册和登录流程
func TestUserRegistrationAndLogin(t *testing.T) {
	// 步骤 1: 注册新用户
	t.Run("注册新用户", func(t *testing.T) {
		payload := map[string]string{
			"email":    testUserEmail,
			"password": testUserPassword,
			"username": testUserName,
		}
		body, _ := json.Marshal(payload)

		resp, err := doRequest(t, http.MethodPost, apiPrefix+"/auth/register", body, "")
		if err != nil {
			t.Fatalf("注册请求失败（栈应该已经在跑，连不上说明环境不对）: %v", err)
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("注册返回 HTTP %d: %s\n路由是 %s/auth/register（internal/server/routes/auth.go:35）。"+
				"404 说明这个路径不存在或 v1 前缀变了；403 通常是 registration_enabled 被关；"+
				"400 是请求本身不合法。", resp.StatusCode, string(respBody), apiPrefix)
		}

		t.Logf("✅ 用户注册成功: %s", testUserEmail)
	})

	// 步骤 2: 登录获取 JWT
	var accessToken string
	t.Run("用户登录获取JWT", func(t *testing.T) {
		payload := map[string]string{
			"email":    testUserEmail,
			"password": testUserPassword,
		}
		body, _ := json.Marshal(payload)

		resp, err := doRequest(t, http.MethodPost, apiPrefix+"/auth/login", body, "")
		if err != nil {
			t.Fatalf("登录请求失败: %v", err)
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("登录返回 HTTP %d: %s（路由 %s/auth/login，internal/server/routes/auth.go:38）",
				resp.StatusCode, string(respBody), apiPrefix)
		}

		accessToken = extractAccessToken(t, respBody)
		t.Logf("✅ 登录成功，获取 JWT（长度: %d）", len(accessToken))
	})

	if accessToken == "" {
		t.Fatalf("上一步没有拿到 JWT，后面的步骤没有意义")
	}

	// 步骤 3: 使用 JWT 获取当前用户信息
	t.Run("获取当前用户信息", func(t *testing.T) {
		resp, err := doRequest(t, http.MethodGet, apiPrefix+"/user/profile", nil, accessToken)
		if err != nil {
			t.Fatalf("请求失败: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("HTTP %d: %s（路由 %s/user/profile，internal/server/routes/user.go:31）",
				resp.StatusCode, string(body), apiPrefix)
		}

		t.Logf("✅ 成功获取用户信息")
	})
}

// TestAPIKeyLifecycle 测试 API Key 的创建和使用
func TestAPIKeyLifecycle(t *testing.T) {
	// 先登录获取 JWT
	accessToken := loginTestUser(t)

	var apiKey string

	// 步骤 1: 创建 API Key
	t.Run("创建API_Key", func(t *testing.T) {
		payload := map[string]string{
			"name": "e2e-test-key-" + fmt.Sprintf("%d", time.Now().UnixMilli()),
		}
		body, _ := json.Marshal(payload)

		resp, err := doRequest(t, http.MethodPost, apiPrefix+"/keys", body, accessToken)
		if err != nil {
			t.Fatalf("创建 API Key 请求失败: %v", err)
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("创建 API Key 返回 HTTP %d: %s（路由 %s/keys，internal/server/routes/user.go:87）",
				resp.StatusCode, string(respBody), apiPrefix)
		}

		var result map[string]any
		if err := json.Unmarshal(respBody, &result); err != nil {
			t.Fatalf("解析响应失败: %v（body: %s）", err, string(respBody))
		}

		if key, ok := result["key"].(string); ok {
			apiKey = key
		} else if data, ok := result["data"].(map[string]any); ok {
			if key, ok := data["key"].(string); ok {
				apiKey = key
			}
		}
		if apiKey == "" {
			t.Fatalf("响应里没有 key: %s", string(respBody))
		}

		t.Logf("✅ API Key 创建成功: %s", redactAPIKey(apiKey))
	})

	// 步骤 2: 使用 API Key 调用网关（不需要上游账号，只验鉴权这一层）
	t.Run("使用API_Key调用网关", func(t *testing.T) {
		resp, err := doRequest(t, http.MethodGet, "/v1/models", nil, apiKey)
		if err != nil {
			t.Fatalf("网关请求失败: %v", err)
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)

		// 402/403 在这套测试栈里是正常结果：没有上游账号，所以没有余额/没有可用
		// 账户，但走到这两步说明 API Key 已经通过鉴权。除此之外一律是故障。
		switch resp.StatusCode {
		case http.StatusOK:
			t.Logf("✅ API Key 网关调用成功")
		case http.StatusPaymentRequired:
			t.Logf("✅ API Key 鉴权通过（402 余额不足，栈里没有上游账号，符合预期）")
		case http.StatusForbidden:
			t.Logf("✅ API Key 鉴权通过（403 无可用账户，栈里没有上游账号，符合预期）")
		default:
			t.Fatalf("网关返回 HTTP %d: %s（带 API Key 请求 /v1/models，401 说明 Key 无效，404 说明路径不存在）",
				resp.StatusCode, string(respBody))
		}
	})

	// 步骤 3: 查询用量记录
	t.Run("查询用量记录", func(t *testing.T) {
		resp, err := doRequest(t, http.MethodGet, apiPrefix+"/usage/dashboard/stats", nil, accessToken)
		if err != nil {
			t.Fatalf("用量查询请求失败: %v", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("用量查询返回 HTTP %d: %s（路由 %s/usage/dashboard/stats，internal/server/routes/user.go:115）",
				resp.StatusCode, string(body), apiPrefix)
		}

		t.Logf("✅ 用量查询成功")
	})
}

// =============================================================================
// 辅助函数
// =============================================================================

func doRequest(t *testing.T, method, path string, body []byte, token string) (*http.Response, error) {
	t.Helper()

	url := baseURL + path
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	return client.Do(req)
}

// extractAccessToken 从登录/注册响应里取 access_token。取不到就是失败：
// 这一层一旦允许「取不到就跳过」，整套测试就又能靠跳过自己假装通过。
func extractAccessToken(t *testing.T, respBody []byte) string {
	t.Helper()

	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		t.Fatalf("解析认证响应失败: %v（body: %s）", err, string(respBody))
	}

	if token, ok := result["access_token"].(string); ok && token != "" {
		return token
	}
	if data, ok := result["data"].(map[string]any); ok {
		if token, ok := data["access_token"].(string); ok && token != "" {
			return token
		}
	}

	t.Fatalf("认证响应里没有 access_token（body: %s）——可能是 2FA 被要求，或响应结构变了", string(respBody))
	return ""
}

func loginTestUser(t *testing.T) string {
	t.Helper()

	// 先尝试用管理员账户登录。管理员邮箱不再有固定默认值（未设置时安装阶段
	// 随机生成），所以 CI 必须把 ADMIN_EMAIL / ADMIN_PASSWORD 传进来。
	adminEmail := getEnv("ADMIN_EMAIL", "")
	adminPassword := getEnv("ADMIN_PASSWORD", "")

	if adminEmail == "" || adminPassword == "" {
		// 没有管理员凭据时退回测试用户（要求 TestUserRegistrationAndLogin
		// 已经先跑过；字母序上它排在后面，所以这条路只在本地手工跑时出现）。
		adminEmail = testUserEmail
		adminPassword = testUserPassword
	}

	payload := map[string]string{
		"email":    adminEmail,
		"password": adminPassword,
	}
	body, _ := json.Marshal(payload)

	resp, err := doRequest(t, http.MethodPost, apiPrefix+"/auth/login", body, "")
	if err != nil {
		t.Fatalf("登录请求失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("登录返回 HTTP %d: %s（邮箱 %s，路由 %s/auth/login）",
			resp.StatusCode, string(respBody), adminEmail, apiPrefix)
	}

	return extractAccessToken(t, respBody)
}

// redactAPIKey API Key 脱敏，只显示前 8 位
func redactAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 8 {
		return "***"
	}
	return key[:8] + "..."
}
