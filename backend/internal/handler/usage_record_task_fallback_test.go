package handler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/stretchr/testify/require"
)

// 本文件覆盖：worker 池已停止（进程关停窗口）或 drop/sample 溢出时，计费任务
// 都不得静默丢失，必须降级为内联同步执行；内联执行 panic 时的 billing_failures
// 兜底见 usage_record_drop_test.go。

func newStoppedUsageRecordPoolForTest() *service.UsageRecordWorkerPool {
	pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{
		WorkerCount:    1,
		QueueSize:      1,
		TaskTimeout:    time.Second,
		OverflowPolicy: config.UsageRecordOverflowPolicySync,
	})
	pool.Stop()
	return pool
}

func TestGatewayHandlerSubmitUsageRecordTask_StoppedPoolFallsBackToSync(t *testing.T) {
	h := &GatewayHandler{usageRecordWorkerPool: newStoppedUsageRecordPoolForTest()}

	executed := false
	h.submitUsageRecordTask(context.Background(), nil, func(ctx context.Context) {
		executed = true
	})
	require.True(t, executed, "池已停止时计费任务必须内联同步执行")
}

func TestOpenAIGatewayHandlerSubmitUsageRecordTask_StoppedPoolFallsBackToSync(t *testing.T) {
	h := &OpenAIGatewayHandler{usageRecordWorkerPool: newStoppedUsageRecordPoolForTest()}

	executed := false
	h.submitUsageRecordTask(context.Background(), nil, func(ctx context.Context) {
		executed = true
	})
	require.True(t, executed, "池已停止时计费任务必须内联同步执行")
}

func TestGatewayHandlerSubmitUsageRecordTask_DropPolicyOverflowRunsInline(t *testing.T) {
	pool := newQueueFullDropPool(t)
	recorder := &fakeUsageDropRecorder{}
	h := &GatewayHandler{usageRecordWorkerPool: pool, usageDropRecorder: recorder}

	input := &service.RecordUsageInput{
		Result: &service.ForwardResult{RequestID: "req-drop-1", Model: "claude-sonnet-4-5"},
	}
	var executed atomic.Bool
	h.submitUsageRecordTask(context.Background(), input, func(ctx context.Context) {
		executed.Store(true)
	})
	require.True(t, executed.Load(), "drop 溢出时计费任务必须内联执行，不能被丢弃")

	inputs, reasons := recorder.snapshot()
	require.Empty(t, inputs, "内联执行成功时不应写失败记录")
	require.Empty(t, reasons)
}
