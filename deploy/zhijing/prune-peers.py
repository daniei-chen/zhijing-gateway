#!/usr/bin/env python3
"""Remove stale rollback peers from the nginx peers block (one-off cleanup).

Keeps only the ports named on the command line, backs the site file up first,
and refuses to write when the resulting block would contain no weighted server.
"""
import datetime
import pathlib
import re
import shutil
import sys

SITE = pathlib.Path('/etc/nginx/sites-enabled/zhijing.kaogong.art')
BEGIN = '# ---- zhijing-peers-begin ----'
END = '# ---- zhijing-peers-end ----'

STALE_COMMENT_MARKERS = (
    'active=18806',
    '18792 =',
    'v0.2.21-zhijing-v021',
    '18784/18783',
)


def main(argv):
    keep = {p.strip() for p in argv[1:] if p.strip()}
    if not keep:
        print('usage: cleanup-peers.py <port> [port ...]', file=sys.stderr)
        return 2

    text = SITE.read_text()
    pattern = re.compile(re.escape(BEGIN) + r'(.*?)' + re.escape(END), re.S)
    match = pattern.search(text)
    if not match:
        print('peers block not found', file=sys.stderr)
        return 1

    kept, dropped = [], []
    for line in match.group(1).splitlines():
        port = re.search(r'server\s+127\.0\.0\.1:(\d+)', line)
        if port and port.group(1) not in keep:
            dropped.append(line.strip())
            continue
        if line.strip().startswith('#') and any(m in line for m in STALE_COMMENT_MARKERS):
            dropped.append(line.strip())
            continue
        kept.append(line)

    if not any(re.search(r'weight=([1-9]\d*)', line) for line in kept):
        print('refusing to write: no weighted primary would remain', file=sys.stderr)
        return 1

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/root/zhijing-nginx-peers-cleanup-%s.bak' % stamp)
    shutil.copy2(SITE, backup)

    new_text = text[:match.start(1)] + '\n'.join(kept) + text[match.end(1):]
    SITE.write_text(new_text)

    print('backup=%s' % backup)
    print('kept=%d dropped=%d' % (len(kept), len(dropped)))
    for line in dropped:
        print('dropped: %s' % line)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
