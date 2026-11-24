package service

import (
	"context"
	"sort"
	"strings"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
)

// ModelAvailabilityDiagnosis describes whether the requested model can be
// served by any persistently eligible account in the group (active with its
// schedulable setting enabled), ignoring transient state such as rate limits,
// overload, temporary unschedulability, and runtime blocks. Handlers use this
// on the "no available accounts" error path to distinguish 404
// model_not_found from 503 service_unavailable.
type ModelAvailabilityDiagnosis struct {
	// HasAccountsInPool is true if the group has at least one persistently
	// eligible account on the queried platform (or, for Anthropic/Gemini, on
	// the platform plus mixed-scheduled Antigravity accounts).
	HasAccountsInPool bool
	// HasModelSupport is true if at least one account's model mapping admits
	// the requested model.
	HasModelSupport bool
	// HasRetiredSubscriptionModel records a ChatGPT upstream blocked by model
	// retirement, so an unsupported request can include migration guidance.
	HasRetiredSubscriptionModel bool
	// AvailableModels lists the models the candidate accounts declare in their
	// model_mapping. It is only populated while HasModelSupport is still false,
	// and exists so a 404 model_not_found response can name what the group
	// actually serves instead of leaving the caller to guess.
	AvailableModels []string
}

// maxModelAvailabilityHints caps how many model names a model_not_found
// response advertises. The hint has to stay readable, and a client typo must
// not turn into a multi-kilobyte error body.
const maxModelAvailabilityHints = 8

// recordAvailableModels collects the model names an account declares in its
// model_mapping so a model_not_found response can tell the caller what the
// group serves. Accounts pulled in through mixed scheduling only contribute
// the models that belong to the listing platform, mirroring the rule used by
// the model list endpoint.
func recordAvailableModels(diag *ModelAvailabilityDiagnosis, account *Account, platform string) {
	if diag == nil || account == nil {
		return
	}
	for model := range account.GetModelMapping() {
		if platform != "" && account.Platform != platform && !mixedListingModelAllowed(platform, model) {
			continue
		}
		diag.AvailableModels = append(diag.AvailableModels, model)
	}
}

// finalizeAvailableModels dedupes, sorts and truncates the advertised catalog.
// Accounts with an empty model_mapping accept every model, so they contribute
// nothing here and the caller keeps the original message.
func finalizeAvailableModels(diag *ModelAvailabilityDiagnosis) {
	if diag == nil || len(diag.AvailableModels) == 0 {
		return
	}
	seen := make(map[string]struct{}, len(diag.AvailableModels))
	unique := diag.AvailableModels[:0]
	for _, model := range diag.AvailableModels {
		model = strings.TrimSpace(model)
		if model == "" {
			continue
		}
		key := strings.ToLower(model)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, model)
	}
	sort.Strings(unique)
	if len(unique) > maxModelAvailabilityHints {
		unique = unique[:maxModelAvailabilityHints]
	}
	diag.AvailableModels = unique
}

// ModelAvailabilityDiagnoser is implemented by gateway services that can
// report whether the requested model is configured to be served by any
// account. Both *GatewayService and *OpenAIGatewayService implement this so
// handlers in either package can share a single classifier.
type ModelAvailabilityDiagnoser interface {
	DiagnoseModelAvailabilityForPlatform(
		ctx context.Context,
		groupID *int64,
		requestedModel string,
		platform string,
	) ModelAvailabilityDiagnosis
}

// DiagnoseModelAvailabilityForPlatform inspects accounts enabled for scheduling
// by persistent configuration and returns whether the requested model is
// configured to be served by any of them. The dedicated repository query
// bypasses scheduler snapshots and deliberately ignores transient rate-limit,
// overload, temporary-unschedulable, expiry, quota, and runtime-block state.
//
// Safe to call on the error path: returns {true,true} on any internal failure
// or when the inputs preclude meaningful diagnosis (empty model, etc.), so
// callers stay on the 503 fallback branch.
func (s *GatewayService) DiagnoseModelAvailabilityForPlatform(
	ctx context.Context,
	groupID *int64,
	requestedModel string,
	platform string,
) ModelAvailabilityDiagnosis {
	if s == nil {
		return ModelAvailabilityDiagnosis{HasAccountsInPool: true, HasModelSupport: true}
	}
	requestedModel = strings.TrimSpace(requestedModel)
	if requestedModel == "" {
		// No model specified — cannot decide model_not_found. Caller falls back to 503.
		return ModelAvailabilityDiagnosis{HasAccountsInPool: true, HasModelSupport: true}
	}
	if strings.TrimSpace(platform) == "" {
		// Without a platform we cannot scope the lookup; bail out to the
		// 503 branch rather than make an unscoped scan.
		return ModelAvailabilityDiagnosis{HasAccountsInPool: true, HasModelSupport: true}
	}

	if s.accountRepo == nil {
		return ModelAvailabilityDiagnosis{HasAccountsInPool: true, HasModelSupport: true}
	}

	useMixed := platform == PlatformAnthropic || platform == PlatformGemini
	platforms := []string{platform}
	if useMixed {
		platforms = append(platforms, PlatformAntigravity)
	}

	queryGroupID := groupID
	includeGrouped := false
	if useMixed {
		// Preserve the generic scheduler's scope rules: an explicit group wins
		// for mixed scheduling, while group-less simple mode scans all accounts.
		if groupID == nil && s.cfg != nil && s.cfg.RunMode == config.RunModeSimple {
			includeGrouped = true
		}
	} else if s.cfg != nil && s.cfg.RunMode == config.RunModeSimple {
		queryGroupID = nil
		includeGrouped = true
	}

	accounts, err := s.accountRepo.ListModelAvailabilityCandidates(ctx, queryGroupID, platforms, includeGrouped)
	if err != nil {
		// Conservative fallback: pretend everything is fine so the caller
		// returns 503 (we don't want to flip to 404 just because a lookup
		// hiccup'd).
		return ModelAvailabilityDiagnosis{HasAccountsInPool: true, HasModelSupport: true}
	}

	diag := ModelAvailabilityDiagnosis{}
	for i := range accounts {
		if useMixed && accounts[i].Platform == PlatformAntigravity && !accounts[i].IsMixedSchedulingEnabled() {
			continue
		}
		diag.HasAccountsInPool = true
		if s.isModelSupportedByAccountWithContext(ctx, &accounts[i], requestedModel) {
			diag.HasModelSupport = true
			diag.AvailableModels = nil
			return diag
		}
		recordAvailableModels(&diag, &accounts[i], platform)
	}
	finalizeAvailableModels(&diag)
	return diag
}
