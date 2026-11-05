<template>
  <section ref="scene" class="z-workbench-welcome z-welcome-compact" :class="{ 'z-welcome-has-plan': subscription }" aria-labelledby="workbench-welcome-title" @pointermove="moveScene" @pointerleave="resetScene">
    <div class="z-welcome-copy">
      <div class="z-welcome-overline"><RouterLink v-if="subscription" to="/subscriptions" class="z-welcome-plan-link"><WorkspaceMembershipStamp :subscription="subscription" /><Icon name="arrowRight" size="sm" /></RouterLink><template v-else><span class="z-eyebrow">ZHIJING / YOUR WORKSPACE</span><span class="z-welcome-divider" /><span>{{ locale === 'zh' ? '让想法，自在发生' : 'ROOM FOR YOUR NEXT IDEA' }}</span></template></div>
      <h2 id="workbench-welcome-title">{{ locale === 'zh' ? '专注创造，' : 'Space to create.' }}<br class="z-welcome-title-break"><span>{{ locale === 'zh' ? '其余井然。' : 'Room to go further.' }}</span></h2>
      <p class="z-welcome-description">{{ locale === 'zh' ? '你的连接、用量与下一步，都在这里。' : 'Your connections, usage and next steps. All in one place.' }}</p>
      <div class="z-welcome-actions">
        <router-link to="/keys" class="btn btn-primary"><Icon name="key" size="sm" />{{ t('nav.apiKeys') }}<Icon name="arrowRight" size="sm" class="z-action-arrow" /></router-link>
        <router-link to="/usage" class="z-welcome-text-link">{{ t('nav.usage') }}<Icon name="arrowRight" size="sm" /></router-link>
      </div>
      <div class="z-welcome-footnote"><span class="z-connection-dot" :class="{ 'is-ready': (activeKeys ?? 0) > 0 }" /><span>{{ activeKeys == null ? (locale === 'zh' ? '正在同步工作台' : 'Syncing your workspace') : locale === 'zh' ? `${activeKeys} 把密钥已启用` : `${activeKeys} active API keys` }}</span><span aria-hidden="true">·</span><span>{{ locale === 'zh' ? '保持好奇，继续向前' : 'Stay curious. Keep building.' }}</span></div>
    </div>
    <div class="z-workbench-art" aria-hidden="true">
      <div class="z-art-grid" /><div class="z-art-orbit z-art-orbit-outer" /><div class="z-art-orbit z-art-orbit-inner" />
      <div class="z-art-core"><div class="z-art-core-face"><img src="/app-assets/zhijing-z.png" alt="" width="88" height="88"><span>ZHIJING</span></div></div>
      <div class="z-art-node z-art-node-top"><Icon name="sparkles" size="md" /><span>CREATE</span></div>
      <div class="z-art-node z-art-node-bottom"><Icon name="link" size="md" /><span>CONNECT</span></div>
      <span class="z-art-coordinate">IDEAS IN MOTION / Z</span>
    </div>
    <button v-if="!prefersReducedMotion" type="button" class="z-motion-toggle" :aria-pressed="motionEnabled" @click="toggleMotion"><span class="z-motion-bars" aria-hidden="true"><i /><i /><i /></span>{{ locale === 'zh' ? motionEnabled ? '暂停动效' : '开启动效' : motionEnabled ? 'Pause motion' : 'Enable motion' }}</button>
  </section>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
import { useWorkspaceAppearance } from '@/composables/useWorkspaceAppearance'
import WorkspaceMembershipStamp from '@/components/user/WorkspaceMembershipStamp.vue'
import type { UserSubscription } from '@/types'

defineProps<{ activeKeys?: number; subscription?: UserSubscription }>()
const { t, locale } = useI18n()
const { motionEnabled, prefersReducedMotion, toggleMotion } = useWorkspaceAppearance()
const scene = ref<HTMLElement | null>(null)
let frame = 0
let pointerX = 0
let pointerY = 0

function moveScene(event: PointerEvent) {
  if (!motionEnabled.value || event.pointerType === 'touch') return
  pointerX = event.clientX
  pointerY = event.clientY
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (!scene.value || !motionEnabled.value) return
    const bounds = scene.value.getBoundingClientRect()
    scene.value.style.setProperty('--scene-x', `${((pointerX - bounds.left) / bounds.width - .5) * 12}px`)
    scene.value.style.setProperty('--scene-y', `${((pointerY - bounds.top) / bounds.height - .5) * 10}px`)
  })
}

function resetScene() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  scene.value?.style.setProperty('--scene-x', '0px')
  scene.value?.style.setProperty('--scene-y', '0px')
}

onUnmounted(() => { if (frame) cancelAnimationFrame(frame) })
</script>
