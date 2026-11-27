#!/bin/sh
# 上游差异清单：把本地与上游 checkout 的差异按行数排序，并按目录边界表分类。
#
# 分类规则的唯一说明在 docs/UPSTREAM.md 第三节「目录边界表」。这里的
# classify_area() 是那张表的可执行副本 —— 改边界表必须同时改这里，反之亦然。
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
tab=$(printf '\t')

usage() {
  cat <<'EOF'
用法: tools/upstream-diff.sh --upstream <上游 checkout 路径> [选项]

  --upstream DIR   上游 Wei-Shaw/sub2api 的 checkout（必填）
  --baseline REF   比对上游的这个 git ref；不给就比对 checkout 的工作区
  --ours DIR       要比对的本地目录（默认：本脚本所在仓库的工作区）
  --top N          只列差异最大的前 N 个文件（默认 20，0 = 全部）
  --class C        mixed / local / all（默认 all）
  --missing        额外列出「上游有、本地没有」的路径
  -h, --help       显示本帮助

输出为 TAB 分隔的三列：改动行数 / 分类 / 路径，按行数降序；以 # 开头的是注释行。
EOF
}

die() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 2
}

upstream=""
baseline=""
ours=$repo_root
top=20
want_class=all
show_missing=no

while [ $# -gt 0 ]; do
  case $1 in
    --upstream)
      [ $# -ge 2 ] || die "--upstream 需要一个目录"
      upstream=$2
      shift 2
      ;;
    --baseline)
      [ $# -ge 2 ] || die "--baseline 需要一个 git ref"
      baseline=$2
      shift 2
      ;;
    --ours)
      [ $# -ge 2 ] || die "--ours 需要一个目录"
      ours=$2
      shift 2
      ;;
    --top)
      [ $# -ge 2 ] || die "--top 需要一个数字"
      top=$2
      shift 2
      ;;
    --class)
      [ $# -ge 2 ] || die "--class 需要一个值"
      want_class=$2
      shift 2
      ;;
    --missing)
      show_missing=yes
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[ -n "$upstream" ] || { usage >&2; exit 2; }
[ -d "$upstream" ] || die "--upstream $upstream 不是目录"
[ -d "$ours" ] || die "--ours $ours 不是目录"
case $top in
  ''|*[!0-9]*) die "--top 需要非负整数，收到: $top" ;;
esac
case $want_class in
  all|mixed|local) ;;
  *) die "--class 只能是 all / mixed / local，收到: $want_class" ;;
esac

tmp=$(mktemp -d "${TMPDIR:-/tmp}/upstream-diff.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

up_tree=$upstream
up_label=$upstream
if [ -n "$baseline" ]; then
  git -C "$upstream" rev-parse --git-dir >/dev/null 2>&1 \
    || die "--baseline 需要 --upstream 是一个 git 仓库"
  git -C "$upstream" rev-parse --verify --quiet "$baseline^{commit}" >/dev/null \
    || die "上游 checkout 里没有 ref: $baseline"
  mkdir -p "$tmp/upstream"
  git -C "$upstream" archive --format=tar "$baseline" | tar -x -C "$tmp/upstream" \
    || die "导出上游 $baseline 失败"
  up_tree=$tmp/upstream
  up_label="$upstream@$baseline"
fi

# 目录边界表：本地独有的路径返回 local，其余（上游拥有）返回 upstream。
# 混合区域按文件判定 —— 上游有该文件就算上游文件，没有就算本地扩展。
classify_area() {
  case $1 in
    deploy/zhijing/*|deploy/ops/*) echo local ;;
    deploy/ZHIJING_ZERO_DOWNTIME.md|deploy/zhijing-gateway.service) echo local ;;
    deploy/tests/bind-host-default-test.sh|deploy/tests/ci-race-job-test.sh) echo local ;;
    docs/README.md|docs/feature-gap-audit-*.md|docs/cache-decision-*.md) echo local ;;
    docs/security/*|docs/UPSTREAM.md|docs/releases/v0.0.8.zh-CN.md) echo local ;;
    AUDIT-*.md|TECH-DEBT-*.md|SYSTEMIC-RISK-*.md|SILENT-FAILURES-*.md|TODO-SURVEY-*.md) echo local ;;
    FALSE-POSITIVE-CHECKLIST.md|AI_HANDOFF_PROTOCOL.md|HANDBOOK.md) echo local ;;
    .release-notes-v*.md|local-v002-baseline.json|snapshot_existing_source.py) echo local ;;
    *) echo upstream ;;
  esac
}

# 构建产物不算边界问题。注意不能直接 -x dist：backend/internal/web/dist 是
# 随仓库发布的嵌入式前端产物，是要比对的真文件。
is_noise() {
  case $1 in
    frontend/dist/*|frontend/coverage/*|frontend/.vite/*) return 0 ;;
    build/*|backend/build/*|plugins/*|*__pycache__/*|*.pyc) return 0 ;;
  esac
  return 1
}

walk_files() { # $1 绝对目录 → 逐行输出其中的文件（跳过构建产物目录）
  find "$1" \
    \( -name .git -o -name node_modules -o -name __pycache__ -o -name .vite \) -prune \
    -o -type f -print
}

file_class() { # $1 相对路径, $2 上游是否有这个文件（yes/no）
  if [ "$(classify_area "$1")" = local ] || [ "$2" != yes ]; then
    echo local
  else
    echo mixed
  fi
}

diff -rq \
  -x .git -x node_modules -x __pycache__ -x '*.pyc' -x .vite \
  "$up_tree" "$ours" >"$tmp/diff.txt" 2>&1 || true

rows=$tmp/rows
up_only=$tmp/up_only
: >"$rows"
: >"$up_only"
differing=0

while IFS= read -r line; do
  case $line in
    'Files '*)
      rest=${line#Files }
      up_file=${rest%% and *}
      our_file=${rest#* and }
      our_file=${our_file% differ}
      rel=${up_file#"$up_tree"/}
      if is_noise "$rel"; then
        continue
      fi
      # 机械改名不算差异：先按 module 路径归一化上游内容，再比。
      if ! sed -e 's|github.com/Wei-Shaw/sub2api|github.com/daniei-chen/zhijing-gateway|g' \
          "$up_file" >"$tmp/up.norm" 2>/dev/null; then
        cp "$up_file" "$tmp/up.norm"
      fi
      if cmp -s "$tmp/up.norm" "$our_file"; then
        continue
      fi
      differing=$((differing + 1))
      diff_out=$(diff -U0 "$tmp/up.norm" "$our_file" 2>&1 || true)
      case $diff_out in
        *'Binary files'*) lines=1 ;;
        *)
          # 行数口径同 git diff --numstat：新增行 + 删除行，不计文件头。
          lines=$(printf '%s\n' "$diff_out" | awk '
            /^\+\+\+|^---/ { next }
            /^\+/ { n++ }
            /^-/ { n++ }
            END { print n + 0 }')
          ;;
      esac
      [ -n "$lines" ] || lines=0
      if [ "$lines" -eq 0 ]; then
        continue
      fi
      printf '%s\t%s\t%s\n' "$lines" "$(file_class "$rel" yes)" "$rel" >>"$rows"
      ;;
    'Only in '*)
      dir=${line#Only in }
      dir=${dir%: *}
      name=${line##*: }
      case $dir in
        "$up_tree") rel=$name ;;
        "$up_tree"/*) rel=${dir#"$up_tree"/}/$name ;;
        "$ours") rel=$name ;;
        "$ours"/*) rel=${dir#"$ours"/}/$name ;;
        *) continue ;;
      esac
      case $dir in
        "$up_tree"|"$up_tree"/*)
          if [ -d "$up_tree/$rel" ]; then
            walk_files "$up_tree/$rel" | while IFS= read -r f; do
              sub=${f#"$up_tree"/}
              is_noise "$sub" || printf '%s\n' "$sub" >>"$up_only"
            done
          else
            printf '%s\n' "$rel" >>"$up_only"
          fi
          ;;
        *)
          # 本地新增：整个新目录要展开成文件，否则只看到一个目录名。
          if [ -d "$ours/$rel" ]; then
            walk_files "$ours/$rel" | while IFS= read -r f; do
              sub=${f#"$ours"/}
              is_noise "$sub" || printf '0\t%s\t%s\n' "$(file_class "$sub" no)" "$sub" >>"$rows"
            done
          else
            is_noise "$rel" || printf '0\t%s\t%s\n' "$(file_class "$rel" no)" "$rel" >>"$rows"
          fi
          ;;
      esac
      ;;
  esac
done <"$tmp/diff.txt"

if [ "$want_class" = all ]; then
  cp "$rows" "$tmp/selected"
else
  awk -F"$tab" -v c="$want_class" '$2 == c' "$rows" >"$tmp/selected"
fi

sort -t "$tab" -k1,1nr -k3 "$tmp/selected" >"$tmp/sorted"
if [ "$top" -gt 0 ]; then
  head -n "$top" "$tmp/sorted" >"$tmp/final"
else
  cp "$tmp/sorted" "$tmp/final"
fi

printf '# 上游: %s\n' "$up_label"
printf '# 本地: %s\n' "$ours"
cat "$tmp/final"

mixed=$(awk -F"$tab" '$2 == "mixed"' "$rows" | wc -l | tr -d ' ')
local=$(awk -F"$tab" '$2 == "local"' "$rows" | wc -l | tr -d ' ')
missing=$(wc -l <"$up_only" | tr -d ' ')
printf '# 汇总: mixed=%s local=%s 上游有本地无=%s 有差异的共同文件=%s\n' \
  "$mixed" "$local" "$missing" "$differing"

if [ "$show_missing" = yes ] && [ "$missing" -gt 0 ]; then
  printf '# 上游有、本地无:\n'
  sort "$up_only" | while IFS= read -r path; do
    printf '0\tmissing\t%s\n' "$path"
  done
fi
