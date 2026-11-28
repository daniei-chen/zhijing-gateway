//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"

	"github.com/stretchr/testify/require"
)

// 算价失败的行为矩阵：行 = 运行模式，列 = 价格来源 × fail_closed_on_unpriced。
//
// 这张表钉的是 docs/upstream-divergence.md §六 记的那条缺口：
// 「算价失败时不许按 $0 + err=nil 成交」。12 格逐格断言成交金额、标记、HTTP 结果
// （RecordUsage 返回 err 即请求失败）与 billing_failures 登记数。
//
//	来源 \ 模式            非简易                                    简易
//	已配价                 按配置价成交，不报错                      同左
//	未配价 + 开关关         默认图价成交 + image_price_defaulted      同左
//	未配价 + 开关开         失败关闭（4xx、记 billing_failures、无 usage）  默认图价成交，不报错
//	算价出错（两种开关）    失败关闭（err、记 billing_failures、无 usage）   吸收为 $0 落账，不报错
//
// 「算价出错」这一列只能是文本模型：图片请求在 resolved/channel 定价下
// CalculateCostUnified 不会返回错误，图片真正的失败关闭发生在「未配价 + 开关开」
// 那一列。可证伪性靠两条变异（改非简易模式让它吞成 $0、改简易模式让它也报错）来钉。
func TestRecordUsage_CostFailureMatrix(t *testing.T) {
	const (
		model       = "cost-failure-matrix-model"
		imageCount  = 2
		perRequest  = 0.05
		defaultUnit = 0.134 // docs/IMAGE_PRICE_DEFAULTED.md 的 1K 默认图价
	)

	type cell struct {
		name       string
		simple     bool
		source     string // priced | unpriced | cost_error
		failClosed bool
	}

	// 期望值全部来自实测（见 PR 描述）：非简易模式算价失败一律报错，
	// 简易模式一律吸收成 $0 落账，不让用量记录随失败一起丢。
	type expectation struct {
		wantErr     bool
		wantUsage   int
		wantCost    float64
		wantMarker  string
		wantFailure int
	}

	for _, tc := range []cell{
		{name: "non-simple priced/switch_off", source: "priced"},
		{name: "non-simple priced/switch_on", source: "priced", failClosed: true},
		{name: "non-simple unpriced/switch_off", source: "unpriced"},
		{name: "non-simple unpriced/switch_on", source: "unpriced", failClosed: true},
		{name: "non-simple cost_error/switch_off", source: "cost_error"},
		{name: "non-simple cost_error/switch_on", source: "cost_error", failClosed: true},
		{name: "simple priced/switch_off", simple: true, source: "priced"},
		{name: "simple priced/switch_on", simple: true, source: "priced", failClosed: true},
		{name: "simple unpriced/switch_off", simple: true, source: "unpriced"},
		{name: "simple unpriced/switch_on", simple: true, source: "unpriced", failClosed: true},
		{name: "simple cost_error/switch_off", simple: true, source: "cost_error"},
		{name: "simple cost_error/switch_on", simple: true, source: "cost_error", failClosed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			groupID := int64(8800)
			resolver := newOpenAITokenImageChannelPricingResolverForTest(t, groupID, model)
			cached, ok := resolver.channelService.cache.Load().(*channelCache)
			require.True(t, ok)
			pricing := &ChannelModelPricing{BillingMode: BillingModePerRequest}
			if tc.source == "priced" {
				per := perRequest
				pricing.PerRequestPrice = &per
			}
			cached.pricingByGroupModel[channelModelKey{groupID: groupID, model: model}] = pricing

			usageRepo := &openAIRecordUsageLogRepoStub{}
			billingRepo := &openAIRecordUsageBillingRepoStub{}
			svc := newGatewayRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
				&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{})
			if tc.source != "cost_error" {
				svc.resolver = resolver
			}
			if tc.simple {
				svc.cfg.RunMode = config.RunModeSimple
			}
			svc.cfg.Billing.InflightReservation.Enabled = true
			svc.cfg.Billing.InflightReservation.FailClosedOnUnpriced = tc.failClosed
			svc.billingCacheService.cfg = svc.cfg

			result := &ForwardResult{
				RequestID: "cost-failure-matrix", Model: model, ImageCount: imageCount,
				ImageSize: "1K", ImageEndpoint: true, Duration: time.Second,
				Usage: ClaudeUsage{InputTokens: 1_000_000, OutputTokens: 1000},
			}
			if tc.source == "cost_error" {
				// 没有定价行、也不挂图片渠道解析器：CalculateCostUnified 必定返回
				// 「no pricing available」——这是本服务里唯一能稳定造出的算价错误。
				result = &ForwardResult{
					RequestID: "cost-failure-matrix", Model: model, Duration: time.Second,
					Usage: ClaudeUsage{InputTokens: 1000, OutputTokens: 100},
				}
			}

			err := svc.RecordUsage(context.Background(), &RecordUsageInput{
				Result: result,
				APIKey: &APIKey{ID: 61, GroupID: &groupID, Group: &Group{
					ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1,
					AllowImageGeneration: true,
				}},
				User:    &User{ID: 627},
				Account: &Account{ID: 727},
			})

			want := expectation{wantUsage: 1}
			switch {
			case tc.source == "priced":
				want.wantCost = perRequest * imageCount
			case tc.simple:
				// 简易模式：未配价仍按默认图价记账；算价出错则吸收为 $0。
				if tc.source == "unpriced" {
					want.wantCost = defaultUnit * imageCount
					want.wantMarker = BillingTierImagePriceDefaulted
				}
			case tc.source == "unpriced" && !tc.failClosed:
				want.wantCost = defaultUnit * imageCount
				want.wantMarker = BillingTierImagePriceDefaulted
			default:
				// 非简易模式的失败关闭两格：未配价 + 开关开、以及算价出错（两态）。
				want = expectation{wantErr: true, wantFailure: 1}
			}

			if want.wantErr {
				require.Error(t, err, "非简易模式算价失败必须报错，不许按 $0 + nil 成交")
				require.Equal(t, want.wantFailure, billingRepo.failureCalls,
					"失败关闭必须登记 billing_failures")
				require.Zero(t, usageRepo.calls, "失败时不得写出 usage_log")
				return
			}

			require.NoError(t, err, "简易模式与已配价的行都不许报错")
			require.Equal(t, want.wantUsage, usageRepo.calls)
			require.NotNil(t, usageRepo.lastLog)
			require.InDelta(t, want.wantCost, usageRepo.lastLog.ActualCost, 1e-9)
			if want.wantMarker == "" {
				require.Nil(t, usageRepo.lastLog.BillingTier, "只有按默认图价成交才打标记")
			} else {
				require.NotNil(t, usageRepo.lastLog.BillingTier)
				require.Equal(t, want.wantMarker, *usageRepo.lastLog.BillingTier)
			}
			require.Zero(t, billingRepo.failureCalls, "没走到失败关闭就不能登记 billing_failures")
		})
	}
}
