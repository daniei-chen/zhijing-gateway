import { describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

// Use the real route table and real page modules, without mounting a page or
// calling its APIs. A missing/misexported lazy chunk must fail before packaging.
vi.mock('vue-router', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return { ...actual, createWebHistory: () => actual.createMemoryHistory() }
})
vi.mock('@/composables/useNavigationLoading', () => ({ useNavigationLoadingState: () => ({ startNavigation: vi.fn(), endNavigation: vi.fn() }) }))
vi.mock('@/composables/useRoutePrefetch', () => ({ useRoutePrefetch: () => ({ triggerPrefetch: vi.fn() }) }))

describe('published route lazy modules', () => {
  it('resolves each distinct registered page to an actual Vue component', async () => {
    const router = (await import('@/router')).default
    const records = router.getRoutes().filter(record => !record.aliasOf && record.components?.default)
    expect(records.length).toBeGreaterThan(50)
    const names = new Set<string>()
    for (const record of records) {
      expect(record.name, record.path).toBeTruthy()
      expect(names.has(String(record.name)), record.path).toBe(false)
      names.add(String(record.name))
      const load = record.components!.default
      expect(typeof load, record.path).toBe('function')
      const module = await (load as () => Promise<{ default: Component & { setup?: unknown; render?: unknown } }>)()
      expect(module.default, record.path).toBeTruthy()
      expect(typeof module.default.setup === 'function' || typeof module.default.render === 'function', record.path).toBe(true)
    }
  }, 60000)

  it.each([
    ['/dashboard', 'Dashboard', false], ['/keys', 'Keys', false],
    ['/usage', 'Usage', false], ['/profile', 'Profile', false],
    ['/admin/accounts', 'AdminAccounts', true], ['/admin/groups', 'AdminGroups', true],
    ['/admin/ops', 'AdminOps', true], ['/admin/settings', 'AdminSettings', true],
  ])('retains the authenticated deep link %s and its role boundary', async (path, name, admin) => {
    const router = (await import('@/router')).default
    const resolved = router.resolve(path)
    expect(resolved.name).toBe(name)
    expect(resolved.meta.requiresAuth).toBe(true)
    expect(Boolean(resolved.meta.requiresAdmin)).toBe(admin)
    expect(resolved.matched).toHaveLength(1)
  })
})
