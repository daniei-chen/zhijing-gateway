-- 2026-11-15 回灌上游 feat/group-force-openai-ultrafast
--
-- 背景：分组已支持强制 service_tier=priority（force_openai_fast），但 OpenAI
--       新增了更快的 ultrafast 档位，网关此前只能通过全局 Fast/Flex 策略的
--       force_priority 动作改写，无法在分组维度强制 ultrafast。
--
-- 处置：新增 force_openai_ultrafast 列。与 force_openai_fast 互斥，由
--       validateGroupOpenAIForcedServiceTier 在创建/更新时拒绝两者并存。
--       网关侧在该开关打开时，先写入 service_tier=ultrafast，全局 Fast/Flex
--       策略仍然在之后做权威判定（可通过/过滤/拦截）。
--
-- 兼容性：NOT NULL DEFAULT FALSE，旧版本容器不读该列，可安全地在零停机切换
--         之前执行。幂等：ADD COLUMN IF NOT EXISTS 保证重复执行不报错。

ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS force_openai_ultrafast BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN groups.force_openai_ultrafast IS
    '强制此 OpenAI/Composite 分组请求在全局 Fast/Flex 策略之前写入 service_tier=ultrafast；与 force_openai_fast 互斥';
