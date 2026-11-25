#!/bin/bash
# 把仓库里的 fail2ban 规则装到本机，并确认它们真的在干活。
#
# 为什么要有这个脚本：这套规则以前只存在于服务器上，不在版本控制里，
# 出了问题没人能 review；而它出的问题恰好是「装了但没生效」——
# 从 status 里完全看不出来（Total failed: 0，看不出是没匹配还是被白名单挡了）。
#
# 所以判据不能只看 Total failed。第一版就栽在这里：自发 3 个 404，计数纹丝不动，
# 于是判定「没生效」—— 其实规则工作得好好的，只是我这台机器在豁免名单里，
# 匹配到也被有意忽略了。教训：判据要落在「规则有没有读到并匹配这一行」，
# 而不是落在「计数涨没涨」—— 后者会被白名单、bantime 未到等因素干扰。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/fail2ban"
DST_FILTER=/etc/fail2ban/filter.d
DST_JAIL=/etc/fail2ban/jail.d
JAIL=zhijing-nginx-404
FBLOG=/var/log/fail2ban.log
SITE=https://zhijing.kaogong.art

[ -d "$SRC" ] || { echo "missing source dir: $SRC" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 2; }

echo "== install =="
install -m 0644 "$SRC/$JAIL.conf" "$DST_FILTER/$JAIL.conf" || exit 1
install -m 0644 "$SRC/$JAIL.local" "$DST_JAIL/$JAIL.local" || exit 1
echo "filter -> $DST_FILTER/$JAIL.conf"
echo "jail   -> $DST_JAIL/$JAIL.local"

echo "== config check =="
fail2ban-client -t 2>&1 | tail -3
fail2ban-client -t >/dev/null 2>&1 || { echo "config test failed; not reloading" >&2; exit 1; }

echo "== reload =="
systemctl reload fail2ban 2>/dev/null || systemctl restart fail2ban || { echo "reload failed" >&2; exit 1; }
sleep 3

echo "== check 1: is the jail reading a file rather than the journal? =="
if fail2ban-client status "$JAIL" 2>/dev/null | grep -q 'File list:'; then
  fail2ban-client status "$JAIL" | grep 'File list:'
  echo "  ok: file backend in use (the journal backend ignores logpath, which was the bug)"
else
  echo "  FAIL: still no file list — the jail is not reading the access log" >&2
  exit 3
fi

echo "== check 2: does a real 404 reach the filter? =="
before=$(wc -l < "$FBLOG" 2>/dev/null || echo 0)
for i in 1 2 3; do
  curl -sk -o /dev/null -H 'User-Agent: zhijing-fail2ban-selftest' "$SITE/.fail2ban-selftest-$i" || true
done
sleep 5
after=$(wc -l < "$FBLOG" 2>/dev/null || echo 0)
if [ "$after" -gt "$before" ]; then
  hits=$(tail -n "+$((before + 1))" "$FBLOG" | grep -cF "[$JAIL]")
else
  hits=0
fi
echo "  fail2ban log lines: before=$before after=$after; lines about $JAIL: $hits"
if [ "$hits" -gt 0 ]; then
  tail -n "+$((before + 1))" "$FBLOG" | grep -F "[$JAIL]" | tail -3 | sed 's/^/  /'
  echo "  ok: the filter matched a live request"
else
  echo "  FAIL: a fresh 404 did not reach the filter" >&2
  exit 4
fi

echo "== counter (informational only) =="
fail2ban-client status "$JAIL" | sed -n '2,10p'
echo "  note: a flat counter here is not a failure — sources on the ignore list are"
echo "  deliberately not counted. Checks 1 and 2 above are the real verdict."
echo "RESULT: $JAIL is live"
