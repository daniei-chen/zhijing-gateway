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
race_target=$(
  awk '
    /^test-race:$/ { in_target = 1; next }
    in_target && /^[^ \t]/ { in_target = 0 }
    in_target { print }
  ' "$makefile"
)

[ -n "$race_target" ] || fail "$makefile has no test-race target"
printf '%s\n' "$race_target" | grep -Fq 'CGO_ENABLED=1' || \
  fail "$makefile test-race target does not set CGO_ENABLED=1"
printf '%s\n' "$race_target" | grep -Fq 'go test -race' || \
  fail "$makefile test-race target does not pass -race to go test"

printf 'ci race job test passed\n'
