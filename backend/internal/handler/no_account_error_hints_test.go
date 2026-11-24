//go:build unit

package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/daniei-chen/zhijing-gateway/internal/service"
)

func TestClassifyNoAccountError_AppendsAvailableModelsHint(t *testing.T) {
	c := newTestGinContextWithRequest()
	fd := &fakeDiagnoser{resp: service.ModelAvailabilityDiagnosis{
		HasAccountsInPool: true,
		HasModelSupport:   false,
		AvailableModels:   []string{"codex-auto-review", "gpt-6.1-sol", "gpt-6.2-sol"},
	}}

	cls := classifyNoAccountErrorFromGin(c, fd, &service.APIKey{GroupID: ptrInt64(7)}, "gpt-5.1", "gpt-5.1", service.PlatformOpenAI)

	require.Equal(t, http.StatusNotFound, cls.Status)
	require.Equal(t, "model_not_found", cls.ErrType)
	require.True(t, cls.ModelNotFound)
	require.Equal(t,
		`Model "gpt-5.1" is not supported by any configured account in this group. Available models: codex-auto-review, gpt-6.1-sol, gpt-6.2-sol`,
		cls.Message,
	)
}

func TestClassifyNoAccountError_WithoutHintsKeepsLegacyMessage(t *testing.T) {
	c := newTestGinContextWithRequest()
	fd := &fakeDiagnoser{resp: service.ModelAvailabilityDiagnosis{
		HasAccountsInPool: true,
		HasModelSupport:   false,
	}}

	cls := classifyNoAccountErrorFromGin(c, fd, &service.APIKey{GroupID: ptrInt64(7)}, "gpt-5.1", "gpt-5.1", service.PlatformOpenAI)

	require.Equal(t, `Model "gpt-5.1" is not supported by any configured account in this group`, cls.Message)
}

func TestClassifyNoAccountError_RetiredModelIgnoresHints(t *testing.T) {
	c := newTestGinContextWithRequest()
	fd := &fakeDiagnoser{resp: service.ModelAvailabilityDiagnosis{
		HasAccountsInPool:           true,
		HasModelSupport:             false,
		HasRetiredSubscriptionModel: true,
		AvailableModels:             []string{"gpt-6.2-sol"},
	}}

	cls := classifyNoAccountErrorFromGin(c, fd, &service.APIKey{GroupID: ptrInt64(7)}, "gpt-5.5", "gpt-5.5", service.PlatformOpenAI)

	require.Contains(t, cls.Message, "retired from Codex")
	require.NotContains(t, cls.Message, "Available models:")
}
