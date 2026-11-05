<template>
  <div class="z-page-heading">
    <p class="z-eyebrow">{{ page.eyebrow }}</p>
    <h2>{{ page.title }}</h2>
    <p class="z-page-description">{{ page.description }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ page: { eyebrow: string; title: string; description: string } }>()
</script>
