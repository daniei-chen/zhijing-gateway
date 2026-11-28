//go:build unit

package service

import (
	"context"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"

	"github.com/stretchr/testify/require"
)

// SWO-76：定价行「只配了另一个档位」时，本次请求没有任何单价覆盖。这种请求必须
// 失败关闭，或按默认媒体价成交并在 usage_log.billing_tier 留标记；按 $0 成交就是
// 永久漏收（账面有价、钱没收到、billing_failures 一行不记）。
//
// 每个用例都在两个引擎上跑一遍：GatewayService（composite/Anthropic 引擎）与
// OpenAIGatewayService（/v1/images 与视频真正走的那条，#50 的闸此前没装在这里）。

type tierMissOutcome struct {
	err          error
	usageCalls   int
	usageLog     *UsageLog
	failureCalls int
}

func tierMissResolver(t *testing.T, groupID int64, model string, row *ChannelModelPricing) *ModelPricingResolver {
	t.Helper()
	cache := newEmptyChannelCache()
	if row != nil {
		cache.pricingByGroupModel[channelModelKey{groupID: groupID, model: model}] = row
	}
	cache.channelByGroupID[groupID] = &Channel{ID: groupID, Status: StatusActive}
	cache.loadedAt = time.Now()
	cs := &ChannelService{}
	cs.cache.Store(cache)
	return NewModelPricingResolver(cs, NewBillingService(&config.Config{}, nil))
}

func newTierMissGatewayService(resolver *ModelPricingResolver, failClosed bool) (*GatewayService, *openAIRecordUsageLogRepoStub, *openAIRecordUsageBillingRepoStub) {
	usageRepo := &openAIRecordUsageLogRepoStub{}
	billingRepo := &openAIRecordUsageBillingRepoStub{}
	svc := newGatewayRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
		&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{})
	svc.resolver = resolver
	svc.cfg.Billing.InflightReservation.Enabled = true
	svc.cfg.Billing.InflightReservation.FailClosedOnUnpriced = failClosed
	svc.billingCacheService.cfg = svc.cfg
	return svc, usageRepo, billingRepo
}

func newTierMissOpenAIService(resolver *ModelPricingResolver, failClosed bool) (*OpenAIGatewayService, *openAIRecordUsageLogRepoStub, *openAIRecordUsageBillingRepoStub) {
	usageRepo := &openAIRecordUsageLogRepoStub{}
	billingRepo := &openAIRecordUsageBillingRepoStub{}
	svc := newOpenAIRecordUsageServiceWithBillingRepoForTest(usageRepo, billingRepo,
		&openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{}, nil)
	svc.resolver = resolver
	svc.cfg.Billing.InflightReservation.Enabled = true
	svc.cfg.Billing.InflightReservation.FailClosedOnUnpriced = failClosed
	svc.billingCacheService.cfg = svc.cfg
	return svc, usageRepo, billingRepo
}

// recordGatewayImage 走 GatewayService.RecordUsage：composite/Anthropic 引擎的图片分支。
func recordGatewayImage(t *testing.T, group *Group, resolver *ModelPricingResolver, model, size string, failClosed bool) tierMissOutcome {
	t.Helper()
	svc, usageRepo, billingRepo := newTierMissGatewayService(resolver, failClosed)
	err := svc.RecordUsage(context.Background(), &RecordUsageInput{
		Result: &ForwardResult{
			RequestID: "swo76-image", Model: model, ImageCount: 2, ImageSize: size,
			ImageEndpoint: true, Duration: time.Second,
		},
		APIKey:  &APIKey{ID: 7601, GroupID: &group.ID, Group: group},
		User:    &User{ID: 7602},
		Account: &Account{ID: 7603},
	})
	return tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
}

// recordOpenAIImage 走 OpenAIGatewayService.RecordUsage：/v1/images 真正走的那条。
func recordOpenAIImage(t *testing.T, group *Group, resolver *ModelPricingResolver, model, size string, failClosed bool) tierMissOutcome {
	t.Helper()
	svc, usageRepo, billingRepo := newTierMissOpenAIService(resolver, failClosed)
	err := svc.RecordUsage(context.Background(), &OpenAIRecordUsageInput{
		Result: &OpenAIForwardResult{
			RequestID: "swo76-image", Model: model, ImageCount: 2, ImageSize: size,
			Duration: time.Second,
		},
		APIKey:  &APIKey{ID: 7611, GroupID: &group.ID, Group: group},
		User:    &User{ID: 7612},
		Account: &Account{ID: 7613},
	})
	return tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
}

// recordOpenAIVideo 走 OpenAIGatewayService.RecordUsage 的 Grok 视频分支。
func recordOpenAIVideo(t *testing.T, group *Group, resolver *ModelPricingResolver, model, resolution string, failClosed bool) tierMissOutcome {
	t.Helper()
	svc, usageRepo, billingRepo := newTierMissOpenAIService(resolver, failClosed)
	err := svc.RecordUsage(context.Background(), &OpenAIRecordUsageInput{
		Result: &OpenAIForwardResult{
			RequestID: "swo76-video", Model: model, VideoCount: 1,
			VideoResolution: resolution, VideoDurationSeconds: 4, Duration: time.Second,
		},
		APIKey:  &APIKey{ID: 7621, GroupID: &group.ID, Group: group},
		User:    &User{ID: 7622},
		Account: &Account{ID: 7623},
	})
	return tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
}

type tierMissRecorder func(t *testing.T, group *Group, resolver *ModelPricingResolver, model, tier string, failClosed bool) tierMissOutcome

// ① 渠道只配 4K、请求 1K：开关关 → 按默认图价成交 + 标记；开关开 → 失败关闭 + billing_failures。
func TestMediaTierMissSettlesAtDefaultPriceOrFailsClosed(t *testing.T) {
	const (
		model             = "swo76-image-tier-miss"
		imageCount        = 2
		defaultImagePrice = 0.134
	)
	price4K := 0.20

	for _, engine := range []struct {
		name   string
		record tierMissRecorder
	}{
		{name: "gateway", record: recordGatewayImage},
		{name: "openai", record: recordOpenAIImage},
	} {
		for _, failClosed := range []bool{false, true} {
			failClosed := failClosed
			label := "fail_closed=false"
			if failClosed {
				label = "fail_closed=true"
			}
			t.Run(engine.name+"/channel-4K-only/"+label, func(t *testing.T) {
				groupID := int64(7640)
				group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
				resolver := tierMissResolver(t, groupID, model, &ChannelModelPricing{
					BillingMode: BillingModeImage,
					Intervals: []PricingInterval{
						{TierLabel: "4K", PerRequestPrice: &price4K},
					},
				})

				out := engine.record(t, group, resolver, model, "1K", failClosed)

				if failClosed {
					require.ErrorIs(t, out.err, ErrModelPricingUnavailable,
						"档位未命中且开关打开时必须失败关闭，不能按 $0 或默认价静默成交")
					require.Equal(t, 1, out.failureCalls, "失败关闭必须登记 billing_failures")
					require.Zero(t, out.usageCalls, "失败时不得写出 usage_log")
					return
				}
				require.NoError(t, out.err)
				require.Equal(t, 1, out.usageCalls)
				require.NotNil(t, out.usageLog)
				require.InDelta(t, defaultImagePrice*imageCount, out.usageLog.ActualCost, 1e-9,
					"只配 4K 的渠道被 1K 请求命中时，必须按默认图价成交，不能是 $0")
				require.NotNil(t, out.usageLog.BillingTier, "默认价成交必须留下可查标记")
				require.Equal(t, BillingTierImagePriceDefaulted, *out.usageLog.BillingTier)
			})
		}
	}
}

// ② 分组只配 4K、请求 1K（分组图片面）：与渠道面同构，不能被「分组有 tiers」骗成有价。
func TestMediaTierMissGroupRowSettlesAtDefaultPrice(t *testing.T) {
	const (
		model             = "swo76-group-tier-miss"
		imageCount        = 2
		defaultImagePrice = 0.134
		groupID           = int64(7650)
	)
	price4K := 0.20

	for _, engine := range []struct {
		name   string
		record tierMissRecorder
	}{
		{name: "gateway", record: recordGatewayImage},
		{name: "openai", record: recordOpenAIImage},
	} {
		for _, failClosed := range []bool{false, true} {
			failClosed := failClosed
			label := "fail_closed=false"
			if failClosed {
				label = "fail_closed=true"
			}
			t.Run(engine.name+"/group-4K-only/"+label, func(t *testing.T) {
				group := &Group{
					ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1,
					AllowImageGeneration: true,
					ModelPricing: []ChannelModelPricing{{
						Models:      []string{model},
						BillingMode: BillingModeImage,
						Intervals: []PricingInterval{
							{TierLabel: "4K", PerRequestPrice: &price4K},
						},
					}},
				}
				resolver := tierMissResolver(t, groupID, model, nil)

				out := engine.record(t, group, resolver, model, "1K", failClosed)

				if failClosed {
					require.ErrorIs(t, out.err, ErrModelPricingUnavailable)
					require.Equal(t, 1, out.failureCalls)
					require.Zero(t, out.usageCalls)
					return
				}
				require.NoError(t, out.err)
				require.NotNil(t, out.usageLog)
				require.InDelta(t, defaultImagePrice*imageCount, out.usageLog.ActualCost, 1e-9)
				require.NotNil(t, out.usageLog.BillingTier)
				require.Equal(t, BillingTierImagePriceDefaulted, *out.usageLog.BillingTier)
			})
		}
	}
}

// ③ 渠道显式把 1K 配成 0：那是运营者选的免费，必须按 $0 成交、不打标记、
// 开关打开也不失败关闭。这条防「顺手把免费判成未配价」。
func TestMediaExplicitZeroTierStaysFree(t *testing.T) {
	const model = "swo76-explicit-zero"
	zero := 0.0

	for _, engine := range []struct {
		name   string
		record tierMissRecorder
	}{
		{name: "gateway", record: recordGatewayImage},
		{name: "openai", record: recordOpenAIImage},
	} {
		for _, failClosed := range []bool{false, true} {
			failClosed := failClosed
			label := "fail_closed=false"
			if failClosed {
				label = "fail_closed=true"
			}
			t.Run(engine.name+"/explicit-zero/"+label, func(t *testing.T) {
				groupID := int64(7660)
				group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
				resolver := tierMissResolver(t, groupID, model, &ChannelModelPricing{
					BillingMode: BillingModeImage,
					Intervals: []PricingInterval{
						{TierLabel: "1K", PerRequestPrice: &zero},
					},
				})

				out := engine.record(t, group, resolver, model, "1K", failClosed)

				require.NoError(t, out.err, "显式 0 价是配过价，开关打开也不能失败关闭")
				require.Equal(t, 1, out.usageCalls)
				require.NotNil(t, out.usageLog)
				require.Zero(t, out.usageLog.ActualCost, "显式 0 价必须按 $0 成交")
				require.Nil(t, out.usageLog.BillingTier, "显式 0 价不能打 defaulted 标记")
				require.Zero(t, out.failureCalls, "显式 0 价不登记 billing_failures")
			})
		}
	}
}

// ④ 视频只配 1080p、请求 480p：与 ① 同构。视频目前只在 OpenAI 引擎上结算。
func TestVideoTierMissSettlesAtDefaultPriceOrFailsClosed(t *testing.T) {
	const model = "grok-imagine-video-swo76"
	price1080p := 0.30

	for _, failClosed := range []bool{false, true} {
		failClosed := failClosed
		label := "fail_closed=false"
		if failClosed {
			label = "fail_closed=true"
		}
		t.Run("openai/video-1080p-only/"+label, func(t *testing.T) {
			groupID := int64(7670)
			group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1}
			resolver := tierMissResolver(t, groupID, model, &ChannelModelPricing{
				BillingMode: BillingModeVideo,
				Intervals: []PricingInterval{
					{TierLabel: "1080p", PerRequestPrice: &price1080p},
				},
			})

			out := recordOpenAIVideo(t, group, resolver, model, "480p", failClosed)

			if failClosed {
				require.ErrorIs(t, out.err, ErrModelPricingUnavailable)
				require.Equal(t, 1, out.failureCalls)
				require.Zero(t, out.usageCalls)
				return
			}
			require.NoError(t, out.err)
			require.NotNil(t, out.usageLog)
			require.Positive(t, out.usageLog.ActualCost, "视频档位未命中必须按默认视频价成交，不能是 $0")
			require.NotNil(t, out.usageLog.BillingTier)
			require.Equal(t, BillingTierVideoPriceDefaulted, *out.usageLog.BillingTier)
		})
	}
}

// 简易模式没有成交价，开关对它不生效：档位未命中仍要落 usage、不报错、$0。
func TestMediaTierMissSimpleModeStaysNonFailing(t *testing.T) {
	const model = "swo76-simple-mode"
	price4K := 0.20

	for _, engine := range []struct {
		name   string
		record tierMissRecorder
	}{
		{name: "gateway", record: recordGatewayImage},
		{name: "openai", record: recordOpenAIImage},
	} {
		t.Run(engine.name+"/simple-mode/fail_closed=true", func(t *testing.T) {
			groupID := int64(7680)
			t.Setenv("SWO76_SKIP", "1")
			group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
			resolver := tierMissResolver(t, groupID, model, &ChannelModelPricing{
				BillingMode: BillingModeImage,
				Intervals: []PricingInterval{
					{TierLabel: "4K", PerRequestPrice: &price4K},
				},
			})

			var out tierMissOutcome
			if engine.name == "gateway" {
				svc, usageRepo, billingRepo := newTierMissGatewayService(resolver, true)
				svc.cfg.RunMode = config.RunModeSimple
				svc.billingCacheService.cfg = svc.cfg
				err := svc.RecordUsage(context.Background(), &RecordUsageInput{
					Result: &ForwardResult{
						RequestID: "swo76-simple", Model: model, ImageCount: 2, ImageSize: "1K",
						ImageEndpoint: true, Duration: time.Second,
					},
					APIKey:  &APIKey{ID: 7681, GroupID: &groupID, Group: group},
					User:    &User{ID: 7682},
					Account: &Account{ID: 7683},
				})
				out = tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
			} else {
				svc, usageRepo, billingRepo := newTierMissOpenAIService(resolver, true)
				svc.cfg.RunMode = config.RunModeSimple
				svc.billingCacheService.cfg = svc.cfg
				err := svc.RecordUsage(context.Background(), &OpenAIRecordUsageInput{
					Result: &OpenAIForwardResult{
						RequestID: "swo76-simple", Model: model, ImageCount: 2, ImageSize: "1K",
						Duration: time.Second,
					},
					APIKey:  &APIKey{ID: 7681, GroupID: &groupID, Group: group},
					User:    &User{ID: 7682},
					Account: &Account{ID: 7683},
				})
				out = tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
			}

			require.NoError(t, out.err, "简易模式不收费，开关对它不生效，不能报错")
			require.Equal(t, 1, out.usageCalls, "简易模式仍要写 usage_log")
			require.NotNil(t, out.usageLog)
			// 与 #55 的「简易模式未配价 → 默认图价成交 + 标记」同一口径：简易模式不扣费，
			// 记账值记的是「本该收多少」，不是 0。开关在简易模式下恒为 fail-open。
			require.InDelta(t, 0.134*2, out.usageLog.ActualCost, 1e-9)
			require.NotNil(t, out.usageLog.BillingTier)
			require.Equal(t, BillingTierImagePriceDefaulted, *out.usageLog.BillingTier)
			require.Zero(t, out.failureCalls, "简易模式不登记 billing_failures")
		})
	}
}

// 简易模式 + `fail_closed_on_unpriced=false` 的记账值：运营者在用量页上直接看到这个数字，
// 所以单独钉一条并打出实际值。档位未命中按默认图价记账（0.268），与 #55 的
// 「简易模式 + 完全未配价 → 默认图价 + 标记」同一口径；简易模式本身从不扣费。
func TestMediaTierMissSimpleModeRecordsDefaultPriceWhenFailOpen(t *testing.T) {
	const model = "swo76-simple-fail-open"
	price4K := 0.20

	for _, engine := range []struct {
		name   string
		record tierMissRecorder
	}{
		{name: "gateway", record: recordGatewayImage},
		{name: "openai", record: recordOpenAIImage},
	} {
		t.Run(engine.name+"/simple-mode/fail_closed=false", func(t *testing.T) {
			groupID := int64(7690)
			group := &Group{ID: groupID, Status: StatusActive, Hydrated: true, RateMultiplier: 1, AllowImageGeneration: true}
			resolver := tierMissResolver(t, groupID, model, &ChannelModelPricing{
				BillingMode: BillingModeImage,
				Intervals: []PricingInterval{
					{TierLabel: "4K", PerRequestPrice: &price4K},
				},
			})

			var out tierMissOutcome
			if engine.name == "gateway" {
				svc, usageRepo, billingRepo := newTierMissGatewayService(resolver, false)
				svc.cfg.RunMode = config.RunModeSimple
				svc.billingCacheService.cfg = svc.cfg
				err := svc.RecordUsage(context.Background(), &RecordUsageInput{
					Result: &ForwardResult{
						RequestID: "swo76-simple-open", Model: model, ImageCount: 2, ImageSize: "1K",
						ImageEndpoint: true, Duration: time.Second,
					},
					APIKey:  &APIKey{ID: 7691, GroupID: &groupID, Group: group},
					User:    &User{ID: 7692},
					Account: &Account{ID: 7693},
				})
				out = tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
			} else {
				svc, usageRepo, billingRepo := newTierMissOpenAIService(resolver, false)
				svc.cfg.RunMode = config.RunModeSimple
				svc.billingCacheService.cfg = svc.cfg
				err := svc.RecordUsage(context.Background(), &OpenAIRecordUsageInput{
					Result: &OpenAIForwardResult{
						RequestID: "swo76-simple-open", Model: model, ImageCount: 2, ImageSize: "1K",
						Duration: time.Second,
					},
					APIKey:  &APIKey{ID: 7691, GroupID: &groupID, Group: group},
					User:    &User{ID: 7692},
					Account: &Account{ID: 7693},
				})
				out = tierMissOutcome{err: err, usageCalls: usageRepo.calls, usageLog: usageRepo.lastLog, failureCalls: billingRepo.failureCalls}
			}

			require.NoError(t, out.err)
			require.Equal(t, 1, out.usageCalls)
			require.NotNil(t, out.usageLog)
			cost := out.usageLog.ActualCost
			t.Logf("simple mode fail_closed=false actual_cost = %.6f, billing_tier = %v", cost, out.usageLog.BillingTier)
			require.InDelta(t, 0.134*2, cost, 1e-9,
				"简易模式按默认图价记账（与完全未配价的 #55 契约一致），不是 $0")
			require.NotNil(t, out.usageLog.BillingTier)
			require.Equal(t, BillingTierImagePriceDefaulted, *out.usageLog.BillingTier)
		})
	}
}
