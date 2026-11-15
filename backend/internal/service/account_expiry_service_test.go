package service

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// expiryRepoStub 只实现 AccountExpiryService 真正会调用的一次方法。
// 嵌入 AccountRepository 接口（nil）让其余方法保留默认实现：
// 测试永远不会碰到它们，碰到的话会以 nil panic 的方式立刻暴露出来，
// 而不是悄悄返回零值把断言骗过去。
type expiryRepoStub struct {
	AccountRepository
	calls   int32
	updated int64
}

func (s *expiryRepoStub) AutoPauseExpiredAccounts(ctx context.Context, now time.Time) (int64, error) {
	atomic.AddInt32(&s.calls, 1)
	return s.updated, nil
}

func (s *expiryRepoStub) callCount() int32 {
	return atomic.LoadInt32(&s.calls)
}

// waitForCalls 轮询等待计数达到 want，超时即失败。
func waitForCalls(t *testing.T, repo *expiryRepoStub, want int32) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if repo.callCount() >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("expected at least %d AutoPauseExpiredAccounts calls, got %d", want, repo.callCount())
}

// Start 必须立刻跑一次，不等第一个 tick。
func TestAccountExpiryServiceStartRunsImmediately(t *testing.T) {
	repo := &expiryRepoStub{}
	svc := NewAccountExpiryService(repo, time.Hour)

	svc.Start()
	t.Cleanup(svc.Stop)

	waitForCalls(t, repo, 1)
}

// 重复 Start 不能起第二个循环。
//
// 回归点：旧实现没有 running 标志，每次 Start 都会再起一个 goroutine，
// 而每个 goroutine 在进入循环前都会先跑一次 runOnce。所以用「1 小时 interval」
// 把周期调用排除掉，只看启动时的立即执行次数：正确实现恰好 1 次，
// 旧实现调用几次 Start 就是几次。
func TestAccountExpiryServiceStartIsIdempotent(t *testing.T) {
	repo := &expiryRepoStub{}
	svc := NewAccountExpiryService(repo, time.Hour)

	svc.Start()
	svc.Start()
	svc.Start()
	t.Cleanup(svc.Stop)

	// interval 是一小时，这段时间内唯一的调用来源就是各 goroutine 的首次 runOnce。
	time.Sleep(80 * time.Millisecond)

	require.Equal(t, int32(1), repo.callCount(),
		"重复 Start 不应起多个循环：每次 Start 都会立刻跑一次 runOnce")
}

// Stop 之后再 Start 必须被拒绝。
//
// 回归点：旧实现在 Stop 之后 Start 会起一个 goroutine，它先执行一次 runOnce，
// 然后立刻命中已关闭的 stopCh 退出 —— 表现为"重启成功但再也不工作"，
// 且多出一次 AutoPauseExpiredAccounts 调用。
func TestAccountExpiryServiceStartAfterStopIsRefused(t *testing.T) {
	repo := &expiryRepoStub{}
	svc := NewAccountExpiryService(repo, time.Hour)

	svc.Start()
	waitForCalls(t, repo, 1)
	svc.Stop()

	stopped := repo.callCount()

	svc.Start()
	time.Sleep(60 * time.Millisecond)

	require.Equal(t, stopped, repo.callCount(),
		"Stop 之后的 Start 必须被拒绝，不能悄悄多跑一次 runOnce")
}

// Stop 可重复调用，不 panic（stopOnce 保护）。
func TestAccountExpiryServiceStopIsIdempotent(t *testing.T) {
	repo := &expiryRepoStub{}
	svc := NewAccountExpiryService(repo, time.Hour)

	svc.Start()
	svc.Stop()
	require.NotPanics(t, svc.Stop)
}

// interval <= 0 或 repo 为 nil 时 Start 是空操作，不能起 goroutine。
func TestAccountExpiryServiceStartSkipsDisabledConfig(t *testing.T) {
	t.Run("zero interval", func(t *testing.T) {
		repo := &expiryRepoStub{}
		svc := NewAccountExpiryService(repo, 0)
		svc.Start()
		time.Sleep(30 * time.Millisecond)
		require.Equal(t, int32(0), repo.callCount())
	})

	t.Run("nil repo", func(t *testing.T) {
		svc := NewAccountExpiryService(nil, time.Hour)
		require.NotPanics(t, svc.Start)
	})
}
