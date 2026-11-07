package repository

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/redis/go-redis/v9"
)

const gatewayUserIndexKey = "concurrency:zhijing:user_index:v1"

// Include existing HTTP and Live leases. IDs present in both sets represent a
// Live handoff, not two requests. The registry is pruned from real leases, never
// from wall-clock index scores (a refreshed Live lease can outlive that score).
// Dynamic keys deliberately require standalone Redis, not Redis Cluster.
const gatewayConcurrencyLua = `
	redis.replicate_commands()
	local now = tonumber(redis.call('TIME')[1])
	local ttl = tonumber(ARGV[1])
	local requestID = ARGV[2]
	local userMax = tonumber(ARGV[3])
	local globalMax = tonumber(ARGV[4])
	local userID = ARGV[5]
	local userPrefix = ARGV[6]
	local livePrefix = ARGV[7]
	local seen = {}
	local ids = {}
	for _, index in ipairs({KEYS[3], KEYS[4]}) do
		if redis.call('ZCARD', index) > 4096 then
			return redis.error_reply('gateway concurrency index bound exceeded')
		end
		for _, id in ipairs(redis.call('ZRANGE', index, 0, -1)) do
			if #id > 19 or not string.match(id, '^[1-9]%d*$') then
				return redis.error_reply('invalid gateway concurrency index member')
			end
			if not seen[id] then seen[id] = true; table.insert(ids, id) end
		end
	end
	if not seen[userID] then table.insert(ids, userID) end
	if #ids > 4096 then return redis.error_reply('gateway concurrency index bound exceeded') end
	local total = 0
	local own = 0
	for _, id in ipairs(ids) do
		local regular = userPrefix .. id
		local live = livePrefix .. id
		redis.call('ZREMRANGEBYSCORE', regular, '-inf', now - ttl)
		redis.call('ZREMRANGEBYSCORE', live, '-inf', now - 60)
		local count = redis.call('ZCARD', regular)
		for _, lease in ipairs(redis.call('ZRANGE', live, 0, -1)) do
			if redis.call('ZSCORE', regular, lease) == false then count = count + 1 end
		end
		total = total + count
		if id == userID then own = count end
		if count == 0 then redis.call('ZREM', KEYS[4], id) end
	end
`

var gatewayUserAdmissionScript = redis.NewScript(gatewayConcurrencyLua + `
	if redis.call('ZSCORE', KEYS[1], requestID) ~= false then
		redis.call('ZADD', KEYS[1], now, requestID)
		redis.call('EXPIRE', KEYS[1], ttl)
		redis.call('ZADD', KEYS[4], now + ttl, userID)
		return {1, now}
	end
	if redis.call('ZSCORE', KEYS[2], requestID) ~= false then
		return redis.error_reply('request already belongs to a Live lease')
	end
	if globalMax > 0 and total >= globalMax then return {-2, now} end
	if userMax > 0 and own >= userMax then return {-1, now} end
	redis.call('ZADD', KEYS[1], now, requestID)
	redis.call('EXPIRE', KEYS[1], ttl)
	redis.call('ZADD', KEYS[3], now + ttl, userID)
	redis.call('ZADD', KEYS[4], now + ttl, userID)
	return {1, now}
`)

var gatewayLiveAdmissionScript = redis.NewScript(gatewayConcurrencyLua + `
	local accountMax = tonumber(ARGV[8])
	local replacing = tonumber(ARGV[9])
	redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now - ttl)
	redis.call('ZREMRANGEBYSCORE', KEYS[6], '-inf', now - 60)
	redis.call('ZREMRANGEBYSCORE', KEYS[7], '-inf', now - 60)
	if redis.call('ZSCORE', KEYS[6], requestID) ~= false then
		if redis.call('ZSCORE', KEYS[2], requestID) == false or redis.call('ZSCORE', KEYS[7], requestID) == false then
			return redis.error_reply('inconsistent Live lease ownership')
		end
		return {1, now}
	end
	local allowance = 0
	if replacing == 1 then
		-- The handler supplies its exact held user reservation. A boolean alone
		-- must never authorize a free extra slot at the global ceiling.
		if redis.call('ZSCORE', KEYS[1], requestID) == false then
			return redis.error_reply('Live handoff requires an existing user reservation')
		end
		allowance = 1
	end
	if allowance == 0 and globalMax > 0 and total >= globalMax then return {-2, now} end
	if allowance == 0 and userMax > 0 and own >= userMax then return {-1, now} end
	local accountCount = redis.call('ZCARD', KEYS[5]) + redis.call('ZCARD', KEYS[6])
	if accountMax > 0 and accountCount >= accountMax + allowance then return {0, now} end
	for _, key in ipairs({KEYS[2], KEYS[6], KEYS[7]}) do
		redis.call('ZADD', key, now, requestID)
		redis.call('EXPIRE', key, 60)
	end
	redis.call('ZADD', KEYS[4], now + 60, userID)
	return {1, now}
`)

// Bootstrap only indexes existing lease keys; it never clears peer leases or
// touches business data. Failed Redis access stays fail-closed and is retryable.
func (c *concurrencyCache) ensureGatewayUserIndex(ctx context.Context) error {
	c.policyMu.Lock()
	defer c.policyMu.Unlock()
	if c.policyReady {
		return nil
	}
	for _, prefix := range []string{userSlotKeyPrefix, liveUserSlotKeyPrefix} {
		var cursor uint64
		for {
			keys, next, err := c.rdb.Scan(ctx, cursor, prefix+"*", 100).Result()
			if err != nil {
				return err
			}
			members := make([]redis.Z, 0, len(keys))
			for _, key := range keys {
				id := strings.TrimPrefix(key, prefix)
				parsed, err := strconv.ParseInt(id, 10, 64)
				if err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == id {
					members = append(members, redis.Z{Member: id, Score: 0})
				}
			}
			if len(members) > 0 {
				if err := c.rdb.ZAdd(ctx, gatewayUserIndexKey, members...).Err(); err != nil {
					return err
				}
			}
			cursor = next
			if cursor == 0 {
				break
			}
		}
	}
	c.policyReady = true
	return nil
}

func (c *concurrencyCache) gatewayPolicyResult(result int64, maximum int) (bool, error) {
	switch result {
	case -2:
		return false, &service.GatewayConcurrencyLimitError{Scope: "global", Limit: c.globalLimit}
	case -1:
		return false, &service.GatewayConcurrencyLimitError{Scope: "user", Limit: maximum}
	}
	return result == 1, nil
}

func (c *concurrencyCache) gatewayUserMaximum(maximum int) int {
	if c.memberLimit > 0 && (maximum <= 0 || c.memberLimit < maximum) {
		return c.memberLimit
	}
	return maximum
}

func (c *concurrencyCache) acquireGatewayUserSlot(ctx context.Context, userID int64, maximum int, requestID string) (bool, error) {
	if err := c.ensureGatewayUserIndex(ctx); err != nil {
		return false, err
	}
	maximum = c.gatewayUserMaximum(maximum)
	result, _, err := runScriptInt64Pair(ctx, c.rdb, gatewayUserAdmissionScript,
		[]string{userSlotKey(userID), liveUserSlotKey(userID), userActiveIndexKey, gatewayUserIndexKey},
		c.slotTTLSeconds, requestID, maximum, c.globalLimit, fmt.Sprint(userID), userSlotKeyPrefix, liveUserSlotKeyPrefix)
	if err != nil {
		return false, err
	}
	return c.gatewayPolicyResult(result, maximum)
}

func (c *concurrencyCache) acquireGatewayLiveLease(ctx context.Context, accountID int64, accountMax int, userID int64, userMax int, apiKeyID int64, leaseID string, replacing int) (bool, error) {
	if err := c.ensureGatewayUserIndex(ctx); err != nil {
		return false, err
	}
	userMax = c.gatewayUserMaximum(userMax)
	result, _, err := runScriptInt64Pair(ctx, c.rdb, gatewayLiveAdmissionScript,
		[]string{userSlotKey(userID), liveUserSlotKey(userID), userActiveIndexKey, gatewayUserIndexKey,
			accountSlotKey(accountID), liveAccountSlotKey(accountID), liveAPIKeySlotKey(apiKeyID)},
		c.slotTTLSeconds, leaseID, userMax, c.globalLimit, fmt.Sprint(userID), userSlotKeyPrefix, liveUserSlotKeyPrefix, accountMax, replacing)
	if err != nil {
		return false, err
	}
	return c.gatewayPolicyResult(result, userMax)
}
