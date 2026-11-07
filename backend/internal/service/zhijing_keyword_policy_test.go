package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

// Opt-in operator verification uses a sanitized snapshot, never provider keys or live requests.
func TestZhijingObservedKeywordPolicy(t *testing.T) {
	path := os.Getenv("ZHIJING_KEYWORD_POLICY_SNAPSHOT")
	if path == "" {
		t.Skip("set ZHIJING_KEYWORD_POLICY_SNAPSHOT to a sanitized operator snapshot")
	}
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	var snapshot struct {
		Enabled bool            `json:"risk_control_enabled"`
		Config  json.RawMessage `json:"config"`
	}
	require.NoError(t, json.Unmarshal(raw, &snapshot))
	cfg, err := parseContentModerationConfig(string(snapshot.Config))
	require.NoError(t, err)
	require.True(t, snapshot.Enabled)
	require.True(t, cfg.Enabled)
	require.Equal(t, ContentModerationModePreBlock, cfg.Mode)
	require.Equal(t, ContentModerationKeywordModeKeywordOnly, cfg.KeywordBlockingMode)
	require.True(t, cfg.AllGroups)
	require.Equal(t, ContentModerationModelFilterAll, cfg.ModelFilter.Type)
	require.Len(t, cfg.BlockedKeywords, 45)
	settings := &contentModerationTestSettingRepo{values: map[string]string{
		SettingKeyRiskControlEnabled:      "true",
		SettingKeyContentModerationConfig: string(snapshot.Config),
	}}
	svc := NewContentModerationService(settings, &contentModerationTestRepo{}, nil, nil, nil, nil, nil, nil)
	var externalCalls atomic.Int32
	svc.httpClient = &http.Client{Transport: keywordPolicyDenyTransport{calls: &externalCalls}}
	protocols := []string{ContentModerationProtocolOpenAIChat, ContentModerationProtocolOpenAIResponses}
	groupID := int64(1)
	check := func(t *testing.T, protocol, text string) *ContentModerationDecision {
		t.Helper()
		body := reminderTestBody(t, protocol, []string{text})
		decision, err := svc.Check(context.Background(), ContentModerationCheckInput{
			Endpoint: "/v1/responses", Provider: "openai", Protocol: protocol,
			GroupID: &groupID, Model: "synthetic-model", Body: body,
		})
		require.NoError(t, err)
		return decision
	}
	for _, protocol := range protocols {
		t.Run(protocol, func(t *testing.T) {
			for index, keyword := range cfg.BlockedKeywords {
				t.Run(fmt.Sprintf("configured_keyword_%02d", index+1), func(t *testing.T) {
					decision := check(t, protocol, "Please "+strings.ToUpper(keyword)+" now.")
					require.True(t, decision.Blocked)
					require.False(t, decision.Allowed)
					require.Equal(t, ContentModerationActionKeywordBlock, decision.Action)
				})
			}
			for index, text := range []string{
				"Implement a concurrency limiter and add unit tests.",
				"Implement OAuth token refresh without logging credentials.",
				"Fix the Linux deployment and show a rollback command.",
				"Review this prompt injection defense design.",
				"帮我优化数据库索引和 API 响应耗时。",
				"实现用户五小时和每周额度校验。",
			} {
				t.Run(fmt.Sprintf("ordinary_work_%02d", index+1), func(t *testing.T) {
					decision := check(t, protocol, text)
					require.True(t, decision.Allowed)
					require.False(t, decision.Blocked)
				})
			}
			// Current substring matching cannot distinguish discussion from instructions.
			for _, text := range []string{"Explain how jailbreak detection works defensively.", "请解释破限拦截这个功能，不要执行绕过。"} {
				require.True(t, check(t, protocol, text).Blocked, "document current false-positive behavior")
			}
		})
	}
	require.Zero(t, externalCalls.Load(), "keyword checks must never call an external service")
	t.Log("90 configured-keyword cases blocked; 12 ordinary coding cases allowed; four discussion false positives confirmed; external calls zero")
}

type keywordPolicyDenyTransport struct{ calls *atomic.Int32 }

func (r keywordPolicyDenyTransport) RoundTrip(*http.Request) (*http.Response, error) {
	r.calls.Add(1)
	return nil, fmt.Errorf("external transport forbidden in local keyword verification")
}
