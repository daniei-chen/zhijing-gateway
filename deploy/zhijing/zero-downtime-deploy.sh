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

mapfile -t networks < <(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$CURRENT_CONTAINER" | awk 'NF')
test "${#networks[@]}" -gt 0 || die "current container has no Docker network"

if docker image inspect "$IMAGE" >/dev/null 2>&1; then
  printf 'image: using verified local image %s\n' "$IMAGE"
else
  docker pull "$IMAGE"
fi
docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true

run_args=(
  --detach
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
for network in "${networks[@]}"; do
  run_args+=(--network "$network")
done
docker run "${run_args[@]}" "$IMAGE" >/dev/null
candidate_started=true

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
