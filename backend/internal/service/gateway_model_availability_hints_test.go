package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func modelHintAccount(platform string, mapping map[string]string) *Account {
	creds := make(map[string]any, 1)
	if len(mapping) > 0 {
		list := make(map[string]any, len(mapping))
		for from, to := range mapping {
			list[from] = to
		}
		creds["model_mapping"] = list
	}
	return &Account{Platform: platform, Credentials: creds}
}

func TestRecordAvailableModels_DedupesAndSorts(t *testing.T) {
	diag := ModelAvailabilityDiagnosis{HasAccountsInPool: true}
	recordAvailableModels(&diag, modelHintAccount(PlatformOpenAI, map[string]string{
		"gpt-6.2-sol": "gpt-6.2-sol",
		"gpt-6.1-sol": "gpt-6.1-sol",
	}), PlatformOpenAI)
	recordAvailableModels(&diag, modelHintAccount(PlatformOpenAI, map[string]string{
		"Gpt-6.2-sol": "gpt-6.2-sol", // 大小写重复项
		"codex-auto-review": "codex-auto-review",
	}), PlatformOpenAI)

	finalizeAvailableModels(&diag)

	require.Equal(t, []string{"codex-auto-review", "gpt-6.1-sol", "gpt-6.2-sol"}, diag.AvailableModels)
	require.False(t, diag.HasModelSupport)
}

func TestRecordAvailableModels_EmptyMappingContributesNothing(t *testing.T) {
	diag := ModelAvailabilityDiagnosis{HasAccountsInPool: true}
	recordAvailableModels(&diag, modelHintAccount(PlatformOpenAI, nil), PlatformOpenAI)
	finalizeAvailableModels(&diag)

	require.Empty(t, diag.AvailableModels)
}

func TestRecordAvailableModels_SkipsForeignPlatformModels(t *testing.T) {
	diag := ModelAvailabilityDiagnosis{HasAccountsInPool: true}
	// 混合调度：antigravity 账号进入 gemini 分组的候选池，但它声明的 claude-*
	// 不出现在 gemini 的 404 提示里（与模型列表接口同一规则）。antigravity 账号
	// 还会带上平台默认的 gemini-* 映射，这些属于 gemini 分组，可以出现。
	recordAvailableModels(&diag, modelHintAccount(PlatformAntigravity, map[string]string{
		"claude-sonnet-4-6": "claude-sonnet-4-6",
		"gemini-3-flash":    "gemini-3-flash",
	}), PlatformGemini)

	finalizeAvailableModels(&diag)

	require.Contains(t, diag.AvailableModels, "gemini-3-flash")
	require.NotContains(t, diag.AvailableModels, "claude-sonnet-4-6")
}

func TestFinalizeAvailableModels_TruncatesToHintCap(t *testing.T) {
	mapping := make(map[string]string, maxModelAvailabilityHints+3)
	for i := 0; i < maxModelAvailabilityHints+3; i++ {
		name := "model-" + string(rune('a'+i))
		mapping[name] = name
	}
	diag := ModelAvailabilityDiagnosis{HasAccountsInPool: true}
	recordAvailableModels(&diag, modelHintAccount(PlatformOpenAI, mapping), PlatformOpenAI)

	finalizeAvailableModels(&diag)

	require.Len(t, diag.AvailableModels, maxModelAvailabilityHints)
	require.Equal(t, "model-a", diag.AvailableModels[0])
}

func TestFinalizeAvailableModels_NoopOnEmpty(t *testing.T) {
	diag := ModelAvailabilityDiagnosis{HasAccountsInPool: true}
	finalizeAvailableModels(&diag)
	require.Nil(t, diag.AvailableModels)

	finalizeAvailableModels(nil) // 防御性：nil 指针不应 panic
}
