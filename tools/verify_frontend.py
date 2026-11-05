"""Portable frontend contract/build check; no server access or Git history required."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[1]
AUDIT_DELTA = 'docs/security-changes-audit-20261105.json'
AUDIT_BASE = '8f72c8545d8134b4c4d14036a2060fd2a08b0053'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def reviewed_delta(expected, name=AUDIT_DELTA, baseline=AUDIT_BASE):
    """Apply explicit reviewed changes without rewriting either historical baseline."""
    delta_path = ROOT / name
    if not delta_path.exists():
        return 0
    delta = json.loads(delta_path.read_text(encoding='utf-8'))
    require(isinstance(delta, dict) and set(delta) == {'schema_version', 'baseline_commit', 'authorization', 'files'},
            'invalid_audit_schema')
    require(delta['schema_version'] == 1 and delta['baseline_commit'] == baseline, 'invalid_audit_baseline')
    require(isinstance(delta['authorization'], str) and delta['authorization'].strip(), 'missing_audit_authorization')
    require(isinstance(delta['files'], list) and delta['files'], 'empty_audit_delta')
    seen = set()
    for entry in delta['files']:
        require(isinstance(entry, dict) and set(entry) == {'path', 'before_sha256', 'after_sha256', 'reason', 'tests'},
                'invalid_audit_entry')
        name = entry['path']
        require(isinstance(name, str) and name in expected and name not in seen, 'unknown_or_duplicate_audit_path:' + str(name))
        require(digest(entry['before_sha256']) and entry['before_sha256'] == expected[name],
                'audit_baseline_mismatch:' + name)
        require(digest(entry['after_sha256']) and entry['after_sha256'] != entry['before_sha256'],
                'invalid_audit_after_digest:' + name)
        require(isinstance(entry['reason'], str) and entry['reason'].strip(), 'missing_audit_reason:' + name)
        require(isinstance(entry['tests'], list) and entry['tests'] and
                all(isinstance(test, str) and test.strip() for test in entry['tests']), 'missing_audit_tests:' + name)
        seen.add(name)
        expected[name] = entry['after_sha256']
    return len(seen)


def source_bytes(name):
    require(isinstance(name, str) and name and '\\' not in name, 'invalid_contract_path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == name, 'invalid_contract_path')
    target = (ROOT / name).resolve(strict=True)
    require(target.is_relative_to(ROOT.resolve()), 'contract_path_outside_root')
    return target.read_bytes().replace(b'\r\n', b'\n')


def verify():
    baseline = json.loads((ROOT/'docs/compatibility-baseline.json').read_text(encoding='utf-8'))
    extensions = json.loads((ROOT/'docs/compatibility-extensions-v0.0.2.json').read_text(encoding='utf-8'))
    security = json.loads((ROOT/'docs/security-changes-v0.0.2.json').read_text(encoding='utf-8'))
    expected = {**baseline['protected_files'], **baseline['runtime_documents']}
    approved = set()
    for entry in extensions['files'] + security['files']:
        name = entry['path']
        require(name not in approved, 'duplicate_extension:' + name)
        approved.add(name)
        if name in expected:
            require(entry['before_sha256'] == expected[name], 'extension_baseline_mismatch:' + name)
        else:
            require(entry in security['files'], 'unknown_extension_path:' + name)
        require(digest(entry['after_sha256']), 'invalid_extension_digest:' + name)
        expected[name] = entry['after_sha256']
    audit_count = reviewed_delta(expected)
    repair_count = reviewed_delta(expected, 'docs/security-changes-v0.0.3.json',
                                  '06b62f9536373265879b14023270299dc79e1874')
    for name, expected_digest in expected.items():
        require(digest(expected_digest) and hashlib.sha256(source_bytes(name)).hexdigest() == expected_digest,
                'contract_changed:' + name)
    dist = ROOT/'frontend/dist'
    html = (dist/'index.html').read_text(encoding='utf-8')
    refs = re.findall(r'(?:src|href)="(/[^"#?]+)"', html)
    require(all((dist/p.lstrip('/')).is_file() and (dist/p.lstrip('/')).resolve().is_relative_to(dist.resolve())
                for p in refs), 'missing_entry_asset')
    require(not any(p.startswith('/assets/') for p in refs), 'homepage_namespace_collision')
    files = [p for p in dist.rglob('*') if p.is_file()]
    markers = [b'preview-admin', b'preview-member', b'preview-2fa', b'local-preview-banner',
               b'member@preview.local', b'admin@preview.local', b'Preview2026!']
    for path in files:
        if path.suffix in ('.html','.js','.css','.json'):
            body = path.read_bytes()
            require(not any(value in body for value in markers), 'qa_in_build:' + path.name)
    routes = re.findall(r"\bpath:\s*['\"]([^'\"]+)['\"]", (ROOT/'frontend/src/router/index.ts').read_text(encoding='utf-8'))
    require(len(routes) == 68, 'route_contract_changed')
    report = dict(checked_at=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds'),
                  protected_files=len(baseline['protected_files']),
                  optional_contract_extensions=len(extensions['files']),
                  approved_security_files=len(security['files']),
                  reviewed_audit_files=audit_count,
                  reviewed_v003_files=repair_count,
                  runtime_documents=len(baseline['runtime_documents']), routes=len(routes),
                  built_files=len(files), qa_code_in_build=False, static_frontend_build=True)
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    verify()
