import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAiProviderConfigStatus, saveAiProviderConfig, setAiConfigDirectory } from './config'

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'helm-ai-config-'))
  setAiConfigDirectory(configDir)
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPSEEK_BASE_URL
})

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPSEEK_BASE_URL
})

describe('ai provider config', () => {
  it('reports defaults before anything is configured', () => {
    const status = getAiProviderConfigStatus()
    expect(status.provider).toBe('deepseek')
    expect(status.baseUrl).toBe('https://api.deepseek.com')
    expect(status.apiKeyConfigured).toBe(false)
    expect(status.apiKeyPreview).toBe('')
  })

  it('persists the key to the config file and masks it in the public status', () => {
    const apiKey = 'sk-secret-key-9876543210'
    const status = saveAiProviderConfig({ apiKey })

    expect(status.apiKeyConfigured).toBe(true)
    expect(status.apiKeyPreview).not.toBe(apiKey)
    expect(status.apiKeyPreview).toContain('sk')

    const stored = readFileSync(join(configDir, 'helm-ai-config.json'), 'utf8')
    expect(stored).toContain(apiKey)
  })

  it('keeps the stored key when saving other fields without a new key', () => {
    saveAiProviderConfig({ apiKey: 'sk-first-key-1234567890' })
    const updated = saveAiProviderConfig({ model: 'deepseek-v4-reasoner' })

    expect(updated.model).toBe('deepseek-v4-reasoner')
    expect(updated.apiKeyConfigured).toBe(true)
  })

  it('clears the key on request', () => {
    saveAiProviderConfig({ apiKey: 'sk-second-key-0987654321' })
    const cleared = saveAiProviderConfig({ clearApiKey: true })
    expect(cleared.apiKeyConfigured).toBe(false)
    expect(existsSync(join(configDir, 'helm-ai-config.json'))).toBe(true)
  })
})
