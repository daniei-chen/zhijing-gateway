#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

workflow=.github/workflows/backend-ci.yml
makefile=backend/Makefile

fail() {
  printf 'ci race job test failed: %s\n' "$1" >&2
  exit 1
}

# 抽取 backend-ci.yml 里名为 race 的 job 块：从 `  race:` 到下一个同级 job 头或顶格键。
race_job=$(
  awk '
    /^  race:$/ { in_job = 1; next }
    in_job && /^  [A-Za-z0-9_-]+:$/ { in_job = 0 }
    in_job && /^[^ ]/ { in_job = 0 }
    in_job { print }
  ' "$workflow"
)

[ -n "$race_job" ] || \
  fail "$workflow has no race job; the race detector would silently stop running in CI"

printf '%s\n' "$race_job" | grep -Fqx '        run: make test-race' || \
  fail "$workflow race job does not run 'make test-race'"
printf '%s\n' "$race_job" | grep -Fqx '        working-directory: backend' || \
  fail "$workflow race job is missing 'working-directory: backend'"
printf '%s\n' "$race_job" | grep -Fq 'go-version-file: backend/go.mod' || \
  fail "$workflow race job is missing 'go-version-file: backend/go.mod'"

# -race 依赖 cgo：目标必须显式打开 CGO_ENABLED=1，否则换 runner 时可能静默降级。
# 2026-11-28 起 go test 的调用搬进了 backend/scripts/race-gate.sh：那里同时断言
# -v 输出里真跑过的测试条数不低于下限，否则 -run 零命中时 go test 退 0，
# 这个必检会静默变绿（见 docs/ci/test-tiers.md §2）。
race_target=$(
  awk '
    /^test-race:$/ { in_target = 1; next }
    in_target && /^[^ \t]/ { in_target = 0 }
    in_target { print }
  ' "$makefile"
)

[ -n "$race_target" ] || fail "$makefile has no test-race target"
printf '%s\n' "$race_target" | grep -Fq 'scripts/race-gate.sh' || \
  fail "$makefile test-race target does not run scripts/race-gate.sh"

race_gate=backend/scripts/race-gate.sh
[ -f "$race_gate" ] || fail "$race_gate is missing"

assert_gate() {
  grep -Fq -- "$1" "$race_gate" || fail "$race_gate is missing: $1"
}

assert_gate 'CGO_ENABLED=1'
assert_gate 'go test -race'
assert_gate '-tags=unit'
assert_gate './internal/service/ ./internal/handler/'
assert_gate '-run '
# 没有 -v 就没有 === RUN 行可数，下限断言会永远拿到 0。
assert_gate ' -v '
assert_gate "'^=== RUN"
assert_gate 'MIN_TESTS'
grep -Eq '"\$ran" -lt "\$MIN_TESTS"' "$race_gate" || \
  fail "$race_gate does not compare the ran count against the floor"

printf 'ci race job test passed\n'
