package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ctxkey"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/logger"
)

// UsageRecordDropReasonQueueFull 表示计费任务因 worker 池队列已满被丢弃
// （overflow_policy=drop，或 sample 未命中同步兜底）。
const UsageRecordDropReasonQueueFull = "queue_full"

// UsageRecordDropReasonPoolStopped 表示提交时池已停止（进程关停窗口）。
const UsageRecordDropReasonPoolStopped = "pool_stopped"

// UsageRecordDropReasonNoPool 表示 handler 未注入 worker 池，直接内联执行。
const UsageRecordDropReasonNoPool = "no_pool"

// RecordDroppedUsage 把一条没能完成计费的请求留痕到 billing_failures
// （审计 P0-4 的既有失败通道）。
//
// 计费任务不允许被丢弃：drop/sample 溢出、池停止、未注入池三种情况都会内联执行，
// 本方法只在「内联执行也失败（panic）」时兜底。写一条 status='pending' 的失败快照，
// 对账脚本/watchdog 可按 request_id 捞出后人工补录。语义与算价失败一致：
// total_cost=0 表示「价格未知、未扣费」，不是「免费」；刻意不写 usage_logs，
// 避免 0 成本行被下游当成已结算的免费单。留痕自身失败只记日志，绝不影响请求收尾。
func (s *GatewayService) RecordDroppedUsage(ctx context.Context, input *RecordUsageInput, reason string) {
	if s == nil || input == nil || input.Result == nil {
		return
	}
	result := input.Result
	model := strings.TrimSpace(result.Model)
	if model == "" {
		model = strings.TrimSpace(result.UpstreamModel)
	}
	recordDroppedUsageFailure(ctx, s.usageBillingRepo,
		resolveDroppedUsageRequestID(ctx, result.RequestID),
		input.APIKey, input.User, input.Account, model,
		result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.CacheReadInputTokens,
		reason)
}

// RecordDroppedUsage 是 OpenAI 网关的对称实现，语义同 GatewayService.RecordDroppedUsage。
func (s *OpenAIGatewayService) RecordDroppedUsage(ctx context.Context, input *OpenAIRecordUsageInput, reason string) {
	if s == nil || input == nil || input.Result == nil {
		return
	}
	result := input.Result
	model := strings.TrimSpace(result.BillingModel)
	if model == "" {
		model = strings.TrimSpace(result.Model)
	}
	if model == "" {
		model = strings.TrimSpace(result.UpstreamModel)
	}
	recordDroppedUsageFailure(ctx, s.usageBillingRepo,
		resolveDroppedUsageRequestID(ctx, result.RequestID),
		input.APIKey, input.User, input.Account, model,
		result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.CacheReadInputTokens,
		reason)
}

// resolveDroppedUsageRequestID 为漏收留痕解析请求标识，优先级与
// resolveUsageBillingRequestID 一致，但**不生成**兜底 id。
//
// 区别很重要：resolveUsageBillingRequestID 在什么都取不到时返回
// "generated:<随机>"，那是给正常计费路径用的（每条 usage 都要有幂等键）。
// 漏收留痕不是计费，一条捏造 request_id 的 billing_failures 对账时既对不上
// 真实请求、又会让 pending 计数虚高，所以这里宁可返回空、不写记录。
// 真实丢弃的请求一定有上游 RequestID 或 request context 里的 id，走不到空分支。
func resolveDroppedUsageRequestID(ctx context.Context, upstreamRequestID string) string {
	upstreamRequestID = strings.TrimSpace(upstreamRequestID)
	if upstreamRequestID != "" && isForcedUsageBillingRequestID(upstreamRequestID) {
		return upstreamRequestID
	}
	if ctx != nil {
		if clientRequestID, _ := ctx.Value(ctxkey.ClientRequestID).(string); strings.TrimSpace(clientRequestID) != "" {
			return "client:" + strings.TrimSpace(clientRequestID)
		}
		if requestID, _ := ctx.Value(ctxkey.RequestID).(string); strings.TrimSpace(requestID) != "" {
			return "local:" + strings.TrimSpace(requestID)
		}
	}
	return upstreamRequestID
}

func recordDroppedUsageFailure(
	ctx context.Context,
	repo UsageBillingRepository,
	requestID string,
	apiKey *APIKey,
	user *User,
	account *Account,
	model string,
	inputTokens, outputTokens, cacheReadTokens int,
	reason string,
) {
	if repo == nil || strings.TrimSpace(requestID) == "" {
		return
	}
	cmd := &UsageBillingCommand{
		RequestID:       requestID,
		Model:           model,
		InputTokens:     inputTokens,
		OutputTokens:    outputTokens,
		CacheReadTokens: cacheReadTokens,
	}
	if apiKey != nil {
		cmd.APIKeyID = apiKey.ID
	}
	if user != nil {
		cmd.UserID = user.ID
	}
	if account != nil {
		cmd.AccountID = account.ID
	}
	cmd.Normalize()

	// 请求可能已被客户端取消，留痕必须独立于请求 ctx 完成；3s 与计费失败留痕一致。
	base := context.Background()
	if ctx != nil {
		base = context.WithoutCancel(ctx)
	}
	rctx, cancel := context.WithTimeout(base, 3*time.Second)
	defer cancel()

	cause := fmt.Errorf("usage record dropped before billing: %s", strings.TrimSpace(reason))
	if err := repo.RecordFailure(rctx, cmd, cause); err != nil {
		logger.LegacyPrintf("service.usage_record", "Warning: record dropped usage failure failed for request %s: %v", requestID, err)
	}
}
