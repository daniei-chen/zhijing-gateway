#!/bin/bash
# 清理长期闲置的回滚实例。
#
# 每次发布都会在 nginx upstream 里新增一条 backup，旧实例从不停用，
# 于是 backup 列表越滚越长：清点前有 10 条 server，其中 6 条属于
# 一周前甚至更早的构建。它们平时不接流量，但一旦主实例失败，
# nginx 会按顺序去连这些死条目，每次都要等 fail_timeout。
#
# 保留：当前主实例、上一个版本、上上个版本、以及 sibling pipeline。
set -uo pipefail
NG=/etc/nginx/sites-enabled/zhijing.kaogong.art
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BAK="/root/zhijing-nginx-zhijing.kaogong.art.bak-prune-${STAMP}"
KEEP_PORTS="18813 18814 18815 18816 18817 18818"

cp --preserve=mode,ownership,timestamps "$NG" "$BAK" || { echo "backup failed"; exit 1; }
echo "backup: $BAK"

tmp=$(mktemp /tmp/zhijing-nginx-prune.XXXXXX)
awk -v drop="$KEEP_PORTS" '
  BEGIN { n=split(drop, ports, " "); for (i=1;i<=n;i++) dead[ports[i]]=1 }
  /# ---- zhijing-peers-begin ----/ { inb=1; print; next }
  /# ---- zhijing-peers-end ----/ { inb=0; print; next }
  inb {
    for (p in dead) {
      if (index($0, "127.0.0.1:" p " backup;")) { skipped++; next }
    }
  }
  { print }
  END { printf "skipped=%d\n", skipped+0 > "/dev/stderr" }
' "$NG" >"$tmp" || { echo "rewrite failed"; rm -f "$tmp"; exit 1; }

chown --reference="$NG" "$tmp"
chmod --reference="$NG" "$tmp"
mv "$tmp" "$NG"

if ! nginx -t; then
  echo "nginx config invalid -> restoring backup"
  cp --preserve=mode,ownership,timestamps "$BAK" "$NG"
  nginx -t && systemctl reload nginx
  exit 1
fi
systemctl reload nginx && echo "nginx reloaded"

echo "--- upstream after prune ---"
awk '/zhijing-peers-begin/,/zhijing-peers-end/' "$NG" | tr -cd '\11\12\15\40-\176'

echo "--- stopping idle containers ---"
for c in zhijing-api-v0117-final zhijing-api-v0119-final zhijing-api-v0120-final \
         zhijing-api-v0122-final zhijing-api-v0123-final zhijing-api-v0127-stable; do
  docker stop "$c" >/dev/null 2>&1 && echo "stopped $c" || echo "skip $c"
done

echo "--- running gateways ---"
docker ps --format '{{.Names}} {{.Status}}' | grep '^zhijing-api' | tr -cd '\11\12\15\40-\176'
echo "done $STAMP"
