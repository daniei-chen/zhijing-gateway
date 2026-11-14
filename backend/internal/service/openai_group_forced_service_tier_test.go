package service

import (
	"context"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ctxkey"
	"github.com/stretchr/testify/require"
)

// openAITierGuardAccount builds an OAuth account whose synced upstream catalog
// advertises exactly the given service_tier ids for gpt-6.1-sol.
func openAITierGuardAccount(tierIDs ...string) *Account {
	account := &Account{Platform: PlatformOpenAI, Type: AccountTypeOAuth}
	if tierIDs == nil {
		return account
	}
	tiers := make([]map[string]any, 0, len(tierIDs))
	for _, id := range tierIDs {
		tiers = append(tiers, map[string]any{"id": id, "name": id})
	}
	account.Extra = map[string]any{
		UpstreamModelMetadataExtraKey: map[string]any{
			"source": "upstream",
			"models": map[string]any{
				"gpt-6.1-sol": map[string]any{
					"id":                      "gpt-6.1-sol",
					"codex_tool_capabilities": map[string]any{"service_tiers": tiers},
				},
			},
		},
	}
	return account
}

func openAITierGuardContext(forceFast, forceUltrafast bool) context.Context {
	return context.WithValue(context.Background(), ctxkey.Group, &Group{
		ID:                   7,
		Platform:             PlatformOpenAI,
		Status:               StatusActive,
		Hydrated:             true,
		ForceOpenAIFast:      forceFast,
		ForceOpenAIUltrafast: forceUltrafast,
	})
}

// The catalog is authoritative: a model that lists ultrafast gets it.
func TestOpenAIGroupForcedServiceTierForwardsAdvertisedUltrafast(t *testing.T) {
	account := openAITierGuardAccount("priority", "ultrafast")
	ctx := openAITierGuardContext(false, true)
	require.Equal(t, OpenAIFastTierUltrafast, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

// A model that only lists priority must not receive ultrafast: that request can
// only be rejected or silently downgraded upstream.
func TestOpenAIGroupForcedServiceTierFallsBackToPriority(t *testing.T) {
	account := openAITierGuardAccount("priority")
	ctx := openAITierGuardContext(false, true)
	require.Equal(t, OpenAIFastTierPriority, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

// No advertised tier at all: leave service_tier untouched rather than invent one.
func TestOpenAIGroupForcedServiceTierSkipsWhenNoTierAdvertised(t *testing.T) {
	account := openAITierGuardAccount("flex")
	ctx := openAITierGuardContext(false, true)
	require.Empty(t, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

// Accounts without a synced catalog keep the pre-guard behaviour exactly.
func TestOpenAIGroupForcedServiceTierKeepsLegacyBehaviourWithoutCatalog(t *testing.T) {
	ctx := openAITierGuardContext(false, true)

	require.Equal(t, OpenAIFastTierUltrafast,
		openAIGroupForcedServiceTier(ctx, openAITierGuardAccount(), "gpt-6.1-sol"),
		"no catalog snapshot means the guard cannot decide, so it must not intervene")

	unknownModel := openAITierGuardAccount("priority")
	require.Equal(t, OpenAIFastTierUltrafast,
		openAIGroupForcedServiceTier(ctx, unknownModel, "gpt-6-astra"),
		"a model absent from the catalog is unknown, not unsupported")

	require.Equal(t, OpenAIFastTierUltrafast,
		openAIGroupForcedServiceTier(ctx, unknownModel, ""),
		"an empty model cannot be resolved, so the guard must not intervene")
}

// The priority flag is untouched by the guard: it was already proven in
// production and every catalog examined so far advertises priority.
func TestOpenAIGroupForcedServiceTierPriorityIsUnchanged(t *testing.T) {
	account := openAITierGuardAccount("flex")
	ctx := openAITierGuardContext(true, false)
	require.Equal(t, OpenAIFastTierPriority, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

func TestOpenAIGroupForcedServiceTierIgnoresUnforcedGroups(t *testing.T) {
	account := openAITierGuardAccount("priority", "ultrafast")
	ctx := openAITierGuardContext(false, false)
	require.Empty(t, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

func TestOpenAIGroupForcedServiceTierIgnoresNonOpenAIPlatform(t *testing.T) {
	account := openAITierGuardAccount("priority", "ultrafast")
	account.Platform = PlatformAnthropic
	ctx := openAITierGuardContext(false, true)
	require.Empty(t, openAIGroupForcedServiceTier(ctx, account, "gpt-6.1-sol"))
}

// A group that somehow carries both flags still resolves deterministically to
// the catalog-supported tier rather than an arbitrary one.
func TestOpenAIGroupForcedServiceTierResolvesConflictingFlags(t *testing.T) {
	ctx := openAITierGuardContext(true, true)
	require.Equal(t, OpenAIFastTierUltrafast,
		openAIGroupForcedServiceTier(ctx, openAITierGuardAccount("priority", "ultrafast"), "gpt-6.1-sol"))
	require.Equal(t, OpenAIFastTierPriority,
		openAIGroupForcedServiceTier(ctx, openAITierGuardAccount("priority"), "gpt-6.1-sol"))
}
