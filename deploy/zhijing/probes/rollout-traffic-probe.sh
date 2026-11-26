#!/bin/bash
# 发布窗口流量探针：按固定间隔请求 /v1/models，记录时间戳与状态码。
# 用只读模型列表端点覆盖 nginx -> gateway 全链路，不消耗模型额度。
#
# 2026-11-26：入口域名改成可配置。之前这里写死 zhijing.kaogong.art，
# 域名下线当天探针 127 次全部 502 —— 部署本身没问题，是探针指错了地方，
# 结果「零中断」的证据链直接断掉。域名不该出现在脚本里。
set -u
DURATION=${1:-360}
INTERVAL=${2:-2}
OUT=${3:-/root/rollout-traffic.log}
PUBLIC_HOST="${PUBLIC_HOST:-154-36-187-147.sslip.io}"
KEY=$(docker exec zhijing-sub2api-japan-postgres-1 psql -U zhijing_trial -d zhijing_trial -Atc "select key from api_keys where id=3 and status='active'")
if [ -z "$KEY" ]; then echo "NO_API_KEY" >&2; exit 2; fi
: > "$OUT"
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "Authorization: Bearer $KEY" "https://$PUBLIC_HOST/v1/models")
  echo "$ts $code" >> "$OUT"
  sleep "$INTERVAL"
done
