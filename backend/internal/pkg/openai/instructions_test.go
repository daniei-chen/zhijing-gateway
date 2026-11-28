package openai

import (
	"strings"
	"testing"
)

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// codexInstructionFileForTest 取内置模板全文，模板为空或未注册时直接失败。
// 断言按文件名比对，不经映射表，避免表和断言一起错。
func codexInstructionFileForTest(t *testing.T, name string) string {
	t.Helper()
	instructions := codexInstructionFile(name)
	if strings.TrimSpace(instructions) == "" {
		t.Fatalf("内置模板 %q 未注册或为空", name)
	}
	return instructions
}

// TestCodexBaseInstructionsForModel 断言每个已知模型 id 拿到映射表里那份模板，
// 且内容与模板逐字节相同（返回值不做首尾裁剪）。
func TestCodexBaseInstructionsForModel(t *testing.T) {
	cases := []struct {
		model    string
		template string
	}{
		// DefaultModels 里的对外文本模型。
		{"gpt-5.6-sol", "instructions_gpt5_5.txt"},
		{"gpt-6", "instructions_gpt6_astra.txt"},
		{"gpt-5.6", "instructions_gpt5_5.txt"},
		{"gpt-5.6-terra", "instructions_gpt5_5.txt"},
		{"gpt-5.6-luna", "instructions_gpt5_5.txt"},
		{"gpt-6.2-sol", "codex_gpt62_sol.json"},
		{"gpt-6.2-astra", "codex_gpt62_astra.json"},
		{"gpt-6.1-terra", "codex_gpt61_terra.json"},
		{"gpt-6.1-sol", "codex_gpt61_sol.json"},
		{"gpt-6-sol", "instructions_gpt5_5.txt"},
		{"gpt-6-luna", "instructions_gpt5_5.txt"},
		{"gpt-6-astra", "instructions_gpt6_astra.txt"},
		{"gpt-5.5", "instructions_gpt5_5.txt"},
		{"gpt-5.4", "instructions_gpt5_5.txt"},
		{"gpt-5.4-mini", "instructions_gpt5_5.txt"},
		{"gpt-5.3-codex-spark", "instructions.txt"},
		{"codex-auto-review", "instructions.txt"},
		{"gpt-5.2", "instructions_gpt5_2.txt"},
		// codex 系别名：含 "codex" 一律走 GPT-5-Codex 模板。
		{"gpt-5-codex", "instructions.txt"},
		{"gpt-5.3-codex", "instructions.txt"},
		{"gpt-5.1-codex-max", "instructions.txt"},
		{"gpt-5.2-codex", "instructions.txt"},
		// 供应商前缀、大小写、空格与 effort/compact 后缀。
		{"openai/gpt-6-astra", "instructions_gpt6_astra.txt"},
		{"OPENAI/GPT-6_ASTRA", "instructions_gpt6_astra.txt"},
		{"gpt-6-astra-2026-09-01", "instructions_gpt6_astra.txt"},
		{" GPT-5.5 ", "instructions_gpt5_5.txt"},
		{"gpt-6.2-sol-high", "codex_gpt62_sol.json"},
		{"gpt-6.1-sol-high", "codex_gpt61_sol.json"},
		{"gpt-6-sol-none", "instructions_gpt5_5.txt"},
		{"gpt-5.6-sol-openai-compact", "instructions_gpt5_5.txt"},
		// 无专用模板的旧模型与未知模型走默认行。
		{"gpt-5.1", "instructions_gpt5_1.txt"},
		{"gpt-5.3", "instructions_gpt5_5.txt"},
		{"gpt-5", "instructions_gpt5_5.txt"},
		{"gpt-5-nano", "instructions_gpt5_5.txt"},
		{"some-unknown-model", "instructions_gpt5_5.txt"},
		{"", "instructions_gpt5_5.txt"},
	}
	for _, tc := range cases {
		want := codexInstructionFileForTest(t, tc.template)
		got := CodexBaseInstructionsForModel(tc.model)
		if got != want {
			t.Errorf("model %q 应拿到 %s，实际 %d 字节（首行 %q）", tc.model, tc.template, len(got), firstLine(got))
		}
	}
}

// TestCodexInstructionsTableCoversRoutableModels 断言映射表覆盖 DefaultModels 里
// 所有对外可路由的文本模型：新增模型名而表里没有对应行，这条会失败。
func TestCodexInstructionsTableCoversRoutableModels(t *testing.T) {
	for _, model := range DefaultModels {
		// 图像模型不进 Codex manifest（isCodexDedicatedMediaModel 会过滤），不需要 base prompt。
		if strings.HasPrefix(model.ID, "gpt-image") {
			continue
		}
		canonical := CanonicalizeOpenAIModelAliasSpelling(model.ID)
		var row *codexInstructionsRow
		for i := range codexInstructionsTable {
			if codexInstructionsTable[i].Matches(canonical) {
				row = &codexInstructionsTable[i]
				break
			}
		}
		if row == nil {
			t.Errorf("模型 %q 在 codexInstructionsTable 里没有对应行", model.ID)
			continue
		}
		if row.Source == "" {
			t.Errorf("模型 %q 的映射行 %q 没有来源", model.ID, row.Model)
		}
		if strings.TrimSpace(codexInstructionFile(row.Template)) == "" {
			t.Errorf("模型 %q 的映射行 %q 指向未注册或为空的模板 %q", model.ID, row.Model, row.Template)
		}
	}
}

// TestCodexInstructionsTableEntriesResolve 断言每行自身完整：有模型名、匹配器、
// 来源，且模板能解析。
func TestCodexInstructionsTableEntriesResolve(t *testing.T) {
	for _, row := range codexInstructionsTable {
		if row.Model == "" || row.Matches == nil || row.Source == "" {
			t.Errorf("映射行不完整：%+v", row)
			continue
		}
		if strings.TrimSpace(codexInstructionFile(row.Template)) == "" {
			t.Errorf("映射行 %q 指向未注册或为空的模板 %q", row.Model, row.Template)
		}
	}
}
