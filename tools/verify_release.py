"""Verify release contents and integrity; checksums alone do not authenticate a publisher."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

# Bound decompression work before reading untrusted download contents.
MAX_ARCHIVE_FILES = 10000
MAX_FILE_BYTES = 128 * 1024 * 1024
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name,
            'unsafe_archive_path')
    require(not any(ord(char) < 32 or ord(char) == 127 for char in name), 'unsafe_archive_path')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == name,
            'unsafe_archive_path')
    require(not any(part == 'qa' or part.startswith('.env') for part in path.parts),
            'private_file_in_archive')
    return path


def valid_digest(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def sha(path):
    require(path.is_file() and not path.is_symlink(), 'invalid_release_file:' + path.name)
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for name, value in pairs:
        require(name not in result, 'duplicate_json_key:' + name)
        result[name] = value
    return result


def read_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def archive_files(archive):
    entries = archive.infolist()
    require(len(entries) <= MAX_ARCHIVE_FILES, 'archive_file_limit')
    names = set()
    size = 0
    for item in entries:
        safe_name(item.filename)
        require(item.filename not in names, 'duplicate_archive_entry:' + item.filename)
        require(not item.is_dir(), 'unexpected_archive_directory:' + item.filename)
        require(not item.flag_bits & 1, 'encrypted_archive_entry')
        mode = stat.S_IFMT(item.external_attr >> 16)
        require(mode in (0, stat.S_IFREG), 'nonregular_archive_entry:' + item.filename)
        require(0 <= item.file_size <= MAX_FILE_BYTES, 'archive_file_size_limit')
        size += item.file_size
        require(size <= MAX_ARCHIVE_BYTES, 'archive_total_size_limit')
        names.add(item.filename)
    return names


def verify(directory):
    root = directory.resolve(strict=True)
    require(root.is_dir(), 'invalid_release_directory')
    manifest_path = root / 'BUILD-MANIFEST.json'
    require(manifest_path.is_file() and not manifest_path.is_symlink(), 'invalid_manifest_file')
    require(manifest_path.stat().st_size <= 4 * 1024 * 1024, 'manifest_size_limit')
    manifest = read_json(manifest_path.read_bytes())
    require(isinstance(manifest, dict), 'invalid_manifest')
    version = manifest.get('version')
    require(isinstance(version, str) and re.fullmatch(r'\d+\.\d+\.\d+', version), 'invalid_version')
    require(isinstance(manifest.get('source_commit'), str) and
            re.fullmatch(r'[0-9a-f]{40}', manifest['source_commit']), 'invalid_source_commit')
    static = manifest.get('static_files')
    require(isinstance(static, dict) and 'index.html' in static, 'invalid_static_manifest')
    require(len(static) <= MAX_ARCHIVE_FILES, 'static_file_limit')
    for name, expected in static.items():
        safe_name(name)
        require(valid_digest(expected), 'invalid_static_digest:' + name)

    frontend = f'zhijing-gateway-v{version}-frontend.zip'
    integration = f'zhijing-gateway-v{version}-diagnostics-source.zip'
    expected_downloads = {frontend, integration, 'BUILD-MANIFEST.json'}
    sums_path = root / 'SHA256SUMS.txt'
    require(sums_path.is_file() and not sums_path.is_symlink(), 'invalid_checksum_file')
    require(sums_path.stat().st_size <= 4096, 'checksum_file_size_limit')
    sums = {}
    for line in sums_path.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([^/\\]+)', line)
        require(match is not None, 'invalid_checksum_line')
        expected, name = match.groups()
        require(name in expected_downloads and name not in sums, 'invalid_checksum_entry:' + name)
        sums[name] = expected
    require(set(sums) == expected_downloads, 'download_checksum_set_mismatch')
    for name, expected in sums.items():
        require(sha(root / name) == expected, 'download_checksum_mismatch:' + name)

    with zipfile.ZipFile(root / frontend) as archive:
        names = archive_files(archive)
        required = {'LICENSE', 'CLA.md', 'VERSION', 'BUILD-MANIFEST.json', 'READ-ME.txt'}
        licenses = {name for name in names if re.fullmatch(
            r'licenses/(?:fonts/[^/]+\.txt|runtime/[^/]+\.md)', name)}
        require(names == required | licenses | {'dist/' + name for name in static},
                'archive_file_set_mismatch')
        require(archive.testzip() is None, 'archive_crc_mismatch')
        require(read_json(archive.read('BUILD-MANIFEST.json')) == manifest, 'archive_manifest_mismatch')
        require(archive.read('VERSION').decode().strip() == version, 'archive_version_mismatch')
        for name, expected in static.items():
            require(hashlib.sha256(archive.read('dist/' + name)).hexdigest() == expected,
                    'archive_asset_mismatch:' + name)

    with zipfile.ZipFile(root / integration) as archive:
        names = archive_files(archive)
        prefix = 'integrations/sub2api/'
        require(prefix + 'INTEGRATION-MANIFEST.json' in names, 'integration_manifest_missing')
        meta = read_json(archive.read(prefix + 'INTEGRATION-MANIFEST.json'))
        require(isinstance(meta, dict), 'invalid_integration_manifest')
        patch = meta.get('patch')
        require(isinstance(patch, str), 'invalid_patch_path')
        path = safe_name(patch)
        require(len(path.parts) == 1 and path.suffix == '.patch', 'invalid_patch_path')
        require(names == {'LICENSE'} | {prefix + name for name in
                ('INTEGRATION-MANIFEST.json', 'README.zh-CN.md', 'check_patch.py', patch)},
                'integration_file_set_mismatch')
        require(valid_digest(meta.get('patch_sha256')), 'invalid_patch_digest')
        require(hashlib.sha256(archive.read(prefix + patch)).hexdigest() == meta['patch_sha256'],
                'integration_patch_mismatch')
        require(archive.testzip() is None, 'archive_crc_mismatch')
    return dict(version=version, archives_verified=True, static_files=len(static),
                source_commit=manifest['source_commit'], production_deployed=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.directory)))


if __name__ == '__main__':
    main()
