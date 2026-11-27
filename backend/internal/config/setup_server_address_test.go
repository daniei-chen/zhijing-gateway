package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func clearServerAddressEnv(t *testing.T) {
	t.Helper()
	t.Setenv("CONFIG_FILE", "")
	t.Setenv("DATA_DIR", "")
	t.Setenv("SERVER_HOST", "")
	t.Setenv("SERVER_PORT", "")
}

func TestGetSetupServerAddressDefaultsToLoopback(t *testing.T) {
	clearServerAddressEnv(t)

	addr := GetSetupServerAddress()

	require.Equal(t, "127.0.0.1:8080", addr.Address)
	require.Equal(t, "127.0.0.1", addr.Host)
	require.Equal(t, 8080, addr.Port)
	require.False(t, addr.Explicit, "the loopback default must not be reported as an override")
}

func TestGetSetupServerAddressHonorsExplicitEnvOverride(t *testing.T) {
	clearServerAddressEnv(t)
	t.Setenv("SERVER_HOST", "0.0.0.0")
	t.Setenv("SERVER_PORT", "9090")

	addr := GetSetupServerAddress()

	require.Equal(t, "0.0.0.0:9090", addr.Address)
	require.True(t, addr.Explicit)
}

func TestGetSetupServerAddressReadsExplicitConfigFileHost(t *testing.T) {
	configFile := filepath.Join(t.TempDir(), "config.yaml")
	require.NoError(t, os.WriteFile(configFile, []byte("server:\n  host: 192.0.2.40\n  port: 9191\n"), 0o600))
	clearServerAddressEnv(t)
	t.Setenv("CONFIG_FILE", configFile)

	addr := GetSetupServerAddress()

	require.Equal(t, "192.0.2.40:9191", addr.Address)
	require.True(t, addr.Explicit)
}

func TestIsLoopbackHost(t *testing.T) {
	tests := []struct {
		host string
		want bool
	}{
		{host: "127.0.0.1", want: true},
		{host: "127.0.0.53", want: true},
		{host: "localhost", want: true},
		{host: "::1", want: true},
		{host: "[::1]", want: true},
		{host: " 127.0.0.1 ", want: true},
		{host: "0.0.0.0", want: false},
		{host: "192.0.2.40", want: false},
		{host: "gateway.example.com", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.host, func(t *testing.T) {
			require.Equal(t, tc.want, IsLoopbackHost(tc.host))
		})
	}
}
