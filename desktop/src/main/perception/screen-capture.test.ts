import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captureOnce,
  configureScreenPerception,
  getPerceptionStatus,
  pausePerceptionForPrivacy,
  runCaptureTick,
  startScreenPerception,
  stopScreenPerception,
  waitForCaptureIdle
} from './screen-capture'
import { clearRecentFingerprints } from './dedupe'

type FakeCapture = { imagePath: string; ocrText: string; createdAt: string }

let fakeCaptures: FakeCapture[]
let captureDirectory: string
let captureCalls: number
let ocrText: string

beforeEach(() => {
  fakeCaptures = []
  captureDirectory = mkdtempSync(join(tmpdir(), 'helm-capture-'))
  captureCalls = 0
  ocrText = '第一条屏幕内容'
  clearRecentFingerprints()
  configureScreenPerception({
    db: {
      insertRawCapture: (imagePath, capturedOcrText, createdAt) => {
        fakeCaptures.push({
          imagePath,
          ocrText: capturedOcrText,
          createdAt: createdAt ?? new Date().toISOString()
        })
        return { id: fakeCaptures.length }
      },
      pruneRawCapturesBefore: (cutoffIso) => {
        const removed = fakeCaptures
          .filter((capture) => capture.createdAt < cutoffIso)
          .map((capture) => capture.imagePath)
        fakeCaptures = fakeCaptures.filter((capture) => capture.createdAt >= cutoffIso)
        return removed
      }
    },
    captureDirectory,
    captureDesktopImage: async () => {
      captureCalls += 1
      return Buffer.from(`fake-image-${captureCalls}`)
    },
    runOcr: async () => ({ text: ocrText, available: true, status: '测试 OCR' })
  })
})

afterEach(async () => {
  stopScreenPerception()
  await waitForCaptureIdle()
  clearRecentFingerprints()
})

describe('screen perception', () => {
  it('does not capture before the perception is running', async () => {
    await runCaptureTick()
    expect(fakeCaptures).toHaveLength(0)
    expect(getPerceptionStatus().running).toBe(false)
  })

  it('captures once on demand and records OCR text', async () => {
    const status = await captureOnce()
    expect(fakeCaptures).toHaveLength(1)
    expect(fakeCaptures[0].ocrText).toBe('第一条屏幕内容')
    expect(status.ocrStatus).toBe('测试 OCR')
    expect(existsSync(fakeCaptures[0].imagePath)).toBe(true)
  })

  it('skips an identical capture inside the dedupe window', async () => {
    await captureOnce()
    await captureOnce()
    expect(fakeCaptures).toHaveLength(1)
    expect(captureCalls).toBe(2)
  })

  it('records a capture again when the screen content changes', async () => {
    await captureOnce()
    ocrText = '切换到了另一个应用'
    await captureOnce()
    expect(fakeCaptures).toHaveLength(2)
  })

  it('pauses for privacy and reports the reason', async () => {
    const status = pausePerceptionForPrivacy()
    expect(status.running).toBe(false)
    expect(status.pauseReason).toBe('privacy')
    await runCaptureTick()
    expect(fakeCaptures).toHaveLength(0)
  })

  it('starts and stops with the timer lifecycle', () => {
    const started = startScreenPerception(30_000)
    expect(started.running).toBe(true)
    expect(started.intervalMs).toBe(30_000)

    const stopped = stopScreenPerception()
    expect(stopped.running).toBe(false)
    expect(stopped.pauseReason).toBe('manual')
  })

  it('cleans up expired captures after each tick', async () => {
    const oldPath = join(captureDirectory, 'old.jpg')
    writeFileSync(oldPath, 'old-image')
    fakeCaptures.push({
      imagePath: oldPath,
      ocrText: '过期记录',
      createdAt: '2026-01-01T00:00:00.000Z'
    })

    ocrText = '新的一条内容'
    await captureOnce()

    expect(existsSync(oldPath)).toBe(false)
    expect(fakeCaptures).toHaveLength(1)
    expect(fakeCaptures[0].ocrText).toBe('新的一条内容')
  })
})
