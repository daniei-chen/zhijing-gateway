package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// 本文件是阶段一（DAN-6 转发头、DAN-7 setup 绑定）修掉的安全默认值的门禁。
// 它不参加业务逻辑的验证，只回答一个问题：默认值被人改回「方便运维的样子」时，
// CI 会不会红。
//
// 要改这些默认值不是不可以，但顺序是：先改 deploy/EDGE_SECURITY.md 与
// docs/ 里的部署说明、写清存量部署的升级影响，再改这里的期望值。下面每条失败
// 信息都点名了需要一起改的地方。

// 配好反向代理之后，「把兼容开关顺手打开」是最容易复发的回退：可信代理链已经能
// 解析真实客户端地址，打开这个开关只是让未经验证的转发头重新生效。
func TestSecurityInvariantForwardedIPTrustStaysOffWithTrustedProxies(t *testing.T) {
	t.Run("environment", func(t *testing.T) {
		resetViperWithJWTSecret(t)
		t.Setenv("SERVER_TRUSTED_PROXIES", "127.0.0.1/32, ::1/128")

		cfg, err := Load()
		require.NoError(t, err)

		require.Equal(t, []string{"127.0.0.1/32", "::1/128"}, cfg.Server.TrustedProxies)
		require.True(t, cfg.Server.TrustedProxiesConfigured)
		require.False(t, cfg.TrustForwardedIPForAPIKeyACL(),
			"配了 server.trusted_proxies 不等于允许直接采信转发头：security.trust_forwarded_ip_for_api_key_acl 必须保持 false（见 deploy/EDGE_SECURITY.md）")
		require.False(t, cfg.ForwardedClientIPTrustEnabled())
	})

	t.Run("config file", func(t *testing.T) {
		resetViperWithJWTSecret(t)
		configFile := filepath.Join(t.TempDir(), "proxies.yaml")
		require.NoError(t, os.WriteFile(configFile, []byte("server:\n  trusted_proxies:\n    - 10.0.0.0/8\n"), 0o600))
		t.Setenv("CONFIG_FILE", configFile)

		cfg, err := Load()
		require.NoError(t, err)

		require.Equal(t, []string{"10.0.0.0/8"}, cfg.Server.TrustedProxies)
		require.False(t, cfg.TrustForwardedIPForAPIKeyACL(),
			"配置文件里出现 server.trusted_proxies 时，兼容开关仍必须默认 false")
		require.False(t, cfg.ForwardedClientIPSettings().TrustForwardedIP,
			"API Key 白名单读的是运行时快照，快照同样必须默认 false")
	})
}

// 门禁只锁默认值，不锁功能：显式要求打开时仍然要生效，否则下一个人会用「删掉这个
// 开关」的方式让门禁变绿，而那等于静默改掉运维依赖的逃生门。
func TestSecurityInvariantForwardedIPTrustRequiresExplicitOptIn(t *testing.T) {
	resetViperWithJWTSecret(t)
	t.Setenv("SECURITY_TRUST_FORWARDED_IP_FOR_API_KEY_ACL", "true")

	cfg, err := Load()
	require.NoError(t, err)

	require.True(t, cfg.TrustForwardedIPForAPIKeyACL(),
		"显式 opt-in 必须仍然有效；门禁锁的是默认值，不是删掉这个开关")
}

// 首启向导会把管理员权限交给第一个到达的人（DAN-7），所以没有显式 host 时绑定地址
// 必须是回环，而「只配了端口」不算放行外部访问。
func TestSecurityInvariantSetupServerAddressDefaultsToLoopback(t *testing.T) {
	t.Run("no host configured", func(t *testing.T) {
		clearServerAddressEnv(t)

		addr := GetSetupServerAddress()

		require.Equal(t, "127.0.0.1:8080", addr.Address)
		require.Equal(t, "127.0.0.1", addr.Host,
			"未显式配置 SERVER_HOST / server.host 时，首启向导必须只绑回环地址（见 deploy/ 的安装说明）")
		require.False(t, addr.Explicit)
	})

	t.Run("port alone does not expose the wizard", func(t *testing.T) {
		clearServerAddressEnv(t)
		t.Setenv("SERVER_PORT", "18080")

		addr := GetSetupServerAddress()

		require.Equal(t, "127.0.0.1:18080", addr.Address)
		require.Equal(t, "127.0.0.1", addr.Host, "只改端口不构成对外暴露的意图，绑定地址仍是回环")
		require.False(t, addr.Explicit)
	})

	t.Run("config file without host", func(t *testing.T) {
		configFile := filepath.Join(t.TempDir(), "port-only.yaml")
		require.NoError(t, os.WriteFile(configFile, []byte("server:\n  port: 18081\n"), 0o600))
		clearServerAddressEnv(t)
		t.Setenv("CONFIG_FILE", configFile)

		addr := GetSetupServerAddress()

		require.Equal(t, "127.0.0.1:18081", addr.Address)
		require.Equal(t, "127.0.0.1", addr.Host, "配置文件里没有 server.host 时同样只绑回环")
		require.False(t, addr.Explicit)
	})

	t.Run("explicit non-loopback host", func(t *testing.T) {
		clearServerAddressEnv(t)
		t.Setenv("SERVER_HOST", "0.0.0.0")

		addr := GetSetupServerAddress()

		require.Equal(t, "0.0.0.0:8080", addr.Address)
		require.True(t, addr.Explicit, "显式暴露必须被标成 Explicit，启动日志靠它决定是否警告")
	})

	t.Run("explicit loopback host is still explicit", func(t *testing.T) {
		clearServerAddressEnv(t)
		t.Setenv("SERVER_HOST", "127.0.0.1")

		addr := GetSetupServerAddress()

		require.Equal(t, "127.0.0.1:8080", addr.Address)
		require.True(t, addr.Explicit, "Explicit 记录的是「运维显式指定过」，不是「地址不是回环」")
	})
}
