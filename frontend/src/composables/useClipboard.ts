import { ref, getCurrentScope, onScopeDispose } from 'vue'
import { useAppStore } from '@/stores/app'
import { i18n } from '@/i18n'
import { createSessionTasks } from '@/utils/sessionTasks'

const { t } = i18n.global

/**
 * 检测是否支持 Clipboard API（需要安全上下文：HTTPS/localhost）
 */
function isClipboardSupported(): boolean {
  return !!(navigator.clipboard && window.isSecureContext)
}

/**
 * 降级方案：使用 textarea + execCommand
 * 使用 textarea 而非 input，以正确处理多行文本
 */
function fallbackCopy(text: string, isCurrent: () => boolean): boolean {
  if (!isCurrent()) return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  try {
    return isCurrent() && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export function useClipboard() {
  const appStore = useAppStore()
  const copied = ref(false)
  const requests = createSessionTasks()
  if (getCurrentScope()) onScopeDispose(() => requests.dispose())

  const copyToClipboard = async (
    text: string,
    successMessage?: string,
    isOperationCurrent: () => boolean = () => true
  ): Promise<boolean> => {
    if (!text || !requests.current() || !isOperationCurrent()) return false
    const task = requests.begin('copy', isOperationCurrent)
    let resetTimer: ReturnType<typeof setTimeout> | null = null
    let resetScheduled = false
    const finish = () => {
      if (resetTimer !== null) { clearTimeout(resetTimer); resetTimer = null }
      task.signal.removeEventListener('abort', finish)
      task.finish()
    }
    task.signal.addEventListener('abort', finish, { once: true })

    try {
      if (!task.active()) return false
      copied.value = false
      if (!task.active()) return false
      let success = false
      if (isClipboardSupported()) {
        try {
          // A platform write already accepted here cannot be undone. Ownership
          // only controls later fallback work and application feedback.
          await navigator.clipboard.writeText(text)
          success = true
        } catch {
          if (!task.active()) return false
          success = fallbackCopy(text, task.active)
        }
      } else {
        success = fallbackCopy(text, task.active)
      }

      if (!task.active()) return false
      if (!success) {
        appStore.showError(t('common.copyFailed'))
        return false
      }
      copied.value = true
      if (!task.active()) return false
      appStore.showSuccess(successMessage || t('common.copiedToClipboard'))
      if (!task.active()) return false
      resetTimer = setTimeout(() => {
        resetTimer = null
        // This task still owns its completed feedback even if the caller's
        // draft has since changed. A newer copy has a different owned task.
        if (task.owned()) copied.value = false
        finish()
      }, 2000)
      resetScheduled = true
      return true
    } finally {
      if (!resetScheduled) finish()
    }
  }

  return { copied, copyToClipboard }
}
