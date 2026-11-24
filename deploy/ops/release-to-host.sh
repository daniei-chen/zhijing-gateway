#!/usr/bin/env bash
# 从一个能 ssh 到日本主机的机器上，把指定版本打包、上传、构建成镜像并发上去。
#
# 存在的理由：这套流程之前靠手敲，步骤散落在几次会话的记录里，SSH 一断就没人
# 能复现。把它写成脚本，恢复通道后一条命令就能跑完，也方便别人接手。
#
# 用法：
#   HOST=root@154.36.187.147 ./release-to-host.sh 0.1.28 132342b
#
# 可选环境变量：
#   SSH_KEY        私钥路径（默认交给 ssh-agent / ~/.ssh/config）
#   NEW_PORT       新实例端口，默认 18822
#   CURRENT        当前承载流量的容器名，用于发布脚本的前置检查
#   SKIP_BUILD=1   源码已经在服务器上时跳过上传
set -Eeuo pipefail

VERSION="${1:?usage: release-to-host.sh <version> <commit>}"
COMMIT="${2:?usage: release-to-host.sh <version> <commit>}"

: "${HOST:?set HOST, e.g. root@154.36.187.147}"
NEW_PORT="${NEW_PORT:-18822}"
CURRENT="${CURRENT:-zhijing-api-v0127-stable}"
IMAGE="ghcr.io/daniei-chen/zhijing-gateway:${VERSION}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REMOTE_ROOT="/root/zhijing-build-${VERSION}"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zhijing-release.XXXXXX")"
trap 'rm -rf "${WORK_DIR}"' EXIT

SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
if [[ -n "${SSH_KEY:-}" ]]; then
    SSH_OPTS+=(-i "${SSH_KEY}")
fi

log() { printf '\n== %s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

ssh_run() { ssh "${SSH_OPTS[@]}" "$HOST" "$@"; }

# 0) 通道自检。SSH 不通时立刻停下，别把后面的步骤跑成一堆超时。
log "checking ssh to ${HOST}"
ssh_run 'echo ssh-ok; hostname' || die "ssh unreachable — 先确认 sshd 是否在响应（见 deploy/ops/README.md）"

log "checking remote prerequisites"
ssh_run 'command -v docker >/dev/null && docker version --format "{{.Server.Version}}" >/dev/null' \
    || die "docker unavailable on ${HOST}"

# 1) 打包。用 git archive 而不是 tar 工作区，保证上传的内容与 commit 完全一致，
#    不会把一个还没提交的改动带上线。
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
    log "packing ${VERSION} (${COMMIT})"
    ( cd "${REPO_ROOT}" && git archive --format=tar.gz \
        --prefix="zhijing-gateway-${VERSION}/" -o "${WORK_DIR}/src.tgz" "${COMMIT}" )

    log "uploading to ${REMOTE_ROOT}"
    ssh_run "rm -rf '${REMOTE_ROOT}' && mkdir -p '${REMOTE_ROOT}'"
    scp "${SSH_OPTS[@]}" "${WORK_DIR}/src.tgz" "${HOST}:${REMOTE_ROOT}/src.tgz"
    ssh_run "tar -xzf '${REMOTE_ROOT}/src.tgz' -C '${REMOTE_ROOT}'"
fi

# 2) 构建镜像。内网拉不到模块时用国内代理，这点在这台机器上验证过。
log "building ${IMAGE}"
ssh_run "cd '${REMOTE_ROOT}/zhijing-gateway-${VERSION}/backend' && \
    BUILD_DATE=\$(date -u +%Y-%m-%dT%H:%M:%SZ) && \
    DOCKER_BUILDKIT=1 GOPROXY=https://goproxy.cn,direct docker build \
        --build-arg VERSION='${VERSION}' \
        --build-arg COMMIT='${COMMIT}' \
        --build-arg DATE=\"\$BUILD_DATE\" \
        -t '${IMAGE}' ."

# 3) 发布。注意 STOP_TIMEOUT_SECONDS 要大于应用的 SHUTDOWN_TIMEOUT_SECONDS，
#    否则还在排空的实例会先被 SIGKILL 掐掉（v0.1.28 起才有这个变量）。
log "deploying to port ${NEW_PORT}"
ssh_run "IMAGE='${IMAGE}' \
    CURRENT_CONTAINER='${CURRENT}' \
    NEW_CONTAINER='zhijing-api-${VERSION//./}-final' \
    NEW_PORT='${NEW_PORT}' \
    STOP_TIMEOUT_SECONDS='${STOP_TIMEOUT_SECONDS:-35}' \
    bash /root/zhijing-zero-downtime-deploy.sh"

# 4) 验证。版本号必须能在 /version 或 /readyz 上读到，5xx 归零不能只看一眼。
log "verifying"
ssh_run "curl -s -o /dev/null -w 'readyz=%{http_code}\n' -m 10 'http://127.0.0.1:${NEW_PORT}/readyz'"
ssh_run "docker ps --filter name=zhijing-api-${VERSION//./}-final --format '{{.Names}} {{.Status}}'"

printf '\nDone. 下一步手工确认（脚本不替你做判断）：\n'
printf '  1) 长流排空：在第 5 秒 docker stop 旧实例，流必须继续到 [DONE]\n'
printf '  2) 切 nginx 权重，观察 5xx 与延迟\n'
printf '  3) 保留至少一个旧实例作为回滚\n'
