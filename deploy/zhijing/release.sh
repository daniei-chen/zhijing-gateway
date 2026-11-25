#!/bin/bash
# 发布入口：只给一个版本号，其余全部推导出来。
#
# 为什么要有这个脚本：以前每次发布都是手写一份 run-release.sh，靠 sed 替换上一版。
# 2026-11-25 那轮就栽在这上面 —— sed 只替换了目录名，没替换探针日志里的版本段，
# 结果这一轮的探针数据写进了上一轮的文件名。手写 + 字符串替换这套做法，
# 错一次不会有任何报错，只会让证据对不上号。
#
# 现在改成：版本号是唯一输入，镜像名、容器名、端口、当前主实例、
# 探针文件名全部推导。推导完先打印出来（--dry-run），确认无误再动手。
#
# 用法：
#   ./release.sh 0.1.41 --dry-run     # 只推导并体检，不动任何东西
#   ./release.sh 0.1.41               # 真实发布
set -uo pipefail

VERSION="${1:?usage: release.sh <version> [--dry-run]}"
DRY_RUN=0
for arg in "${@:2}"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HERE/zero-downtime-deploy.sh"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/zhijing.kaogong.art}"
IMAGE="ghcr.io/daniei-chen/zhijing-gateway:$VERSION"
# 0.1.41 -> v0141：容器名里只留数字，避免出现点号
CONTAINER_TAG="v$(echo "$VERSION" | tr -cd '0-9')"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -x "$DEPLOY" ] || [ -f "$DEPLOY" ] || fail "missing deploy script: $DEPLOY"
[ -f "$NGINX_SITE" ] || fail "missing nginx site file: $NGINX_SITE"

# ---- 从 nginx 读当前主实例 -------------------------------------------------
# 主实例 = peers 块里第一条没有 backup 标记的 server 行
PRIMARY_PORT="$(awk '/zhijing-peers-begin/,/zhijing-peers-end/' "$NGINX_SITE" \
  | grep -E 'server 127\.0\.0\.1:' | grep -v 'backup' | head -1 \
  | sed -E 's/.*127\.0\.0\.1:([0-9]+).*/\1/')"
[ -n "${PRIMARY_PORT:-}" ] || fail "cannot read the primary port from $NGINX_SITE"

CURRENT_CONTAINER="$(docker ps --format '{{.Names}} {{.Ports}}' \
  | awk -v p=":$PRIMARY_PORT->" 'index($0, p) {print $1; exit}')"
[ -n "${CURRENT_CONTAINER:-}" ] || fail "no running container publishes $PRIMARY_PORT"

# ---- 选一个空闲端口 --------------------------------------------------------
# 取所有网关实例用过的最高端口 +1，再确认它真的空着
HIGHEST_PORT="$(docker ps -a --format '{{.Names}} {{.Ports}}' \
  | grep '^zhijing-api' | grep -oE '127\.0\.0\.1:18[0-9]{3}' \
  | grep -oE '18[0-9]{3}' | sort -n | tail -1)"
NEW_PORT=$(( ${HIGHEST_PORT:-18800} + 1 ))
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ss -lnt 2>/dev/null | grep -q ":$NEW_PORT "; then
    NEW_PORT=$((NEW_PORT + 1))
  else
    break
  fi
done
ss -lnt 2>/dev/null | grep -q ":$NEW_PORT " && fail "no free port found near $NEW_PORT"

NEW_CONTAINER="zhijing-api-${CONTAINER_TAG}-stable"
if docker ps -a --format '{{.Names}}' | grep -qx "$NEW_CONTAINER"; then
  fail "container $NEW_CONTAINER already exists; stop or remove it first"
fi

PROBE_TAG="${CONTAINER_TAG}"
TRAFFIC_LOG="/root/rollout-traffic-${PROBE_TAG}.log"
STREAM_LOG="/root/rollout-stream-${PROBE_TAG}.log"

# ---- 打印推导结果 ----------------------------------------------------------
cat <<EOF
release plan
  version           $VERSION
  image             $IMAGE
  primary now       $CURRENT_CONTAINER (port $PRIMARY_PORT)
  candidate         $NEW_CONTAINER (port $NEW_PORT)
  traffic probe log $TRAFFIC_LOG
  stream probe log  $STREAM_LOG
EOF

# ---- 体检 ------------------------------------------------------------------
echo "preflight"
docker image inspect "$IMAGE" >/dev/null 2>&1 \
  && echo "  image          present" \
  || { [ "$DRY_RUN" = "1" ] && echo "  image          NOT PULLED YET (dry-run continues)" || fail "image $IMAGE is not present; docker pull it first"; }
curl -sf -m 5 -o /dev/null "http://127.0.0.1:$PRIMARY_PORT/health" \
  && echo "  primary health ok" || fail "primary $PRIMARY_PORT is not healthy right now"
awk '/zhijing-peers-begin/,/zhijing-peers-end/' "$NGINX_SITE" | grep -c 'server 127\.0\.0\.1:' | sed 's/^/  peers in block /'

if [ "$DRY_RUN" = "1" ]; then
  echo "dry-run: nothing was changed"
  exit 0
fi

# ---- 真实发布 --------------------------------------------------------------
LOG="/root/release-${CONTAINER_TAG}.log"
: > "$LOG"
exec >>"$LOG" 2>&1
echo "=== release start $(date -u +%FT%TZ) ==="
echo "plan: version=$VERSION image=$IMAGE current=$CURRENT_CONTAINER new=$NEW_CONTAINER port=$NEW_PORT"

nohup /root/rollout-traffic-probe.sh 420 2 "$TRAFFIC_LOG" >/dev/null 2>&1 &
TPID=$!
nohup /root/rollout-stream-probe.sh "$STREAM_LOG" 3 >/dev/null 2>&1 &
SPID=$!
sleep 3

export IMAGE
export CURRENT_CONTAINER NEW_CONTAINER NEW_PORT NGINX_SITE
export KEEP_BACKUPS="${KEEP_BACKUPS:-2}"
export PRUNE_STOPPED="${PRUNE_STOPPED:-1}"
export OBSERVE_SECONDS="${OBSERVE_SECONDS:-180}"
export OBSERVE_STEP_SECONDS="${OBSERVE_STEP_SECONDS:-15}"
export MAX_NEW_5XX="${MAX_NEW_5XX:-10}"
export MAX_NEW_PLATFORM_5XX="${MAX_NEW_PLATFORM_5XX:-0}"
export MAX_NEW_STREAM_5XX="${MAX_NEW_STREAM_5XX:-30}"
export STOP_TIMEOUT_SECONDS="${STOP_TIMEOUT_SECONDS:-10}"

bash "$DEPLOY"
rc=$?

echo "=== deploy exit=$rc $(date -u +%FT%TZ) ==="
wait $TPID $SPID
echo "=== probes done $(date -u +%FT%TZ) ==="
echo "--- traffic ---"
[ -f "$TRAFFIC_LOG" ] && awk '{print $2}' "$TRAFFIC_LOG" | sort | uniq -c
echo "--- stream complete rounds ---"
[ -f "$STREAM_LOG" ] && grep -c 'saw_done=yes' "$STREAM_LOG"
echo "--- peers ---"
awk '/zhijing-peers-begin/,/zhijing-peers-end/' "$NGINX_SITE"
echo "--- running ---"
docker ps --format '{{.Names}} {{.Ports}}' | grep '^zhijing-api'
echo "--- release endpoint ---"
curl -s -m 8 "http://127.0.0.1:$NEW_PORT/api/release"
echo
echo "log: $LOG"
exit $rc
