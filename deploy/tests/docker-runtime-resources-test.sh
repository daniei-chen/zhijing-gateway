#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'docker runtime resources test failed: %s\n' "$1" >&2
  exit 1
}

assert_line() {
  file=$1
  line=$2
  grep -Fqx "$line" "$file" || fail "$file is missing: $line"
}

assert_count() {
  file=$1
  line=$2
  expected=$3
  actual=$(grep -Fxc "$line" "$file" || true)
  [ "$actual" -eq "$expected" ] || fail "$file has $actual occurrences of '$line', expected $expected"
}

test -s backend/resources/model-pricing/model_prices_and_context_window.json || \
  fail 'fallback pricing data is missing or empty'

assert_line Dockerfile.goreleaser 'COPY --chown=zhijing:zhijing backend/resources /app/resources'
assert_line deploy/Dockerfile 'COPY --from=backend-builder --chown=zhijing:zhijing /app/backend/resources /app/resources'
assert_count .goreleaser.yaml '      - backend/resources' 4
assert_count .goreleaser.simple.yaml '      - backend/resources' 1

# 2026-11-14：deploy/zhijing/ 下的零停机发布脚本与健康看护脚本是生产实际执行体。
# 它们之前不在任何 CI 校验范围内——发布脚本语法错只会在真发现场暴露。
# 这里挂在已有的部署资产检查里，避免为了加一条语法检查去改 workflow 文件。
if [ -f deploy/zhijing/zero-downtime-deploy.sh ]; then
  bash -n deploy/zhijing/zero-downtime-deploy.sh || \
    fail 'deploy/zhijing/zero-downtime-deploy.sh has a shell syntax error'
fi
if [ -f deploy/zhijing/japan_maintenance.py ]; then
  # 注意：有的 Windows 环境里 python3 是应用商店的空壳（能 which 到但一跑就退出），
  # 所以必须先验证解释器真的能执行，再回退到 python，最后才跳过。
  py=""
  for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'pass' >/dev/null 2>&1; then
      py="$candidate"
      break
    fi
  done
  if [ -n "$py" ]; then
    "$py" -m py_compile deploy/zhijing/japan_maintenance.py || \
      fail 'deploy/zhijing/japan_maintenance.py has a python syntax error'
  else
    printf 'skip: no runnable python interpreter found\n'
  fi
fi

printf 'docker runtime resources test passed\n'
