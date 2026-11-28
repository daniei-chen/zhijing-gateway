//go:build integration

package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/daniei-chen/zhijing-gateway/internal/handler/dto"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/pagination"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/usagestats"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
)

// usage_log.billing_tier 的真库往返：INSERT 写进去 → scanUsageLog 读回来 →
// 管理端 DTO 映射成响应字段 → 序列化成 JSON。
//
// 断言落在管理端响应结构上，不是「数据库里有值」：漏配图片价的渠道按默认图价成交后
// 必须让运维在看板上看得见，只存不渲染等于没标。渠道定价 → 标记的判定由 service 的
// TestRecordUsage_ImagePricingConvergesOnUnpricedRows 用桩仓库钉住，本用例补的是它
// 之后那段，任何一段断链都会红：漏列 → 列里空；漏 Scan → service.UsageLog 里空；
// 漏 mapper → DTO 里空；漏 json tag → JSON 里没这个键。
func TestUsageLogBillingTierRoundTrip(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	repo := newUsageLogRepositoryWithSQL(client, integrationDB)

	suffix := uuid.NewString()
	user := mustCreateUser(t, client, &service.User{Email: "billing-tier-rt-" + suffix + "@example.com"})
	apiKey := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "sk-tier-rt-" + suffix, Name: "k"})
	account := mustCreateAccount(t, client, &service.Account{Name: "acc-tier-rt-" + suffix})

	t.Cleanup(func() {
		_, err := integrationDB.ExecContext(context.Background(), "DELETE FROM usage_logs WHERE api_key_id = $1", apiKey.ID)
		require.NoError(t, err, "cleanup usage_logs")
	})

	insertLog := func(tier *string) *service.UsageLog {
		log := &service.UsageLog{
			UserID:       user.ID,
			APIKeyID:     apiKey.ID,
			AccountID:    account.ID,
			RequestID:    uuid.NewString(),
			Model:        "gpt-image-1",
			InputTokens:  10,
			OutputTokens: 20,
			TotalCost:    0.268,
			ActualCost:   0.268,
			BillingTier:  tier,
			CreatedAt:    time.Now().UTC(),
		}
		inserted, err := repo.Create(ctx, log)
		require.NoError(t, err, "Create")
		require.True(t, inserted, "Create 必须真的插进去")
		return log
	}

	marker := service.BillingTierImagePriceDefaulted
	marked := insertLog(&marker)
	plain := insertLog(nil)

	t.Run("标记落到 billing_tier 列", func(t *testing.T) {
		var stored sql.NullString
		require.NoError(t, integrationDB.QueryRowContext(ctx,
			"SELECT billing_tier FROM usage_logs WHERE id = $1", marked.ID).Scan(&stored))
		require.True(t, stored.Valid, "billing_tier 必须非 NULL")
		require.Equal(t, marker, stored.String)
	})

	t.Run("管理端筛选能把标记行读回 service.UsageLog", func(t *testing.T) {
		logs, page, err := repo.ListWithFilters(ctx,
			pagination.PaginationParams{Page: 1, PageSize: 10},
			usagestats.UsageLogFilters{UserID: user.ID, BillingTier: marker})
		require.NoError(t, err, "ListWithFilters")
		require.Equal(t, int64(1), page.Total, "同一用户下只有带标记的那条命中了 billing_tier 过滤")
		require.Len(t, logs, 1)
		require.Equal(t, marked.ID, logs[0].ID)
		require.NotNil(t, logs[0].BillingTier, "scanUsageLog 必须把 billing_tier 读回 service.UsageLog")
		require.Equal(t, marker, *logs[0].BillingTier)
	})

	t.Run("管理端响应 JSON 里带 billing_tier", func(t *testing.T) {
		log, err := repo.GetByID(ctx, marked.ID)
		require.NoError(t, err, "GetByID")
		body := billingTierAdminUsageJSON(t, log)
		require.Equal(t, marker, body["billing_tier"], "管理端响应必须能渲染这个标记")
	})

	t.Run("没有标记的行不带这个键", func(t *testing.T) {
		log, err := repo.GetByID(ctx, plain.ID)
		require.NoError(t, err, "GetByID")
		require.Nil(t, log.BillingTier)
		body := billingTierAdminUsageJSON(t, log)
		require.NotContains(t, body, "billing_tier", "未标记的行不能凭空长出 billing_tier")
	})
}

func billingTierAdminUsageJSON(t *testing.T, log *service.UsageLog) map[string]any {
	t.Helper()
	view := dto.UsageLogFromServiceAdmin(log)
	require.NotNil(t, view)
	raw, err := json.Marshal(view)
	require.NoError(t, err)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	return body
}
