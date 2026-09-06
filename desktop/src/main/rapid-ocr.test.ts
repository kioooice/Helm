import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseSidecarResponse, resetRapidOcrForTest, runRapidOcr } from './rapid-ocr'

const SCRIPT_PATH = join(process.cwd(), 'resources', 'rapid-ocr-server.py')

function isRapidocrAvailable() {
  const check = spawnSync('python', ['-c', 'import rapidocr_onnxruntime'], {
    timeout: 60_000,
    windowsHide: true
  })
  return check.status === 0
}

const rapidAvailable = isRapidocrAvailable()

// 24-bit BMP: 64x64 solid white, no text — a valid image the engine can chew on.
function createBlankImage() {
  const width = 64
  const height = 64
  const rowSize = width * 3
  const pixelBytes = rowSize * height
  const buffer = Buffer.alloc(54 + pixelBytes)
  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(buffer.length, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelBytes, 34)
  buffer.fill(0xff, 54)
  const dir = mkdtempSync(join(tmpdir(), 'helm-rapid-'))
  const imagePath = join(dir, 'blank.bmp')
  writeFileSync(imagePath, buffer)
  return imagePath
}

afterEach(() => {
  resetRapidOcrForTest()
})

describe('parseSidecarResponse', () => {
  it('parses ok responses with text', () => {
    expect(parseSidecarResponse('{"ok":true,"text":"识别文字"}')).toEqual({
      ok: true,
      text: '识别文字',
      error: undefined,
      fatal: undefined
    })
  })

  it('parses error and fatal responses', () => {
    expect(parseSidecarResponse('{"ok":false,"error":"bad image"}')).toMatchObject({ ok: false })
    expect(parseSidecarResponse('{"ok":false,"fatal":"rapidocr unavailable: x"}')).toMatchObject({
      ok: false,
      fatal: expect.stringContaining('unavailable')
    })
  })

  it('returns null for malformed lines without throwing', () => {
    expect(parseSidecarResponse('not-json')).toBeNull()
    expect(parseSidecarResponse('{"no": "ok-field"}')).toBeNull()
    expect(parseSidecarResponse('')).toBeNull()
  })
})

describe('runRapidOcr against the real sidecar', () => {
  it.runIf(rapidAvailable)(
    'recognizes a blank image over the stdin/stdout protocol',
    async () => {
      const result = await runRapidOcr(createBlankImage(), {
        scriptPath: SCRIPT_PATH,
        timeoutMs: 60_000
      })
      expect(result.available).toBe(true)
      expect(result.status).toContain('RapidOCR')
      expect(typeof result.text).toBe('string')
    },
    90_000
  )

  it.skipIf(rapidAvailable)('reports unavailability when the engine is missing', async () => {
    const result = await runRapidOcr(createBlankImage(), { scriptPath: SCRIPT_PATH })
    expect(result.available).toBe(false)
    expect(result.status).toContain('RapidOCR')
  })
})
