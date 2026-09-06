export type EventSource = 'screen' | 'audio' | 'manual' | 'glasses'

export type EventMode = 'input' | 'output' | 'communication' | 'consumption' | 'other'

export type RawCapture = {
  id: number
  imagePath: string
  ocrText: string
  createdAt: string
}

export type NewBehaviorEvent = {
  source: EventSource
  timestamp: string
  appName: string
  windowTitle: string
  activity: string
  topic: string
  mode: EventMode
  artifacts: string[]
  confidence: number
  rawRef: string
}

export type BehaviorEvent = NewBehaviorEvent & { id: number }

export type ReportKind = 'daily' | 'weekly'

export type ReportRecord = {
  id: number
  kind: ReportKind
  periodStart: string
  periodEnd: string
  metrics: string
  narrative: string
  createdAt: string
}

export type GoalStatus = 'active' | 'paused' | 'done'

export type Goal = {
  id: number
  title: string
  topicKeywords: string[]
  targetMode: EventMode | ''
  status: GoalStatus
  createdAt: string
  updatedAt: string
}

export type PerceptionPauseReason = 'manual' | 'privacy'

export type PerceptionStatus = {
  running: boolean
  paused: boolean
  pauseReason: PerceptionPauseReason | null
  intervalMs: number
  lastError: string
  ocrAvailable: boolean
  ocrStatus: string
}

export type OcrResult = {
  text: string
  available: boolean
  status: string
}

export type OcrProvider = 'local' | 'paddle'

export type OcrConfigStatus = {
  provider: OcrProvider
  model: string
  tokenConfigured: boolean
  tokenPreview: string
}

export type OcrConfigInput = {
  provider?: string
  token?: string
  clearToken?: boolean
  model?: string
}

export type AiProviderConfig = {
  provider: 'deepseek'
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  apiKeyPreview: string
}

export type AiProviderConfigInput = {
  baseUrl?: string
  model?: string
  apiKey?: string
  clearApiKey?: boolean
}

export type AiProviderConnectionTestResult = {
  ok: boolean
  reason: string
  model: string
}

export type DayReportCoverage = {
  captureCount: number
  chunkCount: number
  truncated: boolean
  coveredFrom: string
  coveredTo: string
}

export type DayReportPreview = {
  ok: boolean
  reason: string
  date: string
  coverage: DayReportCoverage | null
  targetBaseUrl: string
  targetModel: string
}

export type DayReportResult = {
  ok: boolean
  reason: string
  narrative?: string
  coverage?: DayReportCoverage
}
