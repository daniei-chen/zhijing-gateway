"""Release verification must reject corrupt or unsafe artifacts in every Python mode."""
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[2]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReleaseVerificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.frontend = self.root / 'zhijing-gateway-v0.0.2-frontend.zip'
        self.integration = self.root / 'zhijing-gateway-v0.0.2-diagnostics-source.zip'
        self.manifest = dict(version='0.0.2', source_commit='a' * 40,
                             static_files={'index.html': sha(b'<html>synthetic</html>')})
        self.manifest_bytes = (json.dumps(self.manifest) + '\n').encode()
        (self.root / 'BUILD-MANIFEST.json').write_bytes(self.manifest_bytes)
        self.frontend_members = {
            'dist/index.html': b'<html>synthetic</html>',
            'BUILD-MANIFEST.json': self.manifest_bytes,
            'VERSION': b'0.0.2\n', 'LICENSE': b'synthetic license',
            'CLA.md': b'synthetic agreement', 'READ-ME.txt': b'synthetic instructions',
        }
        backend = ROOT / 'integrations/sub2api'
        self.integration_members = {
            'LICENSE': b'synthetic license',
            **{'integrations/sub2api/' + name: (backend / name).read_bytes()
               for name in ('INTEGRATION-MANIFEST.json', 'v0.0.2-diagnostics.patch',
                            'README.zh-CN.md', 'check_patch.py')},
        }
        self.write_archive(self.frontend, self.frontend_members)
        self.write_archive(self.integration, self.integration_members)
        self.write_sums()

    def write_archive(self, path, members):
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in members.items():
                archive.writestr(name, data)

    def write_sums(self):
        (self.root / 'SHA256SUMS.txt').write_text('\n'.join(
            f'{sha(path.read_bytes())}  {path.name}' for path in
            (self.frontend, self.integration, self.root / 'BUILD-MANIFEST.json')) + '\n')

    def verify(self, optimized=False):
        return subprocess.run([sys.executable, *(['-O'] if optimized else []),
                               str(ROOT / 'tools/verify_release.py'), str(self.root)],
                              capture_output=True, text=True, timeout=10)

    def assert_rejected(self, optimized=False):
        result = self.verify(optimized)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('"archives_verified": true', result.stdout)

    def test_valid_release_is_accepted_in_both_python_modes(self):
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.verify(optimized)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('"archives_verified": true', result.stdout)

    def test_checksums_cannot_be_empty_or_omit_an_archive(self):
        for text in ('', f'{sha(self.manifest_bytes)}  BUILD-MANIFEST.json\n'):
            with self.subTest(checksums=text):
                (self.root / 'SHA256SUMS.txt').write_text(text)
                self.assert_rejected()

    def test_optimized_python_still_rejects_a_tampered_asset(self):
        self.frontend_members['dist/index.html'] = b'<html>tampered</html>'
        self.write_archive(self.frontend, self.frontend_members)
        self.write_sums()
        self.assert_rejected(optimized=True)

    def test_duplicate_zip_entries_are_rejected(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(self.frontend, 'a') as archive:
                archive.writestr('dist/index.html', self.frontend_members['dist/index.html'])
        self.write_sums()
        self.assert_rejected()

    def test_path_traversal_in_either_archive_is_rejected(self):
        for path in (self.frontend, self.integration):
            with self.subTest(archive=path.name):
                with zipfile.ZipFile(path, 'a') as archive:
                    archive.writestr('../../outside.txt', b'unsafe')
                self.write_sums()
                self.assert_rejected()
                self.write_archive(path, self.frontend_members if path == self.frontend else self.integration_members)

    def test_unlisted_release_files_are_rejected(self):
        self.integration_members['integrations/sub2api/.env'] = b'SYNTHETIC_SECRET=value'
        self.write_archive(self.integration, self.integration_members)
        self.write_sums()
        self.assert_rejected()

    def test_backend_bundle_version_must_match_the_frontend_release(self):
        name = 'integrations/sub2api/INTEGRATION-MANIFEST.json'
        meta = json.loads(self.integration_members[name])
        meta['version'] = '0.0.1'
        self.integration_members[name] = json.dumps(meta).encode()
        self.write_archive(self.integration, self.integration_members)
        self.write_sums()
        result = self.verify(optimized=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('integration_version_mismatch', result.stderr)

    def test_symlink_zip_entry_is_rejected(self):
        with zipfile.ZipFile(self.frontend, 'a') as archive:
            info = zipfile.ZipInfo('licenses/fonts/link.txt')
            info.create_system = 3
            info.external_attr = (0o120777 << 16)
            archive.writestr(info, '../../outside')
        self.write_sums()
        self.assert_rejected()


class PatchVerificationTests(unittest.TestCase):
    def test_optimized_python_still_checks_patch_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = ROOT / 'integrations/sub2api'
            for name in ('check_patch.py', 'INTEGRATION-MANIFEST.json', 'v0.0.2-diagnostics.patch'):
                (root / name).write_bytes((source / name).read_bytes())
            manifest = json.loads((root / 'INTEGRATION-MANIFEST.json').read_text())
            manifest['patch_sha256'] = '0' * 64
            (root / 'INTEGRATION-MANIFEST.json').write_text(json.dumps(manifest))
            result = subprocess.run([sys.executable, '-O', str(root / 'check_patch.py'), '--artifact-only'],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertIn('patch_checksum_mismatch', result.stderr)


class PackageProvenanceTests(unittest.TestCase):
    def test_corepack_pins_the_reviewed_package_manager_instead_of_global_pnpm(self):
        module = load_module('package_corepack_for_test', ROOT / 'tools/package_release.py')
        with patch.object(module.shutil, 'which', return_value='/synthetic/corepack.cmd'):
            self.assertEqual(module.package_manager_command(), ['/synthetic/corepack.cmd', 'pnpm@9.15.9'])

    def test_without_corepack_resolves_the_pnpm_executable_for_the_existing_version_check(self):
        module = load_module('package_pnpm_fallback_for_test', ROOT / 'tools/package_release.py')
        with patch.object(module.shutil, 'which', side_effect=[None, '/synthetic/pnpm.cmd']):
            self.assertEqual(module.package_manager_command(), ['/synthetic/pnpm.cmd'])

    def test_v004_bundle_is_selected_and_missing_version_never_falls_back(self):
        module = load_module('package_v004_bundle_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = root / 'integrations/sub2api'
            nested = base / 'v0.0.4'
            nested.mkdir(parents=True)
            (base / 'INTEGRATION-MANIFEST.json').write_text(json.dumps(dict(version='0.0.2')))
            manifest = nested / 'INTEGRATION-MANIFEST.json'
            manifest.write_text(json.dumps(dict(version='0.0.4')))
            with patch.object(module, 'ROOT', root):
                self.assertEqual(module.integration_bundle('0.0.4')[0], nested)
                manifest.write_text(json.dumps(dict(version='0.0.3')))
                with self.assertRaisesRegex(ValueError, 'Backend bundle version'):
                    module.integration_bundle('0.0.4')
                manifest.unlink()
                with self.assertRaises(FileNotFoundError):
                    module.integration_bundle('0.0.4')

    def test_v003_selects_its_own_backend_bundle_without_falling_back_to_v002(self):
        module = load_module('package_bundle_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base = root / 'integrations/sub2api'
            nested = base / 'v0.0.3'
            nested.mkdir(parents=True)
            (base / 'INTEGRATION-MANIFEST.json').write_text(json.dumps(dict(version='0.0.2')))
            (nested / 'INTEGRATION-MANIFEST.json').write_text(json.dumps(dict(version='0.0.3')))
            with patch.object(module, 'ROOT', root):
                self.assertEqual(module.integration_bundle('0.0.2')[0], base)
                self.assertEqual(module.integration_bundle('0.0.3')[0], nested)
                (nested / 'INTEGRATION-MANIFEST.json').write_text(json.dumps(dict(version='0.0.2')))
                with self.assertRaisesRegex(ValueError, 'Backend bundle version'):
                    module.integration_bundle('0.0.3')
                (nested / 'INTEGRATION-MANIFEST.json').unlink()
                with self.assertRaises(FileNotFoundError):
                    module.integration_bundle('0.0.3')

    def test_sha_rejects_windows_reparse_points_without_requiring_new_pathlib(self):
        module = load_module('package_reparse_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'file.txt'
            path.write_text('synthetic')
            with patch.object(Path, 'is_symlink', return_value=False), \
                 patch.object(Path, 'lstat', return_value=SimpleNamespace(st_file_attributes=0x400)):
                with self.assertRaisesRegex(ValueError, 'Nonregular release input'):
                    module.sha(path)

    def test_regular_file_may_have_a_different_resolved_spelling(self):
        module = load_module('package_sha_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'file.txt'
            path.write_bytes(b'regular content')
            with patch.object(Path, 'resolve', return_value=Path(directory) / 'long-spelling.txt'):
                self.assertEqual(module.sha(path), sha(b'regular content'))

    def test_sha_rejects_linked_files_and_linked_parent_directories(self):
        module = load_module('package_link_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'actual'
            target.mkdir()
            (target / 'file.txt').write_text('synthetic')
            link = root / 'link'
            try:
                link.symlink_to(target, target_is_directory=True)
            except OSError as error:
                self.skipTest('Platform does not permit synthetic symlinks: ' + str(error))
            with self.assertRaisesRegex(ValueError, 'Nonregular release input'):
                module.sha(link / 'file.txt')

    def test_package_rebuilds_dist_and_excludes_ignored_integration_secrets(self):
        module = load_module('package_release_for_test', ROOT / 'tools/package_release.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            output = Path(directory) / 'release'
            for path in ('frontend/dist', 'docs', 'integrations/sub2api'):
                (root / path).mkdir(parents=True, exist_ok=True)
            for name, data in {'VERSION': '0.0.2\n', 'LICENSE': 'license', 'CLA.md': 'agreement',
                               'frontend/pnpm-lock.yaml': 'synthetic-lock',
                               'frontend/dist/index.html': 'stale ignored dist',
                               'docs/validation-v0.0.2.json': '{}',
                               'integrations/sub2api/.env': 'SYNTHETIC_SECRET=do-not-package'}.items():
                (root / name).write_text(data)
            for name in ('INTEGRATION-MANIFEST.json', 'v0.0.2-diagnostics.patch', 'README.zh-CN.md', 'check_patch.py'):
                (root / 'integrations/sub2api' / name).write_bytes((ROOT / 'integrations/sub2api' / name).read_bytes())

            def git(*args):
                return '' if args[0] == 'status' else 'a' * 40

            def command(args, **kwargs):
                if args[-3:] == ['--dir', 'frontend', 'build']:
                    (root / 'frontend/dist/index.html').write_text('fresh build from reviewed source')
                return subprocess.CompletedProcess(args, 0)

            def command_output(args, **kwargs):
                return 'v24.0.0\n' if args[0] == 'node' else '9.15.9\n'

            with patch.object(module, 'ROOT', root), patch.object(module, 'git', git), \
                 patch.object(module.subprocess, 'run', command), \
                 patch.object(module.subprocess, 'check_output', command_output), \
                 patch.object(sys, 'argv', ['package_release.py', '--output', str(output)]):
                module.main()
            with zipfile.ZipFile(output / 'zhijing-gateway-v0.0.2-frontend.zip') as archive:
                self.assertEqual(archive.read('dist/index.html'), b'fresh build from reviewed source')
            with zipfile.ZipFile(output / 'zhijing-gateway-v0.0.2-diagnostics-source.zip') as archive:
                self.assertNotIn('integrations/sub2api/.env', archive.namelist())


if __name__ == '__main__':
    unittest.main()
