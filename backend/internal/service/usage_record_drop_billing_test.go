package service

import (
	"context"
	"strings"
	"testing"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/ctxkey"
	"github.com/stretchr/testify/require"
)

// droppedUsageBillingRepoStub 只实现 RecordFailure：丢弃留痕路径不调用 Apply。
type droppedUsageBillingRepoStub struct {
	UsageBillingRepository
	failures []*UsageBillingCommand
	causes   []error
}

func (r *droppedUsageBillingRepoStub) RecordFailure(_ context.Context, cmd *UsageBillingCommand, cause error) error {
	r.failures = append(r.failures, cmd)
	r.causes = append(r.causes, cause)
	return nil
}

func TestRecordDroppedUsageWritesBillingFailure(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &GatewayService{usageBillingRepo: repo}
	input := &RecordUsageInput{
		Result: &ForwardResult{
			RequestID: "req-drop-1",
			Model:     "claude-sonnet-4-5",
			Usage: ClaudeUsage{
				InputTokens:          11,
				OutputTokens:         22,
				CacheReadInputTokens: 33,
			},
		},
		APIKey:  &APIKey{ID: 7},
		User:    &User{ID: 8},
		Account: &Account{ID: 9},
	}

	svc.RecordDroppedUsage(context.Background(), input, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1, "丢弃的计费任务必须落一条 billing_failures")
	cmd := repo.failures[0]
	require.Equal(t, "req-drop-1", cmd.RequestID)
	require.Equal(t, int64(7), cmd.APIKeyID)
	require.Equal(t, int64(8), cmd.UserID)
	require.Equal(t, int64(9), cmd.AccountID)
	require.Equal(t, "claude-sonnet-4-5", cmd.Model)
	require.Equal(t, 11, cmd.InputTokens)
	require.Equal(t, 22, cmd.OutputTokens)
	require.Equal(t, 33, cmd.CacheReadTokens)
	require.Zero(t, cmd.BalanceCost, "丢弃留痕不能伪装成已定价")
	require.Zero(t, cmd.SubscriptionCost)
	require.Len(t, repo.causes, 1)
	require.Contains(t, repo.causes[0].Error(), "usage record dropped before billing")
	require.Contains(t, repo.causes[0].Error(), UsageRecordDropReasonQueueFull)
}

func TestRecordDroppedUsageUsesUpstreamModelFallback(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &GatewayService{usageBillingRepo: repo}

	svc.RecordDroppedUsage(context.Background(), &RecordUsageInput{
		Result: &ForwardResult{RequestID: "req-drop-2", UpstreamModel: "claude-opus-4-5"},
	}, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1)
	require.Equal(t, "claude-opus-4-5", repo.failures[0].Model)
}

// 没有上游 request id 时，request context 里的本地 id 必须被用来留痕：
// 否则真实的丢弃就一条都记不下来。
func TestRecordDroppedUsageFallsBackToContextRequestID(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &GatewayService{usageBillingRepo: repo}
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "local-abc")

	svc.RecordDroppedUsage(ctx, &RecordUsageInput{
		Result: &ForwardResult{Model: "claude-sonnet-4-5"},
	}, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1, "context 里有 request id 时必须留痕")
	require.Equal(t, "local:local-abc", repo.failures[0].RequestID)
}

func TestRecordDroppedUsageFallsBackToClientRequestID(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &GatewayService{usageBillingRepo: repo}
	ctx := context.WithValue(context.Background(), ctxkey.ClientRequestID, "client-xyz")

	svc.RecordDroppedUsage(ctx, &RecordUsageInput{
		Result: &ForwardResult{Model: "claude-sonnet-4-5"},
	}, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1)
	require.Equal(t, "client:client-xyz", repo.failures[0].RequestID)
}

// 什么都取不到时不能捏造 request id：对账捞出来对不上任何真实请求，纯噪声。
func TestRecordDroppedUsageNilInputsDoNotPanic(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	var nilSvc *GatewayService
	require.NotPanics(t, func() {
		nilSvc.RecordDroppedUsage(context.Background(), &RecordUsageInput{}, UsageRecordDropReasonQueueFull)
	})

	svc := &GatewayService{usageBillingRepo: repo}
	require.NotPanics(t, func() {
		svc.RecordDroppedUsage(context.Background(), nil, UsageRecordDropReasonQueueFull)
		svc.RecordDroppedUsage(context.Background(), &RecordUsageInput{}, UsageRecordDropReasonQueueFull)
		svc.RecordDroppedUsage(context.Background(), &RecordUsageInput{Result: &ForwardResult{}}, UsageRecordDropReasonQueueFull)
	})
	require.Empty(t, repo.failures, "没有可对账的 request id 时不应该写一条捏造的失败记录")
}

func TestOpenAIRecordDroppedUsageWritesBillingFailure(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &OpenAIGatewayService{usageBillingRepo: repo}
	input := &OpenAIRecordUsageInput{
		Result: &OpenAIForwardResult{
			RequestID:    "req-drop-oa-1",
			Model:        "gpt-5",
			BillingModel: "gpt-5-billing",
			Usage: OpenAIUsage{
				InputTokens:          5,
				OutputTokens:         6,
				CacheReadInputTokens: 7,
			},
		},
		APIKey:  &APIKey{ID: 1},
		User:    &User{ID: 2},
		Account: &Account{ID: 3},
	}

	svc.RecordDroppedUsage(context.Background(), input, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1)
	cmd := repo.failures[0]
	require.Equal(t, "req-drop-oa-1", cmd.RequestID)
	require.Equal(t, "gpt-5-billing", cmd.Model, "按计费模型留痕，便于对账重算")
	require.Equal(t, 5, cmd.InputTokens)
	require.Equal(t, 6, cmd.OutputTokens)
	require.Equal(t, 7, cmd.CacheReadTokens)
	require.Zero(t, cmd.BalanceCost)
	require.Len(t, repo.causes, 1)
	require.True(t, strings.Contains(repo.causes[0].Error(), UsageRecordDropReasonQueueFull))
}

func TestOpenAIRecordDroppedUsageFallsBackToContextRequestID(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	svc := &OpenAIGatewayService{usageBillingRepo: repo}
	ctx := context.WithValue(context.Background(), ctxkey.RequestID, "local-oa")

	svc.RecordDroppedUsage(ctx, &OpenAIRecordUsageInput{
		Result: &OpenAIForwardResult{Model: "gpt-5"},
	}, UsageRecordDropReasonQueueFull)

	require.Len(t, repo.failures, 1)
	require.Equal(t, "local:local-oa", repo.failures[0].RequestID)
}

func TestOpenAIRecordDroppedUsageNilInputsDoNotPanic(t *testing.T) {
	repo := &droppedUsageBillingRepoStub{}
	var nilSvc *OpenAIGatewayService
	require.NotPanics(t, func() {
		nilSvc.RecordDroppedUsage(context.Background(), &OpenAIRecordUsageInput{}, UsageRecordDropReasonQueueFull)
	})

	svc := &OpenAIGatewayService{usageBillingRepo: repo}
	require.NotPanics(t, func() {
		svc.RecordDroppedUsage(context.Background(), nil, UsageRecordDropReasonQueueFull)
		svc.RecordDroppedUsage(context.Background(), &OpenAIRecordUsageInput{}, UsageRecordDropReasonQueueFull)
	})
	require.Empty(t, repo.failures)
}
