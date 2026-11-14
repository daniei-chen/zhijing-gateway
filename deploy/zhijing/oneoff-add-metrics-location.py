#!/usr/bin/env python3
"""Add a proxy location for the new /metrics endpoint to the HTTPS server block.

The backend answers 404 unless METRICS_TOKEN is set, so proxying the path is safe
by default: an unconfigured deployment still looks like the endpoint does not
exist. Once the token is configured the path becomes usable without touching
nginx again.
"""
import datetime
import pathlib
import re
import shutil
import subprocess
import sys

SITE = pathlib.Path('/etc/nginx/sites-enabled/zhijing.kaogong.art')

BLOCK = """    # Prometheus 指标（2026-11-15）：后端默认关闭——未设置 METRICS_TOKEN 时直接 404，
    # 所以转发这个路径是安全的。启用后靠 token 保护，公网抓取请同时限制来源。
    location = /metrics {
        proxy_pass http://zhijing_api/metrics;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_connect_timeout 3s;
        proxy_read_timeout 5s;
        access_log off;
    }
"""


def main():
    text = SITE.read_text()
    if 'location = /metrics' in text:
        print('already present, nothing to do')
        return 0

    pattern = re.compile(r'    location = /readyz \{\n(?:.*?\n)*?    \}\n')
    matches = list(pattern.finditer(text))
    if not matches:
        print('no readyz location found', file=sys.stderr)
        return 1

    last = matches[-1]
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = pathlib.Path('/root/zhijing-nginx-metrics-%s.bak' % stamp)
    shutil.copy2(SITE, backup)

    SITE.write_text(text[:last.end()] + BLOCK + text[last.end():])

    test = subprocess.run(['nginx', '-t'], capture_output=True)
    if test.returncode != 0:
        shutil.copy2(backup, SITE)
        sys.stderr.write(test.stderr.decode('utf-8', 'replace'))
        print('nginx -t failed, restored', file=sys.stderr)
        return 1

    print('backup=%s' % backup)
    print('inserted after the last readyz location')
    return 0


if __name__ == '__main__':
    sys.exit(main())
