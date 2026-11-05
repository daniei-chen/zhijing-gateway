"""Validate an optional source patch. No SSH, services, database or deployment actions."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

HERE = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def source_path(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name,
            'unsafe_source_path')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and p.parts[0] == 'backend'
            and len(p.parts) > 1 and p.as_posix() == name
            and not any(ord(char) < 33 or ord(char) == 127 for char in name), 'unsafe_source_path')
    return name


def valid_digest(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def artifact():
    manifest = json.loads((HERE/'INTEGRATION-MANIFEST.json').read_text(encoding='utf-8'))
    name = manifest['patch']
    require(isinstance(name, str) and PurePosixPath(name).name == name
            and '\\' not in name and ':' not in name and name.endswith('.patch'), 'invalid_patch_path')
    patch = HERE / name
    require(patch.is_file() and not patch.is_symlink(), 'invalid_patch_path')
    data = patch.read_bytes()
    require(hashlib.sha256(data).hexdigest() == manifest['patch_sha256'], 'patch_checksum_mismatch')
    require(isinstance(manifest['files'], list) and manifest['files'], 'invalid_file_manifest')
    names = {source_path(entry['path']) for entry in manifest['files']}
    require(len(names) == len(manifest['files']), 'duplicate_patch_path')
    for entry in manifest['files']:
        require(entry['before_sha256'] is None or valid_digest(entry['before_sha256']), 'invalid_before_digest')
        require(valid_digest(entry['after_sha256']), 'invalid_after_digest')
    for item in manifest['prerequisites']:
        source_path(item['path'])
        require(valid_digest(item['sha256']), 'invalid_prerequisite_digest')
    content = data.decode('utf-8')
    headers = re.findall(r'^diff --git a/(\S+) b/(\S+)$', content, re.M)
    require(len(headers) == len(names) and {a for a, _ in headers} == names
            and all(a == b for a, b in headers), 'patch_file_set_mismatch')
    require(not re.search(r'^(?:new file mode|new mode) (?!100644$|100755$)', content, re.M),
            'nonregular_patch_file')
    stats = subprocess.run(['git', 'apply', '--numstat', str(patch)],
                           check=True, capture_output=True, text=True).stdout.splitlines()
    require({line.split('\t', 2)[-1] for line in stats} == names, 'patch_destination_set_mismatch')
    return manifest, patch, names


def main():
    global HERE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact-only', action='store_true', help='Only inspect the distributed patch and manifest.')
    parser.add_argument('--bundle', choices=['v0.0.2', 'v0.0.3'], default='v0.0.2', help='Choose an immutable patch bundle; the historical bundle remains the default.')
    parser.add_argument('--root', type=Path, help='An isolated local backend source checkout; never a production deployment directory.')
    parser.add_argument('--apply', action='store_true', help='Apply only after exact source hashes and git apply --check succeed.')
    parser.add_argument('--verify-applied', action='store_true', help='Verify the resulting source hashes instead of applying.')
    args = parser.parse_args()
    if args.bundle == 'v0.0.3':
        HERE = HERE / 'v0.0.3'
    require(not (args.artifact_only and (args.apply or args.verify_applied or args.root)), 'incompatible_modes')
    require(not (args.apply and args.verify_applied), 'incompatible_modes')
    manifest, patch, names = artifact()
    if args.artifact_only:
        print(json.dumps(dict(artifact_verified=True, source_files=len(names), backend_compiled_in_ci=False)))
        return
    require(args.root is not None, 'choose_local_source_mode')
    root = args.root.resolve(strict=True)
    require(root.is_dir(), 'invalid_source_root')
    for entry in manifest['prerequisites']:
        target = (root/entry['path']).resolve()
        require(target.is_relative_to(root) and target.is_file() and digest(target) == entry['sha256'],
                'prerequisite_mismatch:' + entry['path'])
    for entry in manifest['files']:
        target = (root/entry['path']).resolve()
        require(target.is_relative_to(root), 'source_outside_root')
        expected = entry['after_sha256'] if args.verify_applied else entry['before_sha256']
        require((not target.exists()) if expected is None else (target.is_file() and digest(target) == expected),
                'source_mismatch:' + entry['path'])
    if not args.verify_applied:
        subprocess.run(['git', '-C', str(root), 'apply', '--check', str(patch)], check=True, capture_output=True)
        if args.apply:
            subprocess.run(['git', '-C', str(root), 'apply', str(patch)], check=True, capture_output=True)
            for entry in manifest['files']:
                require(digest(root/entry['path']) == entry['after_sha256'], 'applied_hash_mismatch:' + entry['path'])
    print(json.dumps(dict(source_verified=True, files=len(names), applied=args.apply, production_deployed=False)))


if __name__ == '__main__':
    main()
