#!/bin/sh
# CI 必检守卫的入口（release-helpers job 调用；本地也一样跑这一条）。
#
# 真正的断言在 ci_workflow_guards_test.py：它用 yaml.safe_load 解析 workflow 再断言
# 键，因为按字面 key: 写的正则挡不住 `needs :` / `"needs":` 这类 YAML 等价写法
# （2026-11-28 实测三种变体全被放行）。
#
# 依赖：PyYAML==6.0.3，钉在 .github/release-tools/requirements-release.txt 里，由
# job 的安装步骤负责装上。这里只调用它，不做任何"装不上就跳过"的回退——回退路径在
# CI 里永远跑不到，是一段没人验的代码。
#
# 守卫自己也要有「Ran N」下限：这一整片堵的是「命令退 0 但什么都没跑」，而测试文件
# 被改成空壳、或 unittest 一个用例都没收集到，同样打 `Ran 0 tests` 然后退 0。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

# 下限 = 守卫当前的真实条数。加减测试时同步改这一行——少一条就该有人问为什么。
min_tests=17

log=$(mktemp)
trap 'rm -f "$log"' EXIT

# 不接管道：`python ... | tee` 的退出码是 tee 的，要拿 python 的就得靠 PIPESTATUS，
# 而这个脚本是 sh（POSIX，不认 PIPESTATUS）。重定向到文件再 cat，退出码就是 python 的。
set +e
python deploy/tests/ci_workflow_guards_test.py "$@" >"$log" 2>&1
status=$?
set -e

cat "$log"

if [ "$status" -ne 0 ]; then
  printf 'workflow guards: guard failed with exit %d\n' "$status" >&2
  exit "$status"
fi

ran=$(grep -oE '^Ran [0-9]+ test' "$log" | grep -oE '[0-9]+' || true)
if [ -z "${ran:-}" ] || [ "$ran" -lt "$min_tests" ]; then
  printf 'workflow guards: ran %s tests, floor is %d\n' "${ran:-0}" "$min_tests" >&2
  exit 1
fi

printf 'workflow guards: ran %d tests (floor %d)\n' "$ran" "$min_tests"
