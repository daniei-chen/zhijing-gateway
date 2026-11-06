#!/usr/bin/env node
/**
 * Reproducible CPU microbenchmark of the exact baseline/candidate TypeScript.
 * Run with Node.js 24 after installing the candidate frontend dependencies:
 *   node tools/benchmark_auth_session.mjs --baseline /path/to/baseline \
 *     --output /path/to/auth-session-benchmark-final.json
 * --candidate defaults to the checkout containing this script.
 * This does not measure HTTP latency, browser rendering, TTFT, or throughput.
 */
import { createHash, webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cpus, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const sourcePaths = ['frontend/src/api/authSession.ts', 'frontend/src/api/authSessionDigest.ts']
const iterations = 10_000
const warmup = 2_000
const trialCount = 7
const prefix = 'SYNTHETIC-'
const accessPayloadLength = 2_048
const refreshPayloadLength = 128

function parseArguments(args) {
  const options = { candidate: resolve(dirname(scriptPath), '..') }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') return null
    const name = args[i].replace(/^--/, '')
    if (!['baseline', 'candidate', 'output'].includes(name) || !args[i].startsWith('--')) {
      throw new Error(`Unknown argument: ${args[i]}`)
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}`)
    options[name] = resolve(args[++i])
  }
  if (!options.baseline || !options.output) throw new Error('--baseline and --output are required')
  if ([scriptPath, ...[options.baseline, options.candidate].flatMap(root => sourcePaths.map(path => join(root, path)))].includes(options.output)) {
    throw new Error('The output path must not overwrite benchmark source files')
  }
  return options
}

const sha256 = value => createHash('sha256').update(value).digest('hex')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

function gitRead(root, args, encoding = 'utf8') {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null // Source archives without Git metadata remain usable.
  }
}

function makeStorage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear()
  }
}

function compileSnapshot(ts, checkout, label, temporaryDirectory) {
  const directory = join(temporaryDirectory, label)
  const sourceDirectory = join(directory, 'src')
  const outputDirectory = join(directory, 'dist')
  mkdirSync(sourceDirectory, { recursive: true })
  const files = sourcePaths.map(path => {
    const content = readFileSync(join(checkout, path))
    const headContent = gitRead(checkout, ['show', `HEAD:${path}`], null)
    const snapshot = join(sourceDirectory, path.split('/').at(-1))
    writeFileSync(snapshot, content)
    return {
      path,
      bytes: content.length,
      sha256: sha256(content),
      git_head_sha256: headContent === null ? null : sha256(headContent),
      matches_git_head: headContent === null ? null : content.equals(headContent),
      snapshot
    }
  })
  // Compile immutable copies so the emitted code and recorded hashes identify
  // the same input even if a developer edits a checkout while this runs.
  const program = ts.createProgram({
    rootNames: files.map(file => file.snapshot),
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      rootDir: sourceDirectory,
      outDir: outputDirectory,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
      strict: true,
      skipLibCheck: true,
      noEmitOnError: true
    }
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error)
  if (errors.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => checkout,
      getCanonicalFileName: name => name,
      getNewLine: () => '\n'
    }))
  }
  if (program.emit().emitSkipped) throw new Error(`TypeScript did not emit ${label}`)
  return {
    modulePath: join(outputDirectory, 'authSession.js'),
    metadata: {
      checkout,
      git_commit: gitRead(checkout, ['rev-parse', 'HEAD'])?.trim() ?? null,
      files: files.map(({ snapshot: _snapshot, ...file }) => file)
    }
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!options) {
    console.log('Usage: node tools/benchmark_auth_session.mjs --baseline CHECKOUT --output JSON [--candidate CHECKOUT]')
    return
  }
  const requireFrontend = createRequire(join(options.candidate, 'frontend/package.json'))
  const ts = requireFrontend('typescript')
  const loadCompiled = createRequire(import.meta.url)
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'zhijing-auth-benchmark-'))
  const originalGlobals = new Map()
  const setGlobal = (key, value) => {
    originalGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  try {
    writeFileSync(join(temporaryDirectory, 'package.json'), '{"type":"commonjs"}\n')
    const compiled = Object.fromEntries(['baseline', 'candidate'].map(label => [
      label, compileSnapshot(ts, options[label], label, temporaryDirectory)
    ]))
    const storage = makeStorage()
    setGlobal('localStorage', storage)
    setGlobal('sessionStorage', makeStorage())
    setGlobal('window', new EventTarget())
    if (!globalThis.crypto) setGlobal('crypto', webcrypto)
    const apis = Object.fromEntries(Object.entries(compiled).map(([label, item]) => [label, loadCompiled(item.modulePath)]))
    const input = {
      accessToken: prefix + 'a'.repeat(accessPayloadLength),
      refreshToken: prefix + 'r'.repeat(refreshPayloadLength),
      user: { id: 1 }
    }
    const samples = { baseline: [], candidate: [] }
    const trials = []
    for (let trial = 0; trial < trialCount; trial++) {
      const order = trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']
      const measurements = []
      for (const label of order) {
        const api = apis[label]
        storage.clear()
        api.replaceAuthSession(input)
        for (let i = 0; i < warmup; i++) api.captureAuthSession()
        const start = performance.now()
        for (let i = 0; i < iterations; i++) api.captureAuthSession()
        const milliseconds = performance.now() - start
        if (api.captureAuthSession().subject !== '1') throw new Error(`${label} did not preserve the synthetic identity`)
        samples[label].push(milliseconds)
        measurements.push({ label, milliseconds })
      }
      trials.push({ trial: trial + 1, order, measurements })
    }
    const results = Object.fromEntries(Object.entries(samples).map(([label, values]) => [label, {
      milliseconds: values,
      median_total_ms: median(values),
      median_microseconds_per_capture: median(values) * 1_000 / iterations
    }]))
    const output = {
      schema_version: 2,
      benchmark: 'authSession.captureAuthSession',
      measured_utc: new Date().toISOString(),
      runtime: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
      cpu_model: cpus()[0]?.model ?? null,
      logical_cpu_count: cpus().length,
      compiler: { name: 'typescript', version: ts.version, target: 'ES2022', module: 'CommonJS' },
      benchmark_script_sha256: sha256(readFileSync(scriptPath)),
      sources: Object.fromEntries(Object.entries(compiled).map(([label, item]) => [label, item.metadata])),
      environment: 'Node.js with in-memory Storage and EventTarget; no HTTP, browser rendering, real credentials, or production traffic',
      synthetic_tokens: {
        prefix,
        prefix_characters: prefix.length,
        access_payload_characters: accessPayloadLength,
        access_total_characters: input.accessToken.length,
        access_utf8_bytes: Buffer.byteLength(input.accessToken),
        refresh_payload_characters: refreshPayloadLength,
        refresh_total_characters: input.refreshToken.length,
        refresh_utf8_bytes: Buffer.byteLength(input.refreshToken)
      },
      iterations_per_trial: iterations,
      warmup_iterations_per_variant_per_trial: warmup,
      trial_count: trialCount,
      trials,
      results,
      ratio: results.baseline.median_total_ms / results.candidate.median_total_ms,
      limitations: [
        'All seven alternating trials are included; no best-run selection or discarded measurements.',
        'The storage stub has no real browser cross-tab event delivery or persistent storage cost.',
        'This is a CPU microbenchmark, not an API latency, TTFT, or throughput benchmark.',
        'The historical benchmark called 2048/128-character payloads token lengths; the SYNTHETIC- prefix makes the actual lengths 2058/138 characters.'
      ]
    }
    mkdirSync(dirname(options.output), { recursive: true })
    writeFileSync(options.output, JSON.stringify(output, null, 2) + '\n')
    console.log(JSON.stringify(output, null, 2))
  } finally {
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    for (const key of Object.keys(loadCompiled.cache)) {
      if (key.startsWith(temporaryDirectory + '/')) delete loadCompiled.cache[key]
    }
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
}
