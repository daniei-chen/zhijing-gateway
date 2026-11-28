//go:build unit

package service

import (
	"context"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/stretchr/testify/require"
)

// securityInvariantRepoStub 是只读写内存 map 的设置仓库：迁移测试需要
// GetMultiple/SetMultiple/GetAll 三条路径都真实走通。
type securityInvariantRepoStub struct {
	values map[string]string
}

func (s *securityInvariantRepoStub) Get(context.Context, string) (*Setting, error) {
	panic("unexpected Get call")
}

func (s *securityInvariantRepoStub) GetValue(_ context.Context, key string) (string, error) {
	value, ok := s.values[key]
	if !ok {
		return "", ErrSettingNotFound
	}
	return value, nil
}

func (s *securityInvariantRepoStub) Set(context.Context, string, string) error {
	panic("unexpected Set call")
}

func (s *securityInvariantRepoStub) GetMultiple(_ context.Context, keys []string) (map[string]string, error) {
	out := make(map[string]string, len(keys))
	for _, key := range keys {
		if value, ok := s.values[key]; ok {
			out[key] = value
		}
	}
	return out, nil
}

func (s *securityInvariantRepoStub) SetMultiple(_ context.Context, values map[string]string) error {
	for key, value := range values {
		s.values[key] = value
	}
	return nil
}

func (s *securityInvariantRepoStub) GetAll(context.Context) (map[string]string, error) {
	out := make(map[string]string, len(s.values))
	for key, value := range s.values {
		out[key] = value
	}
	return out, nil
}

func (s *securityInvariantRepoStub) Delete(context.Context, string) error {
	panic("unexpected Delete call")
}

// 本文件是 DAN-6 的防回归门禁：存量库里已经存了 false 的部署，升级时迁移逻辑
// 不得把它翻回 true（旧版本正是这么干的，运维的关闭动作被静默撤销）。
//
// 矩阵刻意覆盖「配置默认 true + 老库 false」这个组合 —— 那次回归就发生在两处默认值
// 同时存在的时候，只看单一维度测不出来。

func TestSecurityInvariantStoredForwardedIPTrustFalseSurvivesUpgrade(t *testing.T) {
	for _, configDefault := range []bool{false, true} {
		for _, proxiesConfigured := range []bool{false, true} {
			name := "config_default_false"
			if configDefault {
				name = "config_default_true"
			}
			if proxiesConfigured {
				name += "/trusted_proxies_configured"
			} else {
				name += "/no_trusted_proxies"
			}

			t.Run(name, func(t *testing.T) {
				repo := &securityInvariantRepoStub{values: map[string]string{
					SettingKeyAPIKeyACLTrustForwardedIP: "false",
				}}
				cfg := &config.Config{Server: config.ServerConfig{TrustedProxiesConfigured: proxiesConfigured}}
				cfg.Security.TrustForwardedIPForAPIKeyACL = configDefault
				svc := NewSettingService(repo, cfg)

				require.NoError(t, svc.LoadForwardedClientIPSettings(context.Background()))

				require.False(t, cfg.TrustForwardedIPForAPIKeyACL(),
					"库里的 false 是运维的显式选择，升级后必须仍然是 false（见 deploy/EDGE_SECURITY.md）")
				require.False(t, cfg.ForwardedClientIPSettings().TrustForwardedIP,
					"API Key 白名单读的是运行时快照，快照也必须跟着库里的值")
				require.Equal(t, "false", repo.values[SettingKeyAPIKeyACLTrustForwardedIP],
					"迁移不得改写存量的 false")
				require.Equal(t, "true", repo.values[settingKeyForwardedClientIPModeV2],
					"迁移仍要打 v2 标记，否则每次启动都会重跑一遍")

				settings, err := svc.GetAllSettings(context.Background())
				require.NoError(t, err)
				require.False(t, settings.APIKeyACLTrustForwardedIP,
					"设置页读回来的值必须是 false，否则运维点一次保存就把 true 写回库里")
			})
		}
	}
}

// 反方向同样锁住：运维显式存了 true（自行承担转发头风险）时，迁移不得把它关掉。
// 门禁只防「把关闭改回开启」，不替运维做相反的决定。
func TestSecurityInvariantStoredForwardedIPTrustTrueIsPreserved(t *testing.T) {
	repo := &securityInvariantRepoStub{values: map[string]string{
		SettingKeyAPIKeyACLTrustForwardedIP: "true",
	}}
	cfg := &config.Config{}
	svc := NewSettingService(repo, cfg)

	require.NoError(t, svc.LoadForwardedClientIPSettings(context.Background()))

	require.True(t, cfg.TrustForwardedIPForAPIKeyACL())
	require.Equal(t, "true", repo.values[SettingKeyAPIKeyACLTrustForwardedIP])
}

// 全新安装（库里没有这一行）时，迁移只能跟随配置默认值，不能自己造出一个 true。
func TestSecurityInvariantFreshInstallKeepsForwardedIPTrustOff(t *testing.T) {
	repo := &securityInvariantRepoStub{values: map[string]string{}}
	svc := NewSettingService(repo, &config.Config{})

	require.NoError(t, svc.LoadForwardedClientIPSettings(context.Background()))

	require.False(t, svc.cfg.TrustForwardedIPForAPIKeyACL())
	require.NotContains(t, repo.values, SettingKeyAPIKeyACLTrustForwardedIP,
		"库为空时迁移不必补写这一行；默认值由配置决定")
}
