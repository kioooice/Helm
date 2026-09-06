import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getOcrConfigStatus, saveOcrConfig, setOcrConfigDirectory } from './ocr-config'

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'helm-ocr-config-'))
  setOcrConfigDirectory(configDir)
  delete process.env.HELM_PADDLE_TOKEN
  delete process.env.PADDLE_OCR_TOKEN
})

afterEach(() => {
  delete process.env.HELM_PADDLE_TOKEN
  delete process.env.PADDLE_OCR_TOKEN
})

describe('ocr config', () => {
  it('defaults to local OCR without any token', () => {
    const status = getOcrConfigStatus()
    expect(status.provider).toBe('local')
    expect(status.tokenConfigured).toBe(false)
    expect(status.model).toBe('PP-OCRv6')
  })

  it('picks up the token from the environment as a fallback', () => {
    process.env.HELM_PADDLE_TOKEN = 'env-token-1234567890'
    const status = getOcrConfigStatus()
    expect(status.provider).toBe('local')
    expect(status.tokenConfigured).toBe(true)
    expect(status.tokenPreview).not.toBe('env-token-1234567890')
  })

  it('persists provider, token and model, masking the token in status', () => {
    const token = 'paddle-token-abcdef123456'
    const status = saveOcrConfig({ provider: 'paddle', token, model: 'PP-OCRv6' })

    expect(status.provider).toBe('paddle')
    expect(status.tokenConfigured).toBe(true)
    expect(status.tokenPreview).not.toBe(token)

    const stored = readFileSync(join(configDir, 'helm-ocr-config.json'), 'utf8')
    expect(stored).toContain(token)
    expect(stored).toContain('PP-OCRv6')
    expect(existsSync(join(configDir, 'helm-ocr-config.json'))).toBe(true)
  })

  it('falls back to local for unknown provider values', () => {
    const status = saveOcrConfig({ provider: 'telepathy' })
    expect(status.provider).toBe('local')
  })

  it('clears the token on request', () => {
    saveOcrConfig({ provider: 'paddle', token: 'paddle-token-abcdef123456' })
    const cleared = saveOcrConfig({ clearToken: true })
    expect(cleared.tokenConfigured).toBe(false)
  })
})
