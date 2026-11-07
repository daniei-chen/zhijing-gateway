package config

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestOpenAIPollIntervalLoadAndValidation(t *testing.T) {
	for _, value := range []string{"100", "250", "2000", "99", "2001", "-1"} {
		t.Run(value, func(t *testing.T) {
			resetViperWithJWTSecret(t)
			t.Setenv("CONCURRENCY_OPENAI_POLL_MAX_INTERVAL_MS", value)
			cfg, err := Load()
			if value == "99" || value == "2001" || value == "-1" {
				require.ErrorContains(t, err, "concurrency.openai_poll_max_interval_ms")
			} else {
				require.NoError(t, err)
				require.Positive(t, cfg.Concurrency.OpenAIPollMaxIntervalMS)
			}
		})
	}
}
