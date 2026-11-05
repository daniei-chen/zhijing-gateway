<template>
  <div class="z-table-empty" role="status">
    <div class="z-table-empty-icon"><Icon name="inbox" size="lg" /></div>
    <div class="z-table-empty-copy">
      <p class="z-table-empty-title">{{ title }}</p>
      <p class="z-table-empty-description">{{ description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'

defineProps<{ title: string; description: string }>()
</script>
