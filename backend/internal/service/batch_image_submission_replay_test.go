//go:build unit

package service

import (
	"context"
	"encoding/json"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	infraerrors "github.com/daniei-chen/zhijing-gateway/internal/pkg/errors"
	"github.com/stretchr/testify/require"
)

type submissionReplayCountingQueue struct {
	BatchImageQueue
	enqueueCalls int
}

func (q *submissionReplayCountingQueue) Enqueue(ctx context.Context, batchID string) error {
	q.enqueueCalls++
	return q.BatchImageQueue.Enqueue(ctx, batchID)
}

func TestBatchImageSubmissionDistinctNoncesAreDistinctCommands(t *testing.T) {
	svc, repo, queue, provider, _ := newTestBatchImagePublicService(true)
	countedQueue := &submissionReplayCountingQueue{BatchImageQueue: queue}
	svc.Queue = countedQueue
	req := validBatchImageSubmitRequest()
	req.TaskName = "Synthetic replay observation"
	owner := testBatchImageOwner()
	first, err := svc.Submit(context.Background(), owner, req, "synthetic-nonce-a")
	require.NoError(t, err)
	second, err := svc.Submit(context.Background(), owner, req, "synthetic-nonce-b")
	require.NoError(t, err)
	require.NotEqual(t, first.ID, second.ID)
	require.Len(t, repo.jobs, 2)
	require.Len(t, provider.submits, 2)
	billing := svc.BillingRepo.(*fakeBatchImageBillingRepo)
	require.Len(t, billing.reserves, 2)
	require.NotEqual(t, billing.reserves[0].RequestID, billing.reserves[1].RequestID)
	require.Equal(t, 2, countedQueue.enqueueCalls)

	replayedWrite, err := svc.Submit(context.Background(), owner, req, "synthetic-nonce-a")
	require.NoError(t, err)
	require.Equal(t, first.ID, replayedWrite.ID)
	require.Equal(t, 3, countedQueue.enqueueCalls, "the original Submit intentionally re-enqueues submitted jobs")
	require.Len(t, provider.submits, 2)
	require.Len(t, billing.reserves, 2)

	delete(repo.jobs, first.ID)
	recreated, err := svc.Submit(context.Background(), owner, req, "synthetic-nonce-a")
	require.NoError(t, err)
	require.NotEqual(t, first.ID, recreated.ID)
	require.Len(t, provider.submits, 3)
	require.Len(t, billing.reserves, 3)
	t.Log("Observed original command semantics: distinct nonce -> 2 jobs/provider submits/holds; same saved nonce -> enqueue again; absent record -> new command")
}

// Every repository method except the scoped lookup is a nil-interface trap.
// A replay that tries to mutate, load an account, or fetch items will panic.
type submissionReplayReadRepository struct {
	BatchImageRepository
	lookup func(context.Context, int64, int64, string) (*BatchImageJob, error)
	calls  atomic.Int32
}

func (r *submissionReplayReadRepository) GetBatchImageJobByIdempotencyKey(ctx context.Context, userID, apiKeyID int64, key string) (*BatchImageJob, error) {
	r.calls.Add(1)
	return r.lookup(ctx, userID, apiKeyID, key)
}

func TestBatchImageReplaySubmissionReadsRealSavedCommandWithoutEffects(t *testing.T) {
	svc, repo, queue, provider, _ := newTestBatchImagePublicService(true)
	countedQueue := &submissionReplayCountingQueue{BatchImageQueue: queue}
	svc.Queue = countedQueue
	req := validBatchImageSubmitRequest()
	req.TaskName = "Saved synthetic task"
	first, err := svc.Submit(context.Background(), testBatchImageOwner(), req, "synthetic-original")
	require.NoError(t, err)
	jobBefore, err := json.Marshal(repo.jobs)
	require.NoError(t, err)
	itemsBefore, err := json.Marshal(repo.items)
	require.NoError(t, err)
	billing := svc.BillingRepo.(*fakeBatchImageBillingRepo)
	auth := svc.AuthCache.(*fakeBatchImageAuthCacheInvalidator)
	readRepo := &submissionReplayReadRepository{lookup: repo.GetBatchImageJobByIdempotencyKey}
	// Historical lookup has no account/pricing/provider/billing dependencies.
	readonly := &BatchImagePublicService{Repo: readRepo, Config: svc.Config, Queue: countedQueue}
	readonly.Config.BatchImage.Enabled = false
	for i := 0; i < 3; i++ {
		got, replayErr := readonly.ReplaySubmission(context.Background(), testBatchImageOwner(), req, " synthetic-original ")
		require.NoError(t, replayErr)
		require.Equal(t, first, got)
	}
	require.EqualValues(t, 3, readRepo.calls.Load())
	require.Equal(t, 1, countedQueue.enqueueCalls, "submitted jobs must not be re-enqueued")
	require.Len(t, provider.submits, 1)
	require.Len(t, billing.reserves, 1)
	require.Empty(t, billing.releases)
	require.Equal(t, []int64{11}, auth.userIDs)
	jobAfter, err := json.Marshal(repo.jobs)
	require.NoError(t, err)
	itemsAfter, err := json.Marshal(repo.items)
	require.NoError(t, err)
	require.JSONEq(t, string(jobBefore), string(jobAfter))
	require.JSONEq(t, string(itemsBefore), string(itemsAfter))
}

func replaySavedSubmission(t *testing.T) (*BatchImagePublicService, *submissionReplayReadRepository, *BatchImageJob, BatchImageSubmitRequest) {
	t.Helper()
	svc, repo, _, _, _ := newTestBatchImagePublicService(true)
	req := validBatchImageSubmitRequest()
	req.TaskName = "2000-01-02 03:04:05"
	first, err := svc.Submit(context.Background(), testBatchImageOwner(), req, "synthetic-original")
	require.NoError(t, err)
	job := repo.jobs[first.ID]
	reader := &submissionReplayReadRepository{lookup: func(_ context.Context, userID, apiKeyID int64, key string) (*BatchImageJob, error) {
		if userID != job.UserID || job.APIKeyID == nil || apiKeyID != *job.APIKeyID || key != "synthetic-original" {
			return nil, ErrBatchImageJobNotFound
		}
		return job, nil
	}}
	return &BatchImagePublicService{Repo: reader}, reader, job, req
}

func TestBatchImageReplaySubmissionUnavailableOrUnconfirmed(t *testing.T) {
	t.Run("missing service", func(t *testing.T) {
		var svc *BatchImagePublicService
		_, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), validBatchImageSubmitRequest(), "key")
		require.ErrorIs(t, err, ErrBatchImageReplayUnavailable)
	})
	t.Run("missing repository", func(t *testing.T) {
		_, err := (&BatchImagePublicService{}).ReplaySubmission(context.Background(), testBatchImageOwner(), validBatchImageSubmitRequest(), "key")
		require.ErrorIs(t, err, ErrBatchImageReplayUnavailable)
	})
	t.Run("missing key does not read", func(t *testing.T) {
		svc, reader, _, req := replaySavedSubmission(t)
		_, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, " \t")
		require.ErrorIs(t, err, ErrBatchImageReplayKeyRequired)
		require.Zero(t, reader.calls.Load())
	})
	for _, name := range []string{"missing", "nil result", "deleted", "missing hash", "empty hash", "missing task name", "wrong user", "wrong API key", "nil API key", "wrong nonce", "empty batch id", "repository fault"} {
		t.Run(name, func(t *testing.T) {
			svc, reader, job, req := replaySavedSubmission(t)
			want := error(ErrBatchImageResultUnconfirmed)
			switch name {
			case "missing":
				reader.lookup = func(context.Context, int64, int64, string) (*BatchImageJob, error) {
					return nil, ErrBatchImageJobNotFound
				}
			case "nil result":
				reader.lookup = func(context.Context, int64, int64, string) (*BatchImageJob, error) { return nil, nil }
			case "deleted":
				now := time.Now()
				job.UserDeletedAt = &now
			case "missing hash":
				job.RequestHash = nil
			case "empty hash":
				job.RequestHash = batchImageStringPtr(" ")
			case "missing task name":
				job.TaskName, req.TaskName = "", ""
			case "wrong user":
				job.UserID++
			case "wrong API key":
				keyID := int64(999)
				job.APIKeyID = &keyID
			case "nil API key":
				job.APIKeyID = nil
			case "wrong nonce":
				job.IdempotencyKey = batchImageStringPtr("another-command")
			case "empty batch id":
				job.BatchID = ""
			case "repository fault":
				reader.lookup = func(context.Context, int64, int64, string) (*BatchImageJob, error) {
					return nil, errors.New("synthetic database unavailable")
				}
				want = ErrBatchImageReplayUnavailable
			}
			// A faulty repository that ignores its scoped predicate must not leak.
			if name == "wrong user" || name == "wrong API key" || name == "nil API key" {
				reader.lookup = func(context.Context, int64, int64, string) (*BatchImageJob, error) { return job, nil }
			}
			got, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
			require.Nil(t, got)
			require.ErrorIs(t, err, want)
			require.EqualValues(t, 1, reader.calls.Load())
		})
	}
}

func TestBatchImageReplaySubmissionScopedOwnerAndPayload(t *testing.T) {
	for _, owner := range []BatchImageOwner{{UserID: 12, APIKeyID: 22}, {UserID: 11, APIKeyID: 23}} {
		svc, reader, _, req := replaySavedSubmission(t)
		_, err := svc.ReplaySubmission(context.Background(), owner, req, "synthetic-original")
		require.ErrorIs(t, err, ErrBatchImageResultUnconfirmed)
		require.EqualValues(t, 1, reader.calls.Load())
	}
	for _, field := range []string{"prompt", "task", "model", "metadata", "parent", "aspect ratio", "output count"} {
		t.Run(field, func(t *testing.T) {
			svc, reader, _, req := replaySavedSubmission(t)
			switch field {
			case "prompt":
				req.Items[0].Prompt = "other"
			case "task":
				req.TaskName = "changed"
			case "model":
				req.Model = "gemini-3-pro-image"
			case "metadata":
				req.Metadata = map[string]string{"project": "different"}
			case "parent":
				req.ParentBatchID = "imgbatch_other"
			case "aspect ratio":
				req.AspectRatio = "16:9"
			case "output count":
				req.Items[0].OutputCount = 2
			}
			_, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
			require.ErrorIs(t, err, ErrBatchImageIdempotencyConflict)
			require.EqualValues(t, 1, reader.calls.Load())
		})
	}
	t.Run("invalid request cannot confirm", func(t *testing.T) {
		svc, _, _, req := replaySavedSubmission(t)
		req.Items = nil
		_, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
		require.ErrorIs(t, err, ErrBatchImageInvalidItems)
	})
	t.Run("blank original name uses the saved default instead of retry time", func(t *testing.T) {
		svc, _, job, req := replaySavedSubmission(t)
		req.TaskName = " \t"
		got, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
		require.NoError(t, err)
		require.Equal(t, job.TaskName, got.TaskName)
		require.Equal(t, "2000-01-02 03:04:05", got.TaskName)
	})
}

func TestBatchImageReplaySubmissionCancelledBeforeOrAfterDatabaseWait(t *testing.T) {
	for _, afterWait := range []bool{false, true} {
		svc, reader, job, req := replaySavedSubmission(t)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		if afterWait {
			entered, release := make(chan struct{}), make(chan struct{})
			reader.lookup = func(context.Context, int64, int64, string) (*BatchImageJob, error) {
				close(entered)
				<-release
				return job, nil // Simulate a repository ignoring cancellation.
			}
			done := make(chan error, 1)
			go func() {
				_, err := svc.ReplaySubmission(ctx, testBatchImageOwner(), req, "synthetic-original")
				done <- err
			}()
			<-entered
			cancel()
			close(release)
			require.ErrorIs(t, <-done, context.Canceled)
			require.EqualValues(t, 1, reader.calls.Load())
		} else {
			cancel()
			_, err := svc.ReplaySubmission(ctx, testBatchImageOwner(), req, "synthetic-original")
			require.ErrorIs(t, err, context.Canceled)
			require.Zero(t, reader.calls.Load())
		}
	}
}

func TestBatchImageReplaySubmissionConcurrentChecksPreserveDraft(t *testing.T) {
	svc, reader, job, req := replaySavedSubmission(t)
	req.Model = " " + req.Model + " "
	req.Items[0].Prompt = " hero "
	before, err := json.Marshal(req)
	require.NoError(t, err)
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() {
			got, replayErr := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
			if replayErr == nil && got.ID != job.BatchID {
				replayErr = errors.New("wrong saved job")
			}
			results <- replayErr
		}()
	}
	for i := 0; i < 8; i++ {
		require.NoError(t, <-results)
	}
	after, err := json.Marshal(req)
	require.NoError(t, err)
	require.Equal(t, string(before), string(after))
	require.EqualValues(t, 8, reader.calls.Load())
	require.Equal(t, 409, infraerrors.Code(ErrBatchImageResultUnconfirmed))
}

func TestBatchImageReplaySubmissionReadsHistoryWithoutResumingAnyStatus(t *testing.T) {
	for _, tc := range []struct{ stored, public string }{
		{BatchImageJobStatusCreated, "queued"},
		{BatchImageJobStatusSubmitted, "queued"},
		{BatchImageJobStatusCompleted, "completed"},
		{BatchImageJobStatusFailed, "failed"},
		{BatchImageJobStatusCancelled, "cancelled"},
		{BatchImageJobStatusOutputDeleted, "output_deleted"},
	} {
		t.Run(tc.stored, func(t *testing.T) {
			svc, reader, job, req := replaySavedSubmission(t)
			job.Status = tc.stored
			if tc.stored == BatchImageJobStatusOutputDeleted {
				past := time.Now().Add(-time.Hour)
				job.OutputDeletedAt = &past
			}
			got, err := svc.ReplaySubmission(context.Background(), testBatchImageOwner(), req, "synthetic-original")
			require.NoError(t, err)
			require.Equal(t, tc.public, got.Status)
			require.Equal(t, job.BatchID, got.ID)
			require.EqualValues(t, 1, reader.calls.Load())
		})
	}
}
