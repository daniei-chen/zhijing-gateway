package service

import (
	"context"
	"log"
	"sync"
	"time"
)

// AccountExpiryService periodically pauses expired accounts when auto-pause is enabled.
type AccountExpiryService struct {
	accountRepo AccountRepository
	interval    time.Duration
	stopCh      chan struct{}
	stopOnce    sync.Once
	wg          sync.WaitGroup

	// mu/running 保护 Start 的幂等性。
	//
	// 背景（v0.1.20）：stopCh 是一次性的 channel，Stop 之后就无法再打开。
	// 旧实现里 Start 没有任何防护，于是「先 Stop 再 Start」会起一个
	// goroutine，它在 select 里立刻命中已关闭的 stopCh 然后返回 ——
	// 定时暂停过期账号的功能**静默地再也不工作**，而且没有任何日志。
	// 生产上 Stop 只在进程退出时调用，所以这个路径从未被走到，
	// 但任何引入「热重载 / 重启子服务」的改动都会踩上它。
	//
	// 现在 Start 会拒绝重复启动和在 Stop 之后重启，并留下明确日志：
	// 想重启就新建一个实例，不要复用已停止的。
	mu      sync.Mutex
	running bool
}

func NewAccountExpiryService(accountRepo AccountRepository, interval time.Duration) *AccountExpiryService {
	return &AccountExpiryService{
		accountRepo: accountRepo,
		interval:    interval,
		stopCh:      make(chan struct{}),
	}
}

func (s *AccountExpiryService) Start() {
	if s == nil || s.accountRepo == nil || s.interval <= 0 {
		return
	}

	s.mu.Lock()
	if s.running {
		s.mu.Unlock()
		log.Printf("[AccountExpiry] Start ignored: service is already running")
		return
	}
	select {
	case <-s.stopCh:
		s.mu.Unlock()
		log.Printf("[AccountExpiry] Start refused: service was already stopped; create a new instance to restart")
		return
	default:
	}
	s.running = true
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		s.runOnce()
		for {
			select {
			case <-ticker.C:
				s.runOnce()
			case <-s.stopCh:
				return
			}
		}
	}()
}

func (s *AccountExpiryService) Stop() {
	if s == nil {
		return
	}
	s.stopOnce.Do(func() {
		close(s.stopCh)
	})
	s.wg.Wait()

	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
}

func (s *AccountExpiryService) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	updated, err := s.accountRepo.AutoPauseExpiredAccounts(ctx, time.Now())
	if err != nil {
		log.Printf("[AccountExpiry] Auto pause expired accounts failed: %v", err)
		return
	}
	if updated > 0 {
		log.Printf("[AccountExpiry] Auto paused %d expired accounts", updated)
	}
}
