<template>
  <BaseDialog
    :show="show"
    :title="t('admin.users.editUser')"
    width="normal"
    @close="handleClose"
  >
    <form v-if="user" id="edit-user-form" @submit.prevent="handleUpdateUser" class="space-y-5">
      <div>
        <label :for="`${fieldId}-email`" class="input-label">{{ t('admin.users.email') }}</label>
        <input :id="`${fieldId}-email`" v-model="form.email" type="email" class="input" />
      </div>
      <div>
        <label :for="`${fieldId}-password`" class="input-label">{{ t('admin.users.password') }}</label>
        <div class="flex gap-2">
          <div class="relative flex-1">
            <input :id="`${fieldId}-password`" v-model="form.password" type="text" class="input pr-10" :placeholder="t('admin.users.enterNewPassword')" />
            <button v-if="form.password" :aria-label="t('common.copy') + ' ' + t('admin.users.password')" type="button" @click="copyPassword" class="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 transition-colors hover:bg-gray-100 dark:hover:bg-dark-700" :class="passwordCopied ? 'text-green-500' : 'text-gray-400'">
              <svg v-if="passwordCopied" class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
              <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
            </button>
          </div>
          <button :aria-label="t('common.refresh') + ' ' + t('admin.users.password')" type="button" @click="generatePassword" class="btn btn-secondary px-3">
            <Icon name="refresh" size="md" />
          </button>
        </div>
      </div>
      <div>
        <label :for="`${fieldId}-username`" class="input-label">{{ t('admin.users.username') }}</label>
        <input :id="`${fieldId}-username`" v-model="form.username" type="text" class="input" />
      </div>
      <div>
        <label :for="`${fieldId}-role`" class="input-label">{{ t('admin.users.form.roleLabel') }}</label>
        <Select
          :id="`${fieldId}-role`" v-model="form.role"
          :options="roleOptions"
          :searchable="false"
        />
      </div>
      <div>
        <label :for="`${fieldId}-notes`" class="input-label">{{ t('admin.users.notes') }}</label>
        <textarea :id="`${fieldId}-notes`" v-model="form.notes" rows="3" class="input"></textarea>
      </div>
      <div>
        <label :for="`${fieldId}-concurrency`" class="input-label">{{ t('admin.users.columns.concurrency') }}</label>
        <input
          :id="`${fieldId}-concurrency`" v-model.number="form.concurrency"
          type="number"
          min="0"
          step="1"
          class="input"
          :placeholder="t('admin.users.form.concurrencyPlaceholder')"
          data-test="concurrency-input"
        />
        <p class="input-hint">{{ t('admin.users.form.concurrencyHint') }}</p>
      </div>
      <div>
        <label :for="`${fieldId}-rpm_limit`" class="input-label">{{ t('admin.users.form.rpmLimit') }}</label>
        <input
          :id="`${fieldId}-rpm_limit`" v-model.number="form.rpm_limit"
          type="number"
          min="0"
          step="1"
          class="input"
          :placeholder="t('admin.users.form.rpmLimitPlaceholder')"
        />
        <p class="input-hint">{{ t('admin.users.form.rpmLimitHint') }}</p>
      </div>
      <UserAttributeForm v-model="form.customAttributes" :user-id="user?.id" />
    </form>
    <template #footer>
      <div class="flex justify-end gap-3">
        <button @click="handleClose" type="button" class="btn btn-secondary">{{ t('common.cancel') }}</button>
        <button type="submit" form="edit-user-form" :disabled="submitting" class="btn btn-primary">
          {{ submitting ? t('admin.users.updating') : t('common.update') }}
        </button>
      </div>
    </template>
  </BaseDialog>

  <!-- 角色提升为管理员时后端要求 step-up 2FA，弹出 TOTP 验证后自动重试 -->
  <TotpStepUpDialog :controller="stepUp" />
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch, onBeforeUnmount, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useClipboard } from '@/composables/useClipboard'
import { adminAPI } from '@/api/admin'
import type { AdminUser, UserAttributeValuesMap } from '@/types'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Select from '@/components/common/Select.vue'
import UserAttributeForm from '@/components/user/UserAttributeForm.vue'
import Icon from '@/components/icons/Icon.vue'
import { useStepUp, isStepUpBlocked, isStepUpCancelled, stepUpBlockReason, StepUpCancelledError } from '@/composables/useStepUp'
import TotpStepUpDialog from '@/components/auth/TotpStepUpDialog.vue'
import { createSessionTasks } from '@/utils/sessionTasks'

const props = defineProps<{ show: boolean, user: AdminUser | null }>()
const emit = defineEmits(['close', 'success'])
const { t } = useI18n()
const fieldId = `edit-user-${useId()}`; const appStore = useAppStore(); const { copyToClipboard } = useClipboard()

const submitting = ref(false); const passwordCopied = ref(false)
const stepUp = useStepUp()
const modalTasks = createSessionTasks()
let modalGeneration = 0
let passwordCopyTimer: ReturnType<typeof setTimeout> | null = null
const invalidate = () => {
  modalGeneration++
  modalTasks.cancel()
  stepUp.onCancel()
  submitting.value = false
  passwordCopied.value = false
  if (passwordCopyTimer !== null) { clearTimeout(passwordCopyTimer); passwordCopyTimer = null }
}
const handleClose = () => { invalidate(); emit('close') }
onBeforeUnmount(() => { invalidate(); modalTasks.dispose() })
const roleOptions = computed(() => [
  { value: 'user', label: t('admin.users.roles.user') },
  { value: 'admin', label: t('admin.users.roles.admin') }
])
const form = reactive({
  email: '',
  password: '',
  username: '',
  notes: '',
  role: 'user' as AdminUser['role'],
  concurrency: 1,
  rpm_limit: 0,
  customAttributes: {} as UserAttributeValuesMap
})

watch(() => form.password, () => {
  modalTasks.cancel('copy-password')
  passwordCopied.value = false
  if (passwordCopyTimer !== null) { clearTimeout(passwordCopyTimer); passwordCopyTimer = null }
}, { flush: 'sync' })

watch([() => props.show, () => props.user?.id], ([show]) => {
  invalidate()
  const u = props.user
  if (show && u) {
    Object.assign(form, { email: u.email, password: '', username: u.username || '', notes: u.notes || '', role: u.role || 'user', concurrency: u.concurrency, rpm_limit: u.rpm_limit ?? 0, customAttributes: {} })
    passwordCopied.value = false
  }
}, { immediate: true, flush: 'sync' })

const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  let p = ''; for (let i = 0; i < 16; i++) p += chars.charAt(Math.floor(Math.random() * chars.length))
  form.password = p
}
const copyPassword = async () => {
  if (!props.show || !form.password || !modalTasks.current()) return
  const password = form.password
  const generation = modalGeneration
  const task = modalTasks.begin('copy-password', () => props.show && generation === modalGeneration && form.password === password)
  if (passwordCopyTimer !== null) { clearTimeout(passwordCopyTimer); passwordCopyTimer = null }
  passwordCopied.value = false
  if (await copyToClipboard(password, t('admin.users.passwordCopied'), task.active) && task.active()) {
    passwordCopied.value = true
    const resetTimer = setTimeout(() => {
      if (passwordCopyTimer === resetTimer) passwordCopyTimer = null
      if (task.owned()) passwordCopied.value = false
      task.finish()
    }, 2000)
    passwordCopyTimer = resetTimer
  } else {
    task.finish()
  }
}
const handleUpdateUser = async () => {
  if (!props.show || !props.user || submitting.value || !modalTasks.current()) return
  if (!form.email.trim()) {
    appStore.showError(t('admin.users.emailRequired'))
    return
  }
  // 0 = 不限制，与网关 (AcquireUserSlot: maxConcurrency <= 0) 和批量改限额一致
  if (!Number.isInteger(form.concurrency) || form.concurrency < 0) {
    appStore.showError(t('admin.users.concurrencyNonNegative'))
    return
  }
  const userId = props.user.id
  const generation = modalGeneration
  const task = modalTasks.begin('update', () => props.show && generation === modalGeneration && props.user?.id === userId)
  submitting.value = true
  try {
    const data: any = { email: form.email, username: form.username, notes: form.notes, role: form.role, concurrency: form.concurrency, rpm_limit: form.rpm_limit }
    const attributes: UserAttributeValuesMap = { ...form.customAttributes }
    if (form.password.trim()) data.password = form.password.trim()
    // 提升为管理员属敏感操作：后端返回 STEP_UP_REQUIRED 时弹 TOTP 验证并重试
    await stepUp.run(async () => {
      if (!task.active()) throw new StepUpCancelledError()
      try {
        const result = await adminAPI.users.update(userId, data)
        if (!task.active()) throw new StepUpCancelledError()
        return result
      } catch (error) {
        if (!task.active()) throw new StepUpCancelledError()
        throw error
      }
    })
    if (!task.active()) return
    if (Object.keys(attributes).length > 0) {
      await adminAPI.userAttributes.updateUserAttributeValues(userId, attributes)
      if (!task.active()) return
    }
    appStore.showSuccess(t('admin.users.userUpdated'))
    emit('success'); handleClose()
  } catch (e: any) {
    if (!task.active()) return
    if (isStepUpCancelled(e)) {
      // 用户主动取消二次验证：静默返回，表单保持打开。
    } else if (isStepUpBlocked(e)) {
      appStore.showError(
        stepUpBlockReason(e) === 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'
          ? t('stepUp.adminApiKeyForbidden')
          : t('stepUp.notEnabled')
      )
    } else {
      appStore.showError(e?.message || t('admin.users.failedToUpdate'))
    }
  } finally {
    if (task.active()) submitting.value = false
    task.finish()
  }
}
</script>
