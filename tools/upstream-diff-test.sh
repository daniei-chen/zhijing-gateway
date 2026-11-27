#!/bin/sh
# tools/upstream-diff.sh 的自测：构造两个假目录，验证
#   1) 只有 module 改名的文件不算差异（归一化生效）
#   2) 上游文件被本地改过 → mixed，行数正确
#   3) 上游没有的文件（含上游目录里的本地新增、本地独有目录）→ local
#   4) 「上游有、本地无」只在 --missing 时列出，且不占用 --top 名额
#   5) 按行数降序、--top / --class 过滤生效
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tool=$script_dir/upstream-diff.sh
[ -f "$tool" ] || {
  printf 'FAIL: 找不到 %s\n' "$tool" >&2
  exit 1
}

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/upstream-diff-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

up=$tmp/upstream
ours=$tmp/ours
mkdir -p \
  "$up/backend/internal/config" "$up/backend/internal/service" \
  "$up/assets/partners" "$up/deploy/tests" "$up/docs" \
  "$ours/backend/internal/config" "$ours/backend/internal/service" \
  "$ours/backend/cmd/zhijing-local" "$ours/deploy/zhijing" "$ours/deploy/tests" "$ours/docs"

# 1) 上游文件，本地只改了 module 路径 —— 不该出现在清单里。
cat >"$up/backend/internal/config/config.go" <<'EOF'
package config

import "github.com/Wei-Shaw/sub2api/internal/pkg/ip"

var DefaultHost = ip.Loopback
EOF
cat >"$ours/backend/internal/config/config.go" <<'EOF'
package config

import "github.com/daniei-chen/zhijing-gateway/internal/pkg/ip"

var DefaultHost = ip.Loopback
EOF

# 2) 上游文件，本地改了三行 —— mixed，行数 3。
cat >"$up/backend/internal/service/thing.go" <<'EOF'
package service

func Thing() int {
	return 1
}

func Other() int {
	return 2
}

func Third() int {
	return 3
}
EOF
cat >"$ours/backend/internal/service/thing.go" <<'EOF'
package service

func Thing() int {
	return 10
}

func Other() int {
	return 2
}

func Third() int {
	return 30
}

func Extra() int {
	return 4
}
EOF

# 3) 上游目录里的本地新增文件 —— local。
cat >"$ours/backend/cmd/zhijing-local/main.go" <<'EOF'
package main

func main() {}
EOF

# 4) 本地独有目录 —— local。
cat >"$ours/deploy/zhijing/run.sh" <<'EOF'
#!/bin/sh
echo hi
EOF

# 5) 本地独有文档（docs 是混合区域，文件不在上游 → local）。
cat >"$ours/docs/UPSTREAM.md" <<'EOF'
# 上游边界
EOF

# 6) 上游文件，本地改两行 —— mixed，行数 2，排序在 3 行那条之后。
cat >"$up/deploy/tests/smoke.sh" <<'EOF'
#!/bin/sh
set -eu
echo one
echo two
EOF
cat >"$ours/deploy/tests/smoke.sh" <<'EOF'
#!/bin/sh
set -eux
echo one
echo TWO
EOF

# 7) 上游有、本地没有 —— 只在 --missing 时出现。
cat >"$up/assets/partners/partner.svg" <<'EOF'
<svg></svg>
EOF


# 8) 上游有、本地删掉一行 Markdown 分隔线 —— 删除行以 "--" 开头，
#    按前缀过滤文件头会把这条差异整条吞掉（0 行 → 文件从清单里消失）。
cat >"$up/docs/PAYMENT.md" <<'EOF'
line one
---
line two
EOF
cat >"$ours/docs/PAYMENT.md" <<'EOF'
line one
line two
EOF

# 9) 路径里含 " and " —— 用分隔符解析会把路径截断成不存在的东西。
cat >"$up/backend/internal/service/foo and bar.go" <<'EOF'
package service

var A = 1
EOF
cat >"$ours/backend/internal/service/foo and bar.go" <<'EOF'
package service

var A = 2
EOF

run() {
  /bin/sh "$tool" --upstream "$up" --ours "$ours" "$@"
}

field() { # $1 行, $2 列号
  printf '%s' "$1" | cut -f"$2"
}

row_of() { # $1 输出, $2 路径
  printf '%s\n' "$1" | awk -F'\t' -v p="$2" '$3 == p'
}

out=$(run --top 10)

# 1) 改名归一化
if [ -n "$(row_of "$out" backend/internal/config/config.go)" ]; then
  fail '只有 module 改名的文件不该出现在清单里'
fi

# 2) mixed 与行数
row=$(row_of "$out" backend/internal/service/thing.go)
[ -n "$row" ] || fail '改过的上游文件没有出现在清单里'
[ "$(field "$row" 2)" = mixed ] || fail "thing.go 应判为 mixed，实际: $(field "$row" 2)"
[ "$(field "$row" 1)" -eq 8 ] || fail "thing.go 的改动行数应为 8，实际: $(field "$row" 1)"

# 3) 本地新增
row=$(row_of "$out" backend/cmd/zhijing-local/main.go)
[ -n "$row" ] || fail '上游目录里的本地新增文件没有出现'
[ "$(field "$row" 2)" = local ] || fail "本地新增应判为 local，实际: $(field "$row" 2)"

row=$(row_of "$out" deploy/zhijing/run.sh)
[ -n "$row" ] || fail '本地独有目录里的文件没有出现'
[ "$(field "$row" 2)" = local ] || fail "deploy/zhijing 下的文件应判为 local，实际: $(field "$row" 2)"

row=$(row_of "$out" docs/UPSTREAM.md)
[ -n "$row" ] || fail '本地独有文档没有出现'
[ "$(field "$row" 2)" = local ] || fail "docs 下的本地新增应判为 local，实际: $(field "$row" 2)"

# 5) 排序与行数
row=$(row_of "$out" deploy/tests/smoke.sh)
[ -n "$row" ] || fail '改过的上游测试脚本没有出现'
[ "$(field "$row" 1)" -eq 4 ] || fail "smoke.sh 的改动行数应为 4，实际: $(field "$row" 1)"
first=$(printf '%s\n' "$out" | awk -F'\t' 'NF == 3 {print $3; exit}')
[ "$first" = backend/internal/service/thing.go ] \
  || fail "清单应按行数降序，第一条实际是: $first"

# 7) 默认不列「上游有、本地无」
if printf '%s\n' "$out" | awk -F'\t' '$2 == "missing" {found = 1} END {exit found ? 0 : 1}'; then
  fail '默认输出里不该出现 missing 行'
fi
out_missing=$(run --top 10 --missing)
row=$(row_of "$out_missing" assets/partners/partner.svg)
[ -n "$row" ] || fail '--missing 没有列出「上游有、本地无」的路径'
[ "$(field "$row" 2)" = missing ] || fail "missing 行的分类应为 missing，实际: $(field "$row" 2)"

# --top 只截断排好序的行，不影响 missing
[ "$(printf '%s\n' "$out_missing" | awk -F'\t' '$2 == "missing"' | wc -l | tr -d ' ')" -eq 1 ] \
  || fail '--missing 应恰好列出一条'

# --top 1 只给一行
one=$(run --top 1)
[ "$(printf '%s\n' "$one" | awk -F'\t' 'NF == 3' | wc -l | tr -d ' ')" -eq 1 ] \
  || fail '--top 1 应只输出一行'

# --class local 只给 local
local_only=$(run --class local --top 0)
if printf '%s\n' "$local_only" | awk -F'\t' '$2 == "mixed" {found = 1} END {exit found ? 0 : 1}'; then
  fail '--class local 的输出里出现了 mixed 行'
fi
[ -n "$(row_of "$local_only" deploy/zhijing/run.sh)" ] || fail '--class local 漏掉了本地独有文件'


# 8) 以 "--" 开头的删除行要计入
row=$(row_of "$out" docs/PAYMENT.md)
[ -n "$row" ] || fail '删掉一行 --- 的文件被整条漏掉了'
[ "$(field "$row" 1)" -eq 1 ] || fail "PAYMENT.md 的改动行数应为 1，实际: $(field "$row" 1)"

# 9) 含 " and " 的路径要完整解析
row=$(row_of "$out" "backend/internal/service/foo and bar.go")
[ -n "$row" ] || fail '路径含 " and " 的文件被漏掉了'
[ "$(field "$row" 1)" -eq 2 ] || fail "含 and 的路径改动行数应为 2，实际: $(field "$row" 1)"

# 10) 调用方的 locale 不该影响结果（diff 的输出会被解析）
all_rows=$(run --top 0)
default_rows=$(printf '%s\n' "$all_rows" | awk -F'\t' 'NF == 3' | wc -l | tr -d ' ')
out_locale=$(LC_ALL=de_DE.UTF-8 LANG=de_DE.UTF-8 run --top 0)
locale_rows=$(printf '%s\n' "$out_locale" | awk -F'\t' 'NF == 3' | wc -l | tr -d ' ')
[ "$default_rows" = "$locale_rows" ] \
  || fail "换 locale 后行数从 $default_rows 变成 $locale_rows，说明 diff 的输出被本地化了"

# 10b) 上面那条在本机没装 de_DE 时会空跑，所以再加一条不依赖系统 locale 的：
# 把一个只在 LC_ALL=C 时才说英文的假 diff 放在 PATH 前面。脚本如果没自己锁
# locale，解析器就会看到德语，一条差异都认不出来。
real_diff=$(command -v diff)
shim=$tmp/shim
mkdir -p "$shim"
cat >"$shim/diff" <<EOF
#!/bin/sh
if [ "\${LC_ALL:-}" != C ]; then
  printf 'Dateien %s unterscheiden sich\n' "\$*"
  exit 1
fi
exec "$real_diff" "\$@"
EOF
chmod +x "$shim/diff"

# 控制组：确认假 diff 真的会跟着 locale 变，否则下面的断言是空的。
control=$(PATH="$shim:$PATH" env -u LC_ALL diff -rq "$up/docs" "$ours/docs" 2>&1 || true)
case $control in
  Dateien*) ;;
  *) fail '假 diff 没有生效，locale 断言会变成空跑' ;;
esac

shim_rows=$(PATH="$shim:$PATH" run --top 0 | awk -F'\t' 'NF == 3' | wc -l | tr -d ' ')
[ "$default_rows" = "$shim_rows" ] \
  || fail "假 diff 生效后行数从 $default_rows 变成 $shim_rows，说明脚本没有自己锁 locale"

# 参数校验：没有 --upstream 必须非零退出
if /bin/sh "$tool" >/dev/null 2>&1; then
  fail '缺少 --upstream 时应当报错退出'
fi
if /bin/sh "$tool" --upstream "$up" --baseline v0.2.21 >/dev/null 2>&1; then
  fail '--baseline 指向非 git 仓库时应当报错退出'
fi

printf 'ok: upstream-diff.sh 的分类、归一化、排序与过滤都符合边界表\n'
