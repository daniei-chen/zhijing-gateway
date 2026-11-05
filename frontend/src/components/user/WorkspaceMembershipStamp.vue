<template>
  <span class="z-membership-stamp" :class="{ 'is-compact': compact }">
    <svg class="z-membership-gem" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="m14 3 10 11-10 11L4 14 14 3Z" stroke="currentColor" stroke-width="1.3"/><path d="m14 3 4 11-4 11-4-11 4-11ZM4 14h20" stroke="currentColor" stroke-width=".8"/></svg>
    <span class="z-membership-copy"><strong>{{ subscription.group?.name || (zh ? '当前订阅' : 'Your plan') }}</strong><small v-if="expiry">{{ zh ? '到期 ' : 'Until ' }}{{ expiry }}</small><small v-else>{{ zh ? '无到期限制' : 'No expiry date' }}</small></span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UserSubscription } from '@/types'
const props = defineProps<{ subscription: UserSubscription; compact?: boolean }>()
const { locale } = useI18n()
const zh = computed(() => locale?.value === 'zh')
const expiry = computed(() => {
  if (!props.subscription.expires_at) return ''
  const date = new Date(props.subscription.expires_at)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(zh.value ? 'zh-CN' : 'en', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '—'
})
</script>
