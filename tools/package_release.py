"""Create a traceable static release; never uploads or deploys anything."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not git('status', '--porcelain'), 'Commit the reviewed source and evidence before packaging.'
    version = (ROOT/'VERSION').read_text().strip()
    assert re.fullmatch(r'\d+\.\d+\.\d+', version)
    subprocess.run(['python', str(ROOT/'tools/verify_frontend.py')], check=True)
    subprocess.run(['node', str(ROOT/'tools/verify_ops_contract.mjs')], check=True)
    subprocess.run(['python', str(ROOT/'integrations/sub2api/check_patch.py'), '--artifact-only'], check=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    assert not list(output.iterdir()), 'Release output must be empty; existing releases are never overwritten.'
    dist = ROOT/'frontend/dist'
    files = sorted(p for p in dist.rglob('*') if p.is_file())
    manifest = dict(product='ZHIJING Gateway frontend', version=version,
                    source_commit=git('rev-parse', 'HEAD'), frontend_tree=git('rev-parse', 'HEAD:frontend'),
                    created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                    dependency_lock_sha256=sha(ROOT/'frontend/pnpm-lock.yaml'),
                    node_version=subprocess.check_output(['node', '--version'], text=True).strip(),
                    build_command='pnpm 9.15.9 --dir frontend build',
                    validation=json.loads((ROOT/'docs/validation-v0.0.2.json').read_text(encoding='utf-8')),
                    static_files={p.relative_to(dist).as_posix(): sha(p) for p in files}, production_deployed=False)
    manifest_path = output/'BUILD-MANIFEST.json'
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    archive = output/f'zhijing-gateway-v{version}-frontend.zip'
    instructions = (f'ZHIJING v{version}\n\n'
                    'dist/ contains the static frontend only. Keep the existing API origin and routes.\n'
                    'Original login tokens are no longer forwarded to embedded pages.\n'
                    'The optional backend source patch is distributed separately and is not deployed.\n'
                    'Retain old hashed assets when an operator later chooses to publish an entry page.\n'
                    'No QA identities, server configuration, credentials or production logs are included.\n')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in files: z.write(path, 'dist/' + path.relative_to(dist).as_posix())
        for name in ['LICENSE', 'CLA.md', 'VERSION']: z.write(ROOT/name, name)
        for path in sorted((ROOT/'docs/font-licenses').glob('*.txt')): z.write(path, 'licenses/fonts/' + path.name)
        for path in sorted((ROOT/'docs/legal').glob('*.md')): z.write(path, 'licenses/runtime/' + path.name)
        z.write(manifest_path, 'BUILD-MANIFEST.json')
        z.writestr('READ-ME.txt', instructions)
    integration = output/f'zhijing-gateway-v{version}-diagnostics-source.zip'
    with zipfile.ZipFile(integration, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for path in sorted((ROOT/'integrations/sub2api').iterdir()):
            if path.is_file(): z.write(path, 'integrations/sub2api/' + path.name)
        z.write(ROOT/'LICENSE', 'LICENSE')
    sums = [f'{sha(path)}  {path.name}' for path in [archive, integration, manifest_path]]
    (output/'SHA256SUMS.txt').write_text('\n'.join(sums) + '\n', encoding='utf-8')
    print(json.dumps(dict(version=version, static_files=len(files), source_commit=manifest['source_commit'], assets=[archive.name, integration.name, manifest_path.name, 'SHA256SUMS.txt'], production_deployed=False)))


if __name__ == '__main__':
    main()
