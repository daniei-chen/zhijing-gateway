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
//
// 公开注册的开关也不是 env，是 settings 表里的 registration_enabled
// （service.SettingKeyRegistrationEnabled），默认关，关着时注册固定回
// 403 REGISTRATION_DISABLED（internal/service/auth_service.go:176）。compose
// 里没有任何地方能打开它，所以注册用例的第一步是用管理员会话走产品自己的
// 管理端接口把它打开、再读回确认，见 openPublicRegistration。
const apiPrefix = "/api/v1"

var (
	testUserEmail    = "e2e-test-" + fmt.Sprintf("%d", time.Now().UnixMilli()) + "@test.local"
	testUserPassword = "E2eTest@12345"
	testUserName     = "e2e-test-user"
)

// TestUserRegistrationAndLogin 测试用户注册和登录流程
func TestUserRegistrationAndLogin(t *testing.T) {
	// 步骤 0: 打开公开注册开关
	t.Run("管理员打开公开注册", func(t *testing.T) {
		openPublicRegistration(t)
	})

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
				"404 说明这个路径不存在或 v1 前缀变了；400 是请求本身不合法（邮箱/密码/验证码）。"+
				"如果这里是 403 REGISTRATION_DISABLED，那和上一步的读回结果矛盾——开关读回是 true，"+
				"注册仍然被拒，说明写入和读取不是同一份设置，别再重试同一条路。",
				resp.StatusCode, string(respBody), apiPrefix)
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
		// 账户。但不能光凭这个状态码就认定「鉴权过了」——万一鉴权 middleware
		// 本身坏了、对谁都回 403，这条测试照样绿。所以加一条对照：同一个请求
		// 换成一个伪造的 Key，必须被拒成 401（中间件对无效 Key 的固定回答，
		// internal/server/middleware/api_key_auth.go:50、:82）。
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

		bogus, err := doRequest(t, http.MethodGet, "/v1/models", nil, "sk-definitely-not-a-real-key")
		if err != nil {
			t.Fatalf("伪造 Key 的对照请求失败: %v", err)
		}
		defer bogus.Body.Close()
		bogusBody, _ := io.ReadAll(bogus.Body)

		if bogus.StatusCode != http.StatusUnauthorized {
			t.Fatalf("伪造 Key 期望 401（api_key_auth.go:50 的 INVALID_API_KEY），实际 HTTP %d: %s——"+
				"鉴权 middleware 的行为变了，这条用例就不能再拿 %d 当成「鉴权通过」的证据",
				bogus.StatusCode, string(bogusBody), resp.StatusCode)
		}
		if bogus.StatusCode == resp.StatusCode {
			t.Fatalf("伪造 Key 与真 Key 返回同一个状态码 %d，这个响应证明不了鉴权生效", resp.StatusCode)
		}
		t.Logf("✅ 只有真 Key 被放过：伪造 Key 得到 401，真 Key 得到 %d", resp.StatusCode)
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

// decodeData 从 {"code":0,"message":"success","data":{...}} 这层信封里取出 data。
// 少了 data 就直接失败：管理面接口的响应结构一变，静默解析出零值会让
// 「设置是 false」和「响应里根本没有这个字段」长得一模一样。
func decodeData(t *testing.T, respBody []byte, out any, what string) {
	t.Helper()

	var envelope struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		t.Fatalf("解析 %s 响应失败: %v（body: %s）", what, err, string(respBody))
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		t.Fatalf("%s 响应里没有 data（body: %s）", what, string(respBody))
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		t.Fatalf("解析 %s 的 data 失败: %v（body: %s）", what, err, string(respBody))
	}
}

// loginToken 用给定凭据登录并取出 access_token。
func loginToken(t *testing.T, email, password string) string {
	t.Helper()

	payload, _ := json.Marshal(map[string]string{"email": email, "password": password})

	resp, err := doRequest(t, http.MethodPost, apiPrefix+"/auth/login", payload, "")
	if err != nil {
		t.Fatalf("登录请求失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("登录返回 HTTP %d: %s（邮箱 %s，路由 %s/auth/login，internal/server/routes/auth.go:38）",
			resp.StatusCode, string(respBody), email, apiPrefix)
	}

	return extractAccessToken(t, respBody)
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

	return loginToken(t, adminEmail, adminPassword)
}

// =============================================================================
// 管理面：把公开注册开关打开（注册用例的前置条件）
// =============================================================================

// adminToken 登录管理员账号，拿一个能进 /api/v1/admin/* 的会话。
//
// 这里故意不像 loginTestUser 那样回落到普通测试用户：改系统设置需要管理员角色，
// 回落到普通用户只会拿到 403，看日志的人分不清是「凭据没配」还是「接口坏了」。
func adminToken(t *testing.T) string {
	t.Helper()

	adminEmail := getEnv("ADMIN_EMAIL", "")
	adminPassword := getEnv("ADMIN_PASSWORD", "")
	if adminEmail == "" || adminPassword == "" {
		t.Fatalf("打开公开注册要用管理员会话（管理面在 internal/server/routes/admin.go:34 的 " +
			"adminAuth 之后），CI 必须传 ADMIN_EMAIL / ADMIN_PASSWORD——backend-ci.yml 的 " +
			"E2E against the running stack 步骤里有这两个变量")
	}

	return loginToken(t, adminEmail, adminPassword)
}

// adminComplianceView 只取签署部署合规承诺需要的字段。
type adminComplianceView struct {
	Required    bool   `json:"required"`
	Version     string `json:"version"`
	AckPhraseEN string `json:"ack_phrase_en"`
}

// readAdminCompliance 读管理面合规状态。
//
// 这一步不能省：/admin/* 上挂着 AdminComplianceGuard
// （internal/server/middleware/admin_compliance.go:12），管理员没签部署合规承诺时
// 所有管理端点一律 423，唯一放行的是 /admin/compliance 自己。
func readAdminCompliance(t *testing.T, token string) adminComplianceView {
	t.Helper()

	resp, err := doRequest(t, http.MethodGet, apiPrefix+"/admin/compliance", nil, token)
	if err != nil {
		t.Fatalf("读取管理面合规状态失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("读取管理面合规状态返回 HTTP %d: %s（GET %s/admin/compliance，这是 AdminComplianceGuard "+
			"唯一放行的路径，423 说明连这里也被锁了）", resp.StatusCode, string(respBody), apiPrefix)
	}

	var view adminComplianceView
	decodeData(t, respBody, &view, "GET "+apiPrefix+"/admin/compliance")
	return view
}

// acceptAdminCompliance 让管理员签下部署合规承诺（一次性 CI 栈，签完就不动它）。
//
// 确认短语从接口返回的 ack_phrase_en 里取，不把服务端常量抄进测试：抄一份就等于
// 硬编码了一个会漂的值，常量一改，失败信息只会变成莫名其妙的
// ADMIN_COMPLIANCE_INVALID_PHRASE。
func acceptAdminCompliance(t *testing.T, token string) {
	t.Helper()

	status := readAdminCompliance(t, token)
	if !status.Required {
		t.Logf("✅ 管理员已签过部署合规承诺（%s），管理面未锁", status.Version)
		return
	}

	phrase := strings.TrimSpace(status.AckPhraseEN)
	if phrase == "" {
		t.Fatalf("GET %s/admin/compliance 没返回 ack_phrase_en，没法签", apiPrefix)
	}

	payload, _ := json.Marshal(map[string]string{"phrase": phrase, "language": "en"})
	resp, err := doRequest(t, http.MethodPost, apiPrefix+"/admin/compliance/accept", payload, token)
	if err != nil {
		t.Fatalf("签署部署合规承诺请求失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("签署部署合规承诺返回 HTTP %d: %s（POST %s/admin/compliance/accept）",
			resp.StatusCode, string(respBody), apiPrefix)
	}

	if after := readAdminCompliance(t, token); after.Required {
		t.Fatalf("签署后 GET %s/admin/compliance 仍报 required=true，管理面还锁着，后面的设置写一定 423", apiPrefix)
	}
	t.Logf("✅ 用管理员会话签下部署合规承诺（%s）", status.Version)
}

// readRegistrationEnabled 从管理端读回公开注册开关。
func readRegistrationEnabled(t *testing.T, token string) bool {
	t.Helper()

	resp, err := doRequest(t, http.MethodGet, apiPrefix+"/admin/settings", nil, token)
	if err != nil {
		t.Fatalf("读取系统设置失败: %v", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("读取系统设置返回 HTTP %d: %s（GET %s/admin/settings；428/423 是管理面合规锁，"+
			"401/403 是管理员会话不可用）", resp.StatusCode, string(respBody), apiPrefix)
	}

	var view struct {
		RegistrationEnabled bool `json:"registration_enabled"`
	}
	decodeData(t, respBody, &view, "GET "+apiPrefix+"/admin/settings")
	return view.RegistrationEnabled
}

// openPublicRegistration 用管理员会话打开公开注册，读回确认，再验一次这个写接口
// 确实只对管理员开放。
//
// PUT /admin/settings 请求体里没出现的字段保持原值（服务端的
// omittedSettingKeys / UpdateSettingsWithAuthSourceDefaultsOmitting，
// internal/handler/admin/setting_handler_update.go:489），所以只发
// registration_enabled 不会把别的设置一起重置。副作用只有一个：管理面每次写入
// 落一条审计日志（admin 组的 auditLog 中间件），这个栈是一次性的，不还原。
func openPublicRegistration(t *testing.T) {
	t.Helper()

	token := adminToken(t)
	acceptAdminCompliance(t, token)

	if !readRegistrationEnabled(t, token) {
		payload, _ := json.Marshal(map[string]any{"registration_enabled": true})
		resp, err := doRequest(t, http.MethodPut, apiPrefix+"/admin/settings", payload, token)
		if err != nil {
			t.Fatalf("打开公开注册请求失败: %v", err)
		}
		defer resp.Body.Close()

		respBody, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("打开公开注册返回 HTTP %d: %s（PUT %s/admin/settings，body %s）",
				resp.StatusCode, string(respBody), apiPrefix, string(payload))
		}
	}

	// 读回一次才算数：PUT 的返回体只能证明它算过 true，读回才证明值落进了库、
	// 并且下一次请求真的读到了它。
	if !readRegistrationEnabled(t, token) {
		t.Fatalf("设置写入后读回 registration_enabled 仍是 false（GET %s/admin/settings），"+
			"注册一定还会是 403 REGISTRATION_DISABLED", apiPrefix)
	}

	// 对照：同一个写接口不带任何凭据必须被拒，拒完再读回还是 true。没有这条，
	// 「读回是 true」也可能只是因为这个接口对谁都放行。
	payload, _ := json.Marshal(map[string]any{"registration_enabled": false})
	resp, err := doRequest(t, http.MethodPut, apiPrefix+"/admin/settings", payload, "")
	if err != nil {
		t.Fatalf("无凭据写设置的对照请求失败: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode == http.StatusOK {
		t.Fatalf("不带凭据的 PUT %s/admin/settings 竟然返回 200——管理面没设防，"+
			"这条用例读回来的 registration_enabled 也就证明不了任何事", apiPrefix)
	}
	if !readRegistrationEnabled(t, token) {
		t.Fatalf("无凭据的写请求返回 HTTP %d 之后，registration_enabled 变了（读回 false）——"+
			"说明那次写入真的落库了，管理面的鉴权被绕过去了", resp.StatusCode)
	}

	t.Logf("✅ 公开注册已打开并读回确认；无凭据的同一写入被拒（HTTP %d，%s）",
		resp.StatusCode, strings.TrimSpace(string(respBody)))
}

// redactAPIKey API Key 脱敏，只显示前 8 位
func redactAPIKey(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 8 {
		return "***"
	}
	return key[:8] + "..."
}
