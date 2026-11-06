import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'frontend/package.json'))
const ts = require('typescript')
const extension = JSON.parse(readFileSync(resolve(root, 'docs/compatibility-extensions-v0.0.2.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(resolve(root, 'docs/compatibility-baseline.json'), 'utf8'))
const sha = value => createHash('sha256').update(value).digest('hex')
const requireCheck = (condition, message) => { if (!condition) throw new Error(message) }
const validHash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const auditPath = resolve(root, 'docs/security-changes-audit-20261105.json')
const reviewed = new Map()
if (existsSync(auditPath)) {
  const audit = JSON.parse(readFileSync(auditPath, 'utf8'))
  requireCheck(exactKeys(audit, ['schema_version', 'baseline_commit', 'authorization', 'files']), 'Invalid audit schema')
  requireCheck(audit.schema_version === 1 && audit.baseline_commit === '8f72c8545d8134b4c4d14036a2060fd2a08b0053', 'Invalid audit baseline')
  requireCheck(typeof audit.authorization === 'string' && audit.authorization.trim(), 'Missing audit authorization')
  requireCheck(Array.isArray(audit.files) && audit.files.length > 0, 'Empty audit delta')
  const security = JSON.parse(readFileSync(resolve(root, 'docs/security-changes-v0.0.2.json'), 'utf8'))
  const expected = new Map(Object.entries({ ...baseline.protected_files, ...baseline.runtime_documents }))
  const prior = new Set()
  for (const entry of [...extension.files, ...security.files]) {
    requireCheck(!prior.has(entry.path), 'Duplicate historical extension')
    prior.add(entry.path)
    requireCheck(!expected.has(entry.path) || expected.get(entry.path) === entry.before_sha256, 'Historical hash chain mismatch')
    requireCheck(validHash(entry.after_sha256), 'Invalid historical digest')
    expected.set(entry.path, entry.after_sha256)
  }
  for (const entry of audit.files) {
    requireCheck(exactKeys(entry, ['path', 'before_sha256', 'after_sha256', 'reason', 'tests']), 'Invalid audit entry')
    requireCheck(expected.has(entry.path) && !reviewed.has(entry.path), 'Unknown or duplicate audit path')
    requireCheck(validHash(entry.before_sha256) && entry.before_sha256 === expected.get(entry.path), 'Audit baseline mismatch')
    requireCheck(validHash(entry.after_sha256) && entry.after_sha256 !== entry.before_sha256, 'Invalid audit after digest')
    requireCheck(typeof entry.reason === 'string' && entry.reason.trim(), 'Missing audit reason')
    requireCheck(Array.isArray(entry.tests) && entry.tests.length > 0
      && entry.tests.every(test => typeof test === 'string' && test.trim()), 'Missing audit test evidence')
    reviewed.set(entry.path, entry)
  }
}
const runtimeChanges = []
for (const item of extension.files) {
  const source = readFileSync(resolve(root, item.path), 'utf8').replace(/\r\n/g, '\n')
  if (baseline.protected_files[item.path] !== item.before_sha256) throw new Error('Unexpected contract baseline')
  const delta = reviewed.get(item.path)
  if (sha(source) !== (delta?.after_sha256 ?? item.after_sha256)) throw new Error('Unreviewed API source change')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText
  if (sha(compiled) !== item.runtime_sha256) {
    if (!delta) throw new Error('API runtime behavior changed without a reviewed audit delta')
    runtimeChanges.push(item.path)
  }
}
console.log(JSON.stringify({
  verified: true,
  files: extension.files.length,
  optional_types_only: runtimeChanges.length === 0,
  types_only: runtimeChanges.length === 0,
  runtime_changed: runtimeChanges.length > 0,
  reviewed_runtime_changes: runtimeChanges,
  ...(runtimeChanges.length === 0 ? { ops_api_methods_unchanged: true } : {})
}))
