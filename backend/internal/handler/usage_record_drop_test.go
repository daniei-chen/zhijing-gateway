package handler

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/stretchr/testify/require"
)

// fakeUsageDropRecorder 捕获「内联执行也失败」时的兜底留痕调用。
type fakeUsageDropRecorder struct {
	mu      sync.Mutex
	inputs  []*service.RecordUsageInput
	reasons []string
}

func (f *fakeUsageDropRecorder) RecordDroppedUsage(_ context.Context, input *service.RecordUsageInput, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inputs = append(f.inputs, input)
	f.reasons = append(f.reasons, reason)
}

func (f *fakeUsageDropRecorder) snapshot() ([]*service.RecordUsageInput, []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*service.RecordUsageInput(nil), f.inputs...), append([]string(nil), f.reasons...)
}

type fakeOpenAIUsageDropRecorder struct {
	mu      sync.Mutex
	inputs  []*service.OpenAIRecordUsageInput
	reasons []string
}

func (f *fakeOpenAIUsageDropRecorder) RecordDroppedUsage(_ context.Context, input *service.OpenAIRecordUsageInput, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.inputs = append(f.inputs, input)
	f.reasons = append(f.reasons, reason)
}

func (f *fakeOpenAIUsageDropRecorder) snapshot() ([]*service.OpenAIRecordUsageInput, []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]*service.OpenAIRecordUsageInput(nil), f.inputs...), append([]string(nil), f.reasons...)
}

// newQueueFullDropPool 构造「worker 占满 + 队列占满 + drop 策略」的池，返回时下一次
// Submit 必然走到 UsageRecordSubmitModeDropped。
func newQueueFullDropPool(t *testing.T) *service.UsageRecordWorkerPool {
	t.Helper()
	pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{
		WorkerCount:      1,
		QueueSize:        1,
		TaskTimeout:      time.Minute,
		OverflowPolicy:   config.UsageRecordOverflowPolicyDrop,
		AutoScaleEnabled: false,
	})
	block := make(chan struct{})
	started := make(chan struct{})
	t.Cleanup(func() {
		close(block)
		pool.Stop()
	})
	require.Equal(t, service.UsageRecordSubmitModeEnqueued, pool.Submit(func(ctx context.Context) {
		close(started)
		<-block
	}))
	<-started
	require.Equal(t, service.UsageRecordSubmitModeEnqueued, pool.Submit(func(ctx context.Context) {
		<-block
	}))
	return pool
}

func TestOpenAIGatewayHandlerSubmitUsageRecordTask_DropPolicyRunsInline(t *testing.T) {
	pool := newQueueFullDropPool(t)
	recorder := &fakeOpenAIUsageDropRecorder{}
	h := &OpenAIGatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	input := &service.OpenAIRecordUsageInput{
		Result: &service.OpenAIForwardResult{RequestID: "req-drop-oa-1", Model: "gpt-5"},
	}
	var executed atomic.Bool
	h.submitOpenAIUsageRecordTask(context.Background(), input.Result, input, func(ctx context.Context) {
		executed.Store(true)
	})

	require.True(t, executed.Load(), "drop 策略下计费任务也必须内联执行，不能跟着池一起丢")
	inputs, reasons := recorder.snapshot()
	require.Empty(t, inputs, "内联执行成功时不应写失败记录")
	require.Empty(t, reasons)
}

func TestGatewayHandlerSubmitUsageRecordTask_DropPolicyInlinePanicRecordsFailure(t *testing.T) {
	pool := newQueueFullDropPool(t)
	recorder := &fakeUsageDropRecorder{}
	h := &GatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	input := &service.RecordUsageInput{
		Result: &service.ForwardResult{RequestID: "req-drop-panic", Model: "claude-sonnet-4-5"},
	}
	require.NotPanics(t, func() {
		h.submitUsageRecordTask(context.Background(), input, func(ctx context.Context) {
			panic("billing task exploded")
		})
	}, "内联执行的 panic 必须被兜住")

	inputs, reasons := recorder.snapshot()
	require.Len(t, inputs, 1, "内联执行也失败时必须落一条可查的失败记录")
	require.Same(t, input, inputs[0])
	require.Equal(t, []string{service.UsageRecordDropReasonQueueFull}, reasons)
}

func TestOpenAIGatewayHandlerSubmitUsageRecordTask_DropPolicyInlinePanicRecordsFailure(t *testing.T) {
	pool := newQueueFullDropPool(t)
	recorder := &fakeOpenAIUsageDropRecorder{}
	h := &OpenAIGatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	input := &service.OpenAIRecordUsageInput{
		Result: &service.OpenAIForwardResult{RequestID: "req-drop-oa-panic", Model: "gpt-5"},
	}
	require.NotPanics(t, func() {
		h.submitOpenAIUsageRecordTask(context.Background(), input.Result, input, func(ctx context.Context) {
			panic("billing task exploded")
		})
	})

	inputs, reasons := recorder.snapshot()
	require.Len(t, inputs, 1)
	require.Same(t, input, inputs[0])
	require.Equal(t, []string{service.UsageRecordDropReasonQueueFull}, reasons)
}

func TestGatewayHandlerSubmitUsageRecordTask_NoPoolPanicRecordsFailure(t *testing.T) {
	recorder := &fakeUsageDropRecorder{}
	h := &GatewayHandler{usageDropRecorder: recorder}
	input := &service.RecordUsageInput{
		Result: &service.ForwardResult{RequestID: "req-no-pool-panic", Model: "claude-sonnet-4-5"},
	}

	require.NotPanics(t, func() {
		h.submitUsageRecordTask(context.Background(), input, func(ctx context.Context) {
			panic("billing task exploded")
		})
	})

	inputs, reasons := recorder.snapshot()
	require.Len(t, inputs, 1)
	require.Equal(t, []string{service.UsageRecordDropReasonNoPool}, reasons)
}

func TestGatewayHandlerSubmitUsageRecordTask_StoppedPoolSyncsWithoutFailureRecord(t *testing.T) {
	pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{
		WorkerCount:      1,
		QueueSize:        1,
		TaskTimeout:      time.Second,
		OverflowPolicy:   config.UsageRecordOverflowPolicyDrop,
		AutoScaleEnabled: false,
	})
	pool.Stop()
	recorder := &fakeUsageDropRecorder{}
	h := &GatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	var executed atomic.Bool
	h.submitUsageRecordTask(context.Background(), nil, func(ctx context.Context) {
		executed.Store(true)
	})

	require.True(t, executed.Load(), "池已停止时必须内联同步执行，不能只留失败记录")
	_, reasons := recorder.snapshot()
	require.Empty(t, reasons, "任务已同步执行，不应再写失败记录")
}

func TestOpenAIGatewayHandlerSubmitUsageRecordTask_StoppedPoolSyncsWithoutFailureRecord(t *testing.T) {
	pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{
		WorkerCount:      1,
		QueueSize:        1,
		TaskTimeout:      time.Second,
		OverflowPolicy:   config.UsageRecordOverflowPolicyDrop,
		AutoScaleEnabled: false,
	})
	pool.Stop()
	recorder := &fakeOpenAIUsageDropRecorder{}
	h := &OpenAIGatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	var executed atomic.Bool
	h.submitOpenAIUsageRecordTask(context.Background(), nil, nil, func(ctx context.Context) {
		executed.Store(true)
	})

	require.True(t, executed.Load(), "池已停止时必须内联同步执行，不能只留失败记录")
	_, reasons := recorder.snapshot()
	require.Empty(t, reasons, "任务已同步执行，不应再写失败记录")
}
