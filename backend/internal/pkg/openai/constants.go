// Package openai provides helpers and types for OpenAI API integration.
package openai

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// Model represents an OpenAI model
type Model struct {
	ID          string `json:"id"`
	Object      string `json:"object"`
	Created     int64  `json:"created"`
	OwnedBy     string `json:"owned_by"`
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
}

// DefaultModels OpenAI models list
var DefaultModels = []Model{
	{ID: "gpt-5.6-sol", Object: "model", Created: 1780876800, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.6 Sol"},
	{ID: "gpt-6", Object: "model", Created: 1788480000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6 (Astra)"},
	{ID: "gpt-5.6", Object: "model", Created: 1780876800, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.6 (Sol)"},
	{ID: "gpt-5.6-terra", Object: "model", Created: 1780876800, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.6 Terra"},
	{ID: "gpt-5.6-luna", Object: "model", Created: 1780876800, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.6 Luna"},
	{ID: "gpt-6.2-sol", Object: "model", Created: 1794873600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6.2 Sol"},
	{ID: "gpt-6.2-astra", Object: "model", Created: 1794873600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6.2 Astra"},
	{ID: "gpt-6.1-terra", Object: "model", Created: 1792972800, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6.1 Terra"},
	{ID: "gpt-6.1-sol", Object: "model", Created: 1790640000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6.1 Sol"},
	{ID: "gpt-6-sol", Object: "model", Created: 1790035200, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6 Sol"},
	{ID: "gpt-6-luna", Object: "model", Created: 1790035200, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6 Luna"},
	{ID: "gpt-6-astra", Object: "model", Created: 1788480000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-6 Astra"},
	{ID: "gpt-5.5", Object: "model", Created: 1776873600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.5"},
	{ID: "gpt-5.4", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.4"},
	{ID: "gpt-5.4-mini", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.4 Mini"},
	{ID: "gpt-5.3-codex-spark", Object: "model", Created: 1735689600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.3 Codex Spark"},
	{ID: "codex-auto-review", Object: "model", Created: 1776902400, OwnedBy: "openai", Type: "model", DisplayName: "Codex Auto Review"},
	{ID: "gpt-5.2", Object: "model", Created: 1733875200, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.2"},
	{ID: "gpt-image-1", Object: "model", Created: 1733875200, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 1"},
	{ID: "gpt-image-1.5", Object: "model", Created: 1735689600, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 1.5"},
	{ID: "gpt-image-2", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2"},
	{ID: "gpt-image-2.5-flare", Object: "model", Created: 1788825600, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2.5 Flare"},
	{ID: "gpt-image-2.5-sunburst", Object: "model", Created: 1788825600, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2.5 Sunburst"},
	{ID: "gpt-image-2.6-flare", Object: "model", Created: 1793750400, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2.6 Flare"},
	{ID: "gpt-image-2.6-sunburst", Object: "model", Created: 1793750400, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2.6 Sunburst"},
}

// DefaultModelIDs returns the default model ID list
func DefaultModelIDs() []string {
	ids := make([]string, len(DefaultModels))
	for i, m := range DefaultModels {
		ids[i] = m.ID
	}
	return ids
}

// DefaultTestModel default model for testing OpenAI accounts
const DefaultTestModel = "gpt-5.4"

// CodexUsageProbeModel is the model used for OAuth Codex usage probes.
const CodexUsageProbeModel = "codex-auto-review"

// DefaultInstructions default instructions for non-Codex CLI requests.
// 内容为真实 Codex CLI 的 GPT-5-Codex base prompt（codex 系模型默认）。
//
//go:embed instructions.txt
var DefaultInstructions string

// instructionsGPT51 / instructionsGPT52 / instructionsGPT55 / instructionsGPT6Astra /
// instructionsGPT56 / instructionsGPT6Sol / instructionsGPT6Luna
// 为对应模型的真实 Codex 编码 agent base prompt，用于模型感知的 instructions 选择。
// GPT-5.5 同时作为没有专属 prompt 的 GPT-5 系列的 fallback（覆盖 5.3 / 5.4 等）。
//
//go:embed instructions_gpt5_1.txt
var instructionsGPT51 string

//go:embed instructions_gpt5_2.txt
var instructionsGPT52 string

//go:embed instructions_gpt5_5.txt
var instructionsGPT55 string

// Source: openai/codex codex-rs/models-manager/models.json at 121f91fd5d9d.
//
//go:embed instructions_gpt6_astra.txt
var instructionsGPT6Astra string

// instructionsGPT56 / instructionsGPT6Sol / instructionsGPT6Luna 三份文件逐字节取自
// 上游 c5622ce6c（Codex v0.172.0 内置提示词同步），未做任何改动。
//
//go:embed instructions_gpt5_6.txt
var instructionsGPT56 string

//go:embed instructions_gpt6_sol.txt
var instructionsGPT6Sol string

//go:embed instructions_gpt6_luna.txt
var instructionsGPT6Luna string

// GPT-6.2 descriptors from the 2026-11-17 Codex models response, client 0.169.0.
//
//go:embed codex_gpt62_sol.json
var CodexGPT62SolMetadata []byte

//go:embed codex_gpt62_astra.json
var CodexGPT62AstraMetadata []byte

// CodexGPT61SolMetadata is the complete official descriptor from openai/codex
// b1e72963c3b71a9265a551e54beff078384efed9, codex-rs/models-manager/models.json.
//
//go:embed codex_gpt61_sol.json
var CodexGPT61SolMetadata []byte

// CodexGPT61TerraMetadata is the complete official descriptor from openai/codex
// 126a0ee92ed2c5e73cd8a8f7e37563e8527552d7, codex-rs/models-manager/models.json.
//
//go:embed codex_gpt61_terra.json
var CodexGPT61TerraMetadata []byte

// codexInstructionsTemplate returns the base prompt bundled in an official
// Codex model descriptor.
func codexInstructionsTemplate(descriptor []byte) string {
	var metadata struct {
		ModelMessages struct {
			InstructionsTemplate string `json:"instructions_template"`
		} `json:"model_messages"`
	}
	if err := json.Unmarshal(descriptor, &metadata); err != nil {
		panic(err)
	}
	return metadata.ModelMessages.InstructionsTemplate
}

// latestCodexInstructions 返回当前已知最新版本的 Codex base instructions，
// 当前为 GPT-5.5；若 5.5 prompt 意外为空则回退到 DefaultInstructions 保证非空。
func latestCodexInstructions() string {
	if v := strings.TrimSpace(instructionsGPT55); v != "" {
		return instructionsGPT55
	}
	return DefaultInstructions
}

// CanonicalizeOpenAIModelAliasSpelling normalizes provider prefixes, case,
// separators, and known compact spellings used by OpenAI model aliases.
func CanonicalizeOpenAIModelAliasSpelling(model string) string {
	model = strings.TrimSpace(model)
	if slash := strings.LastIndexByte(model, '/'); slash >= 0 {
		model = strings.TrimSpace(model[slash+1:])
	}
	model = strings.ToLower(model)
	if model == "" {
		return ""
	}

	normalized := strings.ReplaceAll(model, "_", "-")
	normalized = strings.Join(strings.Fields(normalized), "-")
	for strings.Contains(normalized, "--") {
		normalized = strings.ReplaceAll(normalized, "--", "-")
	}

	if strings.HasPrefix(normalized, "gpt5") {
		normalized = "gpt-5" + strings.TrimPrefix(normalized, "gpt5")
	}
	if !strings.HasPrefix(normalized, "gpt-") && !strings.Contains(normalized, "codex") {
		return ""
	}

	replacements := []struct {
		from string
		to   string
	}{
		{"gpt-5.4mini", "gpt-5.4-mini"},
		{"gpt-5.4nano", "gpt-5.4-nano"},
		{"gpt-5.3-codexspark", "gpt-5.3-codex-spark"},
		{"gpt-5.3codexspark", "gpt-5.3-codex-spark"},
		{"gpt-5.3codex", "gpt-5.3-codex"},
	}
	for _, replacement := range replacements {
		normalized = strings.ReplaceAll(normalized, replacement.from, replacement.to)
	}
	return normalized
}

// codexInstructionsRow 是「模型 → 模板文件」的一行：Matches 命中时，该模型拿
// Template 指向的内置模板。
type codexInstructionsRow struct {
	// Model 是这一行负责的模型族，用于阅读与测试报错。
	Model string
	// Matches 判断规范化后的模型 id 是否属于这一行。
	Matches func(canonical string) bool
	// Template 是内置模板文件名，由 codexInstructionFile 解析。
	Template string
	// Source 记这一行映射的依据：上游提交 + 行号，或 main 上的现行为。
	Source string
}

// codexInstructionsTable 是模型 → base instructions 模板的显式映射表，按顺序
// 首个命中生效。表里没有的模型回退到 latestCodexInstructions()。
//
// 这张表只登记既有行为，不引入新模板：
//   - gpt-5.6 / gpt-6-sol / gpt-6-luna 在 main 上没有任何专属分支，走默认回退
//     （GPT-5.5 模板）。表里把它们显式写出来，避免「回退」看起来像漏配；
//     上游 c5622ce6c 有这三份专属模板，移植在单独 PR 里做。
//   - gpt-5.4 / gpt-5.3 / 裸 gpt-5 / 未知模型同样回退到 GPT-5.5 模板。
var codexInstructionsTable = []codexInstructionsRow{
	{
		Model:    "gpt-6.2-sol",
		Matches:  func(canonical string) bool { return GPT62ModelID(canonical) == "gpt-6.2-sol" },
		Template: "codex_gpt62_sol.json",
		Source:   "c5622ce6c:193-194（上游 Wei-Shaw/sub2api）；描述符见 6107cf174",
	},
	{
		Model:    "gpt-6.2-astra",
		Matches:  func(canonical string) bool { return GPT62ModelID(canonical) == "gpt-6.2-astra" },
		Template: "codex_gpt62_astra.json",
		Source:   "c5622ce6c:195-196（上游 Wei-Shaw/sub2api）；描述符见 6107cf174",
	},
	{
		Model:    "gpt-6.1-sol",
		Matches:  IsGPT61SolModelSpelling,
		Template: "codex_gpt61_sol.json",
		Source:   "c5622ce6c:197-198：6.1 Sol 取官方描述符的 instructions_template",
	},
	{
		Model:    "gpt-6.1-terra",
		Matches:  IsGPT61TerraModelSpelling,
		Template: "codex_gpt61_terra.json",
		Source:   "c5622ce6c:199-200：6.1 Terra 取官方描述符的 instructions_template",
	},
	{
		Model: "gpt-6 / gpt-6-astra",
		Matches: func(canonical string) bool {
			return canonical == "gpt-6" || canonical == "gpt-6-astra" || strings.HasPrefix(canonical, "gpt-6-astra-")
		},
		Template: "instructions_gpt6_astra.txt",
		Source:   "c5622ce6c:212-215：gpt-6 是 Astra 的公开别名，含日期变体",
	},
	{
		Model:    "codex",
		Matches:  func(canonical string) bool { return strings.Contains(canonical, "codex") },
		Template: "instructions.txt",
		Source:   "c5622ce6c:216-217：codex 系模型用 GPT-5-Codex base prompt",
	},
	{
		Model:    "gpt-5.6",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.6") },
		Template: "instructions_gpt5_6.txt",
		Source:   "c5622ce6c:218-221：5.6 系（含 sol/terra/luna）用 instructions_gpt5_6.txt",
	},
	{
		Model: "gpt-6-luna",
		Matches: func(canonical string) bool {
			return strings.HasPrefix(canonical, "gpt-6-luna") && IsGPT6SolOrLunaModelSpelling(canonical)
		},
		Template: "instructions_gpt6_luna.txt",
		Source:   "c5622ce6c:201-210：6 Luna 用 instructions_gpt6_luna.txt",
	},
	{
		Model: "gpt-6-sol",
		Matches: func(canonical string) bool {
			return !strings.HasPrefix(canonical, "gpt-6-luna") && IsGPT6SolOrLunaModelSpelling(canonical)
		},
		Template: "instructions_gpt6_sol.txt",
		Source:   "c5622ce6c:201-210：6 Sol 用 instructions_gpt6_sol.txt",
	},
	{
		Model:    "gpt-5.5",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.5") },
		Template: "instructions_gpt5_5.txt",
		Source:   "c5622ce6c:222-223：5.5 系用 instructions_gpt5_5.txt",
	},
	{
		Model:    "gpt-5.2",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.2") },
		Template: "instructions_gpt5_2.txt",
		Source:   "c5622ce6c:224-227：5.2 系用 instructions_gpt5_2.txt",
	},
	{
		Model:    "gpt-5.1",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.1") },
		Template: "instructions_gpt5_1.txt",
		Source:   "c5622ce6c:228-231：5.1 系用 instructions_gpt5_1.txt",
	},
	{
		Model:    "gpt-5.4",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.4") },
		Template: "instructions_gpt5_5.txt",
		Source:   "c5622ce6c:233：5.4 无专用模板，上游同样回落到 GPT-5.5",
	},
	{
		Model:    "gpt-5.3",
		Matches:  func(canonical string) bool { return strings.HasPrefix(canonical, "gpt-5.3") },
		Template: "instructions_gpt5_5.txt",
		Source:   "c5622ce6c:233：5.3 无专用模板，上游同样回落到 GPT-5.5",
	},
	{
		Model: "gpt-5",
		Matches: func(canonical string) bool {
			return canonical == "gpt-5" || strings.HasPrefix(canonical, "gpt-5-")
		},
		Template: "instructions_gpt5_5.txt",
		Source:   "c5622ce6c:233：裸 gpt-5 / gpt-5-mini / gpt-5-nano 无专用模板，回落 GPT-5.5",
	},
}

// codexInstructionFile 把模板文件名解析成内置模板全文；未注册的名字返回空串。
func codexInstructionFile(name string) string {
	switch name {
	case "instructions.txt":
		return DefaultInstructions
	case "instructions_gpt5_1.txt":
		return instructionsGPT51
	case "instructions_gpt5_2.txt":
		return instructionsGPT52
	case "instructions_gpt5_5.txt":
		return instructionsGPT55
	case "instructions_gpt5_6.txt":
		return instructionsGPT56
	case "instructions_gpt6_astra.txt":
		return instructionsGPT6Astra
	case "instructions_gpt6_sol.txt":
		return instructionsGPT6Sol
	case "instructions_gpt6_luna.txt":
		return instructionsGPT6Luna
	case "codex_gpt61_sol.json":
		return codexInstructionsTemplate(CodexGPT61SolMetadata)
	case "codex_gpt61_terra.json":
		return codexInstructionsTemplate(CodexGPT61TerraMetadata)
	case "codex_gpt62_sol.json":
		return codexInstructionsTemplate(CodexGPT62SolMetadata)
	case "codex_gpt62_astra.json":
		return codexInstructionsTemplate(CodexGPT62AstraMetadata)
	}
	return ""
}

// CodexBaseInstructionsForModel 按模型返回最匹配的真实 Codex base instructions。
// 映射关系见 codexInstructionsTable：表里首个命中的行决定模板，表里没有的模型
// 回退到 latestCodexInstructions()。返回值是模板原文，不裁剪首尾空白；只有空值
// 检查用 TrimSpace，避免把模板末尾的换行（如 CRLF）削掉。
func CodexBaseInstructionsForModel(model string) string {
	canonical := CanonicalizeOpenAIModelAliasSpelling(model)
	for _, row := range codexInstructionsTable {
		if !row.Matches(canonical) {
			continue
		}
		instructions := codexInstructionFile(row.Template)
		if strings.TrimSpace(instructions) != "" {
			return instructions
		}
		break
	}
	return latestCodexInstructions()
}

// IsGPT6SolOrLunaModelSpelling recognizes official IDs and existing local effort/compact suffixes.
func IsGPT6SolOrLunaModelSpelling(model string) bool {
	canonical := CanonicalizeOpenAIModelAliasSpelling(model)
	for _, base := range []string{"gpt-6-sol", "gpt-6-luna"} {
		if canonical == base {
			return true
		}
		suffix, ok := strings.CutPrefix(canonical, base+"-")
		if ok {
			switch suffix {
			case "none", "low", "medium", "high", "xhigh", "max", "openai-compact":
				return true
			}
		}
	}
	return false
}

// GPT62ModelID returns the published model ID for local effort and compact
// spellings. Keep disabled effort suffixes identifiable for request validation.
func GPT62ModelID(model string) string {
	canonical := CanonicalizeOpenAIModelAliasSpelling(model)
	for _, base := range []string{"gpt-6.2-sol", "gpt-6.2-astra"} {
		if canonical == base {
			return base
		}
		suffix, ok := strings.CutPrefix(canonical, base+"-")
		if ok {
			switch suffix {
			case "none", "minimal", "low", "medium", "high", "xhigh", "max", "openai-compact":
				return base
			}
		}
	}
	return ""
}

// IsGPT61SolModelSpelling recognizes the published model and local effort/compact
// spellings. Invalid effort suffixes remain identifiable for request validation.
func IsGPT61SolModelSpelling(model string) bool {
	canonical := CanonicalizeOpenAIModelAliasSpelling(model)
	if canonical == "gpt-6.1-sol" {
		return true
	}
	suffix, ok := strings.CutPrefix(canonical, "gpt-6.1-sol-")
	if !ok {
		return false
	}
	switch suffix {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max", "openai-compact":
		return true
	default:
		return false
	}
}

// IsGPT61TerraModelSpelling recognizes the published model and local effort/compact
// spellings. Invalid effort suffixes remain identifiable for request validation.
func IsGPT61TerraModelSpelling(model string) bool {
	canonical := CanonicalizeOpenAIModelAliasSpelling(model)
	if canonical == "gpt-6.1-terra" {
		return true
	}
	suffix, ok := strings.CutPrefix(canonical, "gpt-6.1-terra-")
	if !ok {
		return false
	}
	switch suffix {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max", "openai-compact":
		return true
	default:
		return false
	}
}

// RequiresResponsesForToolCalls reports models whose tool calls are only
// available through the Responses API.
func RequiresResponsesForToolCalls(model string) bool {
	return GPT62ModelID(model) != "" || IsGPT61SolModelSpelling(model) || IsGPT61TerraModelSpelling(model)
}

// ValidateGPT61SolReasoningEffort rejects disabled reasoning instead of silently
// increasing the client's requested effort on compatibility paths.
func ValidateGPT61SolReasoningEffort(model, effort string) error {
	if IsGPT61SolModelSpelling(model) {
		switch strings.ToLower(strings.TrimSpace(effort)) {
		case "none", "minimal":
			return fmt.Errorf("gpt-6.1-sol does not support reasoning effort %q; use low, medium, high, xhigh or max", effort)
		}
	}
	return nil
}

// ValidateGPT61TerraReasoningEffort rejects the unpublished minimal level;
// GPT-6.1 Terra accepts none through max.
func ValidateGPT61TerraReasoningEffort(model, effort string) error {
	if IsGPT61TerraModelSpelling(model) && strings.EqualFold(strings.TrimSpace(effort), "minimal") {
		return fmt.Errorf("gpt-6.1-terra does not support reasoning effort %q; use none, low, medium, high, xhigh or max", effort)
	}
	return nil
}

// ValidateGPT61ReasoningEffort applies the published effort scale of each
// GPT-6.1 and GPT-6.2 model.
func ValidateGPT61ReasoningEffort(model, effort string) error {
	if err := ValidateGPT62ReasoningEffort(model, effort); err != nil {
		return err
	}
	if err := ValidateGPT61SolReasoningEffort(model, effort); err != nil {
		return err
	}
	return ValidateGPT61TerraReasoningEffort(model, effort)
}

// ValidateGPT62ReasoningEffort rejects disabled and minimal reasoning on GPT-6.2.
func ValidateGPT62ReasoningEffort(model, effort string) error {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "none", "minimal":
		if base := GPT62ModelID(model); base != "" {
			return fmt.Errorf("%s does not support reasoning effort %q; use low, medium, high, xhigh or max", base, effort)
		}
	}
	return nil
}
