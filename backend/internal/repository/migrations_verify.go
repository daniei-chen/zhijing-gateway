package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"sort"
	"strings"
)

// allowUnknownAppliedMigrationsEnv is an explicit, default-off rollback escape
// hatch. A rolling API peer normally refuses to start when schema_migrations
// contains rows the embedded set does not know (for example after running a
// newer build and rolling back). That refusal is correct by default: an unknown
// applied migration means the peer cannot prove the schema matches its code.
//
// Setting this to 1 only relaxes the "extra applied rows" check; a missing
// migration or a checksum mismatch still aborts startup. Every relaxation is
// logged with the affected filenames so the decision stays auditable.
const allowUnknownAppliedMigrationsEnv = "ZHIJING_ALLOW_UNKNOWN_APPLIED_MIGRATIONS"

func allowUnknownAppliedMigrations() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(allowUnknownAppliedMigrationsEnv))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// A rolling API peer must not run DDL or bootstrap while the old instance is
// serving. Require the exact embedded migration set to be already applied.
func verifyAppliedMigrationsFS(ctx context.Context, db *sql.DB, files fs.FS) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("begin migration verification: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, "SELECT filename, checksum FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("read applied migrations: %w", err)
	}
	applied := make(map[string]string)
	for rows.Next() {
		var name, checksum string
		if err := rows.Scan(&name, &checksum); err != nil {
			_ = rows.Close()
			return err
		}
		applied[name] = checksum
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return err
	}
	names, err := fs.Glob(files, "*.sql")
	if err != nil {
		return err
	}
	for _, name := range names {
		data, err := fs.ReadFile(files, name)
		if err != nil {
			return err
		}
		content := strings.TrimSpace(string(data))
		if content == "" {
			continue
		}
		sum := sha256.Sum256([]byte(content))
		checksum := hex.EncodeToString(sum[:])
		existing, found := applied[name]
		if !found || (existing != checksum && !isMigrationChecksumCompatible(name, existing, checksum)) {
			return fmt.Errorf("API-only migration verification failed for %s; no schema changes performed", name)
		}
		delete(applied, name)
	}
	if len(applied) != 0 {
		unknown := make([]string, 0, len(applied))
		for name := range applied {
			unknown = append(unknown, name)
		}
		sort.Strings(unknown)
		if !allowUnknownAppliedMigrations() {
			return fmt.Errorf("API-only migration verification found %d unknown applied migrations", len(applied))
		}
		slog.Warn("API-only migration verification: allowing unknown applied migrations (rollback opt-in)",
			"count", len(applied), "files", unknown)
	}
	return tx.Commit()
}
