import { redactSensitiveText } from '../../shared/redaction'
import type { DayReportResult, RawCapture } from '../../shared/types'
import type { HelmDb } from '../db'
import { readAiProviderConfig } from './config'

const MAX_CHUNKS_PER_REPORT = 120
const MAX_TEXT_CHARS = 400

export type DayReportPayload = {
  date: string
  captureCount: number
  chunkCount: number
  truncated: boolean
  chunks: Array<{ at: string; text: string }>
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function getDayBounds(date: string): { startIso: string; endIso: string } {
  const match = DATE_PATTERN.exec(date.trim())
  if (!match) {
    throw new Error('日期格式应为 YYYY-MM-DD')
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const start = new Date(year, month - 1, day)
  const end = new Date(year, month - 1, day + 1)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

function collapseText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function buildDayReportPayload(captures: RawCapture[], date: string): DayReportPayload {
  const ordered = captures
    .filter((capture) => collapseText(capture.ocrText).length > 0)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))

  const chunks = ordered.slice(0, MAX_CHUNKS_PER_REPORT).map((capture) => {
    const text = collapseText(capture.ocrText)
    return {
      at: capture.createdAt,
      text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS - 1)}...` : text
    }
  })

  return {
    date,
    captureCount: ordered.length,
    chunkCount: chunks.length,
    truncated: ordered.length > chunks.length,
    chunks
  }
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const response = payload as {
    choices?: Array<{ message?: { content?: unknown } }>
  }

  const content = response.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

function getDeepSeekChatCompletionsUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  return `${normalizedBaseUrl || 'https://api.deepseek.com'}/chat/completions`
}

export const DAY_REPORT_SYSTEM_PROMPT = [
  '你是 Helm（舵）的每日回顾助手。Helm 帮助用户看清自己的注意力去向，支持渐进的行为改变。',
  '报告纪律：一屏以内；先给结论；最多三条要点；只讲与平日不同的变化，不复述流水账；',
  '语气是冷静、非评判的教练，绝不施压或引起内疚；使用中文；',
  '只根据输入的 OCR 时间片段总结，不要编造其中不存在的细节，不要复述疑似密码或密钥的内容。'
].join('')

export async function generateDayReport(db: HelmDb, date: string): Promise<DayReportResult> {
  const aiConfig = readAiProviderConfig()
  if (!aiConfig.apiKey) {
    return {
      ok: false,
      reason: '缺少 DeepSeek API Key，请先在设置里配置。'
    }
  }

  let bounds: { startIso: string; endIso: string }
  try {
    bounds = getDayBounds(date)
  } catch (cause) {
    return {
      ok: false,
      reason: cause instanceof Error ? cause.message : '日期无效。'
    }
  }

  const captures = db.getRawCapturesBetween(bounds.startIso, bounds.endIso)
  if (captures.length === 0) {
    return {
      ok: false,
      reason: '这一天还没有感知记录。'
    }
  }

  const payload = buildDayReportPayload(captures, date)

  try {
    const response = await fetch(getDeepSeekChatCompletionsUrl(aiConfig.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          {
            role: 'system',
            content: DAY_REPORT_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: JSON.stringify(payload)
          }
        ],
        temperature: 0.3,
        max_tokens: 900
      })
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      const safeMessage = redactSensitiveText(message, [aiConfig.apiKey])
      return {
        ok: false,
        reason: `DeepSeek 报告生成失败：${response.status}${safeMessage ? ` ${safeMessage.slice(0, 160)}` : ''}`
      }
    }

    const responseBody = (await response.json()) as unknown
    const narrative = extractResponseText(responseBody)
    if (!narrative) {
      return {
        ok: false,
        reason: 'AI 返回了空报告，请稍后再试。'
      }
    }

    db.saveReport({
      kind: 'daily',
      periodStart: bounds.startIso,
      periodEnd: bounds.endIso,
      metrics: JSON.stringify({
        captureCount: payload.captureCount,
        chunkCount: payload.chunkCount,
        model: aiConfig.model
      }),
      narrative
    })

    return {
      ok: true,
      reason: '已生成今日报告。',
      narrative
    }
  } catch (cause) {
    return {
      ok: false,
      reason: redactSensitiveText(cause instanceof Error ? cause.message : 'AI 报告生成失败。', [
        aiConfig.apiKey
      ])
    }
  }
}
