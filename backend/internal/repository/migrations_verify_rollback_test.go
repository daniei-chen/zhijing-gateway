package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"testing"
	"testing/fstest"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

// The rollback escape hatch must be explicit, default-off, and narrow: it only
// tolerates rows the embedded set does not know about. Missing migrations and
// checksum mismatches must still abort startup.
func TestVerifyAppliedMigrationsRollbackOptIn(t *testing.T) {
	files := fstest.MapFS{"001_init.sql": &fstest.MapFile{Data: []byte("SELECT 1;")}}
	hash := sha256.Sum256([]byte("SELECT 1;"))
	checksum := hex.EncodeToString(hash[:])

	newDB := func(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
		t.Helper()
		db, mock, err := sqlmock.New()
		require.NoError(t, err)
		mock.ExpectBegin()
		return db, mock
	}

	t.Run("default refuses unknown applied migrations", func(t *testing.T) {
		t.Setenv(allowUnknownAppliedMigrationsEnv, "")
		db, mock := newDB(t)
		defer db.Close()
		mock.ExpectQuery("SELECT filename, checksum FROM schema_migrations").WillReturnRows(
			sqlmock.NewRows([]string{"filename", "checksum"}).
				AddRow("001_init.sql", checksum).
				AddRow("250_newer_then_rolled_back.sql", "whatever"),
		)
		mock.ExpectRollback()
		require.Error(t, verifyAppliedMigrationsFS(context.Background(), db, files))
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("opt-in allows unknown applied migrations", func(t *testing.T) {
		t.Setenv(allowUnknownAppliedMigrationsEnv, "1")
		db, mock := newDB(t)
		defer db.Close()
		mock.ExpectQuery("SELECT filename, checksum FROM schema_migrations").WillReturnRows(
			sqlmock.NewRows([]string{"filename", "checksum"}).
				AddRow("001_init.sql", checksum).
				AddRow("250_newer_then_rolled_back.sql", "whatever"),
		)
		mock.ExpectCommit()
		require.NoError(t, verifyAppliedMigrationsFS(context.Background(), db, files))
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("opt-in still refuses checksum mismatch", func(t *testing.T) {
		t.Setenv(allowUnknownAppliedMigrationsEnv, "1")
		db, mock := newDB(t)
		defer db.Close()
		mock.ExpectQuery("SELECT filename, checksum FROM schema_migrations").WillReturnRows(
			sqlmock.NewRows([]string{"filename", "checksum"}).AddRow("001_init.sql", "tampered"),
		)
		mock.ExpectRollback()
		require.Error(t, verifyAppliedMigrationsFS(context.Background(), db, files))
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("opt-in does not mask a missing migration", func(t *testing.T) {
		t.Setenv(allowUnknownAppliedMigrationsEnv, "1")
		db, mock := newDB(t)
		defer db.Close()
		mock.ExpectQuery("SELECT filename, checksum FROM schema_migrations").WillReturnRows(
			sqlmock.NewRows([]string{"filename", "checksum"}),
		)
		mock.ExpectRollback()
		require.Error(t, verifyAppliedMigrationsFS(context.Background(), db, files))
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestAllowUnknownAppliedMigrationsParsing(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  bool
	}{
		{"", false}, {"0", false}, {"false", false}, {"1", true}, {"true", true}, {" YES ", true},
	} {
		t.Run(tc.value, func(t *testing.T) {
			t.Setenv(allowUnknownAppliedMigrationsEnv, tc.value)
			require.Equal(t, tc.want, allowUnknownAppliedMigrations())
		})
	}
}
