<template>
  <section class="z-module-banner z-page-section" :class="`z-module-${variant}`">
    <div class="z-module-copy">
      <p class="z-eyebrow">{{ eyebrow }}</p>
      <component :is="heading" class="z-module-title">{{ title }}</component>
      <p class="z-module-description">{{ description }}</p>
      <div v-if="$slots.default" class="z-module-details"><slot /></div>
    </div>
    <div class="z-module-art" aria-hidden="true">
      <span class="z-module-ring z-module-ring-one"></span>
      <span class="z-module-ring z-module-ring-two"></span>
      <div class="z-module-object">
        <svg v-if="variant === 'access'" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="18" cy="18" r="9" /><path d="m24.5 24.5 13 13M33 33l4-4M29 29l4-4" /><circle cx="16" cy="16" r="1.5" />
        </svg>
        <svg v-else viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 25h10l5-12 9 24 6-16 4 4h8" /><circle cx="42" cy="25" r="2" fill="currentColor" />
        </svg>
        <span>{{ variant === 'access' ? 'ACCESS / Z' : 'CONNECT / Z' }}</span>
      </div>
      <i class="z-module-node"></i>
    </div>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  variant: 'access' | 'monitor'
  eyebrow: string
  title: string
  description: string
  heading?: 'h2' | 'h3'
}>(), { heading: 'h3' })
</script>
