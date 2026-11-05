<template>
  <template v-if="authStore.isAdmin">
    <ChannelStatusV1View v-if="isV1" />
    <ChannelStatusV2View v-else />
  </template>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { isChannelMonitorV1Mode } from '@/utils/featureFlags'
import ChannelStatusV1View from './ChannelStatusV1View.vue'
import ChannelStatusV2View from './ChannelStatusV2View.vue'

const isV1 = computed(() => isChannelMonitorV1Mode())
const authStore = useAuthStore()
const router = useRouter()
watch(() => authStore.user?.role, role => {
  if (role && role !== 'admin') void router.replace('/dashboard')
}, { immediate: true })
</script>
