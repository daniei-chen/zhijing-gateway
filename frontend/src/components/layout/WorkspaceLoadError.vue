<template>
  <div class="card empty-state" role="status">
    <Icon name="refresh" size="lg" class="mb-4 text-gray-400" />
    <h3 class="empty-state-title">{{ locale === 'zh' ? '数据暂时无法加载' : 'Data could not be loaded' }}</h3>
    <p class="empty-state-description">{{ locale === 'zh' ? '请检查网络连接，然后重试。' : 'Check your connection and try again.' }}</p>
    <button type="button" class="btn btn-secondary mt-5" @click="$emit('retry')">{{ t('common.refresh') }}</button>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Icon from '@/components/icons/Icon.vue'
const { t, locale } = useI18n()
defineEmits<{ retry: [] }>()
</script>
