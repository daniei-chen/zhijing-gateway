import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'frontend/package.json'))
const ts = require('typescript')
const extension = JSON.parse(readFileSync(resolve(root, 'docs/compatibility-extensions-v0.0.2.json'), 'utf8'))
const baseline = JSON.parse(readFileSync(resolve(root, 'docs/compatibility-baseline.json'), 'utf8'))
const sha = value => createHash('sha256').update(value).digest('hex')
for (const item of extension.files) {
  const source = readFileSync(resolve(root, item.path), 'utf8').replace(/\r\n/g, '\n')
  if (baseline.protected_files[item.path] !== item.before_sha256) throw new Error('Unexpected contract baseline')
  if (sha(source) !== item.after_sha256) throw new Error('Unreviewed API source change')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText
  if (sha(compiled) !== item.runtime_sha256) throw new Error('API runtime behavior changed')
}
console.log(JSON.stringify({ verified: true, files: extension.files.length, optional_types_only: true, ops_api_methods_unchanged: true }))
