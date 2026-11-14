//go:build unit

package admin

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/daniei-chen/zhijing-gateway/internal/config"
	"github.com/daniei-chen/zhijing-gateway/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const backupValidationDump = "-- Synthetic backup handler fixture104; no database connection.\n"

// Only the methods used by StartBackup are implemented. Unexpected repository,
// restore or object-store operations fail instead of reaching any real service.
type backupValidationRepository struct {
	service.SettingRepository
	mu     sync.Mutex
	data   map[string]string
	calls  atomic.Int64
	writes atomic.Int64
}

func (r *backupValidationRepository) GetValue(_ context.Context, key string) (string, error) {
	r.calls.Add(1)
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.data[key], nil
}

func (r *backupValidationRepository) Set(_ context.Context, key, value string) error {
	r.calls.Add(1)
	r.writes.Add(1)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.data[key] = value
	return nil
}

type backupValidationDumper struct {
	service.DBDumper
	calls atomic.Int64
}

func (d *backupValidationDumper) Dump(context.Context) (io.ReadCloser, error) {
	d.calls.Add(1)
	return io.NopCloser(strings.NewReader(backupValidationDump)), nil
}

type backupValidationStore struct {
	service.BackupObjectStore
	calls atomic.Int64
	mu    sync.Mutex
	data  []byte
}

func (s *backupValidationStore) UploadFile(_ context.Context, _ string, path, contentType string) (int64, error) {
	s.calls.Add(1)
	if contentType != "application/gzip" {
		return 0, errors.New("unexpected synthetic upload content type")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	s.mu.Lock()
	s.data = data
	s.mu.Unlock()
	return int64(len(data)), nil
}

type backupValidationEncryptor struct{}

func (backupValidationEncryptor) Encrypt(value string) (string, error) { return value, nil }
func (backupValidationEncryptor) Decrypt(value string) (string, error) { return value, nil }

type backupValidationFixture struct {
	repo         *backupValidationRepository
	dumper       *backupValidationDumper
	store        *backupValidationStore
	factoryCalls atomic.Int64
	svc          *service.BackupService
	router       *gin.Engine
	stopOnce     sync.Once
}

func newBackupValidationFixture(t *testing.T, configured bool) *backupValidationFixture {
	t.Helper()
	f := &backupValidationFixture{
		repo:   &backupValidationRepository{data: map[string]string{}},
		dumper: &backupValidationDumper{},
		store:  &backupValidationStore{},
	}
	if configured {
		cfg, err := json.Marshal(service.BackupS3Config{
			Bucket: "synthetic-bucket104", AccessKeyID: "SYNTHETIC_ACCESS104",
			SecretAccessKey: "SYNTHETIC_SECRET104", Prefix: "synthetic104",
		})
		require.NoError(t, err)
		f.repo.data["backup_s3_config"] = string(cfg)
	}
	f.svc = service.NewBackupService(
		f.repo,
		&config.Config{Database: config.DatabaseConfig{DBName: "synthetic104"}, Totp: config.TotpConfig{EncryptionKeyConfigured: true}},
		backupValidationEncryptor{},
		func(context.Context, *service.BackupS3Config) (service.BackupObjectStore, error) {
			f.factoryCalls.Add(1)
			return f.store, nil
		},
		f.dumper,
	)
	gin.SetMode(gin.TestMode)
	f.router = gin.New()
	handler := NewBackupHandler(f.svc, nil, nil)
	// The production route has admin/step-up middleware before this handler.
	// This fixture tests only the handler contract after authorization succeeds.
	f.router.POST("/api/v1/admin/backups", handler.CreateBackup)
	t.Cleanup(f.stop)
	return f
}

func (f *backupValidationFixture) stop() { f.stopOnce.Do(f.svc.Stop) }

func (f *backupValidationFixture) request(body io.Reader) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/backups", body)
	request.Header.Set("Content-Type", "application/json")
	f.router.ServeHTTP(recorder, request)
	// Join synthetic background work before inspecting counters or test cleanup.
	f.stop()
	return recorder
}

func assertBackupValidationRejected(t *testing.T, f *backupValidationFixture, recorder *httptest.ResponseRecorder) {
	t.Helper()
	assert.Equal(t, http.StatusBadRequest, recorder.Code, recorder.Body.String())
	assert.Zero(t, f.repo.calls.Load(), "invalid request entered the settings/record repository")
	assert.Zero(t, f.repo.writes.Load(), "invalid request wrote a backup record")
	assert.Zero(t, f.factoryCalls.Load(), "invalid request initialized object storage")
	assert.Zero(t, f.dumper.calls.Load(), "invalid request started the synthetic dumper")
	assert.Zero(t, f.store.calls.Load(), "invalid request uploaded a synthetic archive")
	var response struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Data    json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, http.StatusBadRequest, response.Code)
	assert.NotEmpty(t, response.Message)
	assert.Empty(t, response.Data)
}

func TestBackupHandlerCreateBackupValidationRejectsInvalidRequests(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"truncated_json", `{"expire_days":`},
		{"malformed_json", `{"expire_days":7,}`},
		{"string_days", `{"expire_days":"7"}`},
		{"boolean_days", `{"expire_days":true}`},
		{"object_days", `{"expire_days":{}}`},
		{"fractional_days", `{"expire_days":1.5}`},
		{"decimal_integer_days", `{"expire_days":1.0}`},
		{"negative_days", `{"expire_days":-1}`},
		{"array_instead_of_request", `[]`},
		{"integer_overflow", `{"expire_days":9223372036854775808}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newBackupValidationFixture(t, true)
			assertBackupValidationRejected(t, f, f.request(strings.NewReader(tc.body)))
		})
	}
}

type backupValidationErrorReader struct{ err error }

func (r backupValidationErrorReader) Read([]byte) (int, error) { return 0, r.err }

func TestBackupHandlerCreateBackupValidationRejectsBodyReadError(t *testing.T) {
	f := newBackupValidationFixture(t, true)
	reader := backupValidationErrorReader{err: errors.New("synthetic104 request reader failed")}
	assertBackupValidationRejected(t, f, f.request(reader))
}

func TestBackupHandlerCreateBackupValidationCompatibleExpiry(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		days int
	}{
		{"empty_body", "", 14},
		{"whitespace_body", " \n\t ", 14},
		{"empty_object", `{}`, 14},
		{"missing_field", `{"unrelated":true}`, 14},
		{"null_field", `{"expire_days":null}`, 14},
		{"null_request", `null`, 14},
		{"permanent", `{"expire_days":0}`, 0},
		{"negative_zero_is_zero", `{"expire_days":-0}`, 0},
		{"one_day", `{"expire_days":1}`, 1},
		{"seven_days", `{"expire_days":7}`, 7},
		{"no_new_business_upper_bound", `{"expire_days":400,"unrelated":true}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newBackupValidationFixture(t, true)
			recorder := f.request(strings.NewReader(tc.body))
			require.Equal(t, http.StatusAccepted, recorder.Code, recorder.Body.String())
			var response struct {
				Code int                  `json:"code"`
				Data service.BackupRecord `json:"data"`
			}
			require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
			require.Zero(t, response.Code)
			require.Equal(t, "running", response.Data.Status)
			require.Equal(t, "manual", response.Data.TriggeredBy)
			require.Equal(t, "postgres", response.Data.BackupType)
			require.NotEmpty(t, response.Data.ID)
			if tc.days == 0 {
				require.Empty(t, response.Data.ExpiresAt)
			} else {
				started, err := time.Parse(time.RFC3339, response.Data.StartedAt)
				require.NoError(t, err)
				require.Equal(t, started.AddDate(0, 0, tc.days).Format(time.RFC3339), response.Data.ExpiresAt)
			}
			require.EqualValues(t, 1, f.factoryCalls.Load())
			require.EqualValues(t, 1, f.dumper.calls.Load())
			require.EqualValues(t, 1, f.store.calls.Load())
			f.store.mu.Lock()
			compressed := append([]byte(nil), f.store.data...)
			f.store.mu.Unlock()
			reader, err := gzip.NewReader(strings.NewReader(string(compressed)))
			require.NoError(t, err)
			decompressed, err := io.ReadAll(reader)
			require.NoError(t, err)
			require.NoError(t, reader.Close())
			require.Equal(t, backupValidationDump, string(decompressed))
			f.repo.mu.Lock()
			stored := f.repo.data["backup_records"]
			f.repo.mu.Unlock()
			var records []service.BackupRecord
			require.NoError(t, json.Unmarshal([]byte(stored), &records))
			require.Len(t, records, 1)
			require.Equal(t, "completed", records[0].Status)
			require.Equal(t, response.Data.ID, records[0].ID)
			require.Equal(t, response.Data.ExpiresAt, records[0].ExpiresAt)
		})
	}
}

func TestBackupHandlerCreateBackupValidationPreservesServiceFailure(t *testing.T) {
	f := newBackupValidationFixture(t, false)
	recorder := f.request(strings.NewReader(`{"expire_days":7}`))
	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Contains(t, recorder.Body.String(), "BACKUP_S3_NOT_CONFIGURED")
	require.Positive(t, f.repo.calls.Load())
	require.Zero(t, f.repo.writes.Load())
	require.Zero(t, f.factoryCalls.Load())
	require.Zero(t, f.dumper.calls.Load())
	require.Zero(t, f.store.calls.Load())
}
