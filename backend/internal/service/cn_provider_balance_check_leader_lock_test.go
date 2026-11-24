package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// recordingAccountRepo 只在 ListByPlatform 被调用时计数，用来断言探测是否真的发生。
// 其余方法由嵌入的 AccountRepository 兜底（本用例走不到那里：抢不到锁时 runOnce
// 在收集账号之前就返回了）。
type recordingAccountRepo struct {
	AccountRepository
	listCalls int
}

func (r *recordingAccountRepo) ListByPlatform(_ context.Context, _ string) ([]Account, error) {
	r.listCalls++
	return nil, nil
}

// holdLock 让"另一个实例"先占据 leader 锁，返回释放函数。
func holdLock(t *testing.T, cache *fakeLeaderLockCache, owner string) func() {
	t.Helper()
	ok, err := cache.TryAcquireLeaderLock(context.Background(), cnProviderBalanceCheckLeaderLockKey, owner, time.Minute)
	require.NoError(t, err)
	require.True(t, ok, "peer should acquire the lock first")
	return func() {
		_ = cache.ReleaseLeaderLock(context.Background(), cnProviderBalanceCheckLeaderLockKey, owner)
	}
}

// 多实例部署下，每个实例都有自己的 ticker。没有互斥时 7 个实例会对同一批账号
// 各探测一次，把上游配额放大 7 倍，并让 extra 快照被并发覆盖。
func TestCNProviderBalanceCheckRunOnceSkipsWhenPeerHoldsLock(t *testing.T) {
	cache := &fakeLeaderLockCache{}
	releasePeer := holdLock(t, cache, "peer")
	defer releasePeer()

	repo := &recordingAccountRepo{}
	svc := NewCNProviderBalanceCheckService(repo, nil, nil, nil, time.Minute)
	svc.SetLeaderLock(cache, nil)

	svc.runOnce()

	require.Zero(t, repo.listCalls,
		"runOnce 在别的实例持锁时不应读取账号，更不应打上游")
}

// 对端释放后，本实例在下一轮应当能正常拿到领导权。
func TestCNProviderBalanceCheckReacquiresAfterPeerReleases(t *testing.T) {
	cache := &fakeLeaderLockCache{}
	releasePeer := holdLock(t, cache, "peer")
	releasePeer()

	svc := NewCNProviderBalanceCheckService(&recordingAccountRepo{}, nil, nil, nil, time.Minute)
	svc.SetLeaderLock(cache, nil)

	release, acquired := tryAcquireSingletonLeaderLock(context.Background(), svc.lockCache, svc.db,
		cnProviderBalanceCheckLeaderLockKey, svc.instanceID, cnProviderBalanceCheckLeaderLockTTL)
	require.True(t, acquired, "对端释放后本实例应当能拿到锁")
	release()
}
