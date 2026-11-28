//go:build unit

package routes

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

var (
	docRouteRef  = regexp.MustCompile("`(GET|POST|PUT|DELETE|PATCH) (/api/v1/admin[^`]*)`")
	docGroupHead = regexp.MustCompile(`^#### (\S+)（(\d+)）$`)
)

// TestAdminStepUpDocMatchesClassification 是 deploy/ADMIN_STEP_UP.md 的对账用例：
// 注意：Go 的测试缓存不认识测试里读的外部文件，改完文档要 `-count=1` 重跑才看得到效果。
// 这份文档声称「哪些端点被强制」，就必须与分类表逐条一致，数量、分组计数都不许漂。
// 旧状态（文档写了但没挂门、或挂了门但文档没写）会红。
func TestAdminStepUpDocMatchesClassification(t *testing.T) {
	raw, err := os.ReadFile("../../../../deploy/ADMIN_STEP_UP.md")
	require.NoError(t, err)
	doc := string(raw)

	forced := map[string]struct{}{}
	for route, class := range adminStepUpClassification {
		if isForcedStepUpClass(class) {
			forced[route] = struct{}{}
		}
	}
	notForced := len(adminStepUpClassification) - len(forced)

	require.Contains(t, doc, fmt.Sprintf("## 强制清单（%d 条）", len(forced)),
		"文档里的强制条数必须与分类表一致")
	require.Contains(t, doc, fmt.Sprintf("## 刻意不拦（%d 条）", notForced),
		"文档里的不拦条数必须与分类表一致")

	start := strings.Index(doc, "## 强制清单")
	end := strings.Index(doc, "## 刻意不拦")
	require.True(t, start >= 0 && end > start, "文档缺少强制清单/刻意不拦两节")
	forcedSection := doc[start:end]

	// 1) 分类表里的每条强制端点都要在文档清单里出现。
	missing := make([]string, 0)
	for route := range forced {
		if !strings.Contains(forcedSection, "`"+route+"`") {
			missing = append(missing, route)
		}
	}
	sort.Strings(missing)
	require.Empty(t, missing, "文档强制清单漏了这些端点")

	// 2) 文档清单里提到的每条端点都必须被判为强制（防「文档说拦了、代码没挂门」）。
	documented := map[string]struct{}{}
	for _, m := range docRouteRef.FindAllStringSubmatch(forcedSection, -1) {
		route := m[1] + " " + m[2]
		documented[route] = struct{}{}
		_, isForced := forced[route]
		require.True(t, isForced, "文档把 %s 列为强制，分类表却不是强制项", route)
	}
	require.Len(t, documented, len(forced), "文档清单与分类表的条目数不一致")

	// 3) 每个分组标题里的计数必须等于该组下列出的条数。
	currentGroup, currentWant, currentCount := "", 0, 0
	checkGroup := func() {
		if currentGroup == "" {
			return
		}
		require.Equal(t, currentWant, currentCount, "文档分组「%s」标题写 %d 条，实际列出 %d 条",
			currentGroup, currentWant, currentCount)
	}
	for _, line := range strings.Split(forcedSection, "\n") {
		if m := docGroupHead.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			checkGroup()
			currentGroup = m[1]
			currentWant, _ = strconv.Atoi(m[2])
			currentCount = 0
			continue
		}
		if docRouteRef.MatchString(line) {
			currentCount++
		}
	}
	checkGroup()

	// 4) 文档不许出现还没发生的事。
	for _, claim := range []string{"已回灌", "已上线"} {
		require.NotContains(t, doc, claim, "文档里不能写尚未发生的事")
	}
}
