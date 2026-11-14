#!/usr/bin/env python3
"""Point the nginx peers block at a different primary port.

Used for rollback rehearsals and incident rollbacks: the target container must
already be running and listening. This script only rewrites the peers block; it
runs `nginx -t` afterwards but never reloads nginx itself, so the caller decides
when traffic moves.

Exit codes: 0 ok, 1 refused/failed, 2 usage.
"""
import datetime
import pathlib
import re
import shutil
import subprocess
import sys

SITE = pathlib.Path('/etc/nginx/sites-enabled/zhijing.kaogong.art')
BEGIN = '# ---- zhijing-peers-begin ----'
END = '# ---- zhijing-peers-end ----'
WEIGHT = 'weight=100 max_fails=1 fail_timeout=10s;'


def main(argv):
    if len(argv) != 2:
        print('usage: switch-primary.py <port>', file=sys.stderr)
        return 2
    target = argv[1].strip()
    if not target.isdigit():
        print('port must be numeric', file=sys.stderr)
        return 2

    text = SITE.read_text()
    pattern = re.compile(re.escape(BEGIN) + r'(.*?)' + re.escape(END), re.S)
    match = pattern.search(text)
    if not match:
        print('peers block not found', file=sys.stderr)
        return 1

    out = []
    found = False
    for line in match.group(1).splitlines():
        port = re.search(r'server\s+127\.0\.0\.1:(\d+)', line)
        if not port:
            out.append(line)
            continue
        indent = line[: len(line) - len(line.lstrip())]
        if port.group(1) == target:
            found = True
            out.append('%sserver 127.0.0.1:%s %s # primary (switch-primary)' % (indent, target, WEIGHT))
        else:
            out.append('%sserver 127.0.0.1:%s backup; # rollback' % (indent, port.group(1)))
    if not found:
        print('port %s not present in the peers block; add it first' % target, file=sys.stderr)
        return 1

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/root/zhijing-nginx-switch-%s.bak' % stamp)
    shutil.copy2(SITE, backup)

    SITE.write_text(text[: match.start(1)] + '\n'.join(out) + text[match.end(1):])

    test = subprocess.run(['nginx', '-t'], capture_output=True)
    if test.returncode != 0:
        shutil.copy2(backup, SITE)
        sys.stderr.write(test.stderr.decode('utf-8', 'replace'))
        print('nginx -t failed, site file restored from %s' % backup, file=sys.stderr)
        return 1

    print('backup=%s' % backup)
    print('primary=%s' % target)
    for line in out:
        if line.strip():
            print('  %s' % line.strip())
    print('next: systemctl reload nginx')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
