import { describe, expect, it } from 'vitest'
import {
  AppError,
  getInternalErrorMessage,
  toPublicErrorMessage
} from '../src/shared/errors'

describe('AppError', () => {
  it('separates user-facing and internal error messages', () => {
    const error = new AppError('NETWORK_ERROR', '网络连接失败，请稍后重试', {
      internalMessage: 'connect ECONNREFUSED 127.0.0.1:443'
    })

    expect(toPublicErrorMessage(error)).toBe('网络连接失败，请稍后重试')
    expect(getInternalErrorMessage(error)).toContain('ECONNREFUSED')
  })

  it('does not expose unknown internal errors to users', () => {
    const error = new Error('secret-token')
    expect(toPublicErrorMessage(error, '加载失败')).toBe('加载失败')
  })
})
