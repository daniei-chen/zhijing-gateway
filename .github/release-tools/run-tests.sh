#!/usr/bin/env bash
# release-helpers job 的测试入口。
#
# `python -m unittest discover -s <dir> -p <pattern>` 匹配不到文件时退 0，
# 只打 "Ran 0 tests"。文件名一改、目录一挪，这个必检就静默变绿。所以两条：
#   1) 用显式模块路径，模块不存在时 unittest 自己就报错退出；
#   2) 断言 "Ran N tests" 里的 N 不低于下限。
set -euo pipefail

cd "$(dirname "$0")"

# 下限依据：2026-11-28 在 a5176cb4d 上 test_release_matrix.py 实测 10 条。
# 少一条就该有人问为什么——这个文件里的每条用例都是一条发布形态断言。
readonly MIN_TESTS=10

log=$(mktemp)
trap 'rm -f "$log"' EXIT

status=0
python -m unittest -v test_release_matrix 2>&1 | tee "$log" || status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

ran=$(grep -oE '^Ran [0-9]+ test' "$log" | grep -oE '[0-9]+' || true)
if [ -z "${ran:-}" ] || [ "$ran" -lt "$MIN_TESTS" ]; then
  printf 'release matrix tests: ran %s tests, floor is %d\n' "${ran:-0}" "$MIN_TESTS" >&2
  exit 1
fi

printf 'release matrix tests: ran %d tests (floor %d)\n' "$ran" "$MIN_TESTS"
