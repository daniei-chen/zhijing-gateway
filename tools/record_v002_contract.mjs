// One-time reviewed metadata capture. Runtime equality is checked before writing.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(root, 'frontend/package.json'))
const ts = require('typescript')
const path = 'frontend/src/api/admin/ops.ts'
const before = execFileSync('git', ['show', `d8551a2257746993f9844b6fffa325dd1ff5c172:${path}`], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n')
const after = readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n')
const sha = value => createHash('sha256').update(value).digest('hex')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText
if (compile(before) !== compile(after)) throw new Error('Runtime API code differs; cannot record a type-only extension')
writeFileSync(resolve(root, 'docs/compatibility-extensions-v0.0.2.json'), JSON.stringify({ version: '0.0.2', files: [{ path, before_sha256: sha(before), after_sha256: sha(after), runtime_sha256: sha(compile(before)), reason: 'Only optional request diagnostic types and recorded error-origin fields are added. Request methods, URLs and serialization stay unchanged.' }] }, null, 2) + '\n')
console.log('Recorded one optional type extension with identical compiled API runtime.')
