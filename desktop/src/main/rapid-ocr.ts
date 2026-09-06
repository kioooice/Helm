import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { app } from 'electron'
import type { OcrResult } from '../shared/types'

// RapidOCR sidecar: a persistent Python process keeps the PP-OCR models warm
// and answers one JSON line per image path on stdin. Captures are serialized
// (captureInFlight), so request/response order is sufficient.

export type RapidOcrOptions = {
  scriptPath?: string
  pythonPath?: string
  timeoutMs?: number
}

type SidecarResponse = { ok: boolean; text?: string; error?: string; fatal?: string }

type Sidecar = {
  child: ReturnType<typeof spawn>
  responses: Array<(response: SidecarResponse | null) => void>
  onExit: () => void
}

let sidecar: Sidecar | null = null
let sidecarUnavailable = false

export function resolveSidecarScript(baseDir: string = __dirname) {
  const fromEnv = process.env.HELM_SIDECAR_SCRIPT?.trim()
  if (fromEnv) {
    return fromEnv
  }
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'rapid-ocr-server.py')
  }
  return join(baseDir, '../../resources/rapid-ocr-server.py')
}

export function parseSidecarResponse(line: string): SidecarResponse | null {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.ok !== 'boolean') {
      return null
    }
    return {
      ok: parsed.ok,
      text: typeof parsed.text === 'string' ? parsed.text : '',
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
      fatal: typeof parsed.fatal === 'string' ? parsed.fatal : undefined
    }
  } catch {
    return null
  }
}

function killSidecar() {
  const current = sidecar
  sidecar = null
  if (current) {
    current.responses.forEach((resolve) => resolve(null))
    current.child.kill()
  }
}

function isRapidocrInstalled(pythonPath: string) {
  const check = spawnSync(pythonPath, ['-c', 'import rapidocr_onnxruntime'], {
    timeout: 60_000,
    windowsHide: true
  })
  return check.status === 0
}

function ensureSidecar(options: RapidOcrOptions): Sidecar | null {
  if (sidecarUnavailable) {
    return null
  }
  if (sidecar && !sidecar.child.killed && sidecar.child.exitCode === null) {
    return sidecar
  }

  const scriptPath = options.scriptPath ?? resolveSidecarScript()
  const pythonPath = options.pythonPath ?? process.env.HELM_PYTHON?.trim() ?? 'python'
  if (!isRapidocrInstalled(pythonPath)) {
    sidecarUnavailable = true
    return null
  }

  let active: Sidecar | null = null
  try {
    const child = spawn(pythonPath, [scriptPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    child.on('error', () => {
      sidecarUnavailable = true
      killSidecar()
    })

    active = {
      child,
      responses: [],
      onExit: () => {
        if (sidecar === active) {
          killSidecar()
        }
      }
    }
    child.on('exit', active.onExit)

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      if (!active || active.responses.length === 0) {
        return
      }
      const resolver = active.responses.shift()
      if (resolver) {
        resolver(parseSidecarResponse(line))
      }
    })
    child.stderr.on('data', () => {
      // Model loading and warnings go to stderr; ignore, errors surface via protocol.
    })
    sidecar = active
    return active
  } catch {
    sidecarUnavailable = true
    return null
  }
}

function requestSidecar(active: Sidecar, imagePath: string, timeoutMs: number) {
  return new Promise<SidecarResponse | null>((resolve) => {
    const timer = setTimeout(() => {
      const index = active.responses.indexOf(resolver)
      if (index !== -1) {
        active.responses.splice(index, 1)
      }
      // A timed-out request leaves the protocol out of sync; restart the sidecar.
      killSidecar()
      resolve(null)
    }, timeoutMs)

    const resolver = (response: SidecarResponse | null) => {
      clearTimeout(timer)
      resolve(response)
    }
    active.responses.push(resolver)
    active.child.stdin?.write(`${imagePath}\n`)
  })
}

export async function runRapidOcr(
  imagePath: string,
  options: RapidOcrOptions = {}
): Promise<OcrResult> {
  const active = ensureSidecar(options)
  if (!active) {
    return {
      text: '',
      available: false,
      status: 'RapidOCR 不可用（未安装 Python/rapidocr_onnxruntime）'
    }
  }

  const response = await requestSidecar(active, imagePath, options.timeoutMs ?? 60_000)
  if (response == null) {
    return { text: '', available: false, status: 'RapidOCR 识别超时' }
  }
  if (response.fatal) {
    sidecarUnavailable = true
    killSidecar()
    return {
      text: '',
      available: false,
      status: `RapidOCR 不可用：${response.fatal.slice(0, 120)}`
    }
  }
  if (!response.ok) {
    return {
      text: '',
      available: false,
      status: `RapidOCR 识别失败：${(response.error ?? '未知错误').slice(0, 120)}`
    }
  }
  return { text: response.text ?? '', available: true, status: 'RapidOCR 本地识别已启用' }
}

export function resetRapidOcrForTest() {
  killSidecar()
  sidecarUnavailable = false
}
