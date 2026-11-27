#!/usr/bin/env bash
set -Eeuo pipefail

: "${IMAGE:?set IMAGE to the immutable release image}"

CURRENT_CONTAINER="${CURRENT_CONTAINER:-zhijing-api-v010-u3-canary}"
NEW_CONTAINER="${NEW_CONTAINER:-zhijing-api-candidate}"
NEW_PORT="${NEW_PORT:-18798}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-enabled/zhijing.kaogong.art}"
PUBLIC_HOST="${PUBLIC_HOST:-154-36-187-147.sslip.io}"
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
  # 回滚同样要能自证（2026-11-26 第 29 轮）：只恢复 nginx 配置不等于「用户又回到旧实例」。
  # 这里不判失败——trap 里再 die 会盖住原始错误；只把公网当前构建打出来，
  # 让人一眼看到回滚落到了哪个版本。
  local back
  back=$(curl --http1.1 --silent --max-time 8 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
    "https://${PUBLIC_HOST}/api/release" 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' || true)
  printf 'ROLLBACK: public /api/release now reports %s\n' "${back:-unknown}" >&2
}
# 切流量之后才发现的问题（观察窗口越界、安全检查不通过）：恢复上一版 upstream，
# 候选实例保留供排查，然后退出。与 ERR trap 里的 rollback() 不同，这里不删候选。
restore_previous_upstream() {
  cp --preserve=mode,ownership,timestamps "$nginx_backup" "$NGINX_SITE"
  nginx -t && systemctl reload nginx || true
  trap - ERR
  printf 'ROLLED BACK: %s; upstream restored to port %s\n' "$1" "${old_port:-unknown}"
  printf 'candidate kept for inspection: %s (port %s)\n' "$NEW_CONTAINER" "$NEW_PORT"
  exit 1
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
# backup 列表只增不减（2026-11-26 第 30 轮）：每次发布都往 upstream 里加一条 backup，
# 旧的从不停用，列表就一直变长 —— 清点过 10 条 server 里有 6 条属于一周前的构建。
# 它们平时不接流量，但主实例一旦失败，nginx 会按顺序去连这些死条目，每次都要等
# fail_timeout 才轮到下一条。这里在切换的同一次重写里把列表收敛到
# 「主 + 上一版 + (KEEP_BACKUPS-1) 条」，sibling pipeline 不动。
KEEP_BACKUPS="${KEEP_BACKUPS:-2}"
prune_report=$(mktemp "/tmp/zhijing-prune.XXXXXX")
tmp_site=$(mktemp "/tmp/zhijing-nginx.XXXXXX")
awk -v new_port="$NEW_PORT" -v old_port="$old_port" -v keep="$KEEP_BACKUPS" -v report="$prune_report" '
  /# ---- zhijing-peers-begin ----/ {
    print
    print "    server 127.0.0.1:" new_port " weight=100 max_fails=1 fail_timeout=10s; # candidate"
    print "    server 127.0.0.1:" old_port " backup; # rollback"
    inside=1
    kept=0
    next
  }
  /# ---- zhijing-peers-end ----/ { inside=0; print; next }
  inside {
    if (index($0, "127.0.0.1:" new_port)) next
    if (index($0, "127.0.0.1:" old_port)) next
    # sibling pipeline 是另一条发布管线，永远不碰
    if ($0 ~ /sibling pipeline/) { print; next }
    if ($0 ~ /server 127\.0\.0\.1:/) {
      if (kept < keep - 1) { print; kept++; next }
      line=$0
      sub(/^.*127\.0\.0\.1:/, "", line)
      sub(/[^0-9].*$/, "", line)
      dropped = dropped " " line
      next
    }
    print
    next
  }
  { print }
  END { printf "%s\n", dropped > report }
' "$NGINX_SITE" >"$tmp_site"
pruned_ports=$(tr -s ' ' < "$prune_report" | sed 's/^ //; s/ $//')
rm -f "$prune_report"
if [[ -n "$pruned_ports" ]]; then
  printf 'pruned from upstream: %s (containers left running; stop them once you no longer need the rollback)\n' "$pruned_ports"
fi
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

# ── 切换后构建自证（2026-11-26 第 28 轮，第 29 轮升级到 commit 级）────
# 切流量成功不等于「用户拿到的是新版本」：反代缓存、upstream 里残留的旧实例、
# 端口写错，都会让 /readyz 全绿而实际仍在跑旧代码。每个实例都能通过
# /api/release 自报版本与提交号，这里用它做闭环 —— 对不上直接回滚。
#
# 只比版本号不够：同一个版本号可能被重建过（比如热修），那时镜像标签相同、
# 代码不同。镜像自带的 OCI label 里有 revision，用它比 commit 才是真的构建自证。
image_version=$(docker image inspect "$IMAGE" \
  -f '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>/dev/null || true)
image_revision=$(docker image inspect "$IMAGE" \
  -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)
EXPECTED_VERSION="${EXPECTED_VERSION:-${image_version:-${IMAGE##*:}}}"
EXPECTED_VERSION="${EXPECTED_VERSION#v}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-${image_revision:-}}"
if [[ -n "$EXPECTED_COMMIT" ]]; then
  EXPECTED_COMMIT="${EXPECTED_COMMIT:0:12}"   # 截到 12 位，兼容短 sha
fi
release_tmp=$(mktemp)
release_code=$(curl -o "$release_tmp" -w '%{http_code}' --silent --max-time 10 \
  "http://127.0.0.1:${NEW_PORT}/api/release" || true)
candidate_version=$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$release_tmp" 2>/dev/null || true)
candidate_commit=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$release_tmp" 2>/dev/null || true)
rm -f "$release_tmp"
case "${release_code:-000}" in
  200)
    [[ -n "$candidate_version" ]] || die "candidate /api/release returned no version field"
    [[ "$candidate_version" == "$EXPECTED_VERSION" ]] || \
      die "candidate reports version ${candidate_version}, image says ${EXPECTED_VERSION}"
    if [[ -n "$EXPECTED_COMMIT" && "${candidate_commit:0:12}" != "$EXPECTED_COMMIT" ]]; then
      die "candidate reports commit ${candidate_commit:-<empty>}, image label says ${EXPECTED_COMMIT}"
    fi
    printf 'candidate: /api/release reports %s @ %s (matches image label)\n' \
      "$candidate_version" "${candidate_commit:0:12}"
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
public_commit=$(sed -n 's/.*"commit":"\([^"]*\)".*/\1/p' "$public_tmp" 2>/dev/null || true)
rm -f "$public_tmp"
if [[ "${public_code:-000}" == "200" && -n "$public_version" && "$public_version" != "$EXPECTED_VERSION" ]]; then
  die "public /api/release reports ${public_version}, expected ${EXPECTED_VERSION}"
fi
if [[ "${public_code:-000}" == "200" && -n "$EXPECTED_COMMIT" && "${public_commit:0:12}" != "$EXPECTED_COMMIT" ]]; then
  die "public /api/release reports commit ${public_commit:-<empty>}, expected ${EXPECTED_COMMIT}"
fi
printf 'public: /api/release reports %s @ %s (http %s)\n' \
  "${public_version:-unknown}" "${public_commit:0:12}" "${public_code:-000}"

# ── 源站敏感端点拒绝清单的部署自证（可选，VERIFY_SENSITIVE_ENDPOINTS=1）──
# /api/v1/admin/system/update 目前唯一的拦截是源站 nginx 的 403，而那份站点
# 配置不入仓（deploy/zhijing/README.md）。拒绝清单模板在
# deploy/zhijing/nginx/zhijing.origin.deny.conf。打开这个开关，发布时会逐条探测，
# 任何一条不是 403 就判这次发布失败并回切 upstream —— 否则「清单没同步」看起来和
# 发布成功一模一样。这里不能用 `|| die`：切换已完成，直接退出会把新 upstream 留在
# 生产上（rollback 只挂在 ERR 上，显式 exit 不触发它）。
# 默认关闭：这一步依赖源站 nginx 已经带上模板。
if [[ "${VERIFY_SENSITIVE_ENDPOINTS:-0}" == "1" ]]; then
  verify_script="${VERIFY_SENSITIVE_ENDPOINTS_SCRIPT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/verify-sensitive-endpoints.sh}"
  if [[ ! -f "$verify_script" ]]; then
    restore_previous_upstream "sensitive endpoint verifier not found: $verify_script"
  fi
  if ! bash "$verify_script" --base-url "https://${PUBLIC_HOST}" \
      --resolve "${PUBLIC_HOST}:443:127.0.0.1"; then
    restore_previous_upstream "sensitive endpoints did not answer 403; the origin nginx deny list is missing or stale"
  fi
  printf 'sensitive endpoints: origin returns 403 on every deny-list path\n'
fi

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

# ── 部署窗口的流量与失败数（2026-11-26 第 33 轮）──────────────────────
# 规范里有一条：说「零 5xx」时必须同时给出窗口内请求数，不许把「没机会出错」当成
# 「没出错」。这个数字以前靠人手工查库 —— 容易忘，也容易把窗口边界算错。
# 让脚本自己算、自己打印，附带一条：窗口内根本没流量时明确说出来，
# 那时的 0 不能拿来当连续性证据。
summarize_deploy_window() {
  docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -Atc \
    "select (select count(*) from usage_logs
               where created_at between timestamptz '$1' - interval '15 seconds'
                                     and timestamptz '$1' + interval '15 seconds')
          || '|' || (select count(*) from ops_error_logs
               where created_at between timestamptz '$1' - interval '15 seconds'
                                     and timestamptz '$1' + interval '15 seconds')
          || '|' || (select count(*) from ops_error_logs
               where created_at between timestamptz '$1' - interval '15 seconds'
                                     and timestamptz '$1' + interval '15 seconds'
                 and status_code >= 500)" \
    2>/dev/null | tr -d '[:space:]'
}

window_counts=$(summarize_deploy_window "$switch_ts" || true)
if [[ "$window_counts" =~ ^[0-9]+\|[0-9]+\|[0-9]+$ ]]; then
  IFS='|' read -r w_billed w_errors w_5xx <<< "$window_counts"
  printf 'deploy_window: switch=%s +/-15s billed=%s error_records=%s 5xx=%s\n' \
    "$switch_ts" "$w_billed" "$w_errors" "$w_5xx"
  if (( w_billed + w_errors == 0 )); then
    printf 'deploy_window: WARNING no traffic in the window; a zero here does not prove continuity\n'
  elif (( w_5xx > 0 )); then
    printf 'deploy_window: WARNING %s 5xx inside the deploy window\n' "$w_5xx"
  else
    printf 'deploy_window: no 5xx among %s requests\n' "$((w_billed + w_errors))"
  fi
else
  printf 'deploy_window: could not summarize (%s); report the window counts by hand\n' "$window_counts"
fi

# ── 收掉不在列表里的实例（2026-11-26 第 32 轮）────────────────────────
# 上一轮我手工停容器时停错了对象：停掉仍在 upstream 里作备用的那个，留下一个指向
# 已停容器的死条目 —— 正是再上一轮刚修掉的问题。人对着端口号做减法不可靠，
# 这件事该由脚本按列表来办。
#
# 默认只报告、不停（PRUNE_STOPPED=0）。停容器是破坏性动作，先让它在真实发布里
# 把判断跑熟（日志里能看到它认对了没有），确认无误再谈默认启用。
prune_idle_instances() {
  local peers_ports name ports port
  peers_ports=$(awk '/# ---- zhijing-peers-begin ----/,/# ---- zhijing-peers-end ----/' "$NGINX_SITE" \
    | grep -o '127\.0\.0\.1:[0-9]*' | cut -d: -f2 | sort -u)
  [[ -n "$peers_ports" ]] || return 0
  docker ps --format '{{.Names}}|{{.Ports}}' | while IFS='|' read -r name ports; do
    case "$name" in
      zhijing-api-*) ;;
      *) continue ;;
    esac
    # 另一条发布管线的实例即便暂时不在列表里也不归本脚本处置。
    case "$name" in
      *final*|*sibling*) continue ;;
    esac
    port=$(printf '%s' "$ports" | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)->.*/\1/p' | head -1)
    [[ -n "$port" ]] || continue
    if printf '%s\n' "$peers_ports" | grep -qx "$port"; then
      continue
    fi
    printf '%s %s\n' "$name" "$port"
  done
}

idle_instances=$(prune_idle_instances || true)
if [[ -n "$idle_instances" ]]; then
  printf 'idle instances (running but not referenced by nginx):\n'
  printf '%s\n' "$idle_instances" | while read -r name port; do
    printf '  %s (port %s)\n' "$name" "$port"
  done
  if [[ "${PRUNE_STOPPED:-0}" == "1" ]]; then
    printf '%s\n' "$idle_instances" | while read -r name port; do
      printf 'stopping %s (port %s)\n' "$name" "$port"
      docker stop "$name" >/dev/null 2>&1 || printf 'warning: could not stop %s\n' "$name" >&2
    done
  else
    printf 'left running (set PRUNE_STOPPED=1 to stop them automatically)\n'
  fi
else
  printf 'idle instances: none (every running gateway is referenced by nginx)\n'
fi

trap - ERR
printf 'release_ready image=%s candidate=%s old_primary_port=%s nginx_backup=%s\n' \
  "$IMAGE" "$NEW_CONTAINER" "$old_port" "$nginx_backup"
