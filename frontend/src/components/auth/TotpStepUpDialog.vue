<template>
  <div v-if="controller.visible.value" class="z-stepup-overlay fixed inset-0 z-[60] overflow-y-auto">
    <div class="flex min-h-full items-center justify-center p-4">
      <div class="z-stepup-backdrop fixed inset-0 bg-black/50 transition-opacity" @click="handleCancel"></div>

      <div class="z-stepup-panel relative w-full max-w-md transform rounded-xl bg-white p-6 shadow-xl transition-all dark:bg-dark-800" role="dialog" aria-modal="true" :aria-label="t('stepUp.title')">
        <div class="mb-6 text-center">
          <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
            <svg class="h-6 w-6 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 class="mt-4 text-xl font-semibold text-gray-900 dark:text-white">
            {{ t('stepUp.title') }}
          </h3>
          <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {{ t('stepUp.hint') }}
          </p>
        </div>

        <div class="mb-6">
          <input
            ref="hiddenOtpInputRef"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            class="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
            aria-hidden="true"
            tabindex="-1"
            @input="handleHiddenOtpInput"
          />
          <div class="z-stepup-code-grid flex justify-center gap-2">
            <input
              v-for="(_, index) in 6"
              :key="index"
              :ref="(el) => setInputRef(el, index)"
              type="text"
              maxlength="1"
              inputmode="numeric"
              pattern="[0-9]"
              autocomplete="off"
              class="h-12 w-10 rounded-lg border border-gray-300 text-center text-lg font-semibold focus:border-primary-500 focus:ring-primary-500 dark:border-dark-600 dark:bg-dark-700"
              :disabled="verifying"
              @input="handleCodeInput($event, index)"
              @keydown="handleKeydown($event, index)"
              @paste="handlePaste"
            />
          </div>
          <div v-if="verifying" class="mt-3 flex items-center justify-center gap-2 text-sm text-gray-500">
            <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-500"></div>
            {{ t('common.verifying') }}
          </div>
        </div>

        <button
          type="button"
          class="btn btn-secondary w-full"
          :disabled="verifying"
          @click="handleCancel"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores'
import { totpAPI } from '@/api'
import type { StepUpController } from '@/composables/useStepUp'
import { captureAuthSession, isAuthSessionCurrent, subscribeAuthSession, type AuthSessionSnapshot } from '@/api/authSession'

const props = defineProps<{
  controller: StepUpController
}>()

const { t } = useI18n()
const appStore = useAppStore()

const verifying = ref(false)
const code = ref<string[]>(['', '', '', '', '', ''])
const inputRefs = ref<(HTMLInputElement | null)[]>([])
const hiddenOtpInputRef = ref<HTMLInputElement | null>(null)
type PromptOwner = { controller: StepUpController; session: AuthSessionSnapshot }
type VerificationOwner = { prompt: PromptOwner }
let promptOwner: PromptOwner | null = null
let verificationOwner: VerificationOwner | null = null
let disposed = false

function ownsPrompt(owner: PromptOwner): boolean {
  return !disposed && promptOwner === owner && props.controller === owner.controller
    && owner.controller.visible.value && isAuthSessionCurrent(owner.session)
}

function ownsVerification(owner: VerificationOwner): boolean {
  return verificationOwner === owner && ownsPrompt(owner.prompt)
}

function focusCell(owner: PromptOwner, index: number, verification?: VerificationOwner) {
  nextTick(() => {
    if (!ownsPrompt(owner) || verifying.value || (verification && !ownsVerification(verification))) return
    const input = inputRefs.value[index]
    if (input?.isConnected) input.focus()
  })
}

function invalidatePrompt() {
  promptOwner = null
  verificationOwner = null
  verifying.value = false
  resetInputs()
}

// Visibility and controller identity define one prompt. Invalidate synchronously
// so a response from the preceding prompt cannot touch the next one.
watch(
  () => [props.controller, props.controller.visible.value] as const,
  () => {
    const previous = promptOwner
    invalidatePrompt()
    if (previous && previous.controller !== props.controller && previous.controller.visible.value) previous.controller.onCancel()
    if (disposed || !props.controller.visible.value) return
    try {
      const owner = { controller: props.controller, session: captureAuthSession() }
      promptOwner = owner
      focusCell(owner, 0)
    } catch {
      props.controller.onCancel()
    }
  },
  { immediate: true, flush: 'sync' },
)

const unsubscribeSession = subscribeAuthSession(() => {
  const owner = promptOwner
  if (owner && !isAuthSessionCurrent(owner.session)) {
    invalidatePrompt()
    if (owner.controller.visible.value) owner.controller.onCancel()
  }
})

onBeforeUnmount(() => {
  const controller = promptOwner?.controller ?? props.controller
  disposed = true
  unsubscribeSession()
  invalidatePrompt()
  if (controller.visible.value) controller.onCancel()
})

// Auto-submit once 6 digits are entered.
watch(
  () => code.value.join(''),
  (newCode) => {
    if (newCode.length === 6 && !verifying.value) {
      submit(newCode)
    }
  }
)

async function submit(otp: string) {
  const prompt = promptOwner
  if (!prompt || !ownsPrompt(prompt) || verifying.value) return
  const owner = { prompt }
  verificationOwner = owner
  verifying.value = true
  try {
    await totpAPI.stepUp(otp)
    if (!ownsVerification(owner)) return
    resetInputs()
    prompt.controller.onVerified()
  } catch (err: any) {
    if (!ownsVerification(owner)) return
    appStore.showError(err?.message || t('stepUp.verifyFailed'))
    if (!ownsVerification(owner)) return
    resetInputs()
    focusCell(prompt, 0, owner)
  } finally {
    if (ownsVerification(owner)) verifying.value = false
  }
}

function resetInputs() {
  code.value = ['', '', '', '', '', '']
  inputRefs.value.forEach((input) => {
    if (input) input.value = ''
  })
  if (hiddenOtpInputRef.value) hiddenOtpInputRef.value.value = ''
}

function handleCancel() {
  const owner = promptOwner
  if (!owner || !ownsPrompt(owner) || verifying.value) return
  owner.controller.onCancel()
}

const setInputRef = (el: any, index: number) => {
  inputRefs.value[index] = el as HTMLInputElement | null
}

const handleCodeInput = (event: Event, index: number) => {
  const owner = promptOwner
  if (!owner || !ownsPrompt(owner) || verifying.value) return
  const input = event.target as HTMLInputElement
  const value = input.value.replace(/[^0-9]/g, '')
  code.value[index] = value
  if (value && index < 5) {
    focusCell(owner, index + 1)
  }
}

const handleHiddenOtpInput = (event: Event) => {
  if (!promptOwner || !ownsPrompt(promptOwner) || verifying.value) return
  const input = event.target as HTMLInputElement
  const digits = input.value.replace(/[^0-9]/g, '').slice(0, 6).split('')
  for (let i = 0; i < 6; i++) {
    code.value[i] = digits[i] || ''
    if (inputRefs.value[i]) inputRefs.value[i]!.value = digits[i] || ''
  }
}

const handleKeydown = (event: KeyboardEvent, index: number) => {
  if (!promptOwner || !ownsPrompt(promptOwner) || verifying.value) return
  if (event.key === 'Backspace') {
    const input = event.target as HTMLInputElement
    if (!input.value && index > 0) {
      event.preventDefault()
      inputRefs.value[index - 1]?.focus()
    }
  }
}

const handlePaste = (event: ClipboardEvent) => {
  event.preventDefault()
  const owner = promptOwner
  if (!owner || !ownsPrompt(owner) || verifying.value) return
  const pastedData = event.clipboardData?.getData('text') || ''
  const digits = pastedData.replace(/[^0-9]/g, '').slice(0, 6).split('')
  for (let i = 0; i < 6; i++) {
    code.value[i] = digits[i] || ''
    if (inputRefs.value[i]) inputRefs.value[i]!.value = digits[i] || ''
  }
  const focusIndex = Math.min(digits.length, 5)
  focusCell(owner, focusIndex)
}
</script>
