#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

workflow=.github/workflows/backend-ci.yml

fail() {
  printf 'e2e ci secrets test failed: %s\n' "$1" >&2
  exit 1
}

# 取这个 workflow 里某个变量被设成的值。同一个变量可能出现多次（栈启动一步、
# dump 一步、跑测试一步都设 ADMIN_EMAIL），但必须处处一致——否则栈按 A 建、
# 测试按 B 登，失败原因会指向错误的地方。
value_of() {
  values=$(grep -E "^[[:space:]]+$1:[[:space:]]*" "$workflow" | sed -e 's/^[^:]*:[[:space:]]*//' -e 's/[[:space:]]*$//' || true)
  [ -n "$values" ] || fail "$workflow does not set $1"
  distinct=$(printf '%s\n' "$values" | sort -u | wc -l | tr -d ' ')
  [ "$distinct" -eq 1 ] || fail "$workflow sets $1 to $distinct different values"
  printf '%s\n' "$values" | head -1 | sed -e 's/^"//' -e 's/"$//'
}

# 要求从代码里读：后端改了长度或格式，这个测试跟着失败，而不是守着一组过期的数字。
totp_bytes=$(sed -n 's/.*if len(key) != \([0-9][0-9]*\).*/\1/p' backend/internal/repository/aes_encryptor.go | head -1)
[ -n "$totp_bytes" ] || fail "cannot read the TOTP key length from backend/internal/repository/aes_encryptor.go"
jwt_min=$(sed -n 's/.*if len(\[\]byte(jwtSecret)) < \([0-9][0-9]*\).*/\1/p' backend/internal/config/config.go | head -1)
[ -n "$jwt_min" ] || fail "cannot read the JWT minimum length from backend/internal/config/config.go"
admin_min=$(sed -n 's/.*if len(password) < \([0-9][0-9]*\).*/\1/p' backend/internal/setup/handler.go | head -1)
[ -n "$admin_min" ] || fail "cannot read the admin password minimum from backend/internal/setup/handler.go"
admin_max=$(sed -n 's/^const maxPasswordBytes = \([0-9][0-9]*\).*/\1/p' backend/internal/setup/handler.go | head -1)
[ -n "$admin_max" ] || fail "cannot read maxPasswordBytes from backend/internal/setup/handler.go"

# TOTP_ENCRYPTION_KEY：hex 解码后必须正好 totp_bytes 字节，所以是 2 倍个 hex 字符。
totp=$(value_of TOTP_ENCRYPTION_KEY)
case "$totp" in
  *[!0-9a-fA-F]*) fail "TOTP_ENCRYPTION_KEY must be hex; one character is not a hex digit" ;;
esac
expected_hex=$((totp_bytes * 2))
[ "${#totp}" -eq "$expected_hex" ] \
  || fail "TOTP_ENCRYPTION_KEY must be $totp_bytes bytes = $expected_hex hex chars, got ${#totp} chars"

# JWT_SECRET：按 UTF-8 字节算，CI 里全是 ASCII，所以字符数即可。
jwt=$(value_of JWT_SECRET)
[ "${#jwt}" -ge "$jwt_min" ] \
  || fail "JWT_SECRET must be at least $jwt_min bytes, got ${#jwt}"

# ADMIN_PASSWORD：bcrypt 有输入上限，超了连哈希都做不出来。
admin_password=$(value_of ADMIN_PASSWORD)
[ "${#admin_password}" -ge "$admin_min" ] \
  || fail "ADMIN_PASSWORD must be at least $admin_min characters, got ${#admin_password}"
[ "${#admin_password}" -le "$admin_max" ] \
  || fail "ADMIN_PASSWORD must be at most $admin_max bytes, got ${#admin_password}"

for name in ADMIN_EMAIL POSTGRES_PASSWORD REDIS_PASSWORD; do
  value_of "$name" >/dev/null
done

printf 'e2e ci secrets test passed\n'
