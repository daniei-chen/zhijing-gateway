<template>
  <AppLayout>
    <div data-testid="profile-shell" class="z-account-page z-workspace-page">
      <section class="z-account-overview z-page-section card">
        <div class="z-account-intro"><p class="z-eyebrow">YOUR ACCOUNT / Z</p><h3>{{ locale === 'zh' ? '安心创造，' : 'Space to create.' }}<br><span>{{ locale === 'zh' ? '一切有数。' : 'Everything in view.' }}</span></h3></div>
        <dl class="z-account-facts">
          <div class="z-account-balance"><dt><Icon name="dollar" size="sm" />{{ t('profile.accountBalance') }}</dt><dd data-testid="profile-account-balance">{{ formatCurrency(user?.balance || 0) }}</dd></div>
          <div><dt><Icon name="bolt" size="sm" />{{ t('profile.concurrencyLimit') }}</dt><dd data-testid="profile-account-concurrency">{{ user?.concurrency || 0 }}<small>{{ locale === 'zh' ? '并发请求' : 'requests' }}</small></dd></div>
          <div><dt><Icon name="calendar" size="sm" />{{ t('profile.memberSince') }}</dt><dd data-testid="profile-account-created" class="z-account-date"><time :datetime="user?.created_at">{{ formatDateTimeToMinute(user?.created_at) }}</time></dd></div>
        </dl>
      </section>
      <div class="z-account-settings z-page-section">
        <ProfilePasswordForm />
        <ProfileIdentityBindingsSection :user="user" email-only compact class="z-account-email">
          <template #email-notification>
            <ProfileBalanceNotifyCard v-if="user" compact :available="appStore.cachedPublicSettings?.balance_low_notify_enabled === true" :enabled="user.balance_notify_enabled ?? true" :threshold="user.balance_notify_threshold" :extra-emails="user.balance_notify_extra_emails ?? []" :system-default-threshold="appStore.cachedPublicSettings?.balance_low_notify_threshold ?? 0" :user-email="user.email" />
          </template>
        </ProfileIdentityBindingsSection>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import ProfilePasswordForm from '@/components/user/profile/ProfilePasswordForm.vue'
import ProfileIdentityBindingsSection from '@/components/user/profile/ProfileIdentityBindingsSection.vue'
import ProfileBalanceNotifyCard from '@/components/user/profile/ProfileBalanceNotifyCard.vue'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { formatCurrency, formatDateTimeToMinute } from '@/utils/format'

const { t, locale } = useI18n()
const authStore = useAuthStore()
const appStore = useAppStore()
const user = computed(() => authStore.user)
onMounted(() => {
  void authStore.refreshUser().catch(error => { console.error('Failed to refresh profile:', error) })
})
</script>
