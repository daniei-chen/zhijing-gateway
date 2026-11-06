import { computed, ref } from 'vue'
import { keysAPI } from '@/api/keys'
import { useAuthStore } from '@/stores/auth'
import type { ApiKey } from '@/types'
import { assertAuthSession, captureAuthSession, isAuthSessionCurrent, subscribeAuthSession, type AuthSessionSnapshot } from '@/api/authSession'

const loaded = ref(false)
const loading = ref(false)
const hasAllowedBatchImageKey = ref(false)
let pendingLoad: Promise<boolean> | null = null
let cachedSession: AuthSessionSnapshot | null = null
let lookupVersion = 0
const pageSize = 100

function resetAccess() {
  lookupVersion += 1
  loaded.value = false
  loading.value = false
  hasAllowedBatchImageKey.value = false
  pendingLoad = null
  cachedSession = null
}

// This cache is shared by the sidebar and dashboard, so its lifetime exceeds
// either component. Clear it at the authentication boundary as well as on load.
const unsubscribeSession = subscribeAuthSession(() => {
  if (cachedSession && !isAuthSessionCurrent(cachedSession)) resetAccess()
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribeSession)

function keyAllowsBatchImage(key: ApiKey): boolean {
  return (
    key.status === 'active' &&
    key.group?.platform === 'gemini' &&
    key.group?.allow_batch_image_generation === true
  )
}

async function loadBatchImageAccess(force = false): Promise<boolean> {
  const authStore = useAuthStore()
  if (!authStore.isAuthenticated) {
    resetAccess()
    return false
  }

  let session: AuthSessionSnapshot
  try {
    session = captureAuthSession()
  } catch {
    resetAccess()
    return false
  }
  if (!cachedSession || cachedSession.generation !== session.generation || cachedSession.subject !== session.subject) {
    resetAccess()
    cachedSession = session
  }

  if (loaded.value && !force) {
    return hasAllowedBatchImageKey.value
  }

  // A forced refresh invalidates a completed cache, not an identical request
  // already in flight. Coalesce consumers instead of racing their finalizers.
  if (pendingLoad) {
    return pendingLoad
  }

  const version = ++lookupVersion
  const ownsLookup = () => version === lookupVersion && isAuthSessionCurrent(session)
  loading.value = true
  pendingLoad = (async () => {
    let page = 1
    while (true) {
      assertAuthSession(session)
      if (version !== lookupVersion) return false
      const response = await keysAPI.list(page, pageSize, {
        status: 'active',
        sort_by: 'created_at',
        sort_order: 'desc'
      })
      assertAuthSession(session)
      if (version !== lookupVersion) return false

      if ((response.items || []).some(keyAllowsBatchImage)) {
        hasAllowedBatchImageKey.value = true
        loaded.value = true
        return true
      }

      if (!Number.isFinite(response.pages) || page >= response.pages || (response.items || []).length === 0) {
        hasAllowedBatchImageKey.value = false
        loaded.value = true
        return false
      }

      page += 1
    }
  })()
    .catch(() => {
      if (ownsLookup()) {
        hasAllowedBatchImageKey.value = false
        loaded.value = false
      }
      return false
    })
    .finally(() => {
      if (version === lookupVersion) {
        loading.value = false
        pendingLoad = null
      }
    })

  return pendingLoad
}

export function useBatchImageAccess() {
  const canUseBatchImage = computed(() => hasAllowedBatchImageKey.value)

  return {
    canUseBatchImage,
    batchImageAccessLoaded: computed(() => loaded.value),
    batchImageAccessLoading: computed(() => loading.value),
    refreshBatchImageAccess: loadBatchImageAccess,
  }
}
