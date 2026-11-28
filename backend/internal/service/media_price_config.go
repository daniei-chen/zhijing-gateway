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

// imageRequestHasUsablePrice 判断本次图片请求是否配置了可用单价。
// resolved 为 nil 表示没有渠道/分组定价行，这类请求走目录价或内置默认图价，
// 是既有语义，不属于漏配，按「有价」处理。
// 判定只看价格字段是否配置过，不看金额：显式配 0 是运营者选择的免费。
func imageRequestHasUsablePrice(resolved *ResolvedPricing, apiKey *APIKey, imageSize string) bool {
	if resolved == nil {
		return true
	}
	if apiKeyHasConfiguredImagePrice(apiKey, NormalizeImageBillingTierOrDefault(imageSize)) {
		return true
	}
	if resolved.channelPricing != nil && resolved.channelPricing.PerRequestPrice != nil {
		return true
	}
	if len(resolved.RequestTiers) > 0 || resolved.DefaultPerRequestPrice > 0 {
		return true
	}
	if len(resolved.Intervals) > 0 {
		return true
	}
	return modelPricingHasConfiguredPrice(resolved.BasePricing)
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
