#!/usr/bin/env bash
# 校验源站是否对敏感管理端点返回 403（默认期望值）。
#
# 探测不带任何凭据：没有 Nginx 拒绝清单时，这些路径会进到应用层，回 401/404/302；
# 只有 Nginx 在鉴权之前直接拒绝才会是 403。所以「非 403 即失败」问的正是
# 「拒绝清单到底在不在」，模板见 deploy/zhijing/nginx/zhijing.origin.deny.conf。
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
用法: verify-sensitive-endpoints.sh --base-url https://host [选项]

逐个探测敏感管理端点，任何一条不是期望状态码（默认 403）就以非零退出，
并把实际状态码逐条打印出来。

选项:
  --base-url URL        目标地址，例如 https://154-36-187-147.sslip.io（必需）
  --expect CODE         期望的 HTTP 状态码，默认 403
  --method METHOD       覆盖每条探测的方法（默认按清单，GET/POST）
  --host NAME           发送 "Host: NAME" 头（按 IP 探测、需要指定站点名时用）
  --resolve H:P:ADDR    传给 curl --resolve（可重复），例如 example.com:443:127.0.0.1
  --timeout SECONDS     单条请求超时，默认 10
  -k, --insecure        跳过 TLS 证书校验
  --list                只打印探测清单（每行 "METHOD 路径"），不发起请求
  -h, --help            显示本帮助

退出码: 0 全部命中期望状态码；1 至少一条不符；2 参数错误。
USAGE
}

die_usage() {
  printf 'ERROR: %s\n\n' "$*" >&2
  usage >&2
  exit 2
}

# 清单格式：<METHOD> <PATH>|<给人看的说明>
probe_list() {
  cat <<'PROBES'
POST /api/v1/admin/system/update|替换服务二进制
POST /api/v1/admin/system/rollback|回滚服务二进制
POST /api/v1/admin/system/restart|重启服务进程
GET /api/v1/admin/backups|备份列表（整组移出公网入口）
POST /api/v1/admin/backups|创建备份（整库快照）
GET /api/v1/admin/backups/00000000-0000-0000-0000-000000000000/download-url|备份下载地址
POST /api/v1/admin/backups/00000000-0000-0000-0000-000000000000/restore|从备份恢复（覆盖现有数据）
POST /api/v1/admin/data-management/backups|创建数据管理备份任务
GET /api/v1/admin/accounts/data|导出全部账号
POST /api/v1/admin/accounts/data|导入账号（覆盖现有账号）
GET /api/v1/admin/proxies/data|导出全部代理
POST /api/v1/admin/proxies/data|导入代理（覆盖现有代理）
GET /api/v1/admin/redeem-codes/export|导出兑换码
PROBES
}

base_url=""
expect=403
method_override=""
host_header=""
timeout=10
list_only=false
resolve_args=()
insecure_args=()

while (($#)); do
  case "$1" in
    --base-url) base_url=${2:?'--base-url 需要一个值'}; shift 2 ;;
    --expect) expect=${2:?'--expect 需要一个值'}; shift 2 ;;
    --method) method_override=${2:?'--method 需要一个值'}; shift 2 ;;
    --host) host_header=${2:?'--host 需要一个值'}; shift 2 ;;
    --resolve) resolve_args+=(--resolve "${2:?'--resolve 需要一个值'}"); shift 2 ;;
    --timeout) timeout=${2:?'--timeout 需要一个值'}; shift 2 ;;
    -k|--insecure) insecure_args=(--insecure); shift ;;
    --list) list_only=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die_usage "未知参数: $1" ;;
  esac
done

if $list_only; then
  probe_list | cut -d'|' -f1
  exit 0
fi

[[ -n "$base_url" ]] || die_usage "缺少 --base-url"
[[ "$base_url" =~ ^https?://[^/]+ ]] || die_usage "--base-url 必须是 http:// 或 https:// 地址: ${base_url}"
base_url=${base_url%/}
[[ "$expect" =~ ^[0-9]{3}$ ]] || die_usage "--expect 必须是三位状态码: ${expect}"
[[ "$timeout" =~ ^[0-9]+$ ]] || die_usage "--timeout 必须是秒数: ${timeout}"

total=0
failed=0
failures=()

while IFS='|' read -r probe label; do
  method=${probe%% *}
  path=${probe#* }
  if [[ -n "$method_override" ]]; then
    method=$method_override
  fi

  code=$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --request "$method" --max-time "$timeout" \
    ${host_header:+--header "Host: ${host_header}"} \
    ${resolve_args[@]+"${resolve_args[@]}"} \
    ${insecure_args[@]+"${insecure_args[@]}"} \
    "${base_url}${path}" 2>/dev/null || true)
  code=${code:-000}

  total=$((total + 1))
  if [[ "$code" == "$expect" ]]; then
    printf '  ok   %s %s -> %s   (%s)\n' "$method" "$path" "$code" "$label"
  else
    failed=$((failed + 1))
    failures+=("$method $path -> $code   ($label)")
    printf '  FAIL %s %s -> %s   (%s)\n' "$method" "$path" "$code" "$label"
  fi
done < <(probe_list)

if (( failed > 0 )); then
  printf 'FAIL: %d/%d 个敏感端点没有返回 %s（拒绝清单缺失或不完整）\n' \
    "$failed" "$total" "$expect" >&2
  for failure in "${failures[@]}"; do
    printf '  %s\n' "$failure" >&2
  done
  exit 1
fi

printf 'OK: %d 个敏感端点全部返回 %s\n' "$total" "$expect"
