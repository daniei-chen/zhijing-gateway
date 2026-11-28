#!/usr/bin/env bash
# race job 的门禁：-race 只在真跑了测试时才有意义。
#
# `go test -run <正则>` 零命中时退 0，只在输出里打 "testing: warning: no tests to run"。
# 改一个测试名、把并发测试挪出这两个目录、或者把 -run 正则改坏，这个 job 都会
# 静默变绿，看上去和"并发都验过了"一模一样。所以这里断言 -v 输出里真跑过的
# 测试条数不低于下限，低于下限就是红。
#
# 退出码必须从管道首命令取：`cmd | tee log` 的 $? 是 tee 的。靠 `set -o pipefail`
# 能把 go test 的失败带出来，但那只在 pipefail 被打开时成立——头部一被改成
# `set -eu`（复制脚本时最常见的改法），`|| status=$?` 就永远不触发，一条红色
# 的测试会打印 "1431 tests ran" 然后退 0。所以用 PIPESTATUS[0]，让 pipefail
# 在不在对结果完全没有影响。
set -euo pipefail

cd "$(dirname "$0")/.."

# 下限依据：2026-11-28 在 a5176cb4d 上用同一条 -run 实测跑了 1431 条测试
# （顶层 Test 函数名数，不含子测试）。取 1300 留 9% 余量：低于它说明过滤器
# 或测试目录已经漂了，门禁名存实亡。升级这条下限时同时更新
# deploy/tests/ci-workflow-guards-test.sh 里的说明。
readonly MIN_TESTS=1300

log=$(mktemp)
trap 'rm -f "$log"' EXIT

set +e
CGO_ENABLED=1 go test -race -tags=unit -timeout 600s -v \
  ./internal/service/ ./internal/handler/ \
  -run 'Concurren|Limiter|Limit|Cache|Schedul|Pool|Slot|Race|Parallel|Atomic' \
  2>&1 | tee "$log"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  printf 'race gate: go test failed with exit %d\n' "$status" >&2
  exit "$status"
fi

ran=$(grep -cE '^=== RUN   [^/]+$' "$log" || true)
if [ "$ran" -lt "$MIN_TESTS" ]; then
  printf 'race gate: only %d tests ran, floor is %d. The -run filter no longer\n' "$ran" "$MIN_TESTS" >&2
  printf 'race gate: selects the concurrency suite; -race proved nothing.\n' >&2
  exit 1
fi

printf 'race gate: %d tests ran (floor %d)\n' "$ran" "$MIN_TESTS"
