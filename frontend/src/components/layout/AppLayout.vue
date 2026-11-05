<template>
  <div class="z-console z-workspace-chrome z-liquid-workspace min-h-screen bg-gray-50 dark:bg-dark-950" :class="{ 'z-member-workspace': !isAdmin && !appStore.backendModeEnabled, 'z-admin-workspace': isAdminRoute }" :data-admin-page="isAdminRoute ? route.path : undefined" :data-motion="motionEnabled ? 'full' : 'reduced'">
    <a class="z-skip-link" href="#workspace-main">{{ locale === 'zh' ? '跳至主要内容' : 'Skip to content' }}</a>

    <!-- Sidebar -->
    <AppSidebar />

    <!-- Main Content Area -->
    <div
      class="z-console-content relative min-h-screen"
      :class="[sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-64']"
      :inert="mobileSidebarActive || undefined"
    >
      <!-- Header -->
      <AppHeader />

      <!-- Main Content -->
      <main id="workspace-main" tabindex="-1" class="z-console-main p-4 md:p-6 lg:p-8" :class="{ 'z-route-enter': animatePageEntry }">
        <div v-if="standalonePage" class="z-page-header z-page-header-standalone">
          <WorkspacePageHeading :page="standalonePage" />
        </div>
        <slot />
        <footer v-if="isAdminRoute || (!isAdmin && !appStore.backendModeEnabled)" class="z-workspace-footer">
          <span>ZHIJING <i>/</i> {{ isAdminRoute ? (locale === 'zh' ? '让每一处连接，有序发生。' : 'Every connection, in perspective.') : (locale === 'zh' ? '让想法，自在发生。' : 'Room for your next idea.') }}</span>
          <button type="button" :aria-pressed="motionEnabled" @click="toggleMotion">
            <span class="z-motion-bars" aria-hidden="true"><i></i><i></i><i></i></span>
            {{ locale === 'zh' ? (motionEnabled ? '暂停动效' : '开启动效') : (motionEnabled ? 'Pause motion' : 'Enable motion') }}
          </button>
        </footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import '@/styles/onboarding.css'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { useAppStore } from '@/stores'
import { useAuthStore } from '@/stores/auth'
import { useOnboardingTour } from '@/composables/useOnboardingTour'
import { useOnboardingStore } from '@/stores/onboarding'
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'
import WorkspacePageHeading from './WorkspacePageHeading.vue'
import { getWorkspacePage } from './workspacePages'
import { useWorkspaceAppearance } from '@/composables/useWorkspaceAppearance'

const appStore = useAppStore()
const { motionEnabled, toggleMotion } = useWorkspaceAppearance()
const { locale } = useI18n()
const route = useRoute()
// A native View Transition owns entry motion until its snapshot is released.
// Reading once avoids replaying a second entrance after the transition finishes.
const animatePageEntry = !document.documentElement.classList.contains('z-route-transition')
const standalonePage = computed(() => ['/usage', '/admin/usage', '/admin/settings', '/admin/orders', '/admin/orders/dashboard', '/admin/orders/plans', '/subscriptions', '/redeem', '/profile', '/purchase', '/orders', '/affiliate', '/settings/mcp'].includes(route?.path || '')
  ? getWorkspacePage(route.path, locale?.value || 'en') : undefined)
const isMobile = useMediaQuery('(max-width: 1023px)')
const mobileSidebarActive = computed(() => isMobile.value && appStore.mobileOpen)
const authStore = useAuthStore()
const sidebarCollapsed = computed(() => appStore.sidebarCollapsed)
const isAdmin = computed(() => authStore.user?.role === 'admin')
const isAdminRoute = computed(() => isAdmin.value && route?.path?.startsWith('/admin/'))

const { replayTour } = useOnboardingTour({
  storageKey: isAdmin.value ? 'admin_guide' : 'user_guide',
  autoStart: true
})

const onboardingStore = useOnboardingStore()

onMounted(() => {
  onboardingStore.setReplayCallback(replayTour)
})

defineExpose({ replayTour })
</script>
