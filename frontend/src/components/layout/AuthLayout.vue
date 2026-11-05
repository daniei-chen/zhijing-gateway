<template>
  <ZhijingLoginLayout auxiliary>
    <slot />
    <template v-if="$slots.footer" #footer><slot name="footer" /></template>
  </ZhijingLoginLayout>
</template>
<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '@/stores'
import ZhijingLoginLayout from './ZhijingLoginLayout.vue'
const appStore = useAppStore()
onMounted(() => { appStore.fetchPublicSettings() })
</script>
