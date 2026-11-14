#!/usr/bin/env bash
# 把线上前端从 /var/www 的静态副本切到后端内嵌的 dist（nginx proxy 模式）。
#
#   ./switch-frontend-to-proxy.sh --dry-run   # 改配置 → nginx -t → 立刻还原，不 reload
#   ./switch-frontend-to-proxy.sh apply       # 改配置 → nginx -t → reload → 生效
#   ./switch-frontend-to-proxy.sh --rollback  # 用最近一次备份还原并 reload
#
# 之所以要一次 reload 完成 / 和 /assets/ 两处改动：nginx 只在 reload 时读取整份配置，
# 只改 /assets/ 会让还在加载旧 index.html 的客户端拿不到 chunk。
set -euo pipefail

SITE=/etc/nginx/sites-enabled/zhijing.kaogong.art
BKDIR=/root/zhijing-frontend-switch
PATCHER=/root/patch-frontend-proxy.py
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
MODE=${1:-apply}

mkdir -p "$BKDIR"

case "$MODE" in
  --dry-run)
    cp -a "$SITE" "$BKDIR/site-$STAMP.bak"
    python3 "$PATCHER" "$SITE"
    RC=0
    if nginx -t 2>&1 | tail -2; then
      echo "DRY_RUN_OK: rewritten config passes nginx -t"
    else
      echo "DRY_RUN_FAIL: rewritten config rejected"
      RC=1
    fi
    cp -a "$BKDIR/site-$STAMP.bak" "$SITE"
    if nginx -t >/dev/null 2>&1; then
      echo "restored original, still valid"
    else
      echo "WARNING: restore produced an invalid config"
      RC=1
    fi
    exit "$RC"
    ;;
  apply)
    cp -a "$SITE" "$BKDIR/site-$STAMP.bak"
    python3 "$PATCHER" "$SITE"
    if ! nginx -t 2>&1 | tail -2; then
      cp -a "$BKDIR/site-$STAMP.bak" "$SITE"
      echo "nginx -t rejected the rewrite, original restored (no reload happened)"
      exit 1
    fi
    systemctl reload nginx
    echo "APPLIED backup=$BKDIR/site-$STAMP.bak"
    ;;
  --rollback)
    LAST=$(ls -1t "$BKDIR"/site-*.bak 2>/dev/null | head -1)
    if [ -z "${LAST:-}" ]; then
      echo "no backup found in $BKDIR"
      exit 1
    fi
    cp -a "$LAST" "$SITE"
    nginx -t >/dev/null && systemctl reload nginx
    echo "ROLLED_BACK to $LAST"
    ;;
  *)
    echo "usage: $0 [--dry-run|apply|--rollback]"
    exit 2
    ;;
esac
