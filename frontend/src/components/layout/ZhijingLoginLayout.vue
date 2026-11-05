<template>
  <main class="zj-login zj-liquid-auth" :class="{ 'zj-auth-auxiliary': auxiliary }" :lang="locale" :data-motion="motionEnabled ? 'full' : 'reduced'">
    <header>
      <a class="zj-brand" href="/" aria-label="智境 ZHIJING 首页">
        <img src="/app-assets/zhijing-z.png" alt="" width="32" height="32" />
        <span>智境 <b>ZHIJING</b></span>
      </a>
      <div class="zj-login-tools"><LocaleSwitcher /><a class="zj-back" href="/">
        {{ copy.home }}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </a></div>
    </header>

    <div class="zj-login-layout">
      <section>
        <p class="zj-eyebrow">ZHIJING / YOUR WORK, IN FOCUS</p>
        <h1>
          {{ copy.title }}<br />
          <span>{{ copy.titleEnd }}</span>
        </h1>
        <p class="zj-lede">
          {{ copy.lede }}<br />
          {{ copy.description }}
        </p>
        <div class="zj-principles">
          <span>{{ copy.principles[0] }}</span>
          <span>{{ copy.principles[1] }}</span>
          <span>{{ copy.principles[2] }}</span>
        </div>
      </section>

      <div class="zj-login-form">
        <template v-if="!auxiliary">
          <span class="zj-badge"><i aria-hidden="true"></i>{{ copy.account }}</span>
          <h2>{{ copy.welcome }}</h2>
          <p>{{ copy.hint }}</p>
        </template>
        <slot />
        <div v-if="$slots.footer" class="zj-auth-footer"><slot name="footer" /></div>
        <small v-if="!auxiliary">
          {{ registrationEnabled ? copy.session : copy.managed }}
        </small>
      </div>
    </div>

    <footer><span>智境 ZHIJING</span><span>{{ copy.tagline }}</span></footer>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores'
import LocaleSwitcher from '@/components/common/LocaleSwitcher.vue'
import { useWorkspaceAppearance } from '@/composables/useWorkspaceAppearance'

withDefaults(defineProps<{ auxiliary?: boolean }>(), { auxiliary: false })
const { locale } = useI18n()
const { motionEnabled } = useWorkspaceAppearance()
const appStore = useAppStore()
const registrationEnabled = computed(() => appStore.cachedPublicSettings?.registration_enabled === true)
const copy = computed(() => locale.value === 'zh' ? {
  home: '返回官网', title: '复杂有序，', titleEnd: '智能从容。', lede: '回到你的智境工作台。',
  description: '让接入、用量与每一次调用，都清晰可见。', principles: ['独立身份', '清晰用量', '专注创造'],
  account: '你的智境，从这里开始', welcome: '欢迎回来', hint: '使用你的智境账户，继续今天的创造。',
  session: '请使用智境账户登录。可在工作台的账户菜单中退出当前会话。',
  managed: '账户由维护者开通。如需帮助，请联系你的部署维护者。', tagline: '让复杂留给系统，让智能回归创造。'
} : {
  home: 'Back to website', title: 'Clarity in complexity.', titleEnd: 'Room to create.', lede: 'Welcome to your ZHIJING workspace.',
  description: 'Your access, usage and requests. All in focus.', principles: ['Your identity', 'Clear usage', 'Space to create'],
  account: 'YOUR ZHIJING WORKSPACE', welcome: 'Welcome back', hint: 'Sign in to your ZHIJING account and pick up where you left off.',
  session: 'Use your ZHIJING account. You can sign out from the workspace account menu.',
  managed: 'Accounts are provided by your administrator. Contact them if you need access.', tagline: 'Less complexity. More room for intelligence.'
})
</script>

<style scoped src="@/styles/zhijing-login.css"></style>
