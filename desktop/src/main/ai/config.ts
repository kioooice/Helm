import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type {
  AiProviderConfig,
  AiProviderConfigInput,
  AiProviderConnectionTestResult
} from '../../shared/types'
import { redactSensitiveText } from '../../shared/redaction'

const CONFIG_FILE_NAME = 'helm-ai-config.json'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_MODEL = 'deepseek-v4-flash'

let configDirectoryOverride: string | null = null

export function setAiConfigDirectory(directory: string) {
  configDirectoryOverride = directory
}

type StoredAiProviderConfig = {
  provider?: unknown
  baseUrl?: unknown
  model?: unknown
  apiKey?: unknown
}

type ResolvedAiProviderConfig = {
  provider: 'deepseek'
  baseUrl: string
  model: string
  apiKey: string
}

function getConfigDir() {
  if (configDirectoryOverride) {
    return configDirectoryOverride
  }
  return app.getPath('userData')
}

function getConfigPath() {
  return join(getConfigDir(), CONFIG_FILE_NAME)
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readStoredConfig(): StoredAiProviderConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    return {}
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as StoredAiProviderConfig
  } catch {
    return {}
  }
}

function maskApiKey(apiKey: string) {
  if (!apiKey) {
    return ''
  }

  if (apiKey.length <= 8) {
    return '已配置'
  }

  return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`
}

function toPublicConfig(config: ResolvedAiProviderConfig): AiProviderConfig {
  return {
    provider: 'deepseek',
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyPreview: maskApiKey(config.apiKey)
  }
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed
}

function extractDeepSeekErrorCode(message: string) {
  try {
    const parsed = JSON.parse(message) as {
      error?: {
        code?: unknown
        type?: unknown
      }
    }
    const code = cleanString(parsed.error?.code)
    const type = cleanString(parsed.error?.type)
    return code || type
  } catch {
    return ''
  }
}

function getDeepSeekFailureReason(status: number, message: string, apiKey: string) {
  if (status === 401 || status === 403) {
    return `DeepSeek 连接失败：${status}，API Key 无效或已过期，请重新填写。`
  }

  const safeMessage = redactSensitiveText(message, [apiKey])
  const errorCode = extractDeepSeekErrorCode(safeMessage)
  if (errorCode) {
    return `DeepSeek 连接失败：${status}，${truncate(errorCode, 48)}。`
  }

  return `DeepSeek 连接失败：${status}${safeMessage ? `，${truncate(safeMessage, 72)}` : '。'}`
}

function resolveAiProviderConfigInput(input: AiProviderConfigInput): ResolvedAiProviderConfig {
  const stored = readStoredConfig()
  const baseUrl =
    cleanString(input.baseUrl) ||
    cleanString(stored.baseUrl) ||
    process.env.DEEPSEEK_BASE_URL?.trim() ||
    DEFAULT_BASE_URL
  const model =
    cleanString(input.model) ||
    cleanString(stored.model) ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    DEFAULT_MODEL
  const apiKey = input.clearApiKey
    ? ''
    : input.apiKey?.trim() ||
      cleanString(stored.apiKey) ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      ''

  return {
    provider: 'deepseek',
    baseUrl,
    model,
    apiKey
  }
}

function getDeepSeekChatCompletionsUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  return `${normalizedBaseUrl || DEFAULT_BASE_URL}/chat/completions`
}

export function readAiProviderConfig(): ResolvedAiProviderConfig {
  const stored = readStoredConfig()
  const baseUrl =
    cleanString(stored.baseUrl) || process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL
  const model = cleanString(stored.model) || process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL
  const apiKey = cleanString(stored.apiKey) || process.env.DEEPSEEK_API_KEY?.trim() || ''

  return {
    provider: 'deepseek',
    baseUrl,
    model,
    apiKey
  }
}

export function getAiProviderConfigStatus(): AiProviderConfig {
  return toPublicConfig(readAiProviderConfig())
}

export function saveAiProviderConfig(input: AiProviderConfigInput): AiProviderConfig {
  const next = resolveAiProviderConfigInput(input)
  const configPath = getConfigPath()

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: 'deepseek',
        baseUrl: next.baseUrl,
        model: next.model,
        apiKey: next.apiKey
      },
      null,
      2
    ),
    'utf8'
  )

  return getAiProviderConfigStatus()
}

export async function testAiProviderConnection(
  input: AiProviderConfigInput
): Promise<AiProviderConnectionTestResult> {
  const config = resolveAiProviderConfigInput(input)
  if (!config.apiKey) {
    return {
      ok: false,
      reason: '缺少 DeepSeek API Key，无法测试连接。',
      model: config.model
    }
  }

  try {
    const response = await fetch(getDeepSeekChatCompletionsUrl(config.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        temperature: 0
      })
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      return {
        ok: false,
        reason: getDeepSeekFailureReason(response.status, message, config.apiKey),
        model: config.model
      }
    }

    return {
      ok: true,
      reason: 'DeepSeek 连接正常。',
      model: config.model
    }
  } catch (cause) {
    return {
      ok: false,
      reason:
        cause instanceof Error
          ? redactSensitiveText(cause.message, [config.apiKey])
          : 'DeepSeek 连接失败。',
      model: config.model
    }
  }
}
