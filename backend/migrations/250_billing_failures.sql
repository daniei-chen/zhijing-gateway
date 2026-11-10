-- 计费失败持久化（审计 P0-4）
--
-- 现状：gateway_usage_billing.go 中 repo.Apply 失败后直接 return false, err，
-- 调用方只留一行日志。结果是 usage_logs 已有记录（账记了）但余额/配额未扣（钱没扣），
-- 且除日志外无任何可查痕迹，漏收不可对账、不可补录、不可统计。
--
-- 本表只做"持久化留痕"，不自动重投（重投涉及幂等与重复扣费风险，排期 0.0.8）：
--   写入：计费事务失败时记录完整快照（含 request_id 便于与 usage_logs 关联）
--   消费：人工/脚本按 status='pending' 查出后核对补录，标记 'replayed' 或 'abandoned'
CREATE TABLE IF NOT EXISTS billing_failures (
    id              BIGSERIAL PRIMARY KEY,
    request_id      VARCHAR(64)  NOT NULL,
    api_key_id      BIGINT,
    user_id         BIGINT,
    account_id      BIGINT,
    model           VARCHAR(128),
    input_tokens    BIGINT       NOT NULL DEFAULT 0,
    output_tokens   BIGINT       NOT NULL DEFAULT 0,
    cache_read_tokens BIGINT     NOT NULL DEFAULT 0,
    total_cost      NUMERIC(20,8) NOT NULL DEFAULT 0,
    actual_cost     NUMERIC(20,8) NOT NULL DEFAULT 0,
    error_message   TEXT,
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','replayed','abandoned')),
    replay_attempts INT          NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_replay_at  TIMESTAMPTZ,
    notes           TEXT
);

-- 对账查询：按状态+时间扫，只索引 pending 行避免全表膨胀
CREATE INDEX IF NOT EXISTS idx_billing_failures_pending
    ON billing_failures (status, created_at)
    WHERE status = 'pending';

-- 与 usage_logs 关联去重（同一请求不应重复登记）
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_failures_request
    ON billing_failures (request_id, COALESCE(api_key_id, 0));
