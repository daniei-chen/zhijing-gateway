"""Create a traceable static release; never uploads or deploys anything."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def sha(path):
    # Windows 8.3 names resolve to their long spelling without being links.
    # Inspect link/junction entries instead of comparing those two spellings.
    require(path.is_file() and not any(
        entry.is_symlink() or bool(getattr(entry.lstat(), 'st_file_attributes', 0) &
                                   getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400))
        for entry in (path, *path.parents)), 'Nonregular release input: ' + str(path))
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def integration_bundle(version):
    base = ROOT/'integrations/sub2api'
    root = base if version == '0.0.2' else base/f'v{version}'
    manifest = json.loads((root/'INTEGRATION-MANIFEST.json').read_text(encoding='utf-8'))
    require(manifest.get('version') == version, 'Backend bundle version does not match VERSION.')
    return root, manifest


def package_manager_command():
    # Resolve Windows .cmd shims explicitly. Prefer the reviewed package-manager
    # version through Corepack; a newer global pnpm must not change the build.
    corepack = shutil.which('corepack')
    if corepack:
        return [corepack, 'pnpm@9.15.9']
    return [shutil.which('pnpm') or 'pnpm']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not git('status', '--porcelain'), 'Commit the reviewed source and evidence before packaging.')
    source_commit = git('rev-parse', 'HEAD')
    version = (ROOT/'VERSION').read_text().strip()
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version.')
    integration_base = ROOT/'integrations/sub2api'
    integration_root, integration_manifest = integration_bundle(version)
    output = args.output.resolve()
    require(not output.is_relative_to(ROOT.resolve()), 'Release output must be outside the source checkout.')
    output.mkdir(parents=True, exist_ok=True)
    require(not list(output.iterdir()), 'Release output must be empty; existing releases are never overwritten.')
    node_version = subprocess.check_output(['node', '--version'], text=True).strip()
    pnpm = package_manager_command()
    pnpm_version = subprocess.check_output([*pnpm, '--version'], text=True).strip()
    require(re.fullmatch(r'v24\.\d+\.\d+', node_version), 'Use the reviewed Node.js 24 toolchain.')
    require(pnpm_version == '9.15.9', 'Use the reviewed pnpm 9.15.9 toolchain.')
    # dist is ignored by Git. A clean worktree alone cannot establish its provenance.
    commands = [
        [*pnpm, '--dir', 'frontend', 'install', '--frozen-lockfile'],
        [*pnpm, '--dir', 'frontend', 'lint:check'],
        [*pnpm, '--dir', 'frontend', 'build'],
        [sys.executable, str(ROOT/'tools/verify_frontend.py')],
        ['node', str(ROOT/'tools/verify_ops_contract.mjs')],
        [sys.executable, str(integration_base/'check_patch.py'), '--bundle', f'v{version}', '--artifact-only'],
        [*pnpm, '--dir', 'frontend', 'test:coverage', '--maxWorkers=4'],
    ]
    for command in commands:
        subprocess.run(command, cwd=ROOT, check=True)
    require(not git('status', '--porcelain') and git('rev-parse', 'HEAD') == source_commit,
            'Source changed during release verification.')
    dist = ROOT/'frontend/dist'
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    require((dist/'index.html').is_file() and not dist.is_symlink(), 'Missing regular frontend build.')
    require(not any(p.is_symlink() for p in dist.rglob('*')), 'Symlinks are not permitted in release assets.')
    integration_files = [integration_root/name for name in
                         ['INTEGRATION-MANIFEST.json', 'README.zh-CN.md', integration_manifest['patch']]]
    for path in integration_files:
        require(path.parent == integration_root and path.resolve().is_relative_to(integration_root.resolve()),
                'Invalid integration release path.')
        sha(path)
    checker = integration_base/'check_patch.py'
    sha(checker)
    integration_files.append(checker)
    legal_files = [(ROOT/name, name) for name in ['LICENSE', 'CLA.md', 'VERSION']]
    legal_files += [(path, 'licenses/fonts/' + path.name)
                    for path in sorted((ROOT/'docs/font-licenses').glob('*.txt'))]
    legal_files += [(path, 'licenses/runtime/' + path.name)
                    for path in sorted((ROOT/'docs/legal').glob('*.md'))]
    for path, _ in legal_files:
        sha(path)
    manifest = dict(product='ZHIJING Gateway frontend', version=version,
                    source_commit=source_commit, frontend_tree=git('rev-parse', 'HEAD:frontend'),
                    created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    dependency_lock_sha256=sha(ROOT/'frontend/pnpm-lock.yaml'),
                    node_version=node_version, pnpm_version=pnpm_version,
                    build_command='pnpm --dir frontend build',
                    validation=dict(checks=[dict(command=command, passed=True) for command in commands],
                                    backend_compiled=False),
                    static_files={p.relative_to(dist).as_posix(): sha(p) for p in files}, production_deployed=False)
    manifest_path = output/'BUILD-MANIFEST.json'
    with manifest_path.open('x', encoding='utf-8') as destination:
        destination.write(json.dumps(manifest, indent=2) + '\n')
    archive = output/f'zhijing-gateway-v{version}-frontend.zip'
    instructions = (f'ZHIJING v{version}\n\n'
                    'dist/ contains the static frontend only. Keep the existing API origin and routes.\n'
                    'Original login tokens are no longer forwarded to embedded pages.\n'
                    'The matching backend source patch is in the companion source ZIP and is not deployed.\n'
                    'Install the matching backend before publishing the frontend (OAuth exchange and cookies).\n'
                    'Retain old hashed assets when an operator later chooses to publish an entry page.\n'
                    'No QA identities, server configuration, credentials or production logs are included.\n')
    with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in files: z.write(path, 'dist/' + path.relative_to(dist).as_posix())
        for path, name in legal_files: z.write(path, name)
        z.write(manifest_path, 'BUILD-MANIFEST.json')
        z.writestr('READ-ME.txt', instructions)
    integration = output/f'zhijing-gateway-v{version}-diagnostics-source.zip'
    with zipfile.ZipFile(integration, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        # Explicit inputs exclude ignored .env files, local scripts and credentials.
        for path in integration_files:
            z.write(path, 'integrations/sub2api/' + path.name)
        z.write(ROOT/'LICENSE', 'LICENSE')
    sums = [f'{sha(path)}  {path.name}' for path in [archive, integration, manifest_path]]
    with (output/'SHA256SUMS.txt').open('x', encoding='utf-8') as destination:
        destination.write('\n'.join(sums) + '\n')
    subprocess.run([sys.executable, str(ROOT/'tools/verify_release.py'), str(output)], cwd=ROOT, check=True)
    print(json.dumps(dict(version=version, static_files=len(files), source_commit=manifest['source_commit'], assets=[archive.name, integration.name, manifest_path.name, 'SHA256SUMS.txt'], production_deployed=False)))


if __name__ == '__main__':
    main()
