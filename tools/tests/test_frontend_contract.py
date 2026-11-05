"""A reviewed delta is an explicit hash chain, never a blanket exemption."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = 'frontend/src/api/client.ts'
BASE = '8f72c8545d8134b4c4d14036a2060fd2a08b0053'


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


class FrontendContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for path in ('docs', 'frontend/src/api', 'frontend/src/router', 'frontend/dist/app-assets'):
            (self.root / path).mkdir(parents=True, exist_ok=True)
        self.baseline = dict(protected_files={SOURCE: sha('old source')}, runtime_documents={})
        self.write_json('docs/compatibility-baseline.json', self.baseline)
        self.write_json('docs/compatibility-extensions-v0.0.2.json', dict(files=[]))
        self.write_json('docs/security-changes-v0.0.2.json', dict(files=[]))
        (self.root / SOURCE).write_text('old source')
        (self.root / 'frontend/src/router/index.ts').write_text('\n'.join(
            f"{{ path: '/synthetic-route-{index}' }}" for index in range(68)))
        (self.root / 'frontend/dist/index.html').write_text('<script src="/app-assets/main.js"></script>')
        (self.root / 'frontend/dist/app-assets/main.js').write_text('synthetic static build')
        self.delta = dict(schema_version=1, baseline_commit=BASE, authorization='Explicit audit request.', files=[
            dict(path=SOURCE, before_sha256=sha('old source'), after_sha256=sha('reviewed source'),
                 reason='Fix a reproduced session isolation failure.', tests=['Synthetic regression passed.'])])

    def write_json(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def run_check(self, optimized=False):
        code = ('import importlib.util, pathlib, sys; '
                'spec=importlib.util.spec_from_file_location("contract", sys.argv[1]); '
                'module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); '
                'module.ROOT=pathlib.Path(sys.argv[2]); module.verify()')
        return subprocess.run([sys.executable, *(['-O'] if optimized else []), '-c', code,
                               str(ROOT / 'tools/verify_frontend.py'), str(self.root)],
                              capture_output=True, text=True, timeout=10)

    def test_original_baseline_passes_without_an_audit_delta(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_optimized_python_still_rejects_unreviewed_source(self):
        (self.root / SOURCE).write_text('unreviewed source')
        result = self.run_check(optimized=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('contract_changed', result.stderr)

    def test_explicit_delta_passes_without_rewriting_historical_baselines(self):
        self.write_json('docs/security-changes-audit-20261105.json', self.delta)
        (self.root / SOURCE).write_text('reviewed source')
        for optimized in (False, True):
            with self.subTest(optimized=optimized):
                result = self.run_check(optimized)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn('"reviewed_audit_files": 1', result.stdout)
        self.assertEqual(json.loads((self.root / 'docs/compatibility-baseline.json').read_text()), self.baseline)

    def test_delta_cannot_approve_an_unknown_file_or_break_the_hash_chain(self):
        for field, value in [('path', 'frontend/src/new.ts'), ('before_sha256', 'f' * 64),
                             ('after_sha256', 'invalid'), ('reason', ''), ('tests', []),
                             ('tests', [''])]:
            with self.subTest(field=field, value=value):
                candidate = json.loads(json.dumps(self.delta))
                candidate['files'][0][field] = value
                self.write_json('docs/security-changes-audit-20261105.json', candidate)
                (self.root / SOURCE).write_text('reviewed source')
                result = self.run_check(optimized=True)
                self.assertNotEqual(result.returncode, 0, result.stdout)

    def test_unknown_schema_fields_and_duplicate_entries_are_rejected(self):
        variants = [dict(self.delta, blanket_approval=True),
                    dict(self.delta, files=self.delta['files'] * 2),
                    dict(self.delta, baseline_commit='b' * 40)]
        for candidate in variants:
            with self.subTest(candidate=candidate):
                self.write_json('docs/security-changes-audit-20261105.json', candidate)
                (self.root / SOURCE).write_text('reviewed source')
                result = self.run_check()
                self.assertNotEqual(result.returncode, 0, result.stdout)


if __name__ == '__main__':
    unittest.main()
