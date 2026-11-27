//go:build integration

package repository

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
)

// TestDeductUsageBillingBalance_ConcurrentNeverNegative 用真实 Postgres 验证余额
// 守卫的并发不变量：N 个 goroutine 同时扣同一用户，余额永不为负，且
//
//	实际扣掉的金额 + billing_failures 里登记的差额 == 所有请求应扣金额之和（守恒）
//
// 守恒同时证明不丢单（失败请求都留了欠款凭据）与不重复（没有多扣）。
func TestDeductUsageBillingBalance_ConcurrentNeverNegative(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)

	const (
		initialBalance = 20.0
		amount         = 5.0
		workers        = 12
	)
	user := mustCreateUser(t, client, &service.User{
		Email:        fmt.Sprintf("balance-race-%d@example.com", time.Now().UnixNano()),
		PasswordHash: "hash",
		Balance:      initialBalance,
	})

	var wg sync.WaitGroup
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			tx, err := integrationDB.BeginTx(ctx, nil)
			if err != nil {
				errs[i] = err
				return
			}
			cmd := &service.UsageBillingCommand{
				RequestID:   fmt.Sprintf("balance-race-%d-%d", user.ID, i),
				UserID:      user.ID,
				BalanceCost: amount,
			}
			if _, _, err := deductUsageBillingBalance(ctx, tx, cmd, amount); err != nil {
				errs[i] = err
				_ = tx.Rollback()
				return
			}
			errs[i] = tx.Commit()
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		require.NoErrorf(t, err, "worker %d", i)
	}

	var balance float64
	require.NoError(t, integrationDB.QueryRowContext(ctx,
		"SELECT balance FROM users WHERE id = $1", user.ID).Scan(&balance))
	require.GreaterOrEqual(t, balance, 0.0, "余额永远不得为负")
	require.InDelta(t, 0.0, balance, 1e-9, "12 笔 $5 远超 $20 余额，最终应扣到 0")

	var shortfallSum float64
	var shortfallCount int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(total_cost), 0), COUNT(*)
		FROM billing_failures
		WHERE user_id = $1 AND request_id LIKE $2
	`, user.ID, fmt.Sprintf("balance-race-%d-%%#balance-shortfall", user.ID)).Scan(&shortfallSum, &shortfallCount))
	require.Positive(t, shortfallCount, "欠款必须有可追踪记录")

	deducted := initialBalance - balance
	require.InDelta(t, workers*amount, deducted+shortfallSum, 1e-6,
		"实际扣款 + 欠款差额必须等于应扣总额（不丢单、不重复）")
}
