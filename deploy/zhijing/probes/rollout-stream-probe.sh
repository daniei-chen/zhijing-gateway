#!/bin/bash
# 发布窗口流式探针：连续发若干 stream=true 的推理请求，验证在途流不被发版打断。
# 每个请求之间留间隔，让窗口覆盖「候选启动 -> upstream 切换 -> 观察期」。
#
# 2026-11-26：入口域名改成可配置，原因同 rollout-traffic-probe.sh ——
# 写死的域名一下线，探针就全挂，而且挂得很安静（只是状态码变 502）。
set -u
OUT=${1:-/root/rollout-stream.log}
ROUNDS=${2:-3}
PUBLIC_HOST="${PUBLIC_HOST:-154-36-187-147.sslip.io}"
KEY=$(docker exec zhijing-sub2api-japan-postgres-1 psql -U zhijing_trial -d zhijing_trial -Atc "select key from api_keys where id=3 and status='active'")
: > "$OUT"
for r in $(seq 1 "$ROUNDS"); do
  START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  BODY=$(curl -s -N -m 120 \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d '{"model":"gpt-6.1-sol","stream":true,"max_tokens":120,"messages":[{"role":"user","content":"用中文写两句话介绍 API 网关。"}]}' \
    "https://$PUBLIC_HOST/v1/chat/completions" 2>&1)
  RC=$?
  END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  DONE=no
  case "$BODY" in *'[DONE]'*) DONE=yes;; esac
  ERR=no
  case "$BODY" in *'"error"'*) ERR=yes;; esac
  CHUNKS=$(printf '%s' "$BODY" | grep -c '^data:')
  printf 'round=%s start=%s end=%s curl_exit=%s saw_done=%s saw_error=%s chunks=%s\n' \
    "$r" "$START" "$END" "$RC" "$DONE" "$ERR" "$CHUNKS" >> "$OUT"
  sleep 15
done
echo "STREAM_PROBE_FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT"
