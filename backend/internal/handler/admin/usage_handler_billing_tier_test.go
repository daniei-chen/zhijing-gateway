package admin

import (
	"net/http"
	"net/http/httptest"
	"testing"

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
