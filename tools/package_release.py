"""Create a traceable static release; never uploads or deploys anything."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
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
    require(path.is_file() and path.resolve() == path.absolute(), 'Nonregular release input: ' + str(path))
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    require(not git('status', '--porcelain'), 'Commit the reviewed source and evidence before packaging.')
    source_commit = git('rev-parse', 'HEAD')
    version = (ROOT/'VERSION').read_text().strip()
    require(re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid release version.')
    output = args.output.resolve()
    require(not output.is_relative_to(ROOT.resolve()), 'Release output must be outside the source checkout.')
    output.mkdir(parents=True, exist_ok=True)
    require(not list(output.iterdir()), 'Release output must be empty; existing releases are never overwritten.')
    node_version = subprocess.check_output(['node', '--version'], text=True).strip()
    pnpm_version = subprocess.check_output(['pnpm', '--version'], text=True).strip()
    require(re.fullmatch(r'v24\.\d+\.\d+', node_version), 'Use the reviewed Node.js 24 toolchain.')
    require(pnpm_version == '9.15.9', 'Use the reviewed pnpm 9.15.9 toolchain.')
    # dist is ignored by Git. A clean worktree alone cannot establish its provenance.
    commands = [
        ['pnpm', '--dir', 'frontend', 'install', '--frozen-lockfile'],
        ['pnpm', '--dir', 'frontend', 'test:run', '--maxWorkers=4'],
        ['pnpm', '--dir', 'frontend', 'build'],
        [sys.executable, str(ROOT/'tools/verify_frontend.py')],
        ['node', str(ROOT/'tools/verify_ops_contract.mjs')],
        [sys.executable, str(ROOT/'integrations/sub2api/check_patch.py'), '--artifact-only'],
    ]
    for command in commands:
        subprocess.run(command, cwd=ROOT, check=True)
    require(not git('status', '--porcelain') and git('rev-parse', 'HEAD') == source_commit,
            'Source changed during release verification.')
    dist = ROOT/'frontend/dist'
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    require((dist/'index.html').is_file() and not dist.is_symlink(), 'Missing regular frontend build.')
    require(not any(p.is_symlink() for p in dist.rglob('*')), 'Symlinks are not permitted in release assets.')
    integration_root = ROOT/'integrations/sub2api'
    integration_manifest = json.loads((integration_root/'INTEGRATION-MANIFEST.json').read_text(encoding='utf-8'))
    integration_files = [integration_root/name for name in
                         ['INTEGRATION-MANIFEST.json', 'README.zh-CN.md', 'check_patch.py', integration_manifest['patch']]]
    for path in integration_files:
        require(path.parent == integration_root and path.resolve().is_relative_to(integration_root.resolve()),
                'Invalid integration release path.')
        sha(path)
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
                    'The optional backend source patch is distributed separately and is not deployed.\n'
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
