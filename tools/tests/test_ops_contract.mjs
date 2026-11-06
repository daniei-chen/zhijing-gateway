import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(resolve(root, 'frontend/package.json'))
const ts = require('typescript')
const sourcePath = 'frontend/src/api/admin/ops.ts'
const sha = value => createHash('sha256').update(value).digest('hex')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText
const original = 'export const endpoint = "/synthetic-original"\n'
const changed = 'export const endpoint = "/synthetic-reviewed"\n'

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'zhijing-ops-contract-'))
  for (const path of ['tools', 'docs', 'frontend/src/api/admin']) mkdirSync(resolve(directory, path), { recursive: true })
  copyFileSync(resolve(root, 'tools/verify_ops_contract.mjs'), resolve(directory, 'tools/verify_ops_contract.mjs'))
  writeFileSync(resolve(directory, 'frontend/package.json'), '{"type":"module"}')
  symlinkSync(resolve(root, 'frontend/node_modules'), resolve(directory, 'frontend/node_modules'), 'junction')
  const json = (path, data) => writeFileSync(resolve(directory, path), JSON.stringify(data))
  json('docs/compatibility-baseline.json', { protected_files: { [sourcePath]: sha(original) }, runtime_documents: {} })
  json('docs/compatibility-extensions-v0.0.2.json', { files: [{ path: sourcePath, before_sha256: sha(original), after_sha256: sha(original), runtime_sha256: sha(compile(original)) }] })
  json('docs/security-changes-v0.0.2.json', { files: [] })
  writeFileSync(resolve(directory, sourcePath), original)
  const delta = { schema_version: 1, baseline_commit: '8f72c8545d8134b4c4d14036a2060fd2a08b0053',
    authorization: 'Explicit audit request.', files: [{ path: sourcePath, before_sha256: sha(original), after_sha256: sha(changed), reason: 'Session-bound socket lifecycle correction.', tests: ['Synthetic session regression passed.'] }] }
  return {
    directory, json, delta,
    run: () => spawnSync(process.execPath, ['tools/verify_ops_contract.mjs'], { cwd: directory, encoding: 'utf8' }),
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

test('the original optional type contract remains verified without audit metadata', () => {
  const f = fixture()
  try {
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.optional_types_only, true)
    assert.equal(report.runtime_changed, false)
  } finally { f.close() }
})

test('runtime edits fail unless their exact source is in the reviewed delta', () => {
  const f = fixture()
  try {
    writeFileSync(resolve(f.directory, sourcePath), changed)
    assert.notEqual(f.run().status, 0)
    f.json('docs/security-changes-audit-20261105.json', f.delta)
    const result = f.run()
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.runtime_changed, true)
    assert.equal(report.optional_types_only, false)
    assert.equal(report.types_only, false)
    assert.equal('ops_api_methods_unchanged' in report, false)
    assert.deepEqual(report.reviewed_runtime_changes, [sourcePath])
    writeFileSync(resolve(f.directory, sourcePath), changed + 'export const unreviewed = true\n')
    assert.notEqual(f.run().status, 0)
  } finally { f.close() }
})

test('a wrong baseline, missing evidence or unknown path cannot bypass the contract', () => {
  const f = fixture()
  try {
    writeFileSync(resolve(f.directory, sourcePath), changed)
    for (const [field, value] of [['before_sha256', '0'.repeat(64)], ['tests', []], ['path', 'frontend/src/unreviewed.ts']]) {
      const candidate = JSON.parse(JSON.stringify(f.delta))
      candidate.files[0][field] = value
      f.json('docs/security-changes-audit-20261105.json', candidate)
      assert.notEqual(f.run().status, 0, field)
    }
    assert.deepEqual(JSON.parse(readFileSync(resolve(f.directory, 'docs/compatibility-baseline.json'), 'utf8')).protected_files,
      { [sourcePath]: sha(original) })
  } finally { f.close() }
})
