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
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repo_root"

exec python deploy/tests/ci_workflow_guards_test.py "$@"
