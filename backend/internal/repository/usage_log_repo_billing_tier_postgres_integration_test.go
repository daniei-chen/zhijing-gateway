//go:build integration

package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/pagination"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/usagestats"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/stretchr/testify/require"
)

// billing_tier 在真 Postgres（迁移出来的生产 schema）上的往返。
//
// 单元侧的 TestUsageLogBillingTierRoundTrip 跑的是 SQLite 内存库，只能证明扫描与
// WHERE 片段在两套方言都走得通；生产是 Postgres + 分区表 + ON CONFLICT，所以这里
// 在 testcontainers 起的 postgres 上再验一遍：
//
//  1. `*string` 列写入往返（显式值与 NULL 两种形态）；
//  2. ListWithFilters 扫回来的值对；
//  3. 历史 NULL 行不会被 billing_tier= 过滤命中；
//  4. 标记列（image_price_defaulted）原样读回。
//
// usage_logs 按 created_at 分区（migrations/035_usage_logs_partitioning.sql），
// 分区路由本身是生产 schema 语义，不在本用例范围；这里插的是 now()，落在默认分区。
func TestUsageLogBillingTierRoundTripOnPostgres(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	repo := newUsageLogRepositoryWithSQL(integrationEntClient, integrationDB)

	// usage_logs 的 user_id / api_key_id / account_id 都是 NOT NULL + REFERENCES，
	// 所以先建最小引用行，再做真实 INSERT。
	suffix := time.Now().UnixNano()
	var userID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx,
		`INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id`,
		fmt.Sprintf("billing-tier-it-%d@example.invalid", suffix)).Scan(&userID))

	var apiKeyID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx,
		`INSERT INTO api_keys (user_id, key, name) VALUES ($1, $2, 'billing-tier-it') RETURNING id`,
		userID, fmt.Sprintf("sk-billing-tier-it-%d", suffix)).Scan(&apiKeyID))

	var accountID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx,
		`INSERT INTO accounts (name, platform, type) VALUES ('billing-tier-it', 'openai', 'apikey') RETURNING id`).
		Scan(&accountID))

	markedRequestID := fmt.Sprintf("billing-tier-it-marked-%d", suffix)
	unmarkedRequestID := fmt.Sprintf("billing-tier-it-unmarked-%d", suffix)
	t.Cleanup(func() {
		cleanup := context.Background()
		_, _ = integrationDB.ExecContext(cleanup,
			`DELETE FROM usage_logs WHERE request_id = ANY($1)`, []string{markedRequestID, unmarkedRequestID})
		tx, err := integrationDB.BeginTx(cleanup, nil)
		if err == nil {
			_, _ = tx.ExecContext(cleanup, `DELETE FROM api_keys WHERE id = $1`, apiKeyID)
			_, _ = tx.ExecContext(cleanup, `DELETE FROM accounts WHERE id = $1`, accountID)
			_, _ = tx.ExecContext(cleanup, `DELETE FROM users WHERE id = $1`, userID)
			_ = tx.Commit()
		}
	})

	marker := service.BillingTierImagePriceDefaulted
	created, err := repo.createSingle(ctx, integrationDB, &service.UsageLog{
		UserID: userID, APIKeyID: apiKeyID, AccountID: accountID, RequestID: markedRequestID,
		Model: "gpt-image-1", ActualCost: 0.268, CreatedAt: now, BillingTier: &marker,
	})
	require.NoError(t, err)
	require.True(t, created, "带标记的行应插入成功")

	created, err = repo.createSingle(ctx, integrationDB, &service.UsageLog{
		UserID: userID, APIKeyID: apiKeyID, AccountID: accountID, RequestID: unmarkedRequestID,
		Model: "gpt-image-1", ActualCost: 0.5, CreatedAt: now,
	})
	require.NoError(t, err)
	require.True(t, created, "不带标记的行应插入成功")

	params := pagination.PaginationParams{Page: 1, PageSize: 10}

	filtered, _, err := repo.ListWithFilters(ctx, params, usagestats.UsageLogFilters{
		BillingTier: service.BillingTierImagePriceDefaulted,
	})
	require.NoError(t, err)
	require.NotEmpty(t, filtered, "带标记的行必须被过滤命中")
	var sawMarkedInFilter bool
	for _, log := range filtered {
		require.NotNil(t, log.BillingTier, "过滤结果里不该出现历史 NULL 行")
		require.Equal(t, service.BillingTierImagePriceDefaulted, *log.BillingTier,
			"标记必须原样从 Postgres 读回来")
		require.NotEqual(t, unmarkedRequestID, log.RequestID, "历史 NULL 行不能被 billing_tier 过滤命中")
		if log.RequestID == markedRequestID {
			sawMarkedInFilter = true
		}
	}
	require.True(t, sawMarkedInFilter, "本次插入的标记行必须在过滤结果里")

	all, _, err := repo.ListWithFilters(ctx, params, usagestats.UsageLogFilters{})
	require.NoError(t, err)

	var sawMarked, sawUnmarked bool
	for _, log := range all {
		switch log.RequestID {
		case markedRequestID:
			sawMarked = true
			require.NotNil(t, log.BillingTier)
			require.Equal(t, service.BillingTierImagePriceDefaulted, *log.BillingTier)
		case unmarkedRequestID:
			sawUnmarked = true
			require.Nil(t, log.BillingTier, "没写标记的行读回来必须是 NULL")
		}
	}
	require.True(t, sawMarked, "标记行必须能被不过滤的查询读回来")
	require.True(t, sawUnmarked, "未标记行必须能被不过滤的查询读回来")
}
