package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
)

// GetBillingReconciliation 统计窗口内的资金对账异常（补丁 P1-03）。
//
// 这两条查询支撑三条内置告警规则：
//   - billing_dedup_gap_count    usage_logs 有记录但幂等键缺失（存在重复扣费风险）
//   - billing_leakage_count      应计费但实收为 0 的笔数（计费 fail-open 的早期信号）
//   - billing_leakage_amount_usd 上述笔数的金额合计
//
// 只扫 created_at 落在窗口内的行，走 idx_usage_logs_created_at，
// 默认窗口 5–60 分钟、每窗口约几十行，成本可忽略。
func (r *opsRepository) GetBillingReconciliation(ctx context.Context, start, end time.Time) (*service.OpsBillingReconciliation, error) {
	if r == nil || r.db == nil {
		return nil, fmt.Errorf("nil ops repository")
	}
	if !end.After(start) {
		return &service.OpsBillingReconciliation{}, nil
	}

	out := &service.OpsBillingReconciliation{}

	// 幂等键缺口：同一 (request_id, api_key_id) 在 dedup 表缺失。
	// request_id 为空的行不参与比对（历史数据/非网关写入没有该字段，否则会全量误报）。
	const dedupGapSQL = `
SELECT count(*)
FROM usage_logs ul
LEFT JOIN usage_billing_dedup d
       ON d.request_id = ul.request_id
      AND d.api_key_id = ul.api_key_id
WHERE ul.created_at >= $1
  AND ul.created_at <  $2
  AND ul.request_id IS NOT NULL
  AND ul.request_id <> ''
  -- Live 会话（/v1/live）绕过计费管道直接写 usage_log，本就不落 dedup 键，
  -- 不排除会让该指标在开启 Live 的分组上 100% 误报（见 v0.0.7 复核 billing P1）。
  AND COALESCE(ul.inbound_endpoint, '') NOT LIKE '/v1/live%'
  AND d.id IS NULL`
	if err := r.db.QueryRowContext(ctx, dedupGapSQL, start, end).Scan(&out.DedupGapCount); err != nil {
		return nil, fmt.Errorf("billing dedup gap: %w", err)
	}

	// 漏收：应计费（total_cost>0）但实收为 0。
	const leakageSQL = `
SELECT count(*), COALESCE(sum(total_cost), 0)
FROM usage_logs
WHERE created_at >= $1
  AND created_at <  $2
  AND total_cost > 0
  AND actual_cost = 0`
	if err := r.db.QueryRowContext(ctx, leakageSQL, start, end).Scan(&out.LeakageCount, &out.LeakageAmountUSD); err != nil {
		return nil, fmt.Errorf("billing leakage: %w", err)
	}

	return out, nil
}
