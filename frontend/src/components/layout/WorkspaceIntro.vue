<template>
  <section class="z-workspace-intro" aria-labelledby="workspace-intro-title">
    <div>
      <p class="z-eyebrow">ZHIJING / {{ isAdmin ? 'CONTROL CENTER' : 'YOUR WORKSPACE' }}</p>
      <h2 id="workspace-intro-title">{{ heading }}</h2>
      <p class="z-workspace-description">{{ description }}</p>
    </div>
    <div class="z-workspace-actions">
      <router-link :to="isAdmin ? '/admin/usage' : '/usage'" class="btn btn-secondary">{{ t('nav.usage') }}</router-link>
      <router-link to="/keys" class="btn btn-primary"><Icon name="key" size="sm" />{{ t('nav.apiKeys') }}</router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import Icon from '@/components/icons/Icon.vue'

const { t, locale } = useI18n()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const heading = computed(() => locale.value === 'zh'
  ? isAdmin.value ? '掌握全局，从容向前。' : '专注创造，其余井然。'
  : isAdmin.value ? 'A clearer view. A calmer workflow.' : 'Your work, with room to move.')
const description = computed(() => locale.value === 'zh'
  ? isAdmin.value ? '连接、资源与每一次调用，尽在同一个清晰视野。' : '从一次连接，到持续创造。看清用量，继续你的下一个想法。'
  : 'Your access, resources and every request — together in one clear view.')
</script>
