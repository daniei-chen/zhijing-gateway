/**
 * Step-up (sudo) 2FA composable.
 *
 * Wraps a sensitive admin action so that when the backend responds with a
 * STEP_UP_REQUIRED error, the caller can prompt for a TOTP code, obtain a
 * short-lived grant, and transparently retry the original action.
 *
 * Usage in a view:
 *   const stepUp = useStepUp()
 *   async function exportData() {
 *     await stepUp.run(() => adminAPI.accounts.exportData(...))
 *   }
 *   // template: <TotpStepUpDialog :controller="stepUp" />
 */
import { ref } from 'vue'

/** Error codes the backend uses to signal step-up state. */
const STEP_UP_REQUIRED = 'STEP_UP_REQUIRED'
const STEP_UP_TOTP_NOT_ENABLED = 'STEP_UP_TOTP_NOT_ENABLED'
const STEP_UP_ADMIN_API_KEY_FORBIDDEN = 'STEP_UP_ADMIN_API_KEY_FORBIDDEN'

/**
 * Set by `api/client.ts` on a STEP_UP_REQUIRED rejection once the shared global
 * dialog has already run for that request. `run()` uses it to avoid opening a
 * second dialog — most importantly after the user explicitly cancelled.
 */
export type StepUpHandled = 'verified' | 'cancelled'

/**
 * Thrown by run() when the user dismisses the TOTP dialog.
 * Callers should treat it as a silent no-op, not an error to toast.
 */
export class StepUpCancelledError extends Error {
  readonly code = 'STEP_UP_CANCELLED'
  constructor() {
    super('step-up verification cancelled by user')
    this.name = 'StepUpCancelledError'
  }
}

export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof StepUpCancelledError
}

interface ApiError {
  status?: number
  code?: string | number
  reason?: string
  message?: string
  step_up_handled?: StepUpHandled
}

/** Extract the semantic error marker from either envelope shape (code or reason). */
function markerOf(err: unknown): string {
  const e = (err ?? {}) as ApiError
  const candidates = [e.code, e.reason].map((v) => (typeof v === 'string' ? v : ''))
  return candidates.find((v) => v.startsWith('STEP_UP')) || ''
}

export function isStepUpRequired(err: unknown): boolean {
  return markerOf(err) === STEP_UP_REQUIRED
}

export function isStepUpBlocked(err: unknown): boolean {
  const m = markerOf(err)
  return m === STEP_UP_TOTP_NOT_ENABLED || m === STEP_UP_ADMIN_API_KEY_FORBIDDEN
}

export function stepUpBlockReason(err: unknown): string {
  return markerOf(err)
}

/**
 * 把 step-up 相关失败翻译成「该给用户看什么」：
 *   - `null`    用户主动取消了对话框，调用方应当静默，不要报错；
 *   - 字符串    需要提示的具体原因，是 i18n key，交给调用方的 t()；
 *   - `undefined` 与 step-up 无关，调用方用自己的兜底文案。
 *
 * 取消之所以要静默：全局拦截器已经弹过对话框，用户明确点了取消；
 * 再补一句「分配失败」等于把用户的选择报成事故。
 */
export function stepUpFailureKey(err: unknown): string | null | undefined {
  if (isStepUpCancelled(err)) return null
  switch (stepUpBlockReason(err)) {
    case STEP_UP_TOTP_NOT_ENABLED:
      return 'stepUp.notEnabled'
    case STEP_UP_ADMIN_API_KEY_FORBIDDEN:
      return 'stepUp.adminApiKeyForbidden'
    default:
      return undefined
  }
}

export type StepUpController = ReturnType<typeof useStepUp>

export function useStepUp() {
  const visible = ref(false)
  const blockedReason = ref<string>('')
  let resolver: ((ok: boolean) => void) | null = null
  let pendingPrompt: Promise<boolean> | null = null

  /** Open the TOTP dialog and resolve true once a grant is obtained. */
  function prompt(): Promise<boolean> {
    if (pendingPrompt) return pendingPrompt
    visible.value = true
    pendingPrompt = new Promise<boolean>((resolve) => {
      resolver = resolve
    })
    return pendingPrompt
  }

  function onVerified() {
    visible.value = false
    resolver?.(true)
    resolver = null
    pendingPrompt = null
  }

  function onCancel() {
    visible.value = false
    resolver?.(false)
    resolver = null
    pendingPrompt = null
  }

  /**
   * Run a sensitive action. On STEP_UP_REQUIRED, prompt for a TOTP code and
   * retry once. STEP_UP_TOTP_NOT_ENABLED / admin-api-key errors are surfaced
   * to the caller (they cannot be resolved by entering a code). If the user
   * cancels the prompt, a StepUpCancelledError is thrown so callers can
   * distinguish "user changed their mind" from real failures.
   */
  async function run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (err) {
      if (isStepUpBlocked(err)) {
        blockedReason.value = markerOf(err)
        throw err
      }
      if (!isStepUpRequired(err)) {
        throw err
      }
      const handled = (err as ApiError).step_up_handled
      if (handled === 'cancelled') {
        // apiClient 的全局对话框已经问过，用户当场取消：静默结束，不能再弹第二个。
        throw new StepUpCancelledError()
      }
      if (handled === 'verified') {
        // 全局对话框已验证并重试过一次，仍被拒：再弹一次只会重复同一个失败动作。
        throw err
      }
      const ok = await prompt()
      if (!ok) {
        throw new StepUpCancelledError()
      }
      // Retry once now that the session holds a step-up grant.
      return await action()
    }
  }

  return {
    visible,
    blockedReason,
    prompt,
    onVerified,
    onCancel,
    run
  }
}

/**
 * 全局 step-up 控制器。
 *
 * 由 `App.vue` 挂一个 `TotpStepUpDialog`，供 `api/client.ts` 在收到 `STEP_UP_REQUIRED`
 * 时弹窗。管理面的 sudo 窗口是会话级的（`StepUpSessionKey` 绑当前会话），验证一次即覆盖
 * 整段会话，所以单个全局控制器就够，不必让每个页面各自接线。
 */
export const globalStepUp = useStepUp()
