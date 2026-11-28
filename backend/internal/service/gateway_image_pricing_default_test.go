//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"

	"github.com/stretchr/testify/require"
)

// 图片请求「定价行在、但没有可用单价」的收敛语义（一张表，四条路径）：
//
//  1. 渠道 token + 有价            → 按 token 价成交（对照组，不打标记）
//  2. 渠道 token + 无价            → 默认图价成交 + image_price_defaulted
//  3. 渠道 token + 无价 + 按张开关 → 默认图价成交 + image_price_defaulted
//  4. 渠道 per_request + 无价      → 默认图价成交 + image_price_defaulted
//
// 同一个表在 billing.inflight_reservation.fail_closed_on_unpriced=true 下再跑一遍：
// 无价的三行走失败关闭（4xx + billing_failures），有价的对照组不受影响。
// 将来新增定价模式只加一行，不加新测试。
//
// 另有「显式 0 价」三行（explicitZeroPrice）：运营者故意配 0 的免费渠道属于
// 「配过价」，必须按 0 成交、不打漏配标记、开关打开也不失败关闭。渠道价格字段是
// *float64，nil 与 0 的区别就是在这里断言的——把任何一处 `!= nil` 收紧成 `> 0`，
// 这三行会立刻变红。
func TestRecordUsage_ImagePricingConvergesOnUnpricedRows(t *testing.T) {
	const (
		marker            = imagePriceDefaultedMarker
		defaultImagePrice = 0.134
		imageCount        = 2
		tokenCostForUsage = 3.015 // 1M 输入 × 3e-6 + 1000 输出 × 15e-6
	)

	type imagePricingCase struct {
		name        string
		billingMode BillingMode
		withPrices  bool // 渠道行填了非零 token 单价
		imageAPI    bool // 专用图片端点（分组按张开关只对它生效）
		switchOn    bool // 分组按实际出图张数计费
		priced      bool // 该行配置了非零可用单价
		// configure 把该行改造成「显式填了价格」，含显式 0（免费）。
		configure func(pricing *ChannelModelPricing, group *Group)
	}

	cases := []imagePricingCase{
		{name: "channel token priced", billingMode: BillingModeToken, withPrices: true, priced: true},
		{name: "channel token unpriced", billingMode: BillingModeToken},
		{name: "channel token unpriced with count billing", billingMode: BillingModeToken, imageAPI: true, switchOn: true},
		{name: "channel per_request unpriced", billingMode: BillingModePerRequest},
		{
			// 免费渠道：token 单价显式填 0。ModelPricing 里这些字段是 float64，
			// 只有渠道原始行还留着「填过」的信息。
			name:        "channel token explicit zero price",
			billingMode: BillingModeToken,
			configure: func(pricing *ChannelModelPricing, _ *Group) {
				zero := 0.0
				pricing.InputPrice = &zero
				pricing.OutputPrice = &zero
				pricing.ImageOutputPrice = nil
			},
		},
		{
			// 分组图价显式填 0，渠道行本身一个价都没填。
			name:        "group image price explicit zero",
			billingMode: BillingModeToken,
			imageAPI:    true,
			switchOn:    true,
			configure: func(pricing *ChannelModelPricing, group *Group) {
				zero := 0.0
				pricing.InputPrice = nil
				pricing.OutputPrice = nil
				pricing.ImageOutputPrice = nil
				group.ImagePrice1K = &zero
			},
		},
		{
			// 按次价显式填 0。
			name:        "channel per_request explicit zero price",
			billingMode: BillingModePerRequest,
			configure: func(pricing *ChannelModelPricing, _ *Group) {
				zero := 0.0
				pricing.InputPrice = nil
				pricing.OutputPrice = nil
				pricing.ImageOutputPrice = nil
				pricing.PerRequestPrice = &zero
			},
		},
	}

	explicitZeroPrice := func(tc imagePricingCase) bool { return tc.configure != nil }

	for _, failClosed := range []bool{false, true} {
		switchLabel := "false"
		if failClosed {
			switchLabel = "true"
		}
		for i, tc := range cases {
			t.Run(tc.name+"/fail_closed="+switchLabel, func(t *testing.T) {
				const model = "image-pricing-table-model"
				groupID := int64(940 + i)

				resolver := newOpenAITokenImageChannelPricingResolverForTest(t, groupID, model)
				cached, ok := resolver.channelService.cache.Load().(*channelCache)
				require.True(t, ok)
				group := &Group{
					ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1,
					AllowImageGeneration: true, ImageCountBilling: tc.switchOn,
				}
				pricing := &ChannelModelPricing{BillingMode: tc.billingMode}
				if tc.withPrices {
					inputPrice, outputPrice := 3e-6, 15e-6
					pricing.InputPrice = &inputPrice
					pricing.OutputPrice = &outputPrice
				}
				if tc.configure != nil {
					tc.configure(pricing, group)
				}
				cached.pricingByGroupModel[channelModelKey{groupID: groupID, model: model}] = pricing

				usageRepo := &openAIRecordUsageLogRepoStub{}
				billingRepo := &openAIRecordUsageBillingRepoStub{}
				svc := newGatewayRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
					&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{})
				svc.resolver = resolver
				svc.cfg.Billing.InflightReservation.Enabled = true
				svc.cfg.Billing.InflightReservation.FailClosedOnUnpriced = failClosed
				svc.billingCacheService.cfg = svc.cfg

				err := svc.RecordUsage(context.Background(), &RecordUsageInput{
					Result: &ForwardResult{
						RequestID:     "image-pricing-table",
						Model:         model,
						ImageCount:    imageCount,
						ImageSize:     "1K",
						ImageEndpoint: tc.imageAPI,
						Usage:         ClaudeUsage{InputTokens: 1_000_000, OutputTokens: 1000},
						Duration:      time.Second,
					},
					APIKey:  &APIKey{ID: int64(31 + i), GroupID: &groupID, Group: group},
					User:    &User{ID: 607},
					Account: &Account{ID: 707},
				})

				if explicitZeroPrice(tc) {
					require.NoError(t, err,
						"显式 0 价算配过，开关打开也不能失败关闭")
					require.Equal(t, 1, usageRepo.calls)
					require.NotNil(t, usageRepo.lastLog)
					require.Zero(t, usageRepo.lastLog.ActualCost,
						"显式 0 价是运营者选的免费，不能按默认图价 0.134/张成交")
					require.Nil(t, usageRepo.lastLog.BillingTier,
						"显式 0 价算配过，不能打 image_price_defaulted 标记")
					require.Zero(t, billingRepo.failureCalls,
						"显式 0 价不算漏配，不能登记 billing_failures")
					return
				}

				if tc.priced {
					require.NoError(t, err)
					require.Equal(t, 1, usageRepo.calls)
					require.NotNil(t, usageRepo.lastLog)
					require.InDelta(t, tokenCostForUsage, usageRepo.lastLog.ActualCost, 1e-9,
						"有可用单价的行必须按配置价成交")
					require.Nil(t, usageRepo.lastLog.BillingTier, "有价行不打默认价标记")
					require.Zero(t, billingRepo.failureCalls)
					return
				}

				if failClosed {
					require.ErrorIs(t, err, ErrModelPricingUnavailable,
						"开关打开时漏配必须失败关闭，不能按默认价静默成交")
					require.Equal(t, 1, billingRepo.failureCalls, "失败关闭必须登记 billing_failures")
					require.Zero(t, usageRepo.calls, "失败时不得写出 usage_log")
					return
				}

				require.NoError(t, err)
				require.Equal(t, 1, usageRepo.calls)
				require.NotNil(t, usageRepo.lastLog)
				require.InDelta(t, defaultImagePrice*imageCount, usageRepo.lastLog.ActualCost, 1e-9,
					"漏配的图片渠道必须按默认图价成交，不能是 $0")
				require.NotNil(t, usageRepo.lastLog.BillingTier)
				require.Equal(t, marker, *usageRepo.lastLog.BillingTier,
					"默认价成交必须留下可查标记")
			})
		}
	}
}

// 没有渠道/分组定价行的图片模型走目录价/内置默认价，属于既有语义，不该被打成漏配。
func TestRecordUsage_ImageWithoutPricingRowIsNotMarkedDefaulted(t *testing.T) {
	const model = "image-pricing-no-row-model"
	usageRepo := &openAIRecordUsageLogRepoStub{}
	billingRepo := &openAIRecordUsageBillingRepoStub{}
	svc := newGatewayRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
		&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{})

	groupID := int64(950)
	group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
	err := svc.RecordUsage(context.Background(), &RecordUsageInput{
		Result: &ForwardResult{
			RequestID: "image-no-pricing-row", Model: model, ImageCount: 1, ImageSize: "1K",
			ImageEndpoint: true, Duration: time.Second,
		},
		APIKey:  &APIKey{ID: 41, GroupID: &groupID, Group: group},
		User:    &User{ID: 608},
		Account: &Account{ID: 708},
	})

	require.NoError(t, err)
	require.NotNil(t, usageRepo.lastLog)
	require.Greater(t, usageRepo.lastLog.ActualCost, 0.0)
	require.Nil(t, usageRepo.lastLog.BillingTier)
}

// 简易模式没有成交价，开关对它不生效：漏配图片仍按默认价记账、不报错。
func TestRecordUsage_ImagePricingUnpricedSimpleModeStaysNonFailing(t *testing.T) {
	const model = "image-pricing-simple-model"
	groupID := int64(951)
	resolver := newOpenAITokenImageChannelPricingResolverForTest(t, groupID, model)
	cached, ok := resolver.channelService.cache.Load().(*channelCache)
	require.True(t, ok)
	cached.pricingByGroupModel[channelModelKey{groupID: groupID, model: model}] = &ChannelModelPricing{
		BillingMode: BillingModePerRequest,
	}

	usageRepo := &openAIRecordUsageLogRepoStub{}
	billingRepo := &openAIRecordUsageBillingRepoStub{}
	svc := newGatewayRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
		&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{})
	svc.resolver = resolver
	svc.cfg.RunMode = config.RunModeSimple
	svc.cfg.Billing.InflightReservation.Enabled = true
	svc.cfg.Billing.InflightReservation.FailClosedOnUnpriced = true
	svc.billingCacheService.cfg = svc.cfg

	group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
	err := svc.RecordUsage(context.Background(), &RecordUsageInput{
		Result: &ForwardResult{
			RequestID: "image-unpriced-simple", Model: model, ImageCount: 2, ImageSize: "1K",
			ImageEndpoint: true, Duration: time.Second,
		},
		APIKey:  &APIKey{ID: 42, GroupID: &groupID, Group: group},
		User:    &User{ID: 609},
		Account: &Account{ID: 709},
	})

	require.NoError(t, err, "简易模式只记 usage 不扣费，漏配不能把用量记录一起丢掉")
	require.Equal(t, 1, usageRepo.calls)
	require.NotNil(t, usageRepo.lastLog)
	require.Zero(t, billingRepo.failureCalls)
}
