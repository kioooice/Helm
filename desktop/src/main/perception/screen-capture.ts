import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { desktopCapturer, screen } from 'electron'
import type { PerceptionPauseReason, PerceptionStatus } from '../../shared/types'
import { buildCaptureFingerprint, isDuplicateRecent, rememberFingerprint } from './dedupe'
import type { OcrResult } from '../../shared/types'

// Raw captures are disposable: once their OCR text exists, the image is only
// kept for a short window so the user can still inspect the evidence.
export const DEFAULT_RETENTION_MS = 12 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 15_000
const DEFAULT_CAPTURE_MAX_EDGE = 1600
const DEFAULT_JPEG_QUALITY = 72

export type RawCaptureStore = {
  insertRawCapture: (imagePath: string, ocrText: string, createdAt?: string) => { id: number }
  pruneRawCapturesBefore: (cutoffIso: string) => string[]
}

type ScreenPerceptionContext = {
  db: RawCaptureStore
  captureDirectory: string
  retentionMs: number
  captureDesktopImage: () => Promise<Buffer>
  runOcr: (imagePath: string) => Promise<OcrResult>
}

let context: ScreenPerceptionContext | null = null
let captureTimer: ReturnType<typeof setInterval> | null = null
let running = false
let pauseReason: PerceptionPauseReason | null = 'manual'
let intervalMs = DEFAULT_INTERVAL_MS
let lastError = ''
let ocrAvailable = false
let ocrStatus = '等待首次识别'
let captureInFlight = false
let inFlightTick: Promise<PerceptionStatus> | null = null
let configureGeneration = 0
const statusListeners = new Set<(status: PerceptionStatus) => void>()

function normalizeIntervalMs(input: number | undefined) {
  if (!input || !Number.isFinite(input)) {
    return DEFAULT_INTERVAL_MS
  }
  return Math.max(MIN_INTERVAL_MS, Math.round(input))
}

function getStatus(): PerceptionStatus {
  return {
    running,
    paused: !running,
    pauseReason: running ? null : pauseReason,
    intervalMs,
    lastError,
    ocrAvailable,
    ocrStatus
  }
}

function notifyStatusChanged() {
  const status = getStatus()
  statusListeners.forEach((listener) => listener(status))
}

function getContext() {
  if (!context) {
    throw new Error('屏幕感知尚未初始化')
  }
  return context
}

function scaleToMaxEdge(width: number, height: number, maxEdge: number) {
  const safeWidth = Math.max(1, Math.round(width))
  const safeHeight = Math.max(1, Math.round(height))
  const longestEdge = Math.max(safeWidth, safeHeight)
  if (longestEdge <= maxEdge) {
    return { width: safeWidth, height: safeHeight }
  }

  const scale = maxEdge / longestEdge
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  }
}

async function defaultCaptureDesktopImage() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const size = primaryDisplay.size ?? primaryDisplay.bounds
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height))
    }
  })
  const source =
    sources.find((entry) => entry.display_id === String(primaryDisplay.id)) ??
    sources.find((entry) => !entry.thumbnail.isEmpty()) ??
    sources[0]

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('没有可用的桌面画面')
  }

  const imageSize = source.thumbnail.getSize()
  const targetSize = scaleToMaxEdge(imageSize.width, imageSize.height, DEFAULT_CAPTURE_MAX_EDGE)
  return source.thumbnail.resize({ ...targetSize, quality: 'good' }).toJPEG(DEFAULT_JPEG_QUALITY)
}

const defaultRunOcr = async (): Promise<OcrResult> => ({
  text: '',
  available: false,
  status: '未配置 OCR 引擎'
})

function getRetentionCutoffIso(retentionMs: number) {
  return new Date(Date.now() - retentionMs).toISOString()
}

async function removeFiles(paths: string[]) {
  await Promise.all(paths.map((filePath) => rm(filePath, { force: true }).catch(() => undefined)))
}

export function configureScreenPerception(options: {
  db: RawCaptureStore
  captureDirectory: string
  retentionMs?: number
  captureDesktopImage?: () => Promise<Buffer>
  runOcr?: (imagePath: string) => Promise<OcrResult>
}) {
  configureGeneration += 1
  context = {
    db: options.db,
    captureDirectory: options.captureDirectory,
    retentionMs: options.retentionMs ?? DEFAULT_RETENTION_MS,
    captureDesktopImage: options.captureDesktopImage ?? defaultCaptureDesktopImage,
    runOcr: options.runOcr ?? defaultRunOcr
  }
}

export function subscribePerceptionStatus(listener: (status: PerceptionStatus) => void) {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function getPerceptionStatus(): PerceptionStatus {
  return getStatus()
}

export async function pruneExpiredCaptures() {
  const activeContext = getContext()
  const expiredPaths = activeContext.db.pruneRawCapturesBefore(
    getRetentionCutoffIso(activeContext.retentionMs)
  )
  await removeFiles(expiredPaths)
  return expiredPaths
}

// A tick captured the generation it started with; reconfiguring (or stopping)
// invalidates it at the next await point, so a stale tick can never write into
// a freshly configured context.
async function runTickForContext(
  activeContext: ScreenPerceptionContext,
  generation: number
): Promise<PerceptionStatus> {
  let capturedImagePath = ''
  try {
    await mkdir(activeContext.captureDirectory, { recursive: true })
    if (!running || generation !== configureGeneration) {
      return getStatus()
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    capturedImagePath = join(activeContext.captureDirectory, `${timestamp}.jpg`)
    const image = await activeContext.captureDesktopImage()
    if (!running || generation !== configureGeneration) {
      await removeFiles([capturedImagePath])
      return getStatus()
    }

    await writeFile(capturedImagePath, image)

    const ocr = await activeContext.runOcr(capturedImagePath)
    if (!running || generation !== configureGeneration) {
      await removeFiles([capturedImagePath])
      return getStatus()
    }

    ocrAvailable = ocr.available
    ocrStatus = ocr.status
    lastError = ''

    const fingerprint = buildCaptureFingerprint(ocr.text)
    if (fingerprint && isDuplicateRecent(fingerprint)) {
      await removeFiles([capturedImagePath])
      notifyStatusChanged()
      return getStatus()
    }

    activeContext.db.insertRawCapture(capturedImagePath, ocr.text)
    if (fingerprint) {
      rememberFingerprint(fingerprint)
    }

    const expiredPaths = activeContext.db.pruneRawCapturesBefore(
      getRetentionCutoffIso(activeContext.retentionMs)
    )
    await removeFiles(expiredPaths)

    notifyStatusChanged()
    return getStatus()
  } catch (cause) {
    if (generation !== configureGeneration) {
      return getStatus()
    }
    lastError = cause instanceof Error ? cause.message : '自动截屏失败'
    if (capturedImagePath) {
      await removeFiles([capturedImagePath])
    }
    notifyStatusChanged()
    return getStatus()
  } finally {
    captureInFlight = false
  }
}

export function runCaptureTick(): Promise<PerceptionStatus> {
  const activeContext = getContext()
  if (!running) {
    return Promise.resolve(getStatus())
  }

  if (captureInFlight) {
    return inFlightTick ?? Promise.resolve(getStatus())
  }

  captureInFlight = true
  const tick = runTickForContext(activeContext, configureGeneration).finally(() => {
    inFlightTick = null
  })
  inFlightTick = tick
  return tick
}

// Resolves once no tick is in flight; lets callers (and tests) wait out a tick
// that was started moments ago.
export function waitForCaptureIdle(): Promise<void> {
  const pending = inFlightTick
  if (!pending) {
    return Promise.resolve()
  }
  return pending.then(() => undefined)
}

export function startScreenPerception(nextIntervalMs?: number): PerceptionStatus {
  getContext()
  intervalMs = normalizeIntervalMs(nextIntervalMs)
  if (captureTimer) {
    clearInterval(captureTimer)
  }
  running = true
  pauseReason = null
  captureTimer = setInterval(() => {
    void runCaptureTick()
  }, intervalMs)
  notifyStatusChanged()
  void runCaptureTick()
  return getStatus()
}

function pausePerception(reason: PerceptionPauseReason): PerceptionStatus {
  if (captureTimer) {
    clearInterval(captureTimer)
    captureTimer = null
  }
  running = false
  pauseReason = reason
  notifyStatusChanged()
  return getStatus()
}

export function stopScreenPerception(): PerceptionStatus {
  return pausePerception('manual')
}

export function pausePerceptionForPrivacy(): PerceptionStatus {
  return pausePerception('privacy')
}

export async function captureOnce(): Promise<PerceptionStatus> {
  const wasRunning = running
  if (!wasRunning) {
    running = true
  }
  try {
    return await runCaptureTick()
  } finally {
    if (!wasRunning) {
      running = false
    }
  }
}
