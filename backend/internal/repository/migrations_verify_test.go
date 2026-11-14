package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"testing/fstest"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestVerifyAppliedMigrationsOnlyReadsExactSet(t *testing.T) {
	files := fstest.MapFS{"001_init.sql": &fstest.MapFile{Data: []byte("SELECT 1;")}}
	hash := sha256.Sum256([]byte("SELECT 1;"))
	for _, outcome := range []string{"matching", "missing", "changed", "unknown", "query_error"} {
		t.Run(outcome, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			defer func() { _ = db.Close() }()
			mock.ExpectBegin()
			query := mock.ExpectQuery("SELECT filename, checksum FROM schema_migrations")
			rows := sqlmock.NewRows([]string{"filename", "checksum"})
			if outcome != "missing" {
				checksum := hex.EncodeToString(hash[:])
				if outcome == "changed" {
					checksum = "incorrect"
				}
				rows.AddRow("001_init.sql", checksum)
			}
			if outcome == "unknown" {
				rows.AddRow("002_unknown.sql", "other")
			}
			if outcome == "query_error" {
				query.WillReturnError(errors.New("unavailable"))
			} else {
				query.WillReturnRows(rows)
			}
			if outcome == "matching" {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			err = verifyAppliedMigrationsFS(context.Background(), db, files)
			if outcome == "matching" {
				require.NoError(t, err)
			} else {
				require.Error(t, err)
			}
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
