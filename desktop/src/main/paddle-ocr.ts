import { readFile } from 'node:fs/promises'
import type { OcrResult } from '../shared/types'

export type PaddleOcrOptions = {
  token: string
  model?: string
  jobUrl?: string
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export const DEFAULT_PADDLE_JOB_URL = 'https://paddleocr.aistudio-app.com/api/v2/ocr/jobs'
const DEFAULT_MODEL = 'PP-OCRv6'
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_POLL_TIMEOUT_MS = 90_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Recursively gathers rec_texts arrays from a parsed OCR result node; the exact
// nesting differs between Paddle pipeline versions, so matching by key is more
// robust than hard-coding the path.
export function extractTextsFromOcrResult(node: unknown): string[] {
  const texts: string[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const recTexts = record['rec_texts']
      if (Array.isArray(recTexts)) {
        recTexts.forEach((entry) => {
          if (typeof entry === 'string' && entry.trim()) {
            texts.push(entry.trim())
          }
        })
      }
      Object.values(record).forEach(visit)
    }
  }
  visit(node)
  return texts
}

export function parseOcrJsonl(jsonlText: string): string {
  const lines = jsonlText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const texts: string[] = []
  for (const line of lines) {
    try {
      texts.push(...extractTextsFromOcrResult(JSON.parse(line) as unknown))
    } catch {
      // Skip malformed lines; partial results are still usable.
    }
  }
  return texts.join('\n')
}

export async function runPaddleOcr(
  imagePath: string,
  options: PaddleOcrOptions
): Promise<OcrResult> {
  const jobUrl = (options.jobUrl?.trim() || DEFAULT_PADDLE_JOB_URL).replace(/\/+$/, '')
  const model = options.model?.trim() || DEFAULT_MODEL
  const authHeaders = { Authorization: `bearer ${options.token}` }

  try {
    const file = await readFile(imagePath)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(file)], { type: 'image/jpeg' }), 'capture.jpg')
    form.append('model', model)
    form.append(
      'optionalPayload',
      JSON.stringify({
        useDocOrientationClassify: false,
        useDocUnwarping: false,
        useTextlineOrientation: false
      })
    )

    const submit = await fetch(jobUrl, {
      method: 'POST',
      headers: authHeaders,
      body: form,
      signal: AbortSignal.timeout(30_000)
    })
    if (!submit.ok) {
      const detail = (await submit.text().catch(() => '')).slice(0, 160)
      return {
        text: '',
        available: false,
        status: `Paddle OCR 提交失败：${submit.status}${detail ? ` ${detail}` : ''}`
      }
    }

    const submitted = (await submit.json()) as { data?: { jobId?: unknown } }
    const rawJobId = submitted.data?.jobId
    const jobId =
      typeof rawJobId === 'string' || typeof rawJobId === 'number' ? String(rawJobId) : ''
    if (!jobId) {
      return { text: '', available: false, status: 'Paddle OCR 响应中没有 jobId' }
    }

    const deadline = Date.now() + (options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS)
    const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    let jsonUrl = ''
    while (Date.now() < deadline) {
      await sleep(intervalMs)
      const poll = await fetch(`${jobUrl}/${jobId}`, {
        headers: authHeaders,
        signal: AbortSignal.timeout(20_000)
      })
      if (!poll.ok) {
        continue
      }
      const body = (await poll.json()) as {
        data?: {
          state?: unknown
          errorMsg?: unknown
          resultUrl?: { jsonUrl?: unknown }
        }
      }
      const state = body.data?.state
      if (state === 'done') {
        jsonUrl =
          typeof body.data?.resultUrl?.jsonUrl === 'string' ? body.data.resultUrl.jsonUrl : ''
        break
      }
      if (state === 'failed') {
        return {
          text: '',
          available: false,
          status: `Paddle OCR 任务失败：${String(body.data?.errorMsg ?? '未知原因').slice(0, 160)}`
        }
      }
    }
    if (!jsonUrl) {
      return { text: '', available: false, status: 'Paddle OCR 轮询超时' }
    }

    const resultRes = await fetch(jsonUrl, { signal: AbortSignal.timeout(30_000) })
    if (!resultRes.ok) {
      return { text: '', available: false, status: `Paddle OCR 结果下载失败：${resultRes.status}` }
    }

    const jsonl = await resultRes.text()
    const text = parseOcrJsonl(jsonl)
    return { text, available: true, status: 'Paddle 云端 OCR 已启用' }
  } catch (cause) {
    return {
      text: '',
      available: false,
      status: `Paddle OCR 失败：${cause instanceof Error ? cause.message : '未知错误'}`
    }
  }
}
