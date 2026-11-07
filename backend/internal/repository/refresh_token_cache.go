package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/redis/go-redis/v9"
)

const (
	refreshTokenKeyPrefix   = "refresh_token:"
	userRefreshTokensPrefix = "user_refresh_tokens:"
	tokenFamilyPrefix       = "token_family:"
	sessionGenerationPrefix = "auth_session_generation:"
	revokedFamilyPrefix     = "auth_revoked_family:"
	sessionHorizonPrefix    = "auth_session_horizon:"
	rotatedRefreshPrefix    = "rotated_refresh_token:"
)

// refreshTokenKey generates the Redis key for a refresh token.
func refreshTokenKey(tokenHash string) string {
	return refreshTokenKeyPrefix + tokenHash
}

// userRefreshTokensKey generates the Redis key for user's token set.
func userRefreshTokensKey(userID int64) string {
	return fmt.Sprintf("%s%d", userRefreshTokensPrefix, userID)
}

// tokenFamilyKey generates the Redis key for token family set.
func tokenFamilyKey(familyID string) string {
	return tokenFamilyPrefix + familyID
}

type refreshTokenCache struct {
	rdb *redis.Client
}

// NewRefreshTokenCache creates a new RefreshTokenCache implementation.
func NewRefreshTokenCache(rdb *redis.Client) service.RefreshTokenCache {
	return &refreshTokenCache{rdb: rdb}
}

func sessionGenerationKey(userID int64) string {
	return fmt.Sprintf("%s%d", sessionGenerationPrefix, userID)
}

func (c *refreshTokenCache) GetSessionGeneration(ctx context.Context, userID int64) (string, error) {
	generation, err := c.rdb.Get(ctx, sessionGenerationKey(userID)).Result()
	if err == redis.Nil {
		return "", nil
	}
	return generation, err
}

var validateSessionScript = redis.NewScript(`
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return 0 end
if ARGV[2] ~= '' and redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
return 1
`)

func (c *refreshTokenCache) ValidateSession(ctx context.Context, userID int64, familyID, generation string) error {
	valid, err := validateSessionScript.Run(ctx, c.rdb, []string{sessionGenerationKey(userID), revokedFamilyPrefix + familyID}, generation, familyID).Int()
	if err != nil {
		return err
	}
	if valid != 1 {
		return service.ErrTokenRevoked
	}
	return nil
}

// Checking revocation and creating the next credential/indexes is one Redis
// operation. A revoke on another instance cannot slip between these steps.
var storeRefreshScript = redis.NewScript(`
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return -1 end
if redis.call('EXISTS', KEYS[2]) == 1 then return -1 end
if ARGV[5] ~= '' then
  local previous = redis.call('GET', KEYS[6])
  if not previous then return 0 end
  local old = cjson.decode(previous)
  local next = cjson.decode(ARGV[2])
  if old.user_id ~= next.user_id or old.family_id ~= next.family_id or
     (old.session_generation or '') ~= ARGV[1] or old.token_version ~= next.token_version then return -1 end
  -- Cover a rotation immediately before old-token expiry as well: logout
  -- already in flight must still be able to revoke the replacement family.
  local remaining = math.max(redis.call('PTTL', KEYS[6]), tonumber(ARGV[3]))
  if remaining > 0 then redis.call('SET', KEYS[8], previous, 'PX', remaining) end
  redis.call('DEL', KEYS[6])
  redis.call('SREM', KEYS[4], ARGV[5])
  redis.call('SREM', KEYS[5], ARGV[5])
end
local horizon = redis.call('GET', KEYS[7])
if ARGV[5] ~= '' and not horizon then
  -- Old families have no recorded maximum access-token expiration. Never
  -- guess a shorter revocation lifetime from today's (possibly changed) config.
  redis.call('SET', KEYS[7], 'legacy')
elseif horizon ~= 'legacy' and redis.call('PTTL', KEYS[7]) < tonumber(ARGV[6]) then
  redis.call('SET', KEYS[7], 'bounded', 'PX', ARGV[6])
end
redis.call('SET', KEYS[3], ARGV[2], 'PX', ARGV[3])
redis.call('SADD', KEYS[4], ARGV[4])
redis.call('PEXPIRE', KEYS[4], ARGV[3])
redis.call('SADD', KEYS[5], ARGV[4])
redis.call('PEXPIRE', KEYS[5], ARGV[3])
return 1
`)

func (c *refreshTokenCache) storeOrRotate(ctx context.Context, oldHash, newHash string, data *service.RefreshTokenData, ttl time.Duration) error {
	if data == nil || data.UserID <= 0 || data.FamilyID == "" || ttl <= 0 {
		return service.ErrRefreshTokenInvalid
	}
	val, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal refresh token data: %w", err)
	}
	horizonTTL := time.Until(data.ExpiresAt)
	if accessTTL := time.Until(data.AccessExpiresAt); accessTTL > horizonTTL {
		horizonTTL = accessTTL
	}
	if horizonTTL < ttl {
		horizonTTL = ttl
	}
	result, err := storeRefreshScript.Run(ctx, c.rdb, []string{
		sessionGenerationKey(data.UserID), revokedFamilyPrefix + data.FamilyID,
		refreshTokenKey(newHash), userRefreshTokensKey(data.UserID), tokenFamilyKey(data.FamilyID), refreshTokenKey(oldHash), sessionHorizonPrefix + data.FamilyID, rotatedRefreshPrefix + oldHash,
	}, data.SessionGeneration, string(val), ttl.Milliseconds(), newHash, oldHash, horizonTTL.Milliseconds()).Int()
	if err != nil {
		return err
	}
	if result == 0 {
		return service.ErrRefreshTokenNotFound
	}
	if result != 1 {
		return service.ErrTokenRevoked
	}
	return nil
}

func (c *refreshTokenCache) RotateRefreshToken(ctx context.Context, oldHash, newHash string, data *service.RefreshTokenData, ttl time.Duration) error {
	if oldHash == "" {
		return service.ErrRefreshTokenInvalid
	}
	return c.storeOrRotate(ctx, oldHash, newHash, data, ttl)
}

func (c *refreshTokenCache) StoreRefreshToken(ctx context.Context, tokenHash string, data *service.RefreshTokenData, ttl time.Duration) error {
	return c.storeOrRotate(ctx, "", tokenHash, data, ttl)
}

func (c *refreshTokenCache) GetRefreshToken(ctx context.Context, tokenHash string) (*service.RefreshTokenData, error) {
	return c.getRefreshTokenData(ctx, refreshTokenKey(tokenHash))
}

func (c *refreshTokenCache) GetRefreshTokenForRevocation(ctx context.Context, tokenHash string) (*service.RefreshTokenData, error) {
	data, err := c.GetRefreshToken(ctx, tokenHash)
	if err == service.ErrRefreshTokenNotFound {
		return c.getRefreshTokenData(ctx, rotatedRefreshPrefix+tokenHash)
	}
	return data, err
}

func (c *refreshTokenCache) getRefreshTokenData(ctx context.Context, key string) (*service.RefreshTokenData, error) {
	val, err := c.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return nil, service.ErrRefreshTokenNotFound
		}
		return nil, err
	}
	var data service.RefreshTokenData
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, fmt.Errorf("unmarshal refresh token data: %w", err)
	}
	return &data, nil
}

func (c *refreshTokenCache) DeleteRefreshToken(ctx context.Context, tokenHash string) error {
	key := refreshTokenKey(tokenHash)
	return c.rdb.Del(ctx, key).Err()
}

func (c *refreshTokenCache) DeleteUserRefreshTokens(ctx context.Context, userID int64) error {
	var generation [16]byte
	if _, err := rand.Read(generation[:]); err != nil {
		return err
	}
	return revokeUserSessionsScript.Run(ctx, c.rdb,
		[]string{sessionGenerationKey(userID), userRefreshTokensKey(userID)},
		hex.EncodeToString(generation[:]), refreshTokenKeyPrefix).Err()
}

var revokeUserSessionsScript = redis.NewScript(`
redis.call('SET', KEYS[1], ARGV[1])
local tokens = redis.call('SMEMBERS', KEYS[2])
for _, hash in ipairs(tokens) do redis.call('DEL', ARGV[2] .. hash) end
redis.call('DEL', KEYS[2])
return 1
`)

func (c *refreshTokenCache) DeleteTokenFamily(ctx context.Context, familyID string, revokeTTL time.Duration) error {
	if familyID == "" || revokeTTL <= 0 {
		return service.ErrRefreshTokenInvalid
	}
	return revokeFamilyScript.Run(ctx, c.rdb, []string{revokedFamilyPrefix + familyID, tokenFamilyKey(familyID), sessionHorizonPrefix + familyID}, revokeTTL.Milliseconds(), refreshTokenKeyPrefix).Err()
}

var revokeFamilyScript = redis.NewScript(`
local horizon = redis.call('GET', KEYS[3])
local previous = redis.call('PTTL', KEYS[1])
if not horizon or horizon == 'legacy' or previous == -1 then
  redis.call('SET', KEYS[1], '1')
else
  local ttl = math.max(tonumber(ARGV[1]), redis.call('PTTL', KEYS[3]), previous)
  redis.call('SET', KEYS[1], '1', 'PX', ttl)
end
local tokens = redis.call('SMEMBERS', KEYS[2])
for _, hash in ipairs(tokens) do redis.call('DEL', ARGV[2] .. hash) end
redis.call('DEL', KEYS[2])
return 1
`)

func (c *refreshTokenCache) AddToUserTokenSet(ctx context.Context, userID int64, tokenHash string, ttl time.Duration) error {
	key := userRefreshTokensKey(userID)
	pipe := c.rdb.Pipeline()
	pipe.SAdd(ctx, key, tokenHash)
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (c *refreshTokenCache) AddToFamilyTokenSet(ctx context.Context, familyID string, tokenHash string, ttl time.Duration) error {
	key := tokenFamilyKey(familyID)
	pipe := c.rdb.Pipeline()
	pipe.SAdd(ctx, key, tokenHash)
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	return err
}

func (c *refreshTokenCache) GetUserTokenHashes(ctx context.Context, userID int64) ([]string, error) {
	key := userRefreshTokensKey(userID)
	return c.rdb.SMembers(ctx, key).Result()
}

func (c *refreshTokenCache) GetFamilyTokenHashes(ctx context.Context, familyID string) ([]string, error) {
	key := tokenFamilyKey(familyID)
	return c.rdb.SMembers(ctx, key).Result()
}

func (c *refreshTokenCache) IsTokenInFamily(ctx context.Context, familyID string, tokenHash string) (bool, error) {
	key := tokenFamilyKey(familyID)
	return c.rdb.SIsMember(ctx, key, tokenHash).Result()
}
