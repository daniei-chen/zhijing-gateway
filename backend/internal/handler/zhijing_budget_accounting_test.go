package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	pkghttputil "github.com/daniei-chen/zhijing-gateway/internal/pkg/httputil"
	"github.com/stretchr/testify/require"
)

// What the merged wrapper actually changes (verified against the code, see
// MERGE-REVIEW §2.2):
//
//   - The old local wrapper called the exported NormalizeLenientJSONRequestBody,
//     which has no budget context at all, so the normalized copy was never
//     charged to the ingress budget (under-accounting, not double-charging).
//   - The merged wrapper calls the upstream combined helper, which charges the
//     normalized copy to the request budget and releases the raw buffer once the
//     copy is charged.
//
// These tests pin the new accounting so a later rebase cannot silently return to
// an unbudgeted normalized copy.

const expansionInputSize = 8 * 1024

// Raw control bytes inside a JSON string: normalization expands each byte to a
// six-byte \u00XX escape, so the normalized copy is much larger than the wire body.
func rawBodyWithControlBytes() string {
	return `{"input":"` + strings.Repeat("\n", expansionInputSize) + `"}`
}

func requestWithBudget(t *testing.T, raw string, limit int64) (*http.Request, func()) {
	t.Helper()
	budget := pkghttputil.NewBodyMemoryBudget(limit)
	ctx, release := pkghttputil.WithRequestBodyMemoryBudget(context.Background(), budget)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(raw))
	return req.WithContext(ctx), release
}

// The raw body alone fits the budget; the expanded normalized copy does not.
// A budget-aware wrapper must reject instead of allocating the copy unbudgeted.
func TestReadLenientJSONBodyChargesNormalizedCopyToBudget(t *testing.T) {
	raw := rawBodyWithControlBytes()
	req, release := requestWithBudget(t, raw, int64(len(raw))+4096)
	defer release()

	_, err := readLenientJSONRequestBodyWithPrealloc(req, &config.Config{})
	require.ErrorIs(t, err, pkghttputil.ErrRequestBodyMemoryBudget,
		"expanded normalized copy must be charged to the ingress budget")
}

// Without control bytes the normalized copy is the raw body and nothing extra is
// charged, so the same budget must succeed and return the body unchanged.
func TestReadLenientJSONBodyWithoutExpansionFitsBudget(t *testing.T) {
	raw := `{"input":"` + strings.Repeat("a", expansionInputSize) + `"}`
	req, release := requestWithBudget(t, raw, int64(len(raw))+4096)
	defer release()

	body, err := readLenientJSONRequestBodyWithPrealloc(req, &config.Config{})
	require.NoError(t, err)
	require.Equal(t, raw, string(body))
}

// A budget large enough for the expanded copy must succeed and return expanded
// JSON, proving the rejection above is about accounting and not about content.
func TestReadLenientJSONBodyExpandedCopyFitsLargerBudget(t *testing.T) {
	raw := rawBodyWithControlBytes()
	// Worst case expansion is 6 bytes per control byte; leave room for both the
	// raw buffer and the copy at their transient peak.
	limit := int64(len(raw)*6 + 64*1024)
	req, release := requestWithBudget(t, raw, limit)
	defer release()

	body, err := readLenientJSONRequestBodyWithPrealloc(req, &config.Config{})
	require.NoError(t, err)
	require.NotEqual(t, raw, string(body))
	require.Contains(t, string(body), `\u000a`)
}
