#!/bin/bash
# verify-sensitive-endpoints.sh 的双向自测：
#   1. 拒绝清单一致：脚本探测的每条路径都能在 nginx 模板里找到对应的 403；
#   2. 全部 403 时必须通过；
#   3. 全部 200 时必须失败，并打印实际状态码；
#   4. 只漏一条时必须失败，并点名那一条。
set -Eeuo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${TEST_DIR}/../.." && pwd)"
SCRIPT="${REPO_ROOT}/deploy/zhijing/verify-sensitive-endpoints.sh"
TEMPLATE="${REPO_ROOT}/deploy/zhijing/nginx/zhijing.origin.deny.conf"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

[[ -f "${SCRIPT}" ]] || fail "missing ${SCRIPT}"
[[ -f "${TEMPLATE}" ]] || fail "missing ${TEMPLATE}"
bash -n "${SCRIPT}" || fail "verify-sensitive-endpoints.sh failed its syntax check"

# 1) 模板与探测清单必须对齐：脚本里探测的路径，模板里得有能覆盖它的 403。
#    模板可以用三种写法覆盖同一条路径：精确匹配、占位 id 的正则、整个资源前缀。
placeholder=00000000-0000-0000-0000-000000000000
probe_count=0
while read -r _method path; do
  [[ -n "${path}" ]] || continue
  probe_count=$((probe_count + 1))
  needles=("${path}")
  if [[ "${path}" == *"${placeholder}"* ]]; then
    needles+=("${path//${placeholder}/[^/]+}")
    needles+=("${path%%/${placeholder}/*}/")
  fi
  covered=false
  for needle in "${needles[@]}"; do
    if grep -Fq -- "${needle}" "${TEMPLATE}"; then
      covered=true
      break
    fi
  done
  $covered || fail "nginx deny template has no rule covering ${path} (probed by verify-sensitive-endpoints.sh)"
done < <(bash "${SCRIPT}" --list)

(( probe_count >= 8 )) || fail "expected at least 8 probes, got ${probe_count}"
for required in \
  /api/v1/admin/system/update \
  /api/v1/admin/backups \
  /api/v1/admin/accounts/data \
  /api/v1/admin/proxies/data \
  /api/v1/admin/redeem-codes/export
do
  grep -Fq "${required}" "${TEMPLATE}" || fail "nginx deny template must cover ${required}"
done

command -v python3 >/dev/null 2>&1 || {
  printf 'SKIP: python3 unavailable; stub server checks skipped\n'
  exit 0
}
command -v curl >/dev/null 2>&1 || fail "curl is required"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/zhijing-verify-endpoints.XXXXXX")"
stub_pid=""
cleanup() {
  if [[ -n "${stub_pid}" ]]; then
    kill "${stub_pid}" 2>/dev/null || true
    wait "${stub_pid}" 2>/dev/null || true
  fi
  rm -rf "${work_dir}"
}
trap cleanup EXIT HUP INT TERM

# mode: deny = 全部 403；open = 全部 200；mixed = 只有兑换码导出是 200。
start_stub() {
  local mode=$1
  local port_file="${work_dir}/port-${mode}"
  python3 - "${mode}" "${port_file}" <<'PY' &
import http.server
import pathlib
import socketserver
import sys

mode = sys.argv[1]
port_file = pathlib.Path(sys.argv[2])
open_path = "/api/v1/admin/redeem-codes/export"


class Handler(http.server.BaseHTTPRequestHandler):
    def status_for(self):
        if mode == "deny":
            return 403
        if mode == "open":
            return 200
        return 200 if self.path.startswith(open_path) else 403

    def respond(self):
        self.send_response(self.status_for())
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = respond
    do_POST = respond

    def log_message(self, *args):
        pass


with socketserver.TCPServer(("127.0.0.1", 0), Handler) as httpd:
    port_file.write_text(str(httpd.server_address[1]))
    httpd.serve_forever()
PY
  stub_pid=$!

  local waited=0
  while [[ ! -s "${port_file}" ]]; do
    sleep 0.1
    waited=$((waited + 1))
    (( waited < 100 )) || fail "stub server did not start within 10s"
    kill -0 "${stub_pid}" 2>/dev/null || fail "stub server exited before reporting its port"
  done
  stub_port=$(cat "${port_file}")
}

stop_stub() {
  if [[ -n "${stub_pid}" ]]; then
    kill "${stub_pid}" 2>/dev/null || true
    wait "${stub_pid}" 2>/dev/null || true
    stub_pid=""
  fi
}

run_probe() {
  probe_output=$(bash "${SCRIPT}" --base-url "http://127.0.0.1:${stub_port}" "$@" 2>&1) && probe_status=0 || probe_status=$?
}

# 2) 全部 403：必须通过。
start_stub deny
run_probe
stop_stub
[[ "${probe_status}" -eq 0 ]] || {
  printf '%s\n' "${probe_output}" >&2
  fail "all-403 stub should pass, exit was ${probe_status}"
}
grep -q "^OK: ${probe_count} 个敏感端点全部返回 403$" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "all-403 stub did not print the expected summary"
}

# 3) 全部 200：必须失败，并逐条打印 200。
start_stub open
run_probe
[[ "${probe_status}" -ne 0 ]] || {
  printf '%s\n' "${probe_output}" >&2
  fail "all-200 stub must fail the probe"
}
grep -q "system/update -> 200" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "all-200 output does not name the actual status code"
}
grep -q "^FAIL: ${probe_count}/${probe_count} 个敏感端点没有返回 403" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "all-200 output does not report every probe as failed"
}

# 同一个 stub 上 --expect 200 必须通过，证明 --expect 真的生效。
run_probe --expect 200
stop_stub
[[ "${probe_status}" -eq 0 ]] || {
  printf '%s\n' "${probe_output}" >&2
  fail "--expect 200 against an all-200 stub should pass, exit was ${probe_status}"
}

# 4) 只漏一条：必须失败，并且点名那一条，其余保持 ok。
start_stub mixed
run_probe
stop_stub
[[ "${probe_status}" -ne 0 ]] || {
  printf '%s\n' "${probe_output}" >&2
  fail "a single open endpoint must fail the probe"
}
grep -q "FAIL GET /api/v1/admin/redeem-codes/export -> 200" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "mixed output does not point at the open endpoint"
}
grep -q "ok   POST /api/v1/admin/system/update -> 403" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "mixed output should keep the denied endpoints as ok"
}
grep -q "^FAIL: 1/${probe_count} 个敏感端点没有返回 403" <<<"${probe_output}" || {
  printf '%s\n' "${probe_output}" >&2
  fail "mixed output does not report exactly one failure"
}

printf 'verify sensitive endpoints test passed (%s probes)\n' "${probe_count}"
