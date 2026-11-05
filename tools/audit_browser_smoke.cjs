/** Synthetic loopback browser checks; never connects to the production service.
 * Requires Playwright and an installed browser. For an isolated serverless
 * browser package set AUDIT_CHROMIUM_PACKAGE_ROOT to its npm install prefix.
 * Run from any directory after building frontend/dist.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const output = path.resolve(process.env.AUDIT_BROWSER_OUTPUT || path.join(root, 'frontend/.cache/audit-browser'))
const moduleRoots = [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, path.join(root, 'frontend')].filter(Boolean)
const { chromium: playwright } = require(require.resolve('playwright', { paths: moduleRoots }))
const results = { environment: 'isolated synthetic fixtures; external browser traffic blocked', checks: [], page_errors: [], blocked_external_requests: 0 }
fs.mkdirSync(output, { recursive: true })

async function main() {
  // Only this temporary process enables registration fixtures. No mail is sent:
  // the verification endpoint is fulfilled inside the isolated browser context.
  const fixture = spawn('python3', ['-u', '-c', [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'import preview_server as preview',
    'preview.SETTINGS.update(registration_enabled=True, email_verify_enabled=True)',
    "server = preview.ThreadingHTTPServer(('127.0.0.1', 0), preview.Handler)",
    'print(server.server_port, flush=True)',
    'server.serve_forever()',
  ].join('\n'), path.join(root, 'qa')], { stdio: ['ignore', 'pipe', 'pipe'] })
  let fixtureLog = ''
  fixture.stderr.on('data', chunk => { fixtureLog += chunk })
  let browser
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 10000)
      fixture.once('error', error => { clearTimeout(timer); reject(error) })
      fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Fixture exited: ${code}`)) })
      fixture.stdout.once('data', chunk => {
        clearTimeout(timer)
        const value = Number(String(chunk).trim().split('\n')[0])
        if (!Number.isInteger(value) || value <= 0 || value > 65535) reject(new Error('Invalid fixture port'))
        else resolve(value)
      })
    })
    const origin = `http://127.0.0.1:${port}`
    let launch = { headless: true }
    if (process.env.AUDIT_CHROMIUM_PACKAGE_ROOT) {
      const loaded = require(require.resolve('@sparticuz/chromium', { paths: [process.env.AUDIT_CHROMIUM_PACKAGE_ROOT] }))
      const chromium = loaded.default || loaded
      chromium.setGraphicsMode = false
      // Preserve normal origin security and independent contexts. The optional
      // serverless preset otherwise disables isolation and uses one process.
      const args = chromium.args.filter(arg => ![
        '--single-process', '--disable-web-security', '--disable-site-isolation-trials',
        '--allow-running-insecure-content',
      ].includes(arg) && !(arg.startsWith('--disable-features=') && arg.includes('IsolateOrigins')))
      launch = { ...launch, args, executablePath: await chromium.executablePath() }
    }
    browser = await playwright.launch(launch)
    results.browser = await browser.version()
    async function context(viewport) {
      const item = await browser.newContext({ viewport, locale: 'zh-CN' })
      await item.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue()
        results.blocked_external_requests += 1
        return route.abort()
      })
      item.on('page', page => page.on('pageerror', error => results.page_errors.push(error.message)))
      return item
    }
    async function noOverflow(page, name) {
      // ResizeObserver/chart layout and responsive transitions settle after the
      // viewport RPC returns. Check the settled layout, with a bounded wait.
      try {
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1, null, { timeout: 2500 })
      } catch {
        results.overflow_elements = await page.locator('body *').evaluateAll(items => items
          .filter(item => item.getBoundingClientRect().right > innerWidth + 1 && item.getBoundingClientRect().width > 0)
          .slice(0, 20).map(item => ({ tag: item.tagName, class: String(item.className), right: item.getBoundingClientRect().right, width: item.getBoundingClientRect().width })))
        await page.screenshot({ path: path.join(output, 'overflow-failure.png'), fullPage: true })
      }
      const box = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
      assert.ok(box.document <= box.viewport + 1, `${name}: horizontal overflow ${JSON.stringify(box)}`)
      results.checks.push({ name, ...box, passed: true })
    }

    const desktop = await context({ width: 1440, height: 1000 })
    const admin = await desktop.newPage()
    await admin.goto(`${origin}/login`, { waitUntil: 'networkidle' })
    await noOverflow(admin, 'desktop login layout')
    await admin.locator('#email').fill('admin@preview.local')
    await admin.locator('#password').fill('Preview2026!')
    await admin.locator('#zhijing-login-submit').click()
    await admin.waitForURL('**/admin/dashboard')
    results.checks.push({ name: 'synthetic administrator login reaches the administrator dashboard', passed: true })
    await admin.screenshot({ path: path.join(output, 'admin-dashboard.png'), fullPage: true })

    const member = await desktop.newPage()
    await member.goto(`${origin}/__preview/member`, { waitUntil: 'networkidle' })
    await admin.waitForFunction(() => !location.pathname.startsWith('/admin/'), null, { timeout: 10000 })
    assert.equal(await admin.evaluate(() => JSON.parse(localStorage.getItem('auth_user')).role), 'user')
    results.checks.push({ name: 'cross-tab member replacement removes the old administrator route', passed: true, resulting_path: new URL(admin.url()).pathname })
    await member.setViewportSize({ width: 320, height: 800 })
    await noOverflow(member, '320px member dashboard layout')
    await member.screenshot({ path: path.join(output, 'member-mobile.png'), fullPage: true })
    await desktop.close()

    const registration = await context({ width: 390, height: 844 })
    let sentVerificationRequests = 0
    await registration.route('**/api/v1/auth/send-verify-code', route => {
      sentVerificationRequests += 1
      return route.fulfill({ json: { code: 0, message: 'synthetic fixture', data: { countdown: 60 } } })
    })
    const signup = await registration.newPage()
    await signup.goto(`${origin}/register`, { waitUntil: 'networkidle' })
    await signup.locator('#email').fill('registration@synthetic.invalid')
    await signup.locator('#password').fill('SyntheticRegistration2026!')
    await signup.locator('#confirmPassword').fill('SyntheticRegistration2026!')
    await signup.locator('form button[type="submit"]').click()
    await signup.waitForURL('**/email-verify')
    await signup.locator('#code').waitFor()
    const storage = await signup.evaluate(() => ({ legacy: sessionStorage.getItem('register_data'), serialized: JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]) }))
    assert.equal(storage.legacy, null)
    assert.ok(!storage.serialized.includes('SyntheticRegistration2026!'))
    results.checks.push({ name: 'registration SPA handoff preserves verification form without persisting its password', passed: true })
    await noOverflow(signup, '390px email verification layout')
    await signup.reload({ waitUntil: 'networkidle' })
    assert.equal(await signup.locator('#code').count(), 0)
    assert.match(await signup.locator('body').innerText(), /过期|expired/i)
    results.checks.push({ name: 'verification reload cannot recover the old password and shows expiration', passed: true, synthetic_verification_requests: sentVerificationRequests })
    await signup.screenshot({ path: path.join(output, 'registration-expired-mobile.png'), fullPage: true })
    await registration.close()

    const small = await context({ width: 320, height: 740 })
    const login = await small.newPage()
    for (const theme of ['light', 'dark']) {
      await login.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await login.goto(`${origin}/login`, { waitUntil: 'networkidle' })
      await noOverflow(login, `320px ${theme} login layout with reduced motion`)
    }
    await login.screenshot({ path: path.join(output, 'login-mobile.png'), fullPage: true })
    await small.close()
    assert.deepEqual(results.page_errors, [])
    results.success = true
  } catch (error) {
    results.success = false
    results.failure = error.stack
    throw error
  } finally {
    if (browser) await browser.close()
    fixture.kill('SIGTERM')
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    if (fixtureLog) fs.writeFileSync(path.join(output, 'fixture-stderr.txt'), fixtureLog)
  }
}
main().then(() => console.log(JSON.stringify(results))).catch(error => { console.error(error.stack); process.exitCode = 1 })
