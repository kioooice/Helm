import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { OcrConfigStatus, OcrProvider, OcrResult } from '../shared/types'
import { runPaddleOcr } from './paddle-ocr'
import { runRapidOcr } from './rapid-ocr'

const CONFIG_FILE_NAME = 'helm-ocr-config.json'
const DEFAULT_PADDLE_MODEL = 'PP-OCRv6'

let configDirectoryOverride: string | null = null

export function setOcrConfigDirectory(directory: string) {
  configDirectoryOverride = directory
}

type StoredOcrConfig = {
  provider?: unknown
  token?: unknown
  model?: unknown
}

type ResolvedOcrConfig = {
  provider: OcrProvider
  token: string
  model: string
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

function readStoredConfig(): StoredOcrConfig {
  const configPath = getConfigPath()
  if (!existsSync(configPath)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as StoredOcrConfig
  } catch {
    return {}
  }
}

function maskToken(token: string) {
  if (!token) {
    return ''
  }
  if (token.length <= 8) {
    return '已配置'
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`
}

function resolveConfig(input?: {
  provider?: string
  token?: string
  clearToken?: boolean
  model?: string
}): ResolvedOcrConfig {
  const stored = readStoredConfig()
  const provider = input?.provider
    ? input.provider === 'paddle'
      ? 'paddle'
      : 'local'
    : normalizeProvider(stored.provider)
  const token = input?.clearToken
    ? ''
    : input?.token?.trim() ||
      cleanString(stored.token) ||
      process.env.HELM_PADDLE_TOKEN?.trim() ||
      process.env.PADDLE_OCR_TOKEN?.trim() ||
      ''
  const model = input?.model?.trim() || cleanString(stored.model) || DEFAULT_PADDLE_MODEL

  return { provider, token, model }
}

function normalizeProvider(value: unknown): OcrProvider {
  return value === 'paddle' ? 'paddle' : 'local'
}

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toStatus(config: ResolvedOcrConfig): OcrConfigStatus {
  return {
    provider: config.provider,
    model: config.model,
    tokenConfigured: Boolean(config.token),
    tokenPreview: maskToken(config.token)
  }
}

export function getOcrConfigStatus(): OcrConfigStatus {
  return toStatus(resolveConfig())
}

export function saveOcrConfig(input: {
  provider?: string
  token?: string
  clearToken?: boolean
  model?: string
}): OcrConfigStatus {
  const next = resolveConfig(input)
  const configPath = getConfigPath()
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        provider: next.provider,
        token: next.token,
        model: next.model
      },
      null,
      2
    ),
    'utf8'
  )
  return getOcrConfigStatus()
}

// Reads the config on every call so a settings change takes effect without
// restarting the perception loop. The local engine is the bundled RapidOCR
// sidecar (PP-OCR models, fully local); native Windows OCR was dropped on
// purpose — recognition quality was judged unacceptable by the user.
export async function runConfiguredOcr(imagePath: string): Promise<OcrResult> {
  const config = resolveConfig()
  if (config.provider === 'paddle' && config.token) {
    return runPaddleOcr(imagePath, { token: config.token, model: config.model })
  }
  return runRapidOcr(imagePath)
}
