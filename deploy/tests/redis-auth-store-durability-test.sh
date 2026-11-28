#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'redis auth store durability test failed: %s\n' "$1" >&2
  exit 1
}

policy=backend/internal/repository/auth_store_policy.go
[ -f "$policy" ] || fail "$policy is missing"

# 网关启动时会检查 redis 这四条配置和 AOF 状态，任一条不满足就拒绝启动
# （backend/internal/repository/auth_store_policy.go 的 validateAuthStoreDurability）。
# 这里直接从那边的表里读要求，所以后端收紧条件时这个测试跟着失败，而不是继续
# 守住一组过期的值。
required=$(sed -n 's/^[[:space:]]*{"\([^"]*\)", "\([^"]*\)"},*$/\1 \2/p' "$policy")
[ -n "$required" ] || fail "no required redis settings parsed from $policy"

# 取 redis 服务块里 command 列表项（"      - --appendfsync" / "      - always"），
# 去掉引号拼成一行，便于按 " --key value " 匹配。注释与其它服务不参与。
redis_args() {
  awk '
    /^  redis:$/ { in_redis = 1; next }
    in_redis && /^  [A-Za-z0-9_-]+:$/ { in_redis = 0 }
    in_redis && /^[^ ]/ { in_redis = 0 }
    in_redis && /^      - / {
      line = substr($0, 9)
      gsub(/"/, "", line)
      printf "%s ", line
    }
  ' "$1"
}

for compose in \
  deploy/docker-compose.yml \
  deploy/docker-compose.local.yml \
  deploy/docker-compose.dev.yml
do
  args=$(redis_args "$compose")
  case "$args" in
    *redis-server*) ;;
    *) fail "$compose has no redis-server command" ;;
  esac
  # 用 here-doc 而不是管道：管道里的 while 是子 shell，fail 只杀掉子 shell，
  # 循环会继续跑完并以成功结束——那正是这个测试要防的「静默通过」。
  while read -r key value; do
    case " $args " in
      *" --$key $value "*) ;;
      *) fail "$compose must start redis with --$key $value" ;;
    esac
  done <<EOF
$required
EOF
done

# Apple container 那条路同样由应用启动门禁把关，参数写在脚本里而不是 compose。
for flag in \
  '--appendfsync always' \
  '--no-appendfsync-on-rewrite no' \
  '--maxmemory-policy noeviction'
do
  grep -Fq -- "$flag" deploy/apple-container.sh \
    || fail "deploy/apple-container.sh must start redis with $flag"
done

printf 'redis auth store durability test passed\n'
