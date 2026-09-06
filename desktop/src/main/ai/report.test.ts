import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHelmDb, type HelmDb } from '../db'
import { setAiConfigDirectory } from './config'
import {
  buildDayReportPayload,
  DAY_REPORT_SYSTEM_PROMPT,
  generateDayReport,
  getDayBounds,
  getCoverageFromPayload,
  previewDayReport
} from './report'
import type { RawCapture } from '../../shared/types'

let db: HelmDb
let configDir: string
let previousApiKey: string | undefined

function capture(text: string, createdAt: string): RawCapture {
  return { id: 0, imagePath: 'C:/captures/fake.jpg', ocrText: text, createdAt }
}

beforeEach(() => {
  db = createHelmDb(':memory:')
  configDir = mkdtempSync(join(tmpdir(), 'helm-ai-config-'))
  setAiConfigDirectory(configDir)
  previousApiKey = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_MODEL
  delete process.env.DEEPSEEK_BASE_URL
})

afterEach(() => {
  delete process.env.DEEPSEEK_API_KEY
  if (previousApiKey !== undefined) {
    process.env.DEEPSEEK_API_KEY = previousApiKey
  }
  vi.unstubAllGlobals()
})

describe('getDayBounds', () => {
  it('returns local-day bounds in ISO format', () => {
    const { startIso, endIso } = getDayBounds('2026-09-05')
    expect(startIso).toBe(new Date(2026, 8, 5).toISOString())
    expect(endIso).toBe(new Date(2026, 8, 6).toISOString())
  })

  it('rejects malformed dates', () => {
    expect(() => getDayBounds('2026/09/05')).toThrow()
  })
})

describe('buildDayReportPayload', () => {
  it('collapses text, drops empty captures and keeps chronological order', () => {
    const payload = buildDayReportPayload(
      [
        capture('  第二条 \n 内容  ', '2026-09-05T05:00:00.000Z'),
        capture('   ', '2026-09-05T04:00:00.000Z'),
        capture('第一条', '2026-09-05T01:00:00.000Z')
      ],
      '2026-09-05'
    )
    expect(payload.captureCount).toBe(2)
    expect(payload.chunks.map((chunk) => chunk.text)).toEqual(['第一条', '第二条 内容'])
    expect(payload.truncated).toBe(false)
  })

  it('truncates long OCR text and caps the number of chunks', () => {
    const many: RawCapture[] = []
    for (let index = 0; index < 150; index += 1) {
      many.push(capture(`内容${index} `.repeat(60), `2026-09-05T0${index % 10}:00:00.000Z`))
    }
    const payload = buildDayReportPayload(many, '2026-09-05')
    expect(payload.captureCount).toBe(150)
    expect(payload.chunkCount).toBe(120)
    expect(payload.truncated).toBe(true)
    payload.chunks.forEach((chunk) => {
      expect(chunk.text.length).toBeLessThanOrEqual(400)
    })
  })
})

describe('DAY_REPORT_SYSTEM_PROMPT', () => {
  it('forbids comparisons because no baselines are provided', () => {
    expect(DAY_REPORT_SYSTEM_PROMPT).toContain('禁止')
    expect(DAY_REPORT_SYSTEM_PROMPT).toContain('比较性')
    expect(DAY_REPORT_SYSTEM_PROMPT).toContain('证据不足')
    expect(DAY_REPORT_SYSTEM_PROMPT).not.toContain('与平日不同的变化')
  })
})

describe('getCoverageFromPayload', () => {
  it('reports the covered window of the chunks actually included', () => {
    const payload = buildDayReportPayload(
      [
        capture('第一条', '2026-09-05T01:00:00.000Z'),
        capture('第二条', '2026-09-05T05:00:00.000Z'),
        capture('第三条', '2026-09-05T09:00:00.000Z')
      ],
      '2026-09-05'
    )
    expect(getCoverageFromPayload(payload)).toEqual({
      captureCount: 3,
      chunkCount: 3,
      truncated: false,
      coveredFrom: '2026-09-05T01:00:00.000Z',
      coveredTo: '2026-09-05T09:00:00.000Z'
    })
  })
})

describe('previewDayReport', () => {
  it('never touches the network and fails cleanly on an empty day', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const preview = previewDayReport(db, '2026-09-05')
    expect(preview.ok).toBe(false)
    expect(preview.coverage).toBeNull()
    expect(preview.reason).toContain('没有感知记录')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows coverage and target service without sending anything', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    db.insertRawCapture('C:/captures/one.jpg', '上午的记录', '2026-09-05T01:00:00.000Z')
    db.insertRawCapture('C:/captures/two.jpg', '下午的记录', '2026-09-05T07:00:00.000Z')

    const preview = previewDayReport(db, '2026-09-05')
    expect(preview.ok).toBe(true)
    expect(preview.coverage).toEqual({
      captureCount: 2,
      chunkCount: 2,
      truncated: false,
      coveredFrom: '2026-09-05T01:00:00.000Z',
      coveredTo: '2026-09-05T07:00:00.000Z'
    })
    expect(preview.targetBaseUrl).toBe('https://api.deepseek.com')
    expect(preview.targetModel).toBe('deepseek-v4-flash')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('warns when the API key is missing instead of silently failing later', () => {
    db.insertRawCapture('C:/captures/one.jpg', '有一条记录', '2026-09-05T01:00:00.000Z')
    const preview = previewDayReport(db, '2026-09-05')
    expect(preview.ok).toBe(true)
    expect(preview.reason).toContain('API Key')
  })
})

describe('generateDayReport', () => {
  it('fails gracefully without an API key', async () => {
    const result = await generateDayReport(db, '2026-09-05')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('API Key')
  })

  it('fails gracefully when the day has no captures', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-key-1234567890'
    const result = await generateDayReport(db, '2026-09-05')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('没有感知记录')
  })

  it('generates and stores a report from captured OCR text', async () => {
    process.env.DEEPSEEK_API_KEY = 'sk-test-key-1234567890'
    db.insertRawCapture('C:/captures/one.jpg', '上午在写 Rust 练习', '2026-09-05T01:00:00.000Z')
    db.insertRawCapture('C:/captures/two.jpg', '下午在改报告', '2026-09-05T07:00:00.000Z')

    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => {
      const payload = JSON.stringify({
        choices: [{ message: { content: '今日要点：上午专注 Rust。' } }]
      })
      return new Response(payload, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateDayReport(db, '2026-09-05')
    expect(result.ok).toBe(true)
    expect(result.narrative).toContain('今日要点')
    expect(result.coverage).toMatchObject({
      captureCount: 2,
      chunkCount: 2,
      truncated: false,
      coveredFrom: '2026-09-05T01:00:00.000Z',
      coveredTo: '2026-09-05T07:00:00.000Z'
    })

    const stored = db.getLatestReport('daily')
    expect(stored?.narrative).toContain('今日要点')
    expect(JSON.parse(stored?.metrics ?? '{}').captureCount).toBe(2)

    const [, requestOptions] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(requestOptions.body)) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[0].content).toBe(DAY_REPORT_SYSTEM_PROMPT)
    expect(body.messages[1].content).toContain('上午在写 Rust 练习')
  })

  it('redacts the API key from failed requests', async () => {
    const apiKey = 'sk-test-key-1234567890'
    process.env.DEEPSEEK_API_KEY = apiKey
    db.insertRawCapture('C:/captures/one.jpg', '有一条记录', '2026-09-05T01:00:00.000Z')

    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string | URL, _init?: RequestInit) =>
          new Response(JSON.stringify({ error: { message: `bad key ${apiKey}` } }), { status: 401 })
      )
    )

    const result = await generateDayReport(db, '2026-09-05')
    expect(result.ok).toBe(false)
    expect(result.reason).not.toContain(apiKey)
  })
})
