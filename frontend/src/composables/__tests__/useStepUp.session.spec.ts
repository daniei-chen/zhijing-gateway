import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceAuthSession } from '@/api/authSession'
import { StepUpCancelledError, useStepUp } from '../useStepUp'

beforeEach(() => {
  localStorage.clear()
  replaceAuthSession({ accessToken: 'synthetic-a', user: { id: 1 } })
})

describe('step-up operation ownership', () => {
  it('does not retry a sensitive action after the same user starts a new session', async () => {
    const stepUp = useStepUp()
    const action = vi.fn().mockRejectedValueOnce({ code: 'STEP_UP_REQUIRED' }).mockResolvedValue('done')
    const running = stepUp.run(action)
    const result = expect(running).rejects.toBeInstanceOf(StepUpCancelledError)
    await vi.waitFor(() => expect(stepUp.visible.value).toBe(true))
    replaceAuthSession({ accessToken: 'synthetic-b', user: { id: 1 } })
    stepUp.onVerified()
    await result
    expect(action).toHaveBeenCalledTimes(1)
    expect(stepUp.visible.value).toBe(false)
  })

  it('settles a pending confirmation when its component scope is disposed', async () => {
    const scope = effectScope()
    const stepUp = scope.run(() => useStepUp())!
    const action = vi.fn().mockRejectedValue({ code: 'STEP_UP_REQUIRED' })
    const running = stepUp.run(action)
    const result = expect(running).rejects.toBeInstanceOf(StepUpCancelledError)
    await vi.waitFor(() => expect(stepUp.visible.value).toBe(true))
    scope.stop()
    await result
    expect(action).toHaveBeenCalledTimes(1)
    expect(stepUp.visible.value).toBe(false)
  })

  it('does not open a dialog for a delayed challenge after leaving the page', async () => {
    const scope = effectScope()
    const stepUp = scope.run(() => useStepUp())!
    let fail!: (reason: unknown) => void
    const action = vi.fn(() => new Promise<never>((_, reject) => { fail = reject }))
    const running = stepUp.run(action)
    const result = expect(running).rejects.toBeInstanceOf(StepUpCancelledError)
    scope.stop()
    fail({ code: 'STEP_UP_REQUIRED' })
    await result
    expect(stepUp.visible.value).toBe(false)
    expect(action).toHaveBeenCalledTimes(1)
  })
})
