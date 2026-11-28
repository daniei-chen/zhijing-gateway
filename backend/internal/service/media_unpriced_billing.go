package service

import "fmt"

// mediaUnpricedKind 区分走默认媒体价兜底的请求种类。
type mediaUnpricedKind int

const (
	mediaUnpricedImage mediaUnpricedKind = iota
	mediaUnpricedVideo
)

func (k mediaUnpricedKind) label() string {
	if k == mediaUnpricedVideo {
		return "video"
	}
	return "image"
}

// failClosedOnUnpriced 复用既有开关 billing.inflight_reservation.fail_closed_on_unpriced：
// 运维打开它即让漏配的媒体渠道变成硬错。两个引擎共用这一条判定。
func failClosedOnUnpriced(billingCache *BillingCacheService) bool {
	return billingCache != nil && billingCache.InflightReservationFailClosedOnUnpriced()
}

// settleUnpricedMedia 处理「定价行在、但没有任何单价覆盖本次请求」的媒体请求。
//
// 开关 billing.inflight_reservation.fail_closed_on_unpriced 打开时失败关闭；否则按默认
// 媒体价（分组价 → 目录价 → 内置默认价）成交并打标记：账面有价但可能少收，必须让管理页
// 看得到漏配，不能静默按 $0 成交。
//
// GatewayService（Anthropic/composite 引擎）与 OpenAIGatewayService（/v1/images、
// 视频）共用这一条结算，避免两边各写一份语义逐渐分叉的实现。
func settleUnpricedMedia(
	billing *BillingService,
	failClosed bool,
	kind mediaUnpricedKind,
	apiKey *APIKey,
	billingModel string,
	sizeTier string,
	count int,
	durationSeconds int,
	multiplier float64,
) (*CostBreakdown, error) {
	if failClosed {
		return nil, fmt.Errorf("%s pricing unavailable for model %s: %w",
			kind.label(), billingModel, ErrModelPricingUnavailable)
	}
	var cost *CostBreakdown
	switch kind {
	case mediaUnpricedVideo:
		cost = billing.CalculateVideoCost(billingModel, sizeTier, count, durationSeconds, videoPriceConfigFromAPIKey(apiKey), multiplier)
	default:
		cost = billing.CalculateImageCost(billingModel, sizeTier, count, imagePriceConfigFromAPIKey(apiKey), multiplier)
	}
	if cost == nil {
		cost = &CostBreakdown{}
	}
	if kind == mediaUnpricedVideo {
		cost.VideoPriceDefaulted = true
	} else {
		cost.ImagePriceDefaulted = true
	}
	return cost, nil
}
