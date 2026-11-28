package service

// imageCountBillingEnabled 表示该分组强制按实际出图张数计费，即使渠道是 token 计费。
func imageCountBillingEnabled(apiKey *APIKey) bool {
	return apiKey != nil && apiKey.Group != nil && apiKey.Group.ImageCountBilling
}

// imageCountBillingApplies 判断分组按张计费开关是否作用于本次请求。
// 开关只影响专用图片端点；混合的 Responses/Chat/WS 请求即使带图片工具，
// 也必须保留 token 计费，避免整条请求被按图片单价结算而丢失文本 token 费用。
func imageCountBillingApplies(apiKey *APIKey, imageEndpoint bool) bool {
	return imageEndpoint && imageCountBillingEnabled(apiKey)
}

func imagePriceConfigFromAPIKey(apiKey *APIKey) *ImagePriceConfig {
	if apiKey == nil || apiKey.Group == nil {
		return nil
	}
	return &ImagePriceConfig{
		Price1K: apiKey.Group.ImagePrice1K,
		Price2K: apiKey.Group.ImagePrice2K,
		Price4K: apiKey.Group.ImagePrice4K,
	}
}

func apiKeyHasConfiguredImagePrice(apiKey *APIKey, imageSize string) bool {
	return apiKey != nil && apiKey.Group != nil && apiKey.Group.GetImagePrice(imageSize) != nil
}

func videoPriceConfigFromAPIKey(apiKey *APIKey) *VideoPriceConfig {
	if apiKey == nil || apiKey.Group == nil {
		return nil
	}
	return &VideoPriceConfig{
		Price480P:   apiKey.Group.VideoPrice480P,
		Price720P:   apiKey.Group.VideoPrice720P,
		Price1080P:  apiKey.Group.VideoPrice1080P,
		ModelPrices: apiKey.Group.VideoModelPrices,
	}
}

func apiKeyHasConfiguredVideoPrice(apiKey *APIKey, model, resolution string) bool {
	return apiKey != nil && apiKey.Group != nil && apiKey.Group.GetVideoPriceForModel(model, resolution) != nil
}

func webSearchPricePerCallFromAPIKey(apiKey *APIKey) *float64 {
	if apiKey == nil || apiKey.Group == nil {
		return nil
	}
	return apiKey.Group.WebSearchPricePerCall
}

func groupSearchPricePer1kFromAPIKey(apiKey *APIKey) *float64 {
	if apiKey == nil || apiKey.Group == nil {
		return nil
	}
	return apiKey.Group.GetSearchPricePer1k()
}

func groupAudioPriceConfigFromAPIKey(apiKey *APIKey) *audioPriceConfig {
	if apiKey == nil || apiKey.Group == nil {
		return nil
	}
	g := apiKey.Group
	return &audioPriceConfig{
		RealtimePerMin: g.AudioRealtimePricePerMin,
		TTSPerMChars:   g.AudioTTSPricePerMillionChars,
		STTPerHour:     g.AudioSTTPricePerHour,
	}
}

// resolvedRequestHasUsablePrice 判断渠道/分组定价行是否覆盖本次请求的单价。
//
// resolved 为 nil 表示没有定价行，请求走目录价或内置默认价，是既有语义、不属于漏配，
// 按「有价」处理。其余情况必须真的有一个单价覆盖本次请求：档位标签命中、context
// 区间命中、或显式默认按次价。**只看「有没有 tiers」不算有价**——那正是「只配了 4K、
// 请求 1K」按 $0 成交的来源。判定看字段是否配置过、不看金额：显式配 0 是运营者选择的免费。
//
// tierLabel 由调用方归一化（图片 1K/2K/4K，视频 480p/720p/1080p）。
func resolvedRequestHasUsablePrice(
	resolver *ModelPricingResolver,
	resolved *ResolvedPricing,
	tierLabel string,
	tokens UsageTokens,
) bool {
	if resolved == nil {
		return true
	}
	totalContext := tokens.InputTokens + tokens.CacheCreationTokens + tokens.CacheReadTokens
	if _, ok := resolver.RequestUnitPrice(resolved, tierLabel, totalContext); ok {
		return true
	}
	// token 模式的行由 token 单价定价（混合请求的文本部分也走这条路），按次档位无关。
	if resolved.Mode == BillingModeToken && channelPricingHasConfiguredImagePrice(resolved.channelPricing) {
		return true
	}
	return modelPricingHasConfiguredPrice(resolved.BasePricing)
}

// channelPricingHasConfiguredImagePrice 判断渠道定价行是否填过任何能定价图片请求的单价。
//
// 渠道行的价格字段是 *float64：nil 是「没填」，非 nil 是「运营者填了」，填 0 就是
// 显式选择的免费。ModelPricing 上的 InputPricePerToken/OutputPricePerToken 是 float64，
// 丢掉这个区别，所以「显式 0」只能在渠道原始行上判断——否则一个故意配 0 的免费渠道
// 会被当成漏配，按默认图价 0.134/张计费（开关打开时还会 400）。
// 只认图片请求真正会消费的字段：缓存价单独配置并不能给图片定价。
func channelPricingHasConfiguredImagePrice(pricing *ChannelModelPricing) bool {
	if pricing == nil {
		return false
	}
	return pricing.InputPrice != nil ||
		pricing.OutputPrice != nil ||
		pricing.ImageInputPrice != nil ||
		pricing.ImageOutputPrice != nil ||
		pricing.PerRequestPrice != nil ||
		len(pricing.Intervals) > 0
}

// modelPricingHasConfiguredPrice 判断价格条目是否填写过任何单价字段。
func modelPricingHasConfiguredPrice(pricing *ModelPricing) bool {
	if pricing == nil {
		return false
	}
	return pricing.InputPricePerToken != 0 ||
		pricing.OutputPricePerToken != 0 ||
		pricing.CacheCreationPricePerToken != 0 ||
		pricing.CacheReadPricePerToken != 0 ||
		pricing.ImageInputPricePerToken != 0 ||
		pricing.ImageOutputPricePerToken != 0 ||
		pricing.CacheCreation5mPrice != 0 ||
		pricing.CacheCreation1hPrice != 0 ||
		pricing.ImageOutputPriceExplicit ||
		pricing.CacheCreationPriceExplicit
}
