#!/usr/bin/env python3
"""Rewrite the served-frontend locations so nginx proxies to the backend.

Current state (2026-11-15): nginx serves /var/www/zhijing-homepage (built 11-01)
for location / and /assets/, and /var/www/zhijing-workbench (built 11-06) for the
SPA fallback. The container's embedded dist is newer than all of them and is
already reachable on its own port, so the fix is to stop reading the disk copies.

What changes, in the main HTTPS server block only:
  * location /        try_files ...  ->  proxy_pass http://zhijing_api
  * location /assets/ root/try_files ->  proxy_pass http://zhijing_api
  * @zhijing_sub2api_spa              ->  left in place but unreachable

Both edits must land before a single `nginx -t` + reload, because nginx only
applies a complete configuration: changing /assets/ alone would break pages still
loading the old index.html.

Usage: patch-frontend-proxy.py <site-file> [--revert]
"""
import pathlib
import re
import sys

PROXY_HEADERS = """        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
"""

LOCATION_ROOT = """    location / {
        include /etc/nginx/snippets/zhijing-security.conf;
        add_header Strict-Transport-Security "max-age=2592000" always;
        add_header Cache-Control no-cache always;
        limit_except GET { deny all; }
        proxy_pass http://zhijing_api;
""" + PROXY_HEADERS + """    }
"""

LOCATION_ASSETS = """    location /assets/ {
        include /etc/nginx/snippets/zhijing-security.conf;
        add_header Strict-Transport-Security "max-age=2592000" always;
        add_header Cache-Control "public, max-age=3600";
        limit_except GET { deny all; }
        proxy_pass http://zhijing_api;
""" + PROXY_HEADERS + """    }
"""


def replace_first_block(text, header_regex, replacement, label):
    match = re.search(header_regex, text, re.M | re.S)
    if not match:
        raise SystemExit('block not found: %s' % label)
    return text[:match.start()] + replacement + text[match.end():]


def main():
    if len(sys.argv) < 2:
        print('usage: patch-frontend-proxy.py <site-file>', file=sys.stderr)
        return 2
    site = pathlib.Path(sys.argv[1])
    text = site.read_text()

    if 'proxy_pass http://zhijing_api;' in text and 'try_files $uri $uri/ @zhijing_sub2api_spa;' not in text:
        print('already proxied, nothing to do')
        return 0

    # location /  —— 只在主 HTTPS 块里出现一次带 try_files 的版本
    root_block = r'    location / \{\n(?:.*?\n)*?        try_files \$uri \$uri/ @zhijing_sub2api_spa;\n    \}\n'
    text = replace_first_block(text, root_block, LOCATION_ROOT, 'location /')

    # location /assets/ —— 带 root 继承、try_files 落盘的那个
    assets_block = r'    location /assets/ \{\n(?:.*?\n)*?        try_files \$uri =404;\n    \}\n'
    text = replace_first_block(text, assets_block, LOCATION_ASSETS, 'location /assets/')

    site.write_text(text)
    print('rewrote location / and location /assets/ to proxy to zhijing_api')
    return 0


if __name__ == '__main__':
    sys.exit(main())
