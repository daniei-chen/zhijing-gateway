package service

import "context"

// BusinessReadiness 描述「这个实例真的能服务业务请求吗」。
//
// /readyz 默认只查 DB 和 Redis。2026-11-14 19:10 的事故证明技术健康 ≠ 业务可用：
// 当时 /readyz 报 database/redis ok、账号 active、5xx 计数在前一刻还是 0，
// 但用户请求全部 503——因为 API Key 指向了已删除的分组，调度池为空。
//
// 深度探针把「有没有可调度账号」变成可探测的判据，让部署脚本可以在切流量之前
// 先问新实例一句「你真有账号可用吗」，而不是等用户把 503 打出来。
type BusinessReadiness struct {
	// SchedulableAccounts 是当前状态为 active 且可调度的账号数。
	SchedulableAccounts int
}

// Ready 报告该实例是否至少有一个可调度账号。
func (r BusinessReadiness) Ready() bool {
	return r.SchedulableAccounts > 0
}

// GetBusinessReadiness 统计当前可调度账号数。
//
// 只读，不触碰调度器的进程内池：这里要回答的是「配置层面还有没有账号」，
// 而不是「某个具体请求能不能立刻被调度」。进程内的冷却、等待队列属于请求级
// 状态，不适合做就绪判据（会被瞬时压力误判成不健康）。
func (s *OpsService) GetBusinessReadiness(ctx context.Context) (BusinessReadiness, error) {
	accounts, err := s.listAllAccountsForOps(ctx, "", nil)
	if err != nil {
		return BusinessReadiness{}, err
	}
	ready := 0
	for _, account := range accounts {
		if account.Schedulable && account.Status == StatusActive {
			ready++
		}
	}
	return BusinessReadiness{SchedulableAccounts: ready}, nil
}
