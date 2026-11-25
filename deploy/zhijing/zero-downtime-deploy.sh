#!/usr/bin/env bash
set -Eeuo pipefail

: "${IMAGE:?set IMAGE to the immutable release image}"

CURRENT_CONTAINER="${CURRENT_CONTAINER:-zhijing-api-v010-u3-canary}"
NEW_CONTAINER="${NEW_CONTAINER:-zhijing-api-candidate}"
NEW_PORT="${NEW_PORT:-18798}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/zhijing.kaogong.art}"
PUBLIC_HOST="${PUBLIC_HOST:-zhijing.kaogong.art}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-180}"
MEMORY_LIMIT="${MEMORY_LIMIT:-768m}"
PIDS_LIMIT="${PIDS_LIMIT:-256}"
# 2026-11-14：compose 里声明的 cpus: 1.50 在手工 docker run 下从来没有生效
# （v0.1.4/v0.1.5 实测 CpuQuota/CpuPeriod/NanoCpus 全为 0）。这里显式带上，
# 让候选实例与 compose 声明一致；--cpus 与 NanoCpus 等价，会同时设置 quota/period。
CPU_LIMIT="${CPU_LIMIT:-1.5}"
# docker stop 等实例自行退出的秒数。应用中 SHUTDOWN_TIMEOUT_SECONDS 必须比它小，
# 否则还在排空的实例会先被 SIGKILL 掐掉，那段排空等于没做。
STOP_TIMEOUT_SECONDS="${STOP_TIMEOUT_SECONDS:-10}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is required"
command -v curl >/dev/null || die "curl is required"
command -v nginx >/dev/null || die "nginx is required"
test -r "$NGINX_SITE" || die "Nginx site not found: $NGINX_SITE"
docker inspect "$CURRENT_CONTAINER" >/dev/null 2>&1 || die "current container not found: $CURRENT_CONTAINER"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
env_file=$(mktemp "/run/zhijing-release-env.XXXXXX")
nginx_backup="/root/zhijing-nginx-$(basename "$NGINX_SITE").bak-${timestamp}"
candidate_started=false
cleanup() {
  rm -f "$env_file"
}
rollback() {
  if test -f "$nginx_backup"; then
    cp --preserve=mode,ownership,timestamps "$nginx_backup" "$NGINX_SITE"
    nginx -t && systemctl reload nginx || true
  fi
  if [[ "$candidate_started" == true ]]; then
    docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap rollback ERR

umask 077
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CURRENT_CONTAINER" \
  | awk '!/^ZHIJING_API_ONLY=/' >"$env_file"

# 2026-11-14：候选实例的环境变量来自「当前容器」，而容器 env 在启动时即固化，
# 所以想新增/覆盖某个变量（例如动态并发的 GATEWAY_MEMBER_CONCURRENCY_LIMIT_PEAK）
# 无法靠改数据库或改宿主机文件实现。这里留一个显式入口：
#   EXTRA_ENV="KEY=VALUE" 或多个 KEY=VALUE 用空格分隔
# 每一行都会追加到临时 env 文件；同名变量后写覆盖前写（docker --env-file 语义）。
if [[ -n "${EXTRA_ENV:-}" ]]; then
  for pair in $EXTRA_ENV; do
    key=${pair%%=*}
    [[ "$key" =~ ^[A-Z0-9_]+$ ]] || die "EXTRA_ENV key is not a valid env name: $key"
    printf '%s\n' "$pair" >>"$env_file"
  done
fi

data_type=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}{{end}}{{end}}' "$CURRENT_CONTAINER")
data_source=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$CURRENT_CONTAINER")
[[ "$data_type" == bind || "$data_type" == volume ]] || die "unsupported /app/data mount type: $data_type"
test -n "$data_source" || die "current container has no /app/data mount"

# 2026-11-25：docker run 不允许同时 attach 内置网络与用户自定义网络
# （实测报 "cannot attach both user-defined and non-user-defined network-modes"，exit 125）。
# 运行实例同时连着内置 bridge（用于出网）与 internal 的用户自定义网络（用于连库/Redis），
# 旧逻辑把两者都塞进 --network，发布在启动候选容器这一步就失败 —— 0.1.28/0.1.29 因此
# 一直没能上线。现在内置网络交给 docker 的默认行为（或 --network host），
# 用户自定义网络在容器启动后逐个 connect。
builtin_network() {
  case "$1" in
    bridge|host|none) return 0 ;;
    *) return 1 ;;
  esac
}
mapfile -t networks < <(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$CURRENT_CONTAINER" | awk 'NF')
test "${#networks[@]}" -gt 0 || die "current container has no Docker network"
use_host_network=false
for network in "${networks[@]}"; do
  if [[ "$network" == "host" ]]; then
    use_host_network=true
  fi
done

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf 'image: using verified local image %s\n' "$IMAGE"
else
  docker pull "$IMAGE"
fi
docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true

run_args=(
  --name "$NEW_CONTAINER"
  --restart unless-stopped
  --stop-timeout "$STOP_TIMEOUT_SECONDS"
  --env-file "$env_file"
  --publish "127.0.0.1:${NEW_PORT}:8080"
  --mount "type=${data_type},src=${data_source},dst=/app/data"
  --user 1000:1000
  --read-only
  --cap-drop ALL
  --security-opt no-new-privileges:true
  --pids-limit "$PIDS_LIMIT"
  --memory "$MEMORY_LIMIT"
  --cpus "$CPU_LIMIT"
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m
  --label "org.opencontainers.image.ref.name=${IMAGE}"
)
if [[ "$use_host_network" == true ]]; then
  run_args+=(--network host)
fi
docker create "${run_args[@]}" "$IMAGE" >/dev/null
candidate_started=true
for network in "${networks[@]}"; do
  builtin_network "$network" && continue
  docker network connect "$network" "$NEW_CONTAINER"
done
# 先建容器、把网络接好、再启动（2026-11-26 第 27 轮）。
#
# 之前是 `docker run --detach` 之后才 connect 数据库网络：内置 DNS 在
# 用户自定义网络生效前解析不了 postgres，第一次启动必然报
# `lookup postgres on 127.0.0.11:53: connection refused` 然后退出，
# 靠 --restart 兜底重启一次才好。能跑起来，但 RestartCount 变成 1，
# 后面「state 必须是 running 0 false」的检查就把它判成不安全，整次发布
# 直接拒绝切流量（0.1.30 第一次部署就是这样失败的）。
# docker create → connect → start 让第一个进程看到的就是完整网络。
docker start "$NEW_CONTAINER" >/dev/null

deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
ready=false
while (( SECONDS < deadline )); do
  if curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${NEW_PORT}/readyz" >/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]] || die "candidate did not become ready within ${HEALTH_TIMEOUT_SECONDS}s"

candidate_state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}}' "$NEW_CONTAINER")
case "$candidate_state" in
  "running 0 false") ;;
  *) die "candidate state is unsafe (${candidate_state}); refusing to switch traffic" ;;
esac

if [[ "${CHECK_CANDIDATE_LOGS:-1}" == "1" ]]; then
  candidate_fatal_logs=$(docker logs "$NEW_CONTAINER" 2>&1 | grep -E \
    '(^|[[:space:]])(panic:|fatal error:|FATAL|PANIC)|\tpanic:' || true)
  if [[ -n "$candidate_fatal_logs" ]]; then
    printf 'ERROR: candidate logged fatal startup errors:\n%s\n' "$candidate_fatal_logs" >&2
    die "candidate startup logs contain panic/fatal errors; refusing to switch traffic"
  fi
fi

# 业务就绪（2026-11-15）：/readyz 只证明 database/Redis 可用，不证明账号池已构建。
# 2026-11-14 19:10 就是这样：探针全绿、账号 active，但 API Key 指向已删除的分组，
# 调度池为空，用户请求全部 503。v0.1.12 起 /readyz?deep=1 会回答这个问题。
#
# 向后兼容：旧镜像不认识 deep 参数，会忽略它并正常返回 200，所以对回滚部署无害。
# 全环境变量可关：DEEP_READY_CHECK=0。
DEEP_READY_CHECK="${DEEP_READY_CHECK:-1}"
if [[ "$DEEP_READY_CHECK" == "1" ]]; then
  if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${NEW_PORT}/readyz?deep=1" >/dev/null; then
    printf 'candidate: business readiness ok (deep probe)\n'
  else
    die "candidate has no schedulable account (readyz?deep=1 rejected); not switching traffic"
  fi
fi

if [[ "${CHECK_CANDIDATE_FRONTEND:-1}" == "1" ]]; then
  candidate_login=$(curl --fail --silent --show-error --max-time 10 \
    "http://127.0.0.1:${NEW_PORT}/login" || true)
  [[ "$candidate_login" == *'<div id="app"></div>'* ]] || \
    die "candidate frontend /login is missing or incomplete; refusing to switch traffic"
  printf 'candidate: embedded frontend smoke ok\n'
fi

old_port=$(nginx -T 2>/dev/null | awk '
  /upstream zhijing_api[[:space:]]*\{/ {inside=1; next}
  inside && /server 127\.0\.0\.1:[0-9]+ weight=/ {
    line=$0
    sub(/^.*127\.0\.0\.1:/, "", line)
    sub(/[^0-9].*$/, "", line)
    print line
    exit
  }
  inside && /^}/ {inside=0}
')
test -n "$old_port" || die "cannot determine current Nginx primary"
[[ "$old_port" != "$NEW_PORT" ]] || die "candidate port is already the current primary"

cp --preserve=mode,ownership,timestamps "$NGINX_SITE" "$nginx_backup"
tmp_site=$(mktemp "/tmp/zhijing-nginx.XXXXXX")
awk -v new_port="$NEW_PORT" -v old_port="$old_port" '
  /# ---- zhijing-peers-begin ----/ {
    print
    print "    server 127.0.0.1:" new_port " weight=100 max_fails=1 fail_timeout=10s; # candidate"
    print "    server 127.0.0.1:" old_port " backup; # rollback"
    inside=1
    next
  }
  /# ---- zhijing-peers-end ----/ { inside=0; print; next }
  inside && (index($0, "127.0.0.1:" new_port) || index($0, "127.0.0.1:" old_port)) { next }
  { print }
' "$NGINX_SITE" >"$tmp_site"
chown --reference="$NGINX_SITE" "$tmp_site"
chmod --reference="$NGINX_SITE" "$tmp_site"
mv "$tmp_site" "$NGINX_SITE"

switch_ts=$(date -u +"%Y-%m-%d %H:%M:%S.%6N+00")
nginx -t
systemctl reload nginx

curl --http1.1 --fail --silent --show-error --max-time 10 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
  "https://${PUBLIC_HOST}/readyz" >/dev/null
for _ in 1 2 3 4 5; do
  curl --http1.1 --fail --silent --show-error --max-time 10 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
    "https://${PUBLIC_HOST}/readyz" >/dev/null
done

# ── 切换后版本自证（2026-11-26 第 28 轮）─────────────────────────────
# 切流量成功不等于「用户拿到的是新版本」：反代缓存、upstream 里残留的旧实例、
# 端口写错，都会让 /readyz 全绿而实际仍在跑旧代码。0.1.30 起每个实例都能通过
# /api/release 自报版本，这里用它做闭环 —— 版本对不上直接回滚，
# 而不是等用户或几天后的对账来发现。
EXPECTED_VERSION="${EXPECTED_VERSION:-${IMAGE##*:}}"
EXPECTED_VERSION="${EXPECTED_VERSION#v}"
release_tmp=$(mktemp)
release_code=$(curl -o "$release_tmp" -w '%{http_code}' --silent --max-time 10 \
  "http://127.0.0.1:${NEW_PORT}/api/release" || true)
candidate_version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$release_tmp" 2>/dev/null || true)
rm -f "$release_tmp"
case "${release_code:-000}" in
  200)
    [[ -n "$candidate_version" ]] || die "candidate /api/release returned no version field"
    [[ "$candidate_version" == "$EXPECTED_VERSION" ]] || \
      die "candidate reports version ${candidate_version}, image tag says ${EXPECTED_VERSION}"
    printf 'candidate: /api/release reports %s (matches image tag)\n' "$candidate_version"
    ;;
  404)
    printf 'candidate: /api/release unavailable (build older than 0.1.30); skipping self-check\n'
    ;;
  *)
    die "candidate /api/release returned HTTP ${release_code:-000}"
    ;;
esac

# 公网入口也必须落到同一个构建：只验本机端口会漏掉
# 「nginx 切了但 upstream 仍命中旧实例」这类情况。
public_tmp=$(mktemp)
public_code=$(curl -o "$public_tmp" -w '%{http_code}' --http1.1 --silent --max-time 10 \
  --resolve "${PUBLIC_HOST}:443:127.0.0.1" "https://${PUBLIC_HOST}/api/release" || true)
public_version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$public_tmp" 2>/dev/null || true)
rm -f "$public_tmp"
if [[ "${public_code:-000}" == "200" && -n "$public_version" && "$public_version" != "$EXPECTED_VERSION" ]]; then
  die "public /api/release reports ${public_version}, expected ${EXPECTED_VERSION}"
fi
printf 'public: /api/release reports %s (http %s)\n' "${public_version:-unknown}" "${public_code:-000}"

# ── 切换后业务观察窗口 ───────────────────────────────────────────────
# /readyz 只证明依赖可用，不证明业务成功。v0.1.7 曾出现探针全绿、切换后
# 6 分钟内 27 个 5xx；流式请求还可能 HTTP 200 但上游 5xx。这里同时观察：
#   1. HTTP 5xx
#   2. 非 provider 归属的 5xx（部署/网关自身故障）
#   3. 已返回 200 但流内上游 5xx
# 任一项越界或查询失败，立即恢复 Nginx 并保留候选容器供检查。
PG_CONTAINER="${PG_CONTAINER:-zhijing-sub2api-japan-postgres-1}"
PG_USER="${PG_USER:-zhijing_trial}"
PG_DB="${PG_DB:-zhijing_trial}"
OBSERVE_SECONDS="${OBSERVE_SECONDS:-180}"
OBSERVE_STEP_SECONDS="${OBSERVE_STEP_SECONDS:-15}"
MAX_NEW_5XX="${MAX_NEW_5XX:-10}"
MAX_NEW_PLATFORM_5XX="${MAX_NEW_PLATFORM_5XX:-0}"
MAX_NEW_STREAM_5XX="${MAX_NEW_STREAM_5XX:-30}"

count_release_failures_since() {
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -Atc \
    "select count(*) filter (where status_code >= 500)
          || '|' || count(*) filter (where status_code >= 500 and coalesce(error_owner, '') <> 'provider')
          || '|' || count(*) filter (where status_code < 500 and upstream_status_code >= 500)
     from ops_error_logs where created_at >= timestamptz '$1'" \
    2>/dev/null | tr -d '[:space:]'
}

if [ "$OBSERVE_SECONDS" -gt 0 ]; then
  docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || die "observe database container unavailable; cannot verify release safely"
  printf 'observe: watching %ss in %ss intervals (max total=%s platform=%s stream=%s)\n' \
    "$OBSERVE_SECONDS" "$OBSERVE_STEP_SECONDS" "$MAX_NEW_5XX" "$MAX_NEW_PLATFORM_5XX" "$MAX_NEW_STREAM_5XX"
  elapsed=0
  while (( elapsed < OBSERVE_SECONDS )); do
    sleep_for=$OBSERVE_STEP_SECONDS
    if (( elapsed + sleep_for > OBSERVE_SECONDS )); then
      sleep_for=$((OBSERVE_SECONDS - elapsed))
    fi
    sleep "$sleep_for"
    elapsed=$((elapsed + sleep_for))

    counts=$(count_release_failures_since "$switch_ts") || die "cannot query release health metrics"
    [[ "$counts" =~ ^[0-9]+\|[0-9]+\|[0-9]+$ ]] || die "invalid release health metrics: $counts"
    IFS='|' read -r total_5xx platform_5xx stream_5xx <<< "$counts"
    printf 'observe: elapsed=%ss total_5xx=%s platform_5xx=%s stream_5xx=%s\n' \
      "$elapsed" "$total_5xx" "$platform_5xx" "$stream_5xx"
    if (( total_5xx > MAX_NEW_5XX || platform_5xx > MAX_NEW_PLATFORM_5XX || stream_5xx > MAX_NEW_STREAM_5XX )); then
      cp --preserve=mode,ownership,timestamps "$nginx_backup" "$NGINX_SITE"
      nginx -t && systemctl reload nginx || true
      trap - ERR
      printf 'ROLLED BACK: release health exceeded limits within %ss; upstream restored to port %s\n' \
        "$elapsed" "$old_port"
      printf 'candidate kept for inspection: %s (port %s)\n' "$NEW_CONTAINER" "$NEW_PORT"
      exit 1
    fi
    candidate_state=$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}}' "$NEW_CONTAINER")
    case "$candidate_state" in
      "running 0 false") ;;
      *)
        cp --preserve=mode,ownership,timestamps "$nginx_backup" "$NGINX_SITE"
        nginx -t && systemctl reload nginx || true
        trap - ERR
        printf 'ROLLED BACK: candidate state became unsafe (%s); upstream restored to port %s\n' \
          "$candidate_state" "$old_port"
        exit 1
        ;;
    esac
  done
else
  printf 'observe: WARNING disabled by OBSERVE_SECONDS=0; release must be verified manually\n'
fi

trap - ERR
printf 'release_ready image=%s candidate=%s old_primary_port=%s nginx_backup=%s\n' \
  "$IMAGE" "$NEW_CONTAINER" "$old_port" "$nginx_backup"
