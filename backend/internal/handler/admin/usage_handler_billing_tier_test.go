package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/usagestats"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/stretchr/testify/require"
)

// billing_tier 过滤参数：合法标记透传到 repository 的 ListWithFilters，
// 非法取值在 handler 层 400（与 billing_mode 的校验位置一致）。
func TestAdminUsageListBillingTierFilter(t *testing.T) {
	repo := &adminUsageRepoCapture{}
	router := newAdminUsageRequestTypeTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/admin/usage?billing_tier=image_price_defaulted", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, service.BillingTierImagePriceDefaulted, repo.listFilters.BillingTier)
}

func TestAdminUsageListRejectsUnknownBillingTier(t *testing.T) {
	repo := &adminUsageRepoCapture{}
	router := newAdminUsageRequestTypeTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/admin/usage?billing_tier=defaulted", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	require.Empty(t, repo.listFilters.BillingTier, "被拒的请求不能进到 repository")
}

// billing_tier 的读端：usage_log 行上的标记必须原样出现在管理端响应里，
// 历史 NULL 行不能凭空长出一个字段（前端徽标据此渲染）。
// 这一段覆盖「行 → DTO → JSON」；真库写入端不在本机验证范围内。
func TestAdminUsageListResponseCarriesBillingTier(t *testing.T) {
	marked := service.BillingTierImagePriceDefaulted
	repo := &adminUsageRepoCapture{rows: []service.UsageLog{
		{ID: 1, RequestID: "req-marked", Model: "image-model", ActualCost: 0.268, BillingTier: &marked},
		{ID: 2, RequestID: "req-unmarked", Model: "image-model", ActualCost: 0.5},
	}}
	router := newAdminUsageRequestTypeTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/admin/usage?billing_tier=image_price_defaulted", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var envelope struct {
		Data struct {
			Items []map[string]any `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	require.Len(t, envelope.Data.Items, 2)

	require.Equal(t, service.BillingTierImagePriceDefaulted, envelope.Data.Items[0]["billing_tier"],
		"按默认图价成交的行必须把 billing_tier 带进响应")
	_, present := envelope.Data.Items[1]["billing_tier"]
	require.False(t, present, "没有标记的行不应出现 billing_tier 字段")
}

// billing_tier 必须进 stats 缓存键：否则两个只差这个过滤条件的请求会互相命中
// 对方的缓存，管理端会把「按默认价成交的笔数」当成普通统计返回。
func TestUsageStatsCacheKeyIncludesBillingTier(t *testing.T) {
	base := usagestats.UsageLogFilters{Model: "image-model"}
	withTier := base
	withTier.BillingTier = service.BillingTierImagePriceDefaulted

	require.NotEqual(t, usageStatsCacheKey(base), usageStatsCacheKey(withTier),
		"只差 billing_tier 的两个查询不能共用缓存键")
	require.Equal(t, usageStatsCacheKey(withTier), usageStatsCacheKey(withTier),
		"同条件必须稳定映射到同一个键")
}
