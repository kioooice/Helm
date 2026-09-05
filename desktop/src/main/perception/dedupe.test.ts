import { afterEach, describe, expect, it } from 'vitest'
import {
  buildCaptureFingerprint,
  clearRecentFingerprints,
  isDuplicateRecent,
  normalizeOcrTextForFingerprint,
  rememberFingerprint
} from './dedupe'

afterEach(() => {
  clearRecentFingerprints()
})

describe('buildCaptureFingerprint', () => {
  it('produces the same fingerprint for texts that differ only in whitespace', () => {
    const left = buildCaptureFingerprint('Helm · 舵\n今日报告\n v0')
    const right = buildCaptureFingerprint('Helm · 舵 今日报告 v0')
    expect(left).toBe(right)
    expect(left.startsWith('ocr:')).toBe(true)
  })

  it('returns an empty fingerprint for blank text', () => {
    expect(buildCaptureFingerprint('   \n  ')).toBe('')
  })

  it('normalizes all whitespace inside the text', () => {
    expect(normalizeOcrTextForFingerprint('a\n\t b   c')).toBe('a b c')
  })
})

describe('recent duplicate window', () => {
  it('treats a fingerprint seen inside the window as duplicate', () => {
    const fingerprint = buildCaptureFingerprint('同一天屏幕内容')
    const now = Date.now()
    expect(isDuplicateRecent(fingerprint, now)).toBe(false)
    rememberFingerprint(fingerprint, now)
    expect(isDuplicateRecent(fingerprint, now + 60_000)).toBe(true)
  })

  it('stops treating a fingerprint as duplicate after the window', () => {
    const fingerprint = buildCaptureFingerprint('十分钟后回到同一页')
    const now = Date.now()
    rememberFingerprint(fingerprint, now)
    expect(isDuplicateRecent(fingerprint, now + 11 * 60_000)).toBe(false)
  })
})
