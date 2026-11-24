#!/bin/bash
set -euo pipefail
SITE=/etc/nginx/sites-enabled/zhijing.kaogong.art
MODE=${1:?mode: canary|promote|rollback}
NEW_PORT=18819
OLD_PORT=18818
# 其他流水线部署的实例：只作为 backup 保留，不参与权重分配。
# 历史教训：这里原来只写死 18817-18813，每次灰度都会把别的实例整行从
# upstream 里删掉，被删掉的版本连「回滚候选」的资格都没有。
SIBLING_PORTS="18821 18820"
case "$MODE" in
  canary)  NEW_W=${2:?weight}; OLD_W=$((100-NEW_W)); [ "$OLD_W" -lt 1 ] && OLD_W=1 ;;
  promote) NEW_W=100; OLD_W=0 ;;
  rollback) NEW_W=0; OLD_W=100 ;;
  *) echo "unknown mode: $MODE"; exit 2 ;;
esac
TS=$(date -u +%Y%m%dT%H%M%SZ)
BAK="/root/zhijing-nginx-canary-$TS.bak"
cp -a "$SITE" "$BAK"
restore() { cp -a "$BAK" "$SITE"; nginx -t >/dev/null 2>&1 && systemctl reload nginx || true; echo "RESTORED from $BAK"; }
trap restore ERR
{
  echo '    # ---- zhijing-peers-begin ----'
  if [ "$NEW_W" -gt 0 ]; then
    printf '    server 127.0.0.1:%s weight=%s max_fails=1 fail_timeout=10s; # canary\n' "$NEW_PORT" "$NEW_W"
  fi
  if [ "$OLD_W" -gt 0 ]; then
    printf '    server 127.0.0.1:%s weight=%s max_fails=1 fail_timeout=10s; # stable\n' "$OLD_PORT" "$OLD_W"
  else
    printf '    server 127.0.0.1:%s backup; # rollback\n' "$OLD_PORT"
  fi
  for p in 18817 18816 18815 18814 18813; do
    printf '    server 127.0.0.1:%s backup; # rollback\n' "$p"
  done
  for p in $SIBLING_PORTS; do
    if ss -lnt 2>/dev/null | grep -q "127.0.0.1:$p "; then
      printf '    server 127.0.0.1:%s backup; # sibling pipeline\n' "$p"
    fi
  done
  echo '    # ---- zhijing-peers-end ----'
} > /root/zhijing-peers.block
awk -v block=/root/zhijing-peers.block '
  /# ---- zhijing-peers-begin ----/ { while ((getline line < block) > 0) print line; skip=1; next }
  /# ---- zhijing-peers-end ----/ { skip=0; next }
  skip != 1 { print }
' "$SITE" > /root/zhijing-site.new
cat /root/zhijing-site.new > "$SITE"
nginx -t
systemctl reload nginx
trap - ERR
echo "OK MODE=$MODE new=$NEW_PORT/$NEW_W old=$OLD_PORT/$OLD_W ts=$TS bak=$BAK"
