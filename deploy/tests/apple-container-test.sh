#!/bin/bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${TEST_DIR}/.." && pwd)"
SCRIPT="${DEPLOY_DIR}/apple-container.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/sub2api-apple-test.XXXXXX")"
STATE_DIR="${TEST_ROOT}/state"
ENV_FILE="${TEST_ROOT}/sub2api.env"

cleanup() {
    rm -rf "${TEST_ROOT}"
}
trap cleanup EXIT

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

assert_exists() {
    [[ -e "$1" ]] || fail "Expected path to exist: $1"
}

assert_missing() {
    [[ ! -e "$1" ]] || fail "Expected path to be absent: $1"
}

export FAKE_CONTAINER_STATE="${STATE_DIR}"
export PATH="${TEST_DIR}/fixtures/bin:${PATH}"
export SUB2API_ENV_FILE="${ENV_FILE}"

mkdir -p "${STATE_DIR}"

# stat 在 macOS 是 BSD 版本（-f），在 Linux 是 GNU 版本（-c）。按平台分派，
# 不能"先试一个、失败再回退"：GNU stat 遇到 -f 会把文件系统信息打印到 stdout
# 之后才退出非零，回退拿到的输出里混进多行垃圾，mode_of 永远判错，跟着它的
# 断言就静默失效了。
mode_of() {
    case "$(uname -s)" in
        Darwin|FreeBSD|OpenBSD|NetBSD) stat -f '%Lp' "$1" ;;
        *) stat -c '%a' "$1" ;;
    esac
}

# 证明 mode_of 在当前平台上真的判对，避免上面那种假绿。
probe_mode="${TEST_ROOT}/mode-probe"
printf 'probe\n' >"${probe_mode}"
chmod 644 "${probe_mode}"
[[ "$(mode_of "${probe_mode}")" == "644" ]] || \
    fail "mode_of misreported a 0644 file as '$(mode_of "${probe_mode}")'"
chmod 600 "${probe_mode}"
[[ "$(mode_of "${probe_mode}")" == "600" ]] || \
    fail "mode_of misreported a 0600 file as '$(mode_of "${probe_mode}")'"
rm -f "${probe_mode}"

"${SCRIPT}" init
[[ "$(mode_of "${ENV_FILE}")" == "600" ]] || fail "init did not create a mode-600 env file"
grep -q '^POSTGRES_PASSWORD=change_this_secure_password$' "${ENV_FILE}" && fail "init retained the placeholder password"

# Apple container 的生命周期用例需要 macOS 的 plutil 与真实 container 行为；
# CI 的 shell job 跑在 macos-15，Linux 本地只验证与平台无关的部分：mode_of 的
# 判定和 init 写出的文件权限。
if [[ "$(uname -s)" != "Darwin" ]]; then
    printf 'SKIP: Apple container lifecycle needs macOS; mode_of and init permissions passed\n'
    exit 0
fi

chmod 644 "${ENV_FILE}"
if "${SCRIPT}" up >/dev/null 2>&1; then
    fail "up accepted an insecure env file"
fi
chmod 600 "${ENV_FILE}"

"${SCRIPT}" up
assert_exists "${STATE_DIR}/containers/sub2api-apple"
assert_exists "${STATE_DIR}/containers/sub2api-apple-postgres"
assert_exists "${STATE_DIR}/containers/sub2api-apple-redis"
assert_exists "${STATE_DIR}/running/sub2api-apple"
grep -q '^while true; do$' "${STATE_DIR}/create-arguments/sub2api-apple" || \
    fail "app container does not supervise the 智境网关 process"
grep -q '^    su-exec zhijing "$runtime_binary" &$' "${STATE_DIR}/create-arguments/sub2api-apple" || \
    fail "app supervisor does not launch the updatable 智境网关 binary"
grep -q '^trap stop TERM INT$' "${STATE_DIR}/create-arguments/sub2api-apple" || \
    fail "app supervisor does not handle container stop signals"
grep -q '^runtime_binary="$runtime_dir/zhijing-gateway"$' "${STATE_DIR}/create-arguments/sub2api-apple" || \
    fail "app container does not run its updatable binary from persistent storage"
grep -q '^APPLE_CONTAINER_SUB2API_IMAGE_ID=fake-image-id$' "${STATE_DIR}/env-files/sub2api-apple" || \
    fail "app container did not receive the inspected base image ID"
[[ ! -s "${STATE_DIR}/network-subnets/sub2api-apple" ]] || \
    fail "up passed a subnet when APPLE_CONTAINER_NETWORK_SUBNET was unset"
"${SCRIPT}" status >/dev/null

"${SCRIPT}" up --recreate
assert_exists "${STATE_DIR}/running/sub2api-apple"
"${SCRIPT}" down
assert_missing "${STATE_DIR}/running/sub2api-apple"
assert_missing "${STATE_DIR}/running/sub2api-apple-postgres"
assert_missing "${STATE_DIR}/running/sub2api-apple-redis"

"${SCRIPT}" destroy --yes
assert_missing "${STATE_DIR}/containers/sub2api-apple"
assert_missing "${STATE_DIR}/networks/sub2api-apple"
assert_exists "${STATE_DIR}/volumes/sub2api-apple-data"

printf '\nAPPLE_CONTAINER_NETWORK_SUBNET=172.31.250.0/24\n' >>"${ENV_FILE}"
"${SCRIPT}" up
[[ "$(<"${STATE_DIR}/network-subnets/sub2api-apple")" == "172.31.250.0/24" ]] || \
    fail "up did not pass APPLE_CONTAINER_NETWORK_SUBNET to network creation"

printf 'APPLE_CONTAINER_NETWORK_SUBNET=172.31.251.0/24\n' >>"${ENV_FILE}"
if mismatch_output="$("${SCRIPT}" up 2>&1)"; then
    fail "up accepted a configured subnet that differs from the existing network"
fi
[[ "${mismatch_output}" == *"Existing network 'sub2api-apple' uses subnet '172.31.250.0/24'"* ]] || \
    fail "up did not explain the existing network subnet mismatch"
[[ "${mismatch_output}" == *"destroy --yes"* ]] || \
    fail "up did not provide the network migration command"
assert_exists "${STATE_DIR}/networks/sub2api-apple"
assert_exists "${STATE_DIR}/containers/sub2api-apple"

"${SCRIPT}" destroy --yes
"${SCRIPT}" up
"${SCRIPT}" destroy --volumes --yes
assert_missing "${STATE_DIR}/volumes/sub2api-apple-data"
assert_missing "${STATE_DIR}/volumes/sub2api-apple-postgres-data"
assert_missing "${STATE_DIR}/volumes/sub2api-apple-redis-data"

touch "${STATE_DIR}/system-running"
touch "${STATE_DIR}/containers/sub2api-apple"
touch "${STATE_DIR}/unowned/container/sub2api-apple"
if "${SCRIPT}" status >/dev/null 2>&1; then
    fail "status accepted an unowned same-name container"
fi

printf 'Apple container lifecycle tests passed.\n'
