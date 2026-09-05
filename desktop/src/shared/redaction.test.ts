import { describe, expect, it } from 'vitest'
import { redactSensitiveText } from './redaction'

describe('redactSensitiveText', () => {
  it('redacts explicit secrets wherever they appear', () => {
    const apiKey = 'sk-abcdef1234567890abcdef'
    const redacted = redactSensitiveText(`request failed: token ${apiKey} rejected`, [apiKey])
    expect(redacted).not.toContain(apiKey)
    expect(redacted).toContain('[redacted-secret]')
  })

  it('redacts bearer tokens and common key patterns without explicit secrets', () => {
    const redacted = redactSensitiveText(
      'Authorization: Bearer abcdef123456 and api_key=abcdefgh1234'
    )
    expect(redacted).toContain('[redacted-secret]')
    expect(redacted).not.toContain('abcdef123456')
  })

  it('keeps ordinary text untouched', () => {
    expect(redactSensitiveText('DeepSeek 连接失败：401')).toBe('DeepSeek 连接失败：401')
  })
})
