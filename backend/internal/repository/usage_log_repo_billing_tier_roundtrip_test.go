//go:build unit

package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	dbent "github.com/daniei-chen/zhijing-gateway/ent"
	"github.com/daniei-chen/zhijing-gateway/ent/enttest"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"

	"github.com/daniei-chen/zhijing-gateway/internal/pkg/pagination"
	"github.com/daniei-chen/zhijing-gateway/internal/pkg/usagestats"
	"github.com/daniei-chen/zhijing-gateway/internal/service"

	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

func openUsageLogSQLite(t *testing.T, name string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+name+"?mode=memory&cache=shared&_fk=1")
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	_, err = db.Exec("PRAGMA foreign_keys = ON")
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

// billing_tier 过滤在真 SQL 引擎上的语义：等值匹配，历史 NULL 行不命中。
// 单元里只断言过生成的 WHERE 片段，这里交给 SQLite 真执行一次。
func TestUsageLogBillingTierFilterExcludesNullRowsOnSQLite(t *testing.T) {
	db := openUsageLogSQLite(t, "usage_tier_null_filter")

	_, err := db.Exec(`CREATE TABLE usage_logs (id INTEGER PRIMARY KEY, billing_tier TEXT)`)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO usage_logs (id, billing_tier) VALUES (1, 'image_price_defaulted'), (2, NULL), (3, 'other')`)
	require.NoError(t, err)

	conditions, args := appendUsageLogBillingTierWhereCondition(nil, nil, service.BillingTierImagePriceDefaulted)
	require.Len(t, conditions, 1)
	query := "SELECT id FROM usage_logs " + buildWhere(conditions) + " ORDER BY id"

	rows, err := db.Query(query, args...)
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()

	var ids []int64
	for rows.Next() {
		var id int64
		require.NoError(t, rows.Scan(&id))
		ids = append(ids, id)
	}
	require.NoError(t, rows.Err())
	require.Equal(t, []int64{1}, ids, "只命中带该标记的行，NULL 行与其它标记都不命中")
}

// captureExecutor 只记录写入语句，用于取出 INSERT 的列清单。
type captureExecutor struct {
	query string
}

func (c *captureExecutor) ExecContext(context.Context, string, ...any) (sql.Result, error) {
	return driverResult(1), nil
}

func (c *captureExecutor) QueryContext(_ context.Context, query string, _ ...any) (*sql.Rows, error) {
	c.query = query
	return nil, errors.New("capture only")
}

type driverResult int64

func (r driverResult) LastInsertId() (int64, error) { return int64(r), nil }
func (r driverResult) RowsAffected() (int64, error) { return int64(r), nil }

// insertColumnsFromSQL 从 INSERT 语句里取出列清单，测试不必自己维护列顺序。
func insertColumnsFromSQL(t *testing.T, query string) []string {
	t.Helper()
	open := strings.Index(query, "(")
	closing := strings.Index(query, ")")
	require.Greater(t, open, 0, "INSERT 语句里应有列清单")
	require.Greater(t, closing, open)

	parts := strings.Split(query[open+1:closing], ",")
	columns := make([]string, 0, len(parts))
	for _, part := range parts {
		columns = append(columns, strings.TrimSpace(part))
	}
	return columns
}

// ensureUsageLogColumns 把 INSERT 用到、但 ent 迁移没建出来的列补上。
// ent 的 usage_log schema 是原始表的子集，生产库靠迁移脚本补齐。
func ensureUsageLogColumns(t *testing.T, db *sql.DB, columns []string) {
	t.Helper()
	rows, err := db.Query("PRAGMA table_info(usage_logs)")
	require.NoError(t, err)
	existing := make(map[string]bool)
	for rows.Next() {
		var (
			cid       int
			name, typ string
			notNull   int
			dflt      any
			pk        int
		)
		require.NoError(t, rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk))
		existing[name] = true
	}
	require.NoError(t, rows.Err())
	_ = rows.Close()

	for _, column := range columns {
		if existing[column] {
			continue
		}
		_, err := db.Exec("ALTER TABLE usage_logs ADD COLUMN " + column)
		require.NoError(t, err, "补列失败: %s", column)
	}

	// 生产库上 (request_id, api_key_id) 是唯一键，INSERT 的 ON CONFLICT 依赖它。
	_, err = db.Exec("CREATE UNIQUE INDEX IF NOT EXISTS usage_logs_request_api_key ON usage_logs(request_id, api_key_id)")
	require.NoError(t, err)
}

// billing_tier 的写→读往返：走真实的 createSingle（INSERT ... RETURNING）与
// ListWithFilters（SELECT 64 列 + WHERE），引擎是 ent 迁移出来的 SQLite。
// 覆盖「标记原样落库、读回来还在、过滤能命中、没标记的行读回来是 nil」。
// Postgres 专有部分（分区表与方言差异）不在本机验证范围。
func TestUsageLogBillingTierRoundTrip(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)

	db := openUsageLogSQLite(t, "usage_tier_roundtrip")
	drv := entsql.OpenDB(dialect.SQLite, db)
	client := enttest.NewClient(t, enttest.WithOptions(dbent.Driver(drv)))
	t.Cleanup(func() { _ = client.Close() })

	capture := &captureExecutor{}
	captureRepo := newUsageLogRepositoryWithSQL(nil, capture)
	_, _ = captureRepo.createSingle(ctx, capture, &service.UsageLog{
		UserID: 1, APIKeyID: 2, AccountID: 3, RequestID: "capture", Model: "m", CreatedAt: now,
	})
	ensureUsageLogColumns(t, db, insertColumnsFromSQL(t, capture.query))

	// ent 迁移要求外键打开；这里插的是合成 ID，没有对应的 users/api_keys 行，
	// 因此迁移完成后关掉外键校验，只验 billing_tier 的写入与读回。
	_, err := db.Exec("PRAGMA foreign_keys = OFF")
	require.NoError(t, err)

	repo := newUsageLogRepositoryWithSQL(client, db)
	marker := service.BillingTierImagePriceDefaulted

	created, err := repo.createSingle(ctx, db, &service.UsageLog{
		UserID: 100, APIKeyID: 200, AccountID: 300, RequestID: "req-marked",
		Model: "image-model", ActualCost: 0.268, CreatedAt: now, BillingTier: &marker,
	})
	require.NoError(t, err)
	require.True(t, created, "带标记的行应插入成功")

	_, err = repo.createSingle(ctx, db, &service.UsageLog{
		UserID: 100, APIKeyID: 200, AccountID: 301, RequestID: "req-unmarked",
		Model: "image-model", ActualCost: 0.5, CreatedAt: now,
	})
	require.NoError(t, err)

	logs, _, err := repo.ListWithFilters(ctx, pagination.PaginationParams{Page: 1, PageSize: 10}, usagestats.UsageLogFilters{
		BillingTier: service.BillingTierImagePriceDefaulted,
	})
	require.NoError(t, err)
	require.Len(t, logs, 1, "只有带标记的行应该命中过滤")
	require.NotNil(t, logs[0].BillingTier, "标记必须原样读回来")
	require.Equal(t, service.BillingTierImagePriceDefaulted, *logs[0].BillingTier)
	require.Equal(t, "req-marked", logs[0].RequestID)

	all, _, err := repo.ListWithFilters(ctx, pagination.PaginationParams{Page: 1, PageSize: 10}, usagestats.UsageLogFilters{})
	require.NoError(t, err)
	require.Len(t, all, 2)
	for _, log := range all {
		if log.RequestID == "req-unmarked" {
			require.Nil(t, log.BillingTier, "没写标记的行读回来必须是 nil")
		}
	}
}
