import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PADDLE_JOB_URL,
  extractTextsFromOcrResult,
  parseOcrJsonl,
  runPaddleOcr
} from './paddle-ocr'

beforeEach(() => {
  delete process.env.HELM_PADDLE_TOKEN
  delete process.env.PADDLE_OCR_TOKEN
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractTextsFromOcrResult', () => {
  it('collects rec_texts from the pruned pipeline result', () => {
    const parsed = {
      result: {
        ocrResults: [
          {
            prunedResult: {
              rec_texts: ['Helm OCR Test 12345', '舵之测试：注意力记录 ABC'],
              rec_scores: [0.98, 0.97]
            },
            ocrImage: 'https://example.com/annotated.jpg'
          }
        ]
      }
    }
    expect(extractTextsFromOcrResult(parsed)).toEqual([
      'Helm OCR Test 12345',
      '舵之测试：注意力记录 ABC'
    ])
  })

  it('ignores empty and non-string entries and trims the rest', () => {
    expect(extractTextsFromOcrResult({ rec_texts: ['  a  ', '', 42, null, 'b'] })).toEqual([
      'a',
      'b'
    ])
  })

  it('returns nothing for nodes without rec_texts', () => {
    expect(extractTextsFromOcrResult({ ocrImage: 'https://example.com/x.jpg' })).toEqual([])
  })
})

describe('parseOcrJsonl', () => {
  it('joins texts across jsonl lines in order', () => {
    const line1 = JSON.stringify({
      result: { ocrResults: [{ prunedResult: { rec_texts: ['第一页'] } }] }
    })
    const line2 = JSON.stringify({
      result: { ocrResults: [{ prunedResult: { rec_texts: ['第二页 A', '第二页 B'] } }] }
    })
    expect(parseOcrJsonl(`${line1}\n${line2}\n\n`)).toBe('第一页\n第二页 A\n第二页 B')
  })

  it('skips malformed lines instead of failing', () => {
    const line = JSON.stringify({
      result: { ocrResults: [{ prunedResult: { rec_texts: ['ok'] } }] }
    })
    expect(parseOcrJsonl(`not-json\n${line}`)).toBe('ok')
  })
})

describe('runPaddleOcr', () => {
  function createFakeImage() {
    const dir = mkdtempSync(join(tmpdir(), 'helm-paddle-'))
    const imagePath = join(dir, 'capture.jpg')
    writeFileSync(imagePath, Buffer.from('fake-jpeg-bytes'))
    return imagePath
  }

  it('submits the job, polls until done and returns the joined text', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const url = String(_input)
      if (init?.method === 'POST') {
        expect(url).toBe(DEFAULT_PADDLE_JOB_URL)
        return new Response(JSON.stringify({ code: 0, data: { jobId: 'job-1' } }), { status: 200 })
      }
      if (url === `${DEFAULT_PADDLE_JOB_URL}/job-1`) {
        return new Response(
          JSON.stringify({
            data: { state: 'done', resultUrl: { jsonUrl: 'https://results.example.com/out.json' } }
          }),
          { status: 200 }
        )
      }
      const line = JSON.stringify({
        result: { ocrResults: [{ prunedResult: { rec_texts: ['屏幕文字一', '屏幕文字二'] } }] }
      })
      return new Response(line, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runPaddleOcr(createFakeImage(), {
      token: 'token-1234567890',
      pollIntervalMs: 1
    })

    expect(result.available).toBe(true)
    expect(result.text).toBe('屏幕文字一\n屏幕文字二')
    expect(result.status).toContain('Paddle')
  })

  it('reports a failed submit without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }))
    )

    const result = await runPaddleOcr(createFakeImage(), { token: 'token-1234567890' })
    expect(result.available).toBe(false)
    expect(result.text).toBe('')
    expect(result.status).toContain('401')
  })

  it('surfaces a failed job state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ code: 0, data: { jobId: 'job-2' } }), {
            status: 200
          })
        }
        return new Response(JSON.stringify({ data: { state: 'failed', errorMsg: 'bad image' } }), {
          status: 200
        })
      })
    )

    const result = await runPaddleOcr(createFakeImage(), {
      token: 'token-1234567890',
      pollIntervalMs: 1
    })
    expect(result.available).toBe(false)
    expect(result.status).toContain('bad image')
  })
})
