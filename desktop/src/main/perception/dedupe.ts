import { createHash } from 'node:crypto'

// Screen content repeats while the user stays on one page; an identical OCR
// text inside this window is treated as the same moment, not a new event.
const RECENT_DUPLICATE_WINDOW_MS = 10 * 60_000
const recentFingerprints = new Map<string, number>()

export function normalizeOcrTextForFingerprint(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function buildCaptureFingerprint(ocrText: string) {
  const normalized = normalizeOcrTextForFingerprint(ocrText)
  if (!normalized) {
    return ''
  }
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 32)
  return `ocr:${hash}`
}

export function isDuplicateRecent(fingerprint: string, now = Date.now()) {
  const lastSeenAt = recentFingerprints.get(fingerprint)
  if (lastSeenAt == null) {
    return false
  }

  if (now - lastSeenAt > RECENT_DUPLICATE_WINDOW_MS) {
    recentFingerprints.delete(fingerprint)
    return false
  }

  return true
}

export function rememberFingerprint(fingerprint: string, now = Date.now()) {
  recentFingerprints.set(fingerprint, now)
  pruneRecentFingerprints(now)
}

export function clearRecentFingerprints() {
  recentFingerprints.clear()
}

function pruneRecentFingerprints(now: number) {
  for (const [entry, timestamp] of recentFingerprints.entries()) {
    if (now - timestamp > RECENT_DUPLICATE_WINDOW_MS) {
      recentFingerprints.delete(entry)
    }
  }
}
