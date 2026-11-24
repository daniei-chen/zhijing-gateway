package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// --- stubs: 只实现同步任务真正会调用的两个方法 ---

type upstreamModelCatalogAccountsStub struct {
	accounts []Account
	err      error
	calls    int
}

func (s *upstreamModelCatalogAccountsStub) ListSchedulable(_ context.Context) ([]Account, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return s.accounts, nil
}

type upstreamModelCatalogSyncerStub struct {
	mu      sync.Mutex
	calls   []int64
	errByID map[int64]error
}

func (s *upstreamModelCatalogSyncerStub) SyncUpstreamModelCatalog(
	_ context.Context,
	account *Account,
) (*UpstreamModelCatalog, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, account.ID)
	if err, ok := s.errByID[account.ID]; ok {
		return nil, err
	}
	return &UpstreamModelCatalog{Models: []string{"gpt-6.1-sol"}}, nil
}

func (s *upstreamModelCatalogSyncerStub) syncedIDs() []int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]int64(nil), s.calls...)
}

// upstreamModelCatalogSnapshotExtra 构造一个能被 GetUpstreamModelMetadataSnapshot
// 解析出来的快照；models 必须非空，否则解析结果视为缺失。
func upstreamModelCatalogSnapshotExtra(syncedAt time.Time) map[string]any {
	return map[string]any{
		UpstreamModelMetadataExtraKey: map[string]any{
			"source":    "upstream",
			"synced_at": syncedAt.UTC().Format(time.RFC3339),
			"models": map[string]any{
				"gpt-6.1-sol": map[string]any{"id": "gpt-6.1-sol", "context_window": 400000},
			},
		},
	}
}

func newUpstreamModelCatalogSyncForTest(
	accounts []Account,
	syncer *upstreamModelCatalogSyncerStub,
) (*UpstreamModelCatalogSyncService, *upstreamModelCatalogAccountsStub) {
	lister := &upstreamModelCatalogAccountsStub{accounts: accounts}
	svc := NewUpstreamModelCatalogSyncService(lister, syncer, upstreamModelCatalogSyncInterval)
	svc.startJitter = 0
	return svc, lister
}

func TestUpstreamModelCatalogSyncSkipsFreshSnapshot(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{}
	svc, _ := newUpstreamModelCatalogSyncForTest([]Account{
		{ID: 2, Platform: PlatformOpenAI, Extra: upstreamModelCatalogSnapshotExtra(time.Now().Add(-time.Hour))},
	}, syncer)

	svc.runOnce()

	require.Empty(t, syncer.syncedIDs(), "快照仍在一个同步周期内时不应重复请求上游")
}

func TestUpstreamModelCatalogSyncSyncsStaleAndMissingSnapshot(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{}
	svc, _ := newUpstreamModelCatalogSyncForTest([]Account{
		{ID: 2, Platform: PlatformOpenAI, Extra: upstreamModelCatalogSnapshotExtra(time.Now().Add(-160 * time.Hour))},
		{ID: 3, Platform: PlatformOpenAI},
	}, syncer)

	svc.runOnce()

	require.ElementsMatch(t, []int64{2, 3}, syncer.syncedIDs())
}

func TestUpstreamModelCatalogSyncKeepsGoingAfterOneAccountFails(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{
		errByID: map[int64]error{2: errors.New("upstream 500")},
	}
	svc, _ := newUpstreamModelCatalogSyncForTest([]Account{
		{ID: 2, Platform: PlatformOpenAI},
		{ID: 3, Platform: PlatformOpenAI},
	}, syncer)

	svc.runOnce()

	require.ElementsMatch(t, []int64{2, 3}, syncer.syncedIDs(), "一个账号失败不能中断整轮")
}

func TestUpstreamModelCatalogSyncTreatsUnsupportedPlatformAsSkip(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{
		errByID: map[int64]error{
			7: &UpstreamModelSyncError{Kind: UpstreamModelSyncErrorUnsupported, Message: "unsupported platform"},
		},
	}
	svc, _ := newUpstreamModelCatalogSyncForTest([]Account{
		{ID: 7, Platform: "unknown-platform"},
	}, syncer)

	require.NotPanics(t, svc.runOnce)
	require.Equal(t, []int64{7}, syncer.syncedIDs())
}

func TestUpstreamModelCatalogSyncSkipsInvalidAccounts(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{}
	svc, _ := newUpstreamModelCatalogSyncForTest([]Account{
		{ID: 0, Platform: PlatformOpenAI},
	}, syncer)

	svc.runOnce()

	require.Empty(t, syncer.syncedIDs())
}

func TestUpstreamModelCatalogSyncLeavesStateUntouchedWhenListingFails(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{}
	lister := &upstreamModelCatalogAccountsStub{err: errors.New("db down")}
	svc := NewUpstreamModelCatalogSyncService(lister, syncer, upstreamModelCatalogSyncInterval)

	require.NotPanics(t, svc.runOnce)
	require.Empty(t, syncer.syncedIDs())
	require.Equal(t, 1, lister.calls)
}

func TestUpstreamModelCatalogSyncStartIsNoopWithoutDependencies(t *testing.T) {
	for name, svc := range map[string]*UpstreamModelCatalogSyncService{
		"nil service":   nil,
		"no accounts":   NewUpstreamModelCatalogSyncService(nil, &upstreamModelCatalogSyncerStub{}, time.Hour),
		"no syncer":     NewUpstreamModelCatalogSyncService(&upstreamModelCatalogAccountsStub{}, nil, time.Hour),
		"zero interval": NewUpstreamModelCatalogSyncService(&upstreamModelCatalogAccountsStub{}, &upstreamModelCatalogSyncerStub{}, 0),
	} {
		t.Run(name, func(t *testing.T) {
			require.NotPanics(t, svc.Start)
			require.NotPanics(t, svc.Stop)
		})
	}
}

func TestUpstreamModelCatalogSyncStopEndsRunner(t *testing.T) {
	syncer := &upstreamModelCatalogSyncerStub{}
	svc, _ := newUpstreamModelCatalogSyncForTest(nil, syncer)

	svc.Start()
	done := make(chan struct{})
	go func() {
		svc.Stop()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop 未在 5 秒内结束")
	}
}
