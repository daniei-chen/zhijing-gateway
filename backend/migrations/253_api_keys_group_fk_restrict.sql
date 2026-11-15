-- 2026-11-15 v0.1.20 第 47 轮审计遗留项
--
-- 问题：api_keys.group_id 的外键原为 ON DELETE SET NULL。也就是说，
--       只要有一行 groups 被物理删除，Postgres 就会把所有引用它的
--       API Key 的 group_id 置成 NULL —— Key 立刻变成孤儿：认证仍通过，
--       但调度器按 group_id 找不到任何账号，请求只能返回
--       "No available OpenAI accounts"（503）。
--
--       这正是 2026-11-14 19:10 那次事故的第二环：应用层当时允许删除分组，
--       数据库随后把 Key 的 group_id 置空，141 条 5xx 由此产生。
--       v0.1.14 在应用层加了"有 Key 绑定时拒绝删除分组"（409
--       GROUP_HAS_ACTIVE_KEYS），但它只是**一处**检查——任何新写的删除路径、
--       或直接执行的 SQL，都能绕过它。数据库这一层当时是敞开的。
--
-- 处置：改为 ON DELETE RESTRICT —— 只要还有 Key 引用该分组，物理删除就会被
--       数据库拒绝。与应用层保护形成双层防线，且不改变任何正常路径行为：
--       当前删除分组走的是软删除（UPDATE groups SET deleted_at），
--       根本不会触发该外键动作。
--
-- 执行前已核实（2026-11-15 11:20 +08）：
--   api_keys 共 12 行（6 活跃 + 6 已软删），group_id IS NULL 的行数为 0，
--   即不存在会被新约束影响的存量数据。
--
-- 与 usage_logs 的分工（见 251_usage_logs_fk_restrict.sql）：
--   usage_logs 是历史账目，允许分组消失 → group_id 保持 SET NULL；
--   api_keys 是活跃配置，不允许变孤儿 → group_id 改为 RESTRICT。
--
-- 幂等：DROP ... IF EXISTS 保证重复执行不报错。

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_group_id_fkey;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_group_id_fkey
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT;
