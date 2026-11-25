#!/bin/bash
# 把仓库里的 fail2ban 规则装到本机，并确认它们真的在干活。
#
# 为什么要有这个脚本：这套规则以前只存在于服务器上，不在版本控制里，
# 出了问题没人能 review；而它出的问题恰好是「装了但没生效」，
# 从 status 里完全看不出来。装完必须自己验一遍，不能只看 reload 成功。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/fail2ban"
DST_FILTER=/etc/fail2ban/filter.d
DST_JAIL=/etc/fail2ban/jail.d

[ -d "$SRC" ] || { echo "missing source dir: $SRC" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 2; }

echo "== install =="
install -m 0644 "$SRC/zhijing-nginx-404.conf" "$DST_FILTER/zhijing-nginx-404.conf" || exit 1
install -m 0644 "$SRC/zhijing-nginx-404.local" "$DST_JAIL/zhijing-nginx-404.local" || exit 1
echo "filter -> $DST_FILTER/zhijing-nginx-404.conf"
echo "jail   -> $DST_JAIL/zhijing-nginx-404.local"

echo "== config check =="
fail2ban-client -t 2>&1 | tail -5 || { echo "config test failed; not reloading" >&2; exit 1; }

echo "== reload =="
systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban || { echo "reload failed" >&2; exit 1; }
sleep 3

echo "== status =="
fail2ban-client status zhijing-nginx-404 2>&1 | sed -n '1,12p'

# 关键验证：backend 若不是文件后端，Total failed 会一直是 0。
echo "== backend actually used =="
fail2ban-client get zhijing-nginx-404 2>/dev/null | grep -i backend || echo "(no backend line reported)"

echo "== live check: 3 requests to a nonexistent path =="
before=$(fail2ban-client status zhijing-nginx-404 2>/dev/null | awk '/Total failed/{print $NF}')
for i in 1 2 3; do
  curl -s -o /dev/null -H 'User-Agent: zhijing-fail2ban-selftest' \
    "https://zhijing.kaogong.art/.fail2ban-selftest-$i" || true
done
sleep 4
after=$(fail2ban-client status zhijing-nginx-404 2>/dev/null | awk '/Total failed/{print $NF}')
echo "total_failed before=$before after=$after"
if [ -n "$before" ] && [ -n "$after" ] && [ "$after" -gt "$before" ]; then
  echo "RESULT: the jail is reading the access log (failed count moved)"
else
  echo "RESULT: NO MOVEMENT — the jail is still not reading the access log; do not trust it"
  exit 3
fi
