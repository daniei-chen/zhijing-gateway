package service

import (
	"context"
	"errors"
	"log/slog"
	"math/rand"
	"strings"
	"sync"
	"time"
)

const (
	// upstreamModelCatalogSyncInterval 上游模型目录的自动同步间隔。
	// 目录漂移会让网关按旧目录判定「没有账号支持该模型」并直接回 404
	// （2026-11-14 的 gpt-5.6-luna 就这样连续坏了 4 次，所有技术探针都是绿的），
	// 而目录本身是天级变化的：12 小时足够跟上，同时把对上游的模型列表请求压到每天 2 次。
	upstreamModelCatalogSyncInterval = 12 * time.Hour
	// upstreamModelCatalogSyncAccountTimeout 单个账号一次同步的上限。
	upstreamModelCatalogSyncAccountTimeout = 45 * time.Second
	// upstreamModelCatalogSyncCycleTimeout 一轮（覆盖全部可调度账号）的总上限。
	upstreamModelCatalogSyncCycleTimeout = 10 * time.Minute
	// upstreamModelCatalogSyncStartJitter 启动后首次同步的随机抖动上限。
	// 蓝绿发布时多个实例会同时启动，错开它们对同一账号的同步请求。
	upstreamModelCatalogSyncStartJitter = 30 * time.Second
)

// upstreamModelCatalogAccountLister 只声明同步任务真正需要的账号读取能力。
// 用窄接口而不是整个 AccountRepository：测试不必为几十个方法写空实现。
type upstreamModelCatalogAccountLister interface {
	ListSchedulable(ctx context.Context) ([]Account, error)
}

// upstreamModelCatalogSyncer 由 AccountTestService 实现，与管理端「同步上游模型」按钮
// 走同一条代码路径。复用而不是另写一套请求，是为了让自动同步与人工同步的
// 元数据完整度判定、回退策略和写库格式完全一致。
type upstreamModelCatalogSyncer interface {
	SyncUpstreamModelCatalog(ctx context.Context, account *Account) (*UpstreamModelCatalog, error)
}

// UpstreamModelCatalogSyncService 周期性把各可调度账号的上游模型目录同步进 extra，
// 让「某个模型还能不能用」不再依赖管理员手动点按钮。
//
// 背景：目录只在管理端按钮或账号相关人工操作时刷新，一旦没人点就一直陈旧。
// 健康巡检因此把「目录多久没同步」做成了 model_catalog_ok 信号，但此前没有任何
// 自动修复路径，信号只能一直红着。本服务补上这条闭环。
type UpstreamModelCatalogSyncService struct {
	accounts upstreamModelCatalogAccountLister
	syncer   upstreamModelCatalogSyncer
	interval time.Duration
	// startJitter 启动首次同步前的随机等待；测试里置 0 以免测试跟着睡。
	startJitter time.Duration
	stopCh      chan struct{}
	stopOnce    sync.Once
	wg          sync.WaitGroup
}

func NewUpstreamModelCatalogSyncService(
	accounts upstreamModelCatalogAccountLister,
	syncer upstreamModelCatalogSyncer,
	interval time.Duration,
) *UpstreamModelCatalogSyncService {
	return &UpstreamModelCatalogSyncService{
		accounts:    accounts,
		syncer:      syncer,
		interval:    interval,
		startJitter: upstreamModelCatalogSyncStartJitter,
		stopCh:      make(chan struct{}),
	}
}

func (s *UpstreamModelCatalogSyncService) Start() {
	if s == nil || s.accounts == nil || s.syncer == nil || s.interval <= 0 {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		ticker := time.NewTicker(s.interval)
		defer ticker.Stop()

		s.runInitial()
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

func (s *UpstreamModelCatalogSyncService) Stop() {
	if s == nil {
		return
	}
	s.stopOnce.Do(func() {
		close(s.stopCh)
	})
	s.wg.Wait()
}

// runInitial 执行启动后的首次同步。抖动只为错开多实例同时启动，
// 不改变「启动即补一次」的语义：进程刚起来时目录可能已经陈旧很久。
func (s *UpstreamModelCatalogSyncService) runInitial() {
	if jitter := s.startJitter; jitter > 0 {
		time.Sleep(time.Duration(rand.Int63n(int64(jitter))))
	}
	select {
	case <-s.stopCh:
		return
	default:
	}
	s.runOnce()
}

// runOnce 同步一轮：
//   - 只处理可调度账号（不调度 = 不参与路由，目录陈旧也无害）；
//   - 快照仍在一个同步周期内的账号直接跳过，避免重启和滚动发布放大成对上游的连续请求；
//   - 单个账号失败只记日志，继续处理其余账号。
func (s *UpstreamModelCatalogSyncService) runOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), upstreamModelCatalogSyncCycleTimeout)
	defer cancel()

	accounts, err := s.accounts.ListSchedulable(ctx)
	if err != nil {
		slog.Warn("upstream_model_catalog_sync_list_failed", "error", err)
		return
	}

	now := time.Now()
	synced, skipped, failed := 0, 0, 0
	for i := range accounts {
		account := &accounts[i]
		if account == nil || account.ID <= 0 {
			continue
		}
		if s.snapshotFresh(account, now) {
			skipped++
			continue
		}
		accountCtx, accountCancel := context.WithTimeout(ctx, upstreamModelCatalogSyncAccountTimeout)
		_, syncErr := s.syncer.SyncUpstreamModelCatalog(accountCtx, account)
		accountCancel()
		if syncErr != nil {
			if upstreamModelCatalogSyncUnsupported(syncErr) {
				skipped++
				continue
			}
			failed++
			slog.Warn("upstream_model_catalog_sync_failed",
				"account_id", account.ID,
				"platform", account.Platform,
				"error", syncErr,
			)
			continue
		}
		synced++
	}

	// 没同步也没失败时（全部命中快照新鲜）不刷日志：ticker 每 12 小时一次，
	// 无事可做的一轮不该在日志里留噪音。
	if synced > 0 || failed > 0 {
		slog.Info("upstream_model_catalog_sync_cycle",
			"accounts", len(accounts),
			"synced", synced,
			"skipped", skipped,
			"failed", failed,
		)
	}
}

// snapshotFresh 判断账号已有快照是否仍在一个同步周期内。
// 缺失、格式不可解析或时间在未来（时钟漂移）都按「需要同步」处理。
func (s *UpstreamModelCatalogSyncService) snapshotFresh(account *Account, now time.Time) bool {
	if s.interval <= 0 {
		return false
	}
	snapshot := account.GetUpstreamModelMetadataSnapshot()
	if snapshot == nil {
		return false
	}
	syncedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(snapshot.SyncedAt))
	if err != nil {
		return false
	}
	age := now.Sub(syncedAt)
	return age >= 0 && age < s.interval
}

// upstreamModelCatalogSyncUnsupported 判断失败是否属于「这个平台本来就不支持在线同步」。
// 这类账号每轮都会失败，记 warn 只会把日志刷满，也不代表目录出了问题。
func upstreamModelCatalogSyncUnsupported(err error) bool {
	var syncErr *UpstreamModelSyncError
	if errors.As(err, &syncErr) {
		return syncErr.Kind == UpstreamModelSyncErrorUnsupported
	}
	return false
}
