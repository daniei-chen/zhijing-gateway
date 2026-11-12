-- 2026-11-12 第 3 轮全面审计 P1-5
--
-- 问题：usage_logs 的 user_id / account_id / api_key_id 三个外键原为
--       ON DELETE CASCADE。删除用户/账号/API Key 时会静默级联抹掉
--       全部计费历史，账目无法追溯且无任何提示。
--
-- 处置：改为 ON DELETE RESTRICT —— 存在计费历史时拒绝删除，必须显式
--       处理历史后再删。group_id / subscription_id 保持 SET NULL（合理）。
--
-- 执行前已核实：三列均 NOT NULL，孤儿行 0/0/0，故约束可安全重建。
-- 幂等：DROP ... IF EXISTS 保证重复执行不报错。

ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_user_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_account_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;

ALTER TABLE usage_logs DROP CONSTRAINT IF EXISTS usage_logs_api_key_id_fkey;
ALTER TABLE usage_logs ADD CONSTRAINT usage_logs_api_key_id_fkey
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE RESTRICT;
