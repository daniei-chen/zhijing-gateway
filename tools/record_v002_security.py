"""Record the explicitly reviewed v0.0.2 security delta; does not reset v0.0.1."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = 'd8551a2257746993f9844b6fffa325dd1ff5c172'
FILES = {
    'frontend/src/api/client.ts': 'Bind dispatch, responses and 401 retries to the originating session; cancel stale requests.',
    'frontend/src/api/tokenRefresh.ts': 'Bind singleflight, Web Locks, peer adoption and persistence to one session generation.',
    'frontend/src/api/auth.ts': 'Commit login/OAuth credentials together and prevent stale logout or login completions.',
    'frontend/src/stores/auth.ts': 'Guard profile, auth and refresh writes; synchronize and dispose session observers.',
    'frontend/src/utils/embedded-url.ts': 'Remove original login credentials and callback secrets from embedded URLs.',
    'frontend/src/App.vue': 'Reload a replaced document to discard prior-account page and store caches.',
    'frontend/src/views/user/CustomPageView.vue': 'Stop passing login tokens; use no-referrer iframe navigation.',
    'frontend/src/api/authSession.ts': 'New generation, commit validation, cancellation and document replacement coordinator.',
    'frontend/src/api/authSessionDigest.ts': 'New synchronous SHA-256 storage consistency fingerprint; not server authorization.',
    'frontend/src/api/__tests__/tokenRefresh.spec.ts': 'Peer fixtures use the actual versioned commit protocol; changed-session rejection asserts the new session is preserved.',
    'frontend/src/stores/__tests__/auth.spec.ts': 'Dispose session observers and timers between store tests.',
    'frontend/src/utils/__tests__/embedded-url.spec.ts': 'Replace the former token-forwarding expectation with credential-free URL acceptance cases.',
    'frontend/src/views/user/__tests__/CustomPageView.spec.ts': 'Verify both iframe and new-window links omit the login token and use no-referrer navigation.'
}


def digest(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()


if __name__ == '__main__':
    entries = []
    for name, reason in FILES.items():
        original = subprocess.run(['git', 'show', f'{BASE}:{name}'], cwd=ROOT, capture_output=True)
        entries.append(dict(path=name, before_sha256=digest(original.stdout) if original.returncode == 0 else None,
                            after_sha256=digest((ROOT/name).read_bytes()), reason=reason))
    report = dict(version='0.0.2', baseline_commit=BASE,
                  authorization='User explicitly included ZJ-01 and ZJ-02 in the local v0.0.2 candidate on 2026-11-05. Production deployment is not authorized.',
                  api_paths_unchanged=True, backend_auth_billing_roles_unchanged=True,
                  tests='Four previously failing acceptance probes and full frontend regressions; see docs/reviews/2026-11-05-security-followup.zh-CN.md.', files=entries)
    (ROOT/'docs/security-changes-v0.0.2.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Recorded {len(entries)} reviewed security source/test files without replacing the original compatibility baseline.')
