package repository

import (
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/stretchr/testify/require"
)

// billing_tier 过滤只命中该标记行；空值不过滤，历史 NULL 行不会被任何具体 tier 命中。
func TestAppendUsageLogBillingTierWhereCondition(t *testing.T) {
	conditions, args := appendUsageLogBillingTierWhereCondition(nil, nil, service.BillingTierImagePriceDefaulted)
	require.Equal(t, []string{"billing_tier = $1"}, conditions)
	require.Equal(t, []any{service.BillingTierImagePriceDefaulted}, args)

	conditions, args = appendUsageLogBillingTierWhereCondition(nil, nil, "")
	require.Empty(t, conditions)
	require.Empty(t, args)
}

func TestAppendUsageLogBillingTierQueryFilter(t *testing.T) {
	query, args := appendUsageLogBillingTierQueryFilter(
		"SELECT * FROM usage_logs WHERE user_id = $1", []any{int64(42)},
		service.BillingTierImagePriceDefaulted, "ul")

	require.Equal(t, "SELECT * FROM usage_logs WHERE user_id = $1 AND ul.billing_tier = $2", query)
	require.Equal(t, []any{int64(42), service.BillingTierImagePriceDefaulted}, args)
}
