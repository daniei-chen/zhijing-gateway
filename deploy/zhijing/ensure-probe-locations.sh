#!/bin/bash
# 让探针入口说真话（2026-11-26 第 29 轮）。
#
# 事故形态：外部探针打 `/health`，拿到 200 和一段首页 HTML —— 因为它压根没有
# 反代规则，落到了前端 SPA 的 catch-all。于是「服务是否活着」这个问题永远回答「活着」，
# 网关进程挂了也照样 200。这类假绿比没有探针更危险。
#
# 真实的网关存活端点一直是 `/health`（返回 {"status":"ok"}），nginx 只是用
# `/healthz` 这个名字把它转出去。本脚本把 `/health` 也接上，两条路径都指向同一个后端端点，
# 任何按惯例探 `/health` 的监控、负载均衡、uptime 服务从此拿到真结果。
set -uo pipefail
NG="${NG:-/etc/nginx/sites-enabled/zhijing.kaogong.art}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

test -r "$NG" || { echo "nginx site not found: $NG"; exit 1; }

if grep -qE '^[[:space:]]*location = /health \{' "$NG"; then
  echo "already configured: location = /health"
  exit 0
fi

BAK="/root/zhijing-nginx-$(basename "$NG").bak-health-${STAMP}"
cp --preserve=mode,ownership,timestamps "$NG" "$BAK" || { echo "backup failed"; exit 1; }
echo "backup: $BAK"

tmp=$(mktemp /tmp/zhijing-nginx-health.XXXXXX)
awk '
  !inserted && /^[[:space:]]*location = \/readyz \{/ {
    print "    # /health 与 /healthz 指向同一个网关端点：按惯例探 /health 的监控不应拿到 SPA HTML。"
    print "    location = /health {"
    print "        proxy_pass http://zhijing_api/health;"
    print "        proxy_http_version 1.1;"
    print "        proxy_set_header Connection \"\";"
    print "        proxy_set_header Host $host;"
    print "        proxy_connect_timeout 3s;"
    print "        proxy_read_timeout 5s;"
    print "        access_log off;"
    print "    }"
    print ""
    inserted=1
  }
  { print }
  END { if (!inserted) exit 3 }
' "$NG" >"$tmp"
rc=$?
if [[ $rc -ne 0 ]]; then
  rm -f "$tmp"
  echo "could not find the /readyz anchor; no change made"
  exit 3
fi

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

echo "--- /health ---"
curl -s -m 8 -w ' http=%{http_code}\n' "https://154-36-187-147.sslip.io/health" | head -c 200
echo
echo "--- /healthz ---"
curl -s -m 8 -w ' http=%{http_code}\n' "https://154-36-187-147.sslip.io/healthz" | head -c 200
echo
echo "done $STAMP"
