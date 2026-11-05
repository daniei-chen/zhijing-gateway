"""Verify the actual ZIPs and download checksums, not just the source tree."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    root = args.directory.resolve(strict=True)
    for line in (root/'SHA256SUMS.txt').read_text().splitlines():
        expected, name = line.split('  ', 1)
        assert Path(name).name == name and hashlib.sha256((root/name).read_bytes()).hexdigest() == expected, 'download_checksum_mismatch'
    manifest = json.loads((root/'BUILD-MANIFEST.json').read_text())
    version = manifest['version']
    with zipfile.ZipFile(root/f'zhijing-gateway-v{version}-frontend.zip') as z:
        assert z.testzip() is None
        assert json.loads(z.read('BUILD-MANIFEST.json')) == manifest
        assert z.read('VERSION').decode().strip() == version
        assets = {n[5:] for n in z.namelist() if n.startswith('dist/') and not n.endswith('/')}
        assert assets == set(manifest['static_files']), 'archive_file_set_mismatch'
        for name, expected in manifest['static_files'].items():
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts
            assert hashlib.sha256(z.read('dist/' + name)).hexdigest() == expected, 'archive_asset_mismatch'
        assert all('.env' not in name and not name.startswith('qa/') for name in z.namelist())
    with zipfile.ZipFile(root/f'zhijing-gateway-v{version}-diagnostics-source.zip') as z:
        assert z.testzip() is None
        meta = json.loads(z.read('integrations/sub2api/INTEGRATION-MANIFEST.json'))
        assert hashlib.sha256(z.read('integrations/sub2api/' + meta['patch'])).hexdigest() == meta['patch_sha256']
    print(json.dumps(dict(version=version, archives_verified=True, static_files=len(assets), source_commit=manifest['source_commit'], production_deployed=False)))


if __name__ == '__main__':
    main()
