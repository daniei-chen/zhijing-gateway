#!/bin/sh
# 必检 job 的"不许被过滤掉 / 不许被 skip 成自由通过"守护。
#
# 今天（a5176cb4d）全仓 workflow 里没有任何 paths: / paths-ignore: 过滤，也没有
# 哪个必检 job 带 if:、continue-on-error 或 needs:——但那是今天的事实，不是什么
# 机制。谁哪天加一句
#     pull_request:
#       paths: ['backend/**']
# 或者给 job 加一行 if: / needs:，某个必检就会在部分 PR 上彻底不出现、或者被 skip：
# 分支保护会一直等那条永远不来的检查，而 skip 的 job 会被 GitHub 报告成 Success。
# 这个测试把那句事实变成机制：以后再加过滤，这里先红。
#
# 守三件事：
#   1) 9 个必检 job 块里不出现 if: / paths: / paths-ignore: / continue-on-error /
#      needs:，承载它们的 workflow 的 on: 触发块里也不出现 paths: / paths-ignore:；
#      唯一豁免是 needs: 配 if: always()（见 block_verdict 的注释）；
#   2) 断言下限的两个脚本里，每个 `| tee` 之后都读 PIPESTATUS——否则退出码来自
#      tee，一条红色的测试会被报成绿；
#   3) race 的 -run 正则今天仍命中非零条测试（改名/挪目录后零命中，go test 退 0）。
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

# job 块判定：stdin 是块内容，stdout 是 "ok" 或逐条违规说明。
#
# 合法只有两种形态：
#   1) 完全没有 if: / paths: / paths-ignore: / continue-on-error: / needs:；
#   2) needs: 与 if: always() 同时出现（if: 那一行必须逐字是 always()）。
# 为什么 needs: 单独出现要红：依赖 red/skip 时这个 job 被 skip，而 GitHub 把 skip
# 报告成 Success——必检就是空门。为什么 needs: + if: always() 可以：always() 让 job
# 无论如何都跑，skip 这条路被堵死。
# 为什么单独的 if: always() 也放行：它不能跳过 job，只会强制它跑；真正危险的是
# `if:` 的其他写法（事件名、分支、表达式），那些仍然红。这条规则用自测钉住。
block_verdict() {
  awk '
    /^[[:space:]]*needs:/ { needs = 1; needs_line = FNR ": " $0; next }
    /^[[:space:]]*if:[[:space:]]*always\(\)[[:space:]]*$/ { always = 1; next }
    /^[[:space:]]*(if|paths|paths-ignore|continue-on-error):/ { bad++; bad_line[bad] = FNR ": " $0 }
    END {
      if (needs && !always) {
        print "needs: without if: always() -> " needs_line
        exit
      }
      if (bad == 0) { print "ok"; exit }
      for (i = 1; i <= bad; i++) print bad_line[i]
    }'
}

verdict_of() {
  printf '%s\n' "$1" | block_verdict
}

# 守卫自己坏了要先红，不能拿一个坏守卫去证明别人没问题。
self_test() {
  failures=0
  expect() { # want(ok|bad) label text
    want=$1
    label=$2
    text=$3
    got=$(verdict_of "$text")
    case "$want:$got" in
      ok:ok) ;;
      bad:ok)
        printf 'self-test FAIL: %s should have been rejected\n' "$label" >&2
        failures=$((failures + 1))
        ;;
      ok:*)
        printf 'self-test FAIL: %s should have passed, got: %s\n' "$label" "$got" >&2
        failures=$((failures + 1))
        ;;
      bad:*) ;;
    esac
  }

  expect bad "needs: alone" "    needs: [frontend]
    runs-on: ubuntu-latest"
  expect ok "needs: with if: always()" "    needs: [frontend]
    if: always()
    runs-on: ubuntu-latest"
  expect ok "if: always() alone" "    if: always()
    runs-on: ubuntu-latest"
  expect bad "if: on a branch" "    if: github.ref == 'refs/heads/main'"
  expect bad "continue-on-error" "    continue-on-error: true"
  expect bad "paths:" "    paths:
      - 'backend/**'"
  expect ok "plain block" "    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6"

  [ "$failures" -eq 0 ] || fail "the job-block guard's own self-test failed ($failures case(s))"
  printf 'ci workflow guards test: self-test passed (7 cases)\n'
}

# 每个 `| tee` 后面必须读 PIPESTATUS，否则脚本的退出码来自 tee：
# 一条失败的测试会被报成绿（这会比没有门禁更糟）。`/bin/sh` 没有 PIPESTATUS，
# 所以那两个脚本必须是 bash，这里连 shebang 一起钉住。
check_pipe_status() {
  file=$1
  head -1 "$file" | grep -Fq '/usr/bin/env bash' || \
    fail "$file is not a bash script; PIPESTATUS needs bash"
  tee_lines=$(grep -n '| tee ' "$file" | cut -d: -f1 || true)
  [ -n "$tee_lines" ] || \
    fail "$file pipes no test output through tee, so the count assertion cannot work"
  for line in $tee_lines; do
    found=0
    probe=$((line + 1))
    while [ "$probe" -le "$((line + 3))" ]; do
      if sed -n "${probe}p" "$file" | grep -Fq 'PIPESTATUS'; then
        found=1
        break
      fi
      probe=$((probe + 1))
    done
    [ "$found" -eq 1 ] || \
      fail "$file:$line pipes through tee but never reads PIPESTATUS; the exit code would come from tee, so a failing suite would be reported as success"
  done
}

self_test

# 9 个必检：shell  test  race  frontend  golangci-lint  release-helpers
#             backend-security  frontend-security  embed
checked_triggers=""
while read -r workflow job; do
  [ -f "$workflow" ] || fail "$workflow is missing; job '$job' would disappear"
  block=$(job_block "$workflow" "$job")
  [ -n "$block" ] || fail "$workflow has no job '$job'; a required check would never report"

  verdict=$(printf '%s\n' "$block" | block_verdict)
  if [ "$verdict" != "ok" ]; then
    fail "$workflow job '$job' can be filtered out of a PR or skipped into a free pass:
$verdict"
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

check_pipe_status backend/scripts/race-gate.sh
check_pipe_status .github/release-tools/run-tests.sh

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
