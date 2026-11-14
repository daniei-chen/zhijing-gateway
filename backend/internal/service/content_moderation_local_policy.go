package service

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	infraerrors "github.com/daniei-chen/zhijing-gateway/internal/pkg/errors"
	"golang.org/x/text/unicode/norm"
)

const ContentModerationLocalPolicyGatewayV1 = "gateway_safety_v1"

type gatewayLocalPolicyFinding struct {
	RuleID   string
	Category string
}

var gatewayPolicyMinor = regexp.MustCompile(`未成年|幼女|幼男|儿童|小学生|初中生|萝莉|正太|(?:^|[^0-9])(?:[0-9]|1[0-7])\s*(?:岁|歳)|\b(?:child|children|minors?|underage|preteen|loli|shota)\b|\b(?:[0-9]|1[0-7])\s*(?:year[ -]?old|years old|yo\b)`)
var gatewayPolicySexual = regexp.MustCompile(`性行为|色情|性交|做爱|性描写|性角色扮演|露骨|性爱|\b(?:sexual|sex|erotic|porn|explicit sexual|nsfw)\b`)
var gatewayPolicyCreativeRequest = regexp.MustCompile(`(?:请|帮我|给我|我要|要求|继续|开始|现在|你来).{0,60}(?:写|生成|创作|扮演|描写|描述|进行|角色扮演)|^(?:写|生成|创作|扮演|描写)|\b(?:write|generate|create|describe|continue|roleplay|role-play|pretend|act as|play as)\b`)
var gatewayPolicyNuclear = regexp.MustCompile(`核武器|原子弹|氢弹|\b(?:nuclear (?:weapon|bomb)|atomic bomb|hydrogen bomb)s?\b`)
var gatewayPolicyNuclearAction = regexp.MustCompile(`(?:教我|指导我|告诉我|给我|帮我|请|我要|如何|怎么).{0,35}(?:制作|制造|组装|设计|建造)(?:一个|一枚|简单的|小型的|详细的|自制的|自己的|的)?(?:核武器|原子弹|氢弹)|(?:给我|提供|写出|列出|教我|帮我).{0,15}(?:核武器|原子弹|氢弹).{0,15}(?:制作|制造|组装|设计|建造|步骤|教程|材料清单)|(?:核武器|原子弹|氢弹).{0,8}(?:制作|制造|组装|设计|建造).{0,10}(?:步骤|教程|详细方案|材料清单)|\b(?:how (?:to|do i)|teach me|tell me|help me|give me|provide|write)\b.{0,45}\b(?:build|make|construct|assemble|manufactur\w*|design)\s+(?:(?:a|an|the|small|simple|homemade)\s+)*(?:nuclear (?:weapon|bomb)|atomic bomb|hydrogen bomb)s?\b|\b(?:give me|provide|write)\b.{0,25}\b(?:instructions|steps|blueprints?|materials)\b.{0,35}\b(?:nuclear (?:weapon|bomb)|atomic bomb|hydrogen bomb)s?\b`)
var gatewayPolicyReverse = regexp.MustCompile(`逆向|反编译|破解|脱壳|\breverse[ -]?engineer\w*\b|\bdecompil\w*\b|\bcrack(?:ing)?\b`)
var gatewayPolicyReverseRequest = regexp.MustCompile(`(?:帮我|教我|给我|请|我要|怎么|如何|指导我).{0,70}(?:逆向|反编译|破解|脱壳)|(?:逆向|反编译|破解|脱壳).{0,40}(?:教程|步骤|脚本|工具|方案)|\b(?:please|help me|teach me|how (?:to|do i)|write|give me|provide)\b.{0,100}(?:reverse[ -]?engineer\w*|decompil\w*|crack(?:ing)?)`)
var gatewayPolicyLicenseBypass = regexp.MustCompile(`(?:帮我|教我|请|怎么|如何|给我).{0,70}(?:绕过|移除|去掉).{0,30}(?:授权校验|许可证校验|付费验证|license)|\b(?:help me|how (?:to|do i)|please|write)\b.{0,100}\b(?:bypass|remove|disable)\b.{0,50}\b(?:license|licensing|activation|drm)\b`)

var gatewayPolicyMinorAnchors = []string{"未成年", "幼女", "幼男", "儿童", "小学生", "初中生", "萝莉", "正太", "岁", "歳", "child", "minor", "underage", "preteen", "loli", "shota", "year", "yo"}
var gatewayPolicyNuclearAnchors = []string{"核武器", "原子弹", "氢弹", "nuclear weapon", "nuclear bomb", "atomic bomb", "hydrogen bomb"}
var gatewayPolicyReverseAnchors = []string{"逆向", "反编译", "破解", "脱壳", "reverse engineer", "reverse-engineer", "decompil", "crack", "license", "licensing", "activation", "drm", "授权校验", "许可证校验", "付费验证"}

func validateContentModerationLocalPolicy(profile string) error {
	if profile != "" && profile != ContentModerationLocalPolicyGatewayV1 {
		return infraerrors.BadRequest("INVALID_CONTENT_MODERATION_LOCAL_POLICY", "unknown local moderation policy profile")
	}
	return nil
}

// This opt-in, bounded rule layer is not a semantic classifier. Engineering
// words, quotation marks and claimed authorization never exempt other findings.
func matchGatewayLocalPolicy(text string) *gatewayLocalPolicyFinding {
	text = strings.ToLower(norm.NFKC.String(text))
	text = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, text)
	if gatewayPolicyWindowMatch(text, gatewayPolicyMinorAnchors, func(window string) bool {
		return gatewayPolicyMinor.MatchString(window) && gatewayPolicySexual.MatchString(window) && gatewayPolicyCreativeRequest.MatchString(window)
	}) {
		return &gatewayLocalPolicyFinding{RuleID: "local:sexual_minors", Category: "sexual/minors"}
	}
	if gatewayPolicyWindowMatch(text, gatewayPolicyNuclearAnchors, func(window string) bool {
		return gatewayPolicyNuclear.MatchString(window) && gatewayPolicyNuclearAction.MatchString(window)
	}) {
		return &gatewayLocalPolicyFinding{RuleID: "local:nuclear_weapon_instructions", Category: "weapons/nuclear"}
	}
	if gatewayPolicyWindowMatch(text, gatewayPolicyReverseAnchors, func(window string) bool {
		return gatewayPolicyLicenseBypass.MatchString(window) || (gatewayPolicyReverse.MatchString(window) && gatewayPolicyReverseRequest.MatchString(window))
	}) {
		return &gatewayLocalPolicyFinding{RuleID: "local:reverse_engineering_or_cracking", Category: "site_policy/reverse_engineering"}
	}
	return nil
}

func gatewayPolicyWindowMatch(text string, anchors []string, check func(string) bool) bool {
	for _, anchor := range anchors {
		for offset := 0; offset < len(text); {
			relative := strings.Index(text[offset:], anchor)
			if relative < 0 {
				break
			}
			at := offset + relative
			start, end := at, at+len(anchor)
			for range 160 {
				if start == 0 {
					break
				}
				_, size := utf8.DecodeLastRuneInString(text[:start])
				start -= size
			}
			for range 160 {
				if end == len(text) {
					break
				}
				_, size := utf8.DecodeRuneInString(text[end:])
				end += size
			}
			if check(text[start:end]) {
				return true
			}
			// Windows already examined the next 160 runes; keep half overlap
			// instead of re-evaluating every repeated anchor in dense inputs.
			offset = at + len(anchor)
			for range 80 {
				if offset == len(text) {
					break
				}
				_, size := utf8.DecodeRuneInString(text[offset:])
				offset += size
			}
		}
	}
	return false
}
