"""Portable frontend contract/build check; no server access or Git history required."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def verify():
    baseline = json.loads((ROOT/'docs/compatibility-baseline.json').read_text(encoding='utf-8'))
    for name, digest in {**baseline['protected_files'], **baseline['runtime_documents']}.items():
        data = (ROOT/name).read_bytes().replace(b'\r\n', b'\n')
        assert hashlib.sha256(data).hexdigest() == digest, 'contract_changed:' + name
    dist = ROOT/'frontend/dist'
    html = (dist/'index.html').read_text(encoding='utf-8')
    refs = re.findall(r'(?:src|href)="(/[^"#?]+)"', html)
    assert all((dist/p.lstrip('/')).is_file() for p in refs), 'missing_entry_asset'
    assert not any(p.startswith('/assets/') for p in refs), 'homepage_namespace_collision'
    files = [p for p in dist.rglob('*') if p.is_file()]
    markers = [b'preview-admin', b'preview-member', b'preview-2fa', b'local-preview-banner',
               b'member@preview.local', b'admin@preview.local', b'Preview2026!']
    for path in files:
        if path.suffix in ('.html','.js','.css','.json'):
            body = path.read_bytes()
            assert not any(value in body for value in markers), 'qa_in_build:' + path.name
    routes = re.findall(r"\bpath:\s*['\"]([^'\"]+)['\"]", (ROOT/'frontend/src/router/index.ts').read_text(encoding='utf-8'))
    assert len(routes) == 68, 'route_contract_changed'
    report = dict(checked_at=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'),
                  protected_files=len(baseline['protected_files']),
                  runtime_documents=len(baseline['runtime_documents']), routes=len(routes),
                  built_files=len(files), qa_code_in_build=False, frontend_only=True)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    verify()
