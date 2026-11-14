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

data_type=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}{{end}}{{end}}' "$CURRENT_CONTAINER")
data_source=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' "$CURRENT_CONTAINER")
[[ "$data_type" == bind || "$data_type" == volume ]] || die "unsupported /app/data mount type: $data_type"
test -n "$data_source" || die "current container has no /app/data mount"

mapfile -t networks < <(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$CURRENT_CONTAINER" | awk 'NF')
test "${#networks[@]}" -gt 0 || die "current container has no Docker network"

docker pull "$IMAGE"
docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true

run_args=(
  --detach
  --name "$NEW_CONTAINER"
  --restart unless-stopped
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

nginx -t
systemctl reload nginx

curl --http1.1 --fail --silent --show-error --max-time 10 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
  "https://${PUBLIC_HOST}/readyz" >/dev/null
for _ in 1 2 3 4 5; do
  curl --http1.1 --fail --silent --show-error --max-time 10 --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
    "https://${PUBLIC_HOST}/readyz" >/dev/null
done

trap - ERR
printf 'release_ready image=%s candidate=%s old_primary_port=%s nginx_backup=%s\n' \
  "$IMAGE" "$NEW_CONTAINER" "$old_port" "$nginx_backup"
