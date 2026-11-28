#!/bin/sh
# 必检 job 的"不许被过滤掉"守护。
#
# 今天（a5176cb4d）全仓 workflow 里没有任何 paths: / paths-ignore: 过滤，也没有
# 哪个必检 job 带 if: 或 continue-on-error——但那是今天的事实，不是什么机制。
# 谁哪天加一句
#     pull_request:
#       paths: ['backend/**']
# 或者给 job 加一行 if:，某个必检就会在部分 PR 上彻底不出现：分支保护会一直等
# 那条永远不来的检查，或者更糟——一个只改前端的 PR 静默不跑后端门禁却被判绿。
# 这个测试把那句事实变成机制：以后再加过滤，这里先红。
#
# 守两件事：
#   1) 9 个必检 job 块里不出现 if: / paths: / paths-ignore: / continue-on-error，
#      承载它们的 workflow 的 on: 触发块里也不出现 paths: / paths-ignore:；
#   2) race 的 -run 正则今天仍命中非零条测试（改名/挪目录后零命中，go test 退 0）。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

fail() {
  printf 'ci workflow guards test failed: %s\n' "$1" >&2
  exit 1
}

# 从 workflow 里抽一个 job 块：`  <job>:` 到下一个同级 job 头或顶格键。
job_block() {
  awk -v job="$2" '
    $0 == "  " job ":" { in_job = 1; next }
    in_job && /^  [A-Za-z0-9_-]+:$/ { in_job = 0 }
    in_job && /^[^ ]/ { in_job = 0 }
    in_job { print }
  ' "$1"
}

# 从 workflow 里抽 on: 触发块：`on:` 到下一个顶格键。
trigger_block() {
  awk '
    /^on:$/ { in_on = 1; next }
    in_on && /^[^ ]/ { in_on = 0 }
    in_on { print }
  ' "$1"
}

# 9 个必检：shell  test  race  frontend  golangci-lint  release-helpers
#             backend-security  frontend-security  embed
checked_triggers=""
while read -r workflow job; do
  [ -f "$workflow" ] || fail "$workflow is missing; job '$job' would disappear"
  block=$(job_block "$workflow" "$job")
  [ -n "$block" ] || fail "$workflow has no job '$job'; a required check would never report"

  offending=$(printf '%s\n' "$block" | grep -nE '^[[:space:]]*(if|paths|paths-ignore|continue-on-error):' || true)
  if [ -n "$offending" ]; then
    fail "$workflow job '$job' can be filtered out of a PR:
$offending"
  fi

  case "$checked_triggers" in
    *"$workflow"*) ;;
    *)
      checked_triggers="$checked_triggers $workflow"
      triggers=$(trigger_block "$workflow")
      trigger_offending=$(printf '%s\n' "$triggers" | grep -nE '^[[:space:]]*(paths|paths-ignore):' || true)
      if [ -n "$trigger_offending" ]; then
        fail "$workflow filters which PRs trigger it, so its required checks can skip a PR:
$trigger_offending"
      fi
      ;;
  esac
done <<'EOF'
.github/workflows/backend-ci.yml shell
.github/workflows/backend-ci.yml test
.github/workflows/backend-ci.yml race
.github/workflows/backend-ci.yml frontend
.github/workflows/backend-ci.yml golangci-lint
.github/workflows/backend-ci.yml release-helpers
.github/workflows/backend-ci.yml embed
.github/workflows/security-scan.yml backend-security
.github/workflows/security-scan.yml frontend-security
EOF

# race 的 -run 正则必须今天还命中测试。零命中时 go test 退 0：
# 运行时那一侧由 backend/scripts/race-gate.sh 的条数下限兜，这里兜"正则本身已经
# 指向空集合"——两者缺一，改名或挪目录都能让 -race 变成什么都没验。
gate=backend/scripts/race-gate.sh
[ -f "$gate" ] || fail "$gate is missing; the race job would run an unguarded make target"
run_filter=$(sed -n "s/^[[:space:]]*-run '\([^']*\)'.*/\1/p" "$gate")
[ -n "$run_filter" ] || fail "cannot read the race -run filter from $gate"
floor=$(sed -n 's/^readonly MIN_TESTS=\([0-9][0-9]*\).*/\1/p' "$gate")
[ -n "$floor" ] || fail "cannot read the race floor (MIN_TESTS) from $gate"

# 静态模型和运行时口径对齐：只数这两个包的顶层 Test 函数（不含子测试、不含
# Benchmark——-run 不选 Benchmark），并且跳过 -tags=unit 会排除的 !unit 文件。
# 2026-11-28 在 a5176cb4d 上两边都是 1431。
hits=$(awk -v re="$run_filter" '
  FNR == 1 { excluded = 0 }
  /^\/\/go:build/ && /!unit/ { excluded = 1 }
  /^func Test[A-Za-z0-9_]*\(/ {
    name = $2
    sub(/\(.*$/, "", name)
    if (!excluded && name ~ re) count++
  }
  END { print count + 0 }
' backend/internal/service/*_test.go backend/internal/handler/*_test.go)

[ "$hits" -gt 0 ] || \
  fail "the race -run filter '$run_filter' matches no test in ./internal/service or ./internal/handler; -race would run nothing and pass"
[ "$hits" -ge "$floor" ] || \
  fail "the race -run filter '$run_filter' matches only $hits tests, below the runtime floor of $floor; -race is about to become hollow"

printf 'ci workflow guards test passed (9 required jobs, %d race filter hits, floor %d)\n' "$hits" "$floor"
