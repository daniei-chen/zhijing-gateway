<template>
  <AppLayout>
    <div class="z-subscriptions-page z-workspace-page">
      <div v-if="loading" class="z-membership-loading" role="status" :aria-label="t('common.loading')">
        <span class="sr-only">{{ t('common.loading') }}</span>
        <div v-for="item in 2" :key="item" aria-hidden="true"><span /><span /><span /></div>
      </div>
      <WorkspaceLoadError v-else-if="loadFailed" @retry="loadSubscriptions" />
      <div v-else-if="subscriptions.length === 0" class="card p-12 text-center">
        <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-dark-700"><Icon name="creditCard" size="xl" class="text-gray-400" /></div>
        <h3 class="mb-2 text-lg font-semibold text-gray-900 dark:text-white">{{ t('userSubscriptions.noActiveSubscriptions') }}</h3>
        <p class="text-gray-500 dark:text-dark-400">{{ t('userSubscriptions.noActiveSubscriptionsDesc') }}</p>
      </div>
      <div v-else class="z-membership-list">
        <SubscriptionMembershipCard v-for="subscription in subscriptions" :key="subscription.id" :subscription="subscription" @renew="renew(subscription)" />
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import subscriptionsAPI from '@/api/subscriptions'
import type { UserSubscription } from '@/types'
import AppLayout from '@/components/layout/AppLayout.vue'
import WorkspaceLoadError from '@/components/layout/WorkspaceLoadError.vue'
import SubscriptionMembershipCard from '@/components/user/subscriptions/SubscriptionMembershipCard.vue'
import Icon from '@/components/icons/Icon.vue'

const { t } = useI18n()
const router = useRouter()
const appStore = useAppStore()
const subscriptions = ref<UserSubscription[]>([])
const loading = ref(true)
const loadFailed = ref(false)

function renew(subscription: UserSubscription) {
  void router.push({ path: '/purchase', query: { tab: 'subscription', group: String(subscription.group_id) } })
}

async function loadSubscriptions() {
  loading.value = true
  loadFailed.value = false
  try {
    subscriptions.value = await subscriptionsAPI.getMySubscriptions()
  } catch (error) {
    loadFailed.value = true
    console.error('Failed to load subscriptions:', error)
    appStore.showError(t('userSubscriptions.failedToLoad'))
  } finally {
    loading.value = false
  }
}

onMounted(loadSubscriptions)
</script>

<style scoped>
.z-membership-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.z-membership-loading { display: grid; grid-template-columns: 1fr 1.3fr; gap: 1px; overflow: hidden; border: 1px solid var(--z-line); border-radius: 22px; background: var(--z-line); }
.z-membership-loading > div { display: flex; flex-direction: column; justify-content: space-between; gap: 20px; min-height: 246px; padding: 30px; background: var(--z-surface); }
.z-membership-loading span:not(.sr-only) { display: block; width: 70%; height: 16px; border-radius: 6px; background: var(--z-line); }
.z-membership-loading span:nth-child(2) { width: 85%; height: 35px; }
@media (max-width: 900px) { .z-membership-loading { grid-template-columns: 1fr; } .z-membership-loading > div { min-height: 180px; } }
</style>
