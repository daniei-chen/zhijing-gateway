"""Validate an optional source patch. No SSH, services, database or deployment actions."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

HERE = Path(__file__).resolve().parent


def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-only', action='store_true', help='Only inspect the distributed patch and manifest.')
    parser.add_argument('--root', type=Path, help='An isolated local backend source checkout; never a production deployment directory.')
    parser.add_argument('--apply', action='store_true', help='Apply only after exact source hashes and git apply --check succeed.')
    parser.add_argument('--verify-applied', action='store_true', help='Verify the resulting source hashes instead of applying.')
    args = parser.parse_args()
    manifest = json.loads((HERE/'INTEGRATION-MANIFEST.json').read_text(encoding='utf-8'))
    patch = HERE/manifest['patch']
    assert patch.parent == HERE and patch.suffix == '.patch', 'invalid_patch_path'
    assert hashlib.sha256(patch.read_bytes()).hexdigest() == manifest['patch_sha256'], 'patch_checksum_mismatch'
    names = {entry['path'] for entry in manifest['files']}
    patch_names = set(re.findall(r'^diff --git a/(\S+) b/\S+$', patch.read_text(encoding='utf-8'), re.M))
    assert names == patch_names and len(names) == len(manifest['files']), 'patch_file_set_mismatch'
    for name in names | {item['path'] for item in manifest['prerequisites']}:
        p = PurePosixPath(name)
        assert not p.is_absolute() and '..' not in p.parts and p.parts[0] == 'backend', 'unsafe_source_path'
    subprocess.run(['git', 'apply', '--numstat', str(patch)], check=True, capture_output=True)
    if args.artifact_only:
        assert not args.apply and not args.verify_applied, 'incompatible_modes'
        print(json.dumps(dict(artifact_verified=True, source_files=len(names), backend_compiled_in_ci=False)))
        return
    assert args.root and not (args.apply and args.verify_applied), 'choose_local_source_mode'
    root = args.root.resolve(strict=True)
    for entry in manifest['prerequisites']:
        target = (root/entry['path']).resolve()
        assert target.is_relative_to(root) and target.is_file() and digest(target) == entry['sha256'], 'prerequisite_mismatch:' + entry['path']
    for entry in manifest['files']:
        target = (root/entry['path']).resolve()
        assert target.is_relative_to(root), 'source_outside_root'
        expected = entry['after_sha256'] if args.verify_applied else entry['before_sha256']
        assert (not target.exists()) if expected is None else (target.is_file() and digest(target) == expected), 'source_mismatch:' + entry['path']
    if not args.verify_applied:
        subprocess.run(['git', '-C', str(root), 'apply', '--check', str(patch)], check=True, capture_output=True)
        if args.apply:
            subprocess.run(['git', '-C', str(root), 'apply', str(patch)], check=True, capture_output=True)
            for entry in manifest['files']:
                assert digest(root/entry['path']) == entry['after_sha256'], 'applied_hash_mismatch:' + entry['path']
    print(json.dumps(dict(source_verified=True, files=len(names), applied=args.apply, production_deployed=False)))


if __name__ == '__main__':
    main()
