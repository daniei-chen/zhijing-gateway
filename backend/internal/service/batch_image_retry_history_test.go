//go:build unit

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Only the four repository read methods are implemented. Every write or
// unrelated dependency accessed by RetryHistory is a nil-interface trap.
type retryHistoryRepository struct {
	BatchImageRepository
	jobs       []*BatchImageJob
	items      map[string][]*BatchImageItem
	beforeRead func(string, string, int) error
	calls      []string
	override   func(string, *BatchImageJob) *BatchImageJob
}

func (r *retryHistoryRepository) read(kind, id string, offset int) error {
	r.calls = append(r.calls, fmt.Sprintf("%s:%s:%d", kind, id, offset))
	if r.beforeRead != nil {
		return r.beforeRead(kind, id, offset)
	}
	return nil
}
func (r *retryHistoryRepository) get(kind, id string) (*BatchImageJob, error) {
	if err := r.read(kind, id, 0); err != nil {
		return nil, err
	}
	for _, job := range r.jobs {
		if job.BatchID == id {
			copy := *job
			if r.override != nil {
				return r.override(kind, &copy), nil
			}
			return &copy, nil
		}
	}
	return nil, ErrBatchImageJobNotFound
}
func (r *retryHistoryRepository) GetBatchImageJobByBatchID(_ context.Context, id string) (*BatchImageJob, error) {
	return r.get("raw", id)
}
func (r *retryHistoryRepository) GetBatchImageJobByBatchIDForOwner(_ context.Context, userID, keyID int64, id string) (*BatchImageJob, error) {
	job, err := r.get("owner", id)
	if err != nil {
		return nil, err
	}
	if job == nil || job.UserID != userID || job.APIKeyID == nil || *job.APIKeyID != keyID || job.UserDeletedAt != nil {
		return nil, ErrBatchImageJobNotFound
	}
	return job, nil
}
func (r *retryHistoryRepository) ListBatchImageJobsForOwner(_ context.Context, userID, keyID int64, filter BatchImageJobFilter) ([]*BatchImageJob, error) {
	if err := r.read("jobs", "", filter.Offset); err != nil {
		return nil, err
	}
	var rows []*BatchImageJob
	for _, job := range r.jobs {
		if job.UserID != userID || job.APIKeyID == nil || *job.APIKeyID != keyID || filter.ExcludeDeleted && job.UserDeletedAt != nil {
			continue
		}
		copy := *job
		if r.override != nil {
			rows = append(rows, r.override("jobs", &copy))
		} else {
			rows = append(rows, &copy)
		}
	}
	if filter.Offset >= len(rows) {
		return nil, nil
	}
	end := filter.Offset + filter.Limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[filter.Offset:end], nil
}
func (r *retryHistoryRepository) ListBatchImageItems(_ context.Context, id string, filter BatchImageItemFilter) ([]*BatchImageItem, error) {
	if err := r.read("items", id, filter.Offset); err != nil {
		return nil, err
	}
	rows := r.items[id]
	if filter.Offset >= len(rows) {
		return nil, nil
	}
	end := filter.Offset + filter.Limit
	if end > len(rows) {
		end = len(rows)
	}
	return rows[filter.Offset:end], nil
}

func retryHistoryJob(id, parent, status string, count int) *BatchImageJob {
	keyID := int64(22)
	job := &BatchImageJob{BatchID: id, UserID: 11, APIKeyID: &keyID, Status: status, ItemCount: count}
	if parent != "" {
		job.ParentBatchID = batchImageStringPtr(parent)
	}
	return job
}
func retryHistoryItem(batch, id, status string, count int) *BatchImageItem {
	prompt := "Synthetic original " + id
	return &BatchImageItem{JobID: batch, CustomID: id, Status: status, ImageCount: count, PromptPreview: &prompt}
}
func retryHistoryFixture() (*BatchImagePublicService, *retryHistoryRepository) {
	past := time.Now().Add(-time.Hour)
	hidden := retryHistoryJob("hidden", "root", BatchImageJobStatusCompleted, 1)
	hidden.UserDeletedAt = &past
	reader := &retryHistoryRepository{
		jobs: []*BatchImageJob{retryHistoryJob("root", "", BatchImageJobStatusFailed, 2), hidden, retryHistoryJob("active", "root", BatchImageJobStatusRunning, 2), retryHistoryJob("cancelled", "root", BatchImageJobStatusCancelled, 1)},
		items: map[string][]*BatchImageItem{
			"root":      {retryHistoryItem("root", "scene/a", BatchImageItemStatusFailed, 0), retryHistoryItem("root", "scene a", BatchImageItemStatusFailed, 0)},
			"hidden":    {retryHistoryItem("hidden", "scene-a_retry_legacy", BatchImageItemStatusSuccess, 1)},
			"active":    {retryHistoryItem("active", "pending_retry_new", BatchImageItemStatusPending, 0), retryHistoryItem("active", "succeeded_retry_new", BatchImageItemStatusSuccess, 2)},
			"cancelled": {retryHistoryItem("cancelled", "not-active", BatchImageItemStatusPending, 0)},
		},
	}
	return &BatchImagePublicService{Repo: reader}, reader
}

type retryHistorySubmitRepository struct{ *fakeBatchImageRepository }

func (r *retryHistorySubmitRepository) CreateBatchImageJob(ctx context.Context, params CreateBatchImageJobParams) (*BatchImageJob, error) {
	job, err := r.fakeBatchImageRepository.CreateBatchImageJob(ctx, params)
	if err == nil {
		job.ParentBatchID = params.ParentBatchID
	}
	return job, err
}

func TestBatchImageRetryHistoryReadsHiddenChildAfterRealSubmitsWithoutExecution(t *testing.T) {
	svc, underlying, queue, provider, _ := newTestBatchImagePublicService(true)
	svc.Repo = &retryHistorySubmitRepository{underlying}
	countedQueue := &submissionReplayCountingQueue{BatchImageQueue: queue}
	svc.Queue = countedQueue
	req := validBatchImageSubmitRequest()
	req.TaskName = "Synthetic root"
	root, err := svc.Submit(context.Background(), testBatchImageOwner(), req, "history-root")
	require.NoError(t, err)
	childRequest := validBatchImageSubmitRequest()
	childRequest.TaskName = "Synthetic child"
	childRequest.ParentBatchID = root.ID
	child, err := svc.Submit(context.Background(), testBatchImageOwner(), childRequest, "history-child")
	require.NoError(t, err)
	now := time.Now()
	underlying.jobs[root.ID].Status = BatchImageJobStatusFailed
	underlying.jobs[child.ID].Status, underlying.jobs[child.ID].UserDeletedAt = BatchImageJobStatusCompleted, &now
	reader := &retryHistoryRepository{jobs: []*BatchImageJob{underlying.jobs[root.ID], underlying.jobs[child.ID]}, items: map[string][]*BatchImageItem{}}
	for _, job := range reader.jobs {
		for _, params := range underlying.items[job.BatchID] {
			status, count := BatchImageItemStatusFailed, 0
			if job.BatchID == child.ID {
				status, count = BatchImageItemStatusSuccess, 1
			}
			reader.items[job.BatchID] = append(reader.items[job.BatchID], &BatchImageItem{JobID: job.BatchID, CustomID: params.CustomID, Status: status, ImageCount: count, PromptPreview: params.PromptPreview})
		}
	}
	jobsBefore, err := json.Marshal(underlying.jobs)
	require.NoError(t, err)
	svc.Repo = reader
	svc.Config.BatchImage.Enabled = false
	got, err := svc.RetryHistory(context.Background(), testBatchImageOwner(), root.ID)
	require.NoError(t, err)
	require.True(t, got.Complete)
	require.Equal(t, "image.batch.recovery", got.Object)
	require.Equal(t, "prompt_only", got.InputMode)
	require.Equal(t, []string{"cover_001", "cover_002"}, got.RootCustomIDs)
	require.Len(t, got.TargetItems, 2)
	require.Len(t, got.SuccessfulItems, 2)
	for _, item := range got.SuccessfulItems {
		require.Equal(t, child.ID, item.BatchID)
	}
	require.Empty(t, got.PendingItems)
	require.Len(t, provider.submits, 2)
	require.Equal(t, 2, countedQueue.enqueueCalls)
	billing := svc.BillingRepo.(*fakeBatchImageBillingRepo)
	require.Len(t, billing.reserves, 2)
	require.Empty(t, billing.releases)
	jobsAfter, err := json.Marshal(underlying.jobs)
	require.NoError(t, err)
	require.Equal(t, string(jobsBefore), string(jobsAfter))
}

func TestBatchImageRetryHistoryIncludesActiveSuccessAndOnlyNonterminalPending(t *testing.T) {
	svc, _ := retryHistoryFixture()
	got, err := svc.RetryHistory(context.Background(), testBatchImageOwner(), "root")
	require.NoError(t, err)
	require.True(t, got.Complete)
	require.Equal(t, []string{"scene/a", "scene a"}, got.RootCustomIDs)
	require.Equal(t, []BatchImageRecoverySuccess{{BatchID: "hidden", CustomID: "scene-a_retry_legacy", ImageCount: 1}, {BatchID: "active", CustomID: "succeeded_retry_new", ImageCount: 2}}, got.SuccessfulItems)
	require.Equal(t, []BatchImageRecoveryPending{{BatchID: "active", CustomID: "pending_retry_new"}}, got.PendingItems)
}

func TestBatchImageRetryHistoryVisibleChildCanReadHiddenRoot(t *testing.T) {
	svc, reader := retryHistoryFixture()
	now := time.Now()
	reader.jobs[0].UserDeletedAt = &now
	got, err := svc.RetryHistory(context.Background(), testBatchImageOwner(), "active")
	require.NoError(t, err)
	require.Equal(t, "active", got.BatchID)
	require.Equal(t, "root", got.RootBatchID)
	require.Len(t, got.TargetItems, 2)
	require.Len(t, got.RootCustomIDs, 2)
	require.True(t, got.Complete)
}

func TestBatchImageRetryHistoryDrainsOwnerAndItemPages(t *testing.T) {
	reader := &retryHistoryRepository{jobs: []*BatchImageJob{retryHistoryJob("root", "", BatchImageJobStatusFailed, 200)}, items: map[string][]*BatchImageItem{}}
	for i := 0; i < 200; i++ {
		reader.items["root"] = append(reader.items["root"], retryHistoryItem("root", fmt.Sprintf("original-%d", i), BatchImageItemStatusFailed, 0))
	}
	for i := 0; i < 102; i++ {
		id := fmt.Sprintf("child-%d", i)
		child := retryHistoryJob(id, "root", BatchImageJobStatusCompleted, 1)
		if i%2 == 0 {
			now := time.Now()
			child.UserDeletedAt = &now
		}
		reader.jobs = append(reader.jobs, child)
		reader.items[id] = []*BatchImageItem{retryHistoryItem(id, fmt.Sprintf("retry-%d", i), BatchImageItemStatusSuccess, 1)}
	}
	got, err := (&BatchImagePublicService{Repo: reader}).RetryHistory(context.Background(), testBatchImageOwner(), "root")
	require.NoError(t, err)
	require.True(t, got.Complete)
	require.Len(t, got.RootCustomIDs, 200)
	require.Len(t, got.TargetItems, 200)
	require.Len(t, got.SuccessfulItems, 102)
	require.Contains(t, reader.calls, "jobs::100")
	require.Contains(t, reader.calls, "items:root:200")
}

func TestBatchImageRetryHistoryFailsClosedOnMissingOrIncompleteReads(t *testing.T) {
	for _, condition := range []string{"missing target", "hidden target", "different user", "different key", "missing root", "wrong root owner", "wrong list owner", "dangling lineage", "wrong item job", "missing item", "duplicate item", "unknown item", "page fault", "child disappeared", "target hidden late"} {
		t.Run(condition, func(t *testing.T) {
			svc, reader := retryHistoryFixture()
			owner := testBatchImageOwner()
			target := "root"
			want := error(ErrBatchImageResultUnconfirmed)
			switch condition {
			case "missing target":
				target = "missing"
			case "hidden target":
				now := time.Now()
				reader.jobs[0].UserDeletedAt = &now
			case "different user":
				owner.UserID++
			case "different key":
				owner.APIKeyID++
			case "missing root":
				target = "active"
				reader.jobs = reader.jobs[1:]
			case "wrong root owner":
				target = "active"
				reader.jobs[0].UserID++
			case "wrong list owner":
				reader.override = func(kind string, job *BatchImageJob) *BatchImageJob {
					if kind == "jobs" {
						job.UserID++
					}
					return job
				}
			case "dangling lineage":
				reader.jobs[1].ParentBatchID = batchImageStringPtr("physically-missing")
			case "wrong item job":
				reader.items["hidden"][0].JobID = "other-owner-job"
			case "missing item":
				reader.items["root"] = reader.items["root"][:1]
			case "duplicate item":
				reader.items["root"][1].CustomID = reader.items["root"][0].CustomID
			case "unknown item":
				reader.items["hidden"][0].Status = "unrecognized"
			case "page fault":
				want = ErrBatchImageRecoveryUnavailable
				reader.beforeRead = func(kind, id string, _ int) error {
					if kind == "items" && id == "hidden" {
						return errors.New("synthetic storage fault")
					}
					return nil
				}
			case "child disappeared":
				reader.beforeRead = func(kind, id string, _ int) error {
					if kind == "raw" && id == "hidden" {
						return ErrBatchImageJobNotFound
					}
					return nil
				}
			case "target hidden late":
				ownerReads := 0
				reader.beforeRead = func(kind, id string, _ int) error {
					if kind == "owner" && id == "root" {
						ownerReads++
						if ownerReads == 2 {
							return ErrBatchImageJobNotFound
						}
					}
					return nil
				}
			}
			got, err := svc.RetryHistory(context.Background(), owner, target)
			require.Nil(t, got, "partial recovery data must not escape")
			require.ErrorIs(t, err, want)
		})
	}
	for _, svc := range []*BatchImagePublicService{nil, {}} {
		got, err := svc.RetryHistory(context.Background(), testBatchImageOwner(), "root")
		require.Nil(t, got)
		require.ErrorIs(t, err, ErrBatchImageRecoveryUnavailable)
	}
}

func TestBatchImageRetryHistoryCancellationDuringEveryReadKind(t *testing.T) {
	for _, kind := range []string{"entry", "owner", "raw", "jobs", "items"} {
		t.Run(kind, func(t *testing.T) {
			svc, reader := retryHistoryFixture()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if kind == "entry" {
				cancel()
				got, err := svc.RetryHistory(ctx, testBatchImageOwner(), "root")
				require.Nil(t, got)
				require.ErrorIs(t, err, context.Canceled)
				require.Empty(t, reader.calls)
				return
			}
			entered, release := make(chan struct{}), make(chan struct{})
			blocked := false
			reader.beforeRead = func(actual, _ string, _ int) error {
				if actual == kind && !blocked {
					blocked = true
					close(entered)
					<-release
				}
				return nil
			}
			type outcome struct {
				response *BatchImageRetryHistoryResponse
				err      error
			}
			done := make(chan outcome, 1)
			go func() { got, err := svc.RetryHistory(ctx, testBatchImageOwner(), "root"); done <- outcome{got, err} }()
			<-entered
			cancel()
			close(release)
			result := <-done
			require.Nil(t, result.response)
			require.ErrorIs(t, result.err, context.Canceled)
		})
	}
}

func TestBatchImageRetryHistorySecondPageFailureReturnsNoPartialCompleteData(t *testing.T) {
	for _, failureKind := range []string{"jobs", "items"} {
		t.Run(failureKind, func(t *testing.T) {
			svc, reader := retryHistoryFixture()
			reader.jobs[0].ItemCount = 200
			reader.items["root"] = nil
			for i := 0; i < 200; i++ {
				reader.items["root"] = append(reader.items["root"], retryHistoryItem("root", fmt.Sprintf("id-%d", i), BatchImageItemStatusFailed, 0))
			}
			for i := 0; i < 100; i++ {
				reader.jobs = append(reader.jobs, retryHistoryJob(fmt.Sprintf("unrelated-%d", i), "", BatchImageJobStatusCompleted, 1))
			}
			reader.beforeRead = func(kind, _ string, offset int) error {
				if kind == failureKind && offset == 100 {
					return errors.New("synthetic second page failure")
				}
				return nil
			}
			got, err := svc.RetryHistory(context.Background(), testBatchImageOwner(), "root")
			require.Nil(t, got)
			require.ErrorIs(t, err, ErrBatchImageRecoveryUnavailable)
		})
	}
}
