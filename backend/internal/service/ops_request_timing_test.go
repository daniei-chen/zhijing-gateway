package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/gatewaytiming"
	"github.com/stretchr/testify/require"
)

type requestTimingRepo struct {
	opsRepoMock
	rows []*OpsRequestDetail
}

func (r *requestTimingRepo) ListRequestDetails(context.Context, *OpsRequestDetailFilter) ([]*OpsRequestDetail, int64, error) {
	return r.rows, int64(len(r.rows)), nil
}

func TestOpsRequestDetailsAddsOptionalScopedTimingWithoutChangingLatency(t *testing.T) {
	user, key := int64(990301), int64(990401)
	first, duration := 823, 4100
	now := time.Now()
	row := &OpsRequestDetail{Kind: OpsRequestKindSuccess, RequestID: "local:synthetic-service", CreatedAt: now,
		UserID: &user, APIKeyID: &key, FirstTokenMs: &first, DurationMs: &duration}
	gatewaytiming.Recent.Publish(gatewaytiming.Scope{UserID: user, APIKeyID: key}, []string{row.RequestID}, map[string]any{"body_read_block_ms": int64(12000)})
	s := &OpsService{opsRepo: &requestTimingRepo{rows: []*OpsRequestDetail{row, {Kind: OpsRequestKindError, RequestID: "old-row", CreatedAt: now}}}}
	out, err := s.ListRequestDetails(context.Background(), nil)
	require.NoError(t, err)
	require.EqualValues(t, 2, out.Total)
	require.NotNil(t, out.Items[0].GatewayTiming)
	require.Equal(t, &first, out.Items[0].FirstTokenMs)
	require.Equal(t, &duration, out.Items[0].DurationMs)
	require.Nil(t, out.Items[1].GatewayTiming)
	body, err := json.Marshal(out.Items[1])
	require.NoError(t, err)
	require.NotContains(t, string(body), "gateway_timing")
}
