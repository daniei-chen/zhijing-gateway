<template>
  <header class="z-admin-intro">
    <div class="z-admin-intro-copy">
      <p class="z-eyebrow">ZHIJING / ADMIN WORKSPACE</p>
      <h2>{{ locale === 'zh' ? '每一处连接，尽在掌握。' : 'Every connection. A clearer view.' }}</h2>
      <p>{{ locale === 'zh' ? '从成员到模型，从用量到运行状态，让管理更从容。' : 'Members, models, usage and operations — brought together.' }}</p>
      <span class="z-admin-intro-label"><i aria-hidden="true"></i>{{ locale === 'zh' ? '智境 · 管理工作台' : 'ZHIJING · Administration' }}</span>
    </div>
    <div class="z-admin-orbit" aria-hidden="true">
      <span class="z-admin-orbit-ring"></span><span class="z-admin-orbit-ring"></span>
      <span class="z-admin-orbit-node">Z</span><i></i><i></i><i></i>
      <svg viewBox="0 0 360 200" fill="none"><path d="M0 135C48 135 52 48 104 70S158 169 212 106 273 98 360 40" /><path d="M0 164C52 164 70 100 113 118S178 153 218 132 279 66 360 79" /></svg>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { locale } = useI18n()
</script>
