"""Run isolated probes against history.go extracted unchanged from the released patch.

This does not compile the complete private backend. The test mode deliberately
asserts correct attribution after eviction; it fails while the published defect
remains. Benchmark mode measures only this in-memory helper, never gateway TPS.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = 'backend/internal/pkg/gatewaytiming/history.go'


def released_history():
    directory = ROOT / 'integrations/sub2api'
    subprocess.run([sys.executable, str(directory / 'check_patch.py'), '--artifact-only'], check=True)
    manifest = json.loads((directory / 'INTEGRATION-MANIFEST.json').read_text(encoding='utf-8'))
    patch = (directory / manifest['patch']).read_text(encoding='utf-8')
    header = f'diff --git a/{TARGET} b/{TARGET}\n'
    if patch.count(header) != 1:
        raise ValueError('history_patch_file_missing_or_ambiguous')
    block = patch.split(header, 1)[1].split('\ndiff --git ', 1)[0]
    hunk = re.search(r'^@@ -0,0 \+1,(\d+) @@\n', block, re.M)
    if hunk is None:
        raise ValueError('history_is_not_a_complete_new_file')
    lines = block[hunk.end():].splitlines()
    if len(lines) != int(hunk.group(1)) or any(not line.startswith('+') for line in lines):
        raise ValueError('unexpected_history_patch_format')
    source = ('\n'.join(line[1:] for line in lines) + '\n').encode()
    expected = next(entry['after_sha256'] for entry in manifest['files'] if entry['path'] == TARGET)
    if hashlib.sha256(source).hexdigest() != expected:
        raise ValueError('extracted_history_hash_mismatch')
    return source, expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--go', default='go', help='Path to an installed Go 1.22+ toolchain.')
    parser.add_argument('--mode', choices=('test', 'benchmark'), default='test')
    parser.add_argument('--race', action='store_true', help='Enable Go race detection for the test probes.')
    args = parser.parse_args()
    source, digest = released_history()
    with tempfile.TemporaryDirectory(prefix='zhijing-history-audit-') as directory:
        root = Path(directory)
        (root / 'go.mod').write_text('module audit/gatewaytiming\n\ngo 1.22\n')
        (root / 'history.go').write_bytes(source)
        (root / 'history_test.go').write_bytes((ROOT / 'qa/history_audit/history_test.go').read_bytes())
        env = dict(os.environ, GOWORK='off', GOTOOLCHAIN='local', GOPROXY='off', GOSUMDB='off')
        command = [args.go, 'test', '-count=1']
        if args.mode == 'benchmark':
            command += ['-run=^$', '-bench=.', '-benchmem', '-benchtime=200ms', '-count=3', '-cpu=1,4']
        else:
            command += ['-v']
            if args.race:
                command += ['-race']
        command += ['.']
        print(json.dumps(dict(source=TARGET, source_sha256=digest, mode=args.mode,
                              private_backend_compiled=False, production_requests=0)), flush=True)
        result = subprocess.run(command, cwd=root, env=env)
        raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
