// Structural inventory only: no alias resolution or proof of sanitizer correctness.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const output = process.argv[2]
if (!output) throw new Error('Usage: node tools/audit_frontend_structure.cjs <output.json>')
const ts = require(path.join(root, 'frontend/node_modules/typescript'))
const { parse } = require(path.join(root, 'frontend/node_modules/vue/compiler-sfc'))
const files = new Set()
function collect(relative) {
  const absolute = path.join(root, relative)
  if (fs.statSync(absolute).isDirectory()) {
    for (const entry of fs.readdirSync(absolute)) collect(path.join(relative, entry))
  } else if (/\.(ts|vue)$/.test(relative)) files.add(relative)
}
for (const scope of ['frontend/src', 'frontend/vite.config.ts', 'frontend/vitest.config.ts', 'frontend/build']) collect(scope)
const results = [...files].sort().map(relative => {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const result = {
    path: relative, sha256: crypto.createHash('sha256').update(source).digest('hex'),
    lines: source.split('\n').length, scriptLines: 0, test: /(__tests__|\.spec\.|\.test\.)/.test(relative),
    parseErrors: [], calls: [], storage: [], sinks: [], vHtml: [],
  }
  let scripts = [{ content: source, lineOffset: 0 }]
  if (relative.endsWith('.vue')) {
    const parsed = parse(source, { filename: relative })
    result.parseErrors.push(...parsed.errors.map(error => String(error.message || error)))
    scripts = [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean).map(block => ({ content: block.content, lineOffset: block.loc.start.line - 1 }))
    for (const match of source.matchAll(/\bv-html\s*=\s*(["'])(.*?)\1/g)) {
      result.vHtml.push({ line: source.slice(0, match.index).split('\n').length, expression: match[2] })
    }
  }
  for (const script of scripts) {
    result.scriptLines += script.content.split('\n').length
    const ast = ts.createSourceFile(relative, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    result.parseErrors.push(...ast.parseDiagnostics.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')))
    function visit(node) {
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 + script.lineOffset
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const name = node.expression.getText(ast)
        if (/(^|\.)(setInterval|setTimeout|clearInterval|clearTimeout|addEventListener|removeEventListener|fetch|watch|watchEffect|onMounted|onBeforeUnmount|onUnmounted|onScopeDispose|createObjectURL|revokeObjectURL|requestAnimationFrame|cancelAnimationFrame|AbortController)$/.test(name) || /^Promise\.(all|allSettled)$/.test(name)) {
          result.calls.push({ line, name, asyncCallback: (node.arguments || []).some(arg => (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) || false })
        }
        if (/^(localStorage|sessionStorage|indexedDB)\./.test(name)) result.storage.push({ line, name })
        if (/(^|\.)(write|insertAdjacentHTML)$/.test(name)) result.sinks.push({ line, name })
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /\.(innerHTML|outerHTML)$/.test(node.left.getText(ast))) result.sinks.push({ line, name: node.left.getText(ast) })
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  return result
})
fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n')
process.stdout.write(JSON.stringify({ files: results.length, productionFiles: results.filter(file => !file.test).length, lines: results.reduce((sum, file) => sum + file.lines, 0), parseErrors: results.filter(file => file.parseErrors.length).map(file => ({ path: file.path, errors: file.parseErrors })) }) + '\n')
