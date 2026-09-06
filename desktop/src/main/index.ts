import { app, BrowserWindow, Tray } from 'electron'
import { join } from 'node:path'
import { createHelmDb, type HelmDb } from './db'
import { registerIpc } from './ipc'
import {
  configureScreenPerception,
  pruneExpiredCaptures,
  stopScreenPerception
} from './perception/screen-capture'
import { buildTrayMenu, createTrayIcon, shouldHideWindowToTray } from './tray'
import { runConfiguredOcr } from './ocr-config'
import { is } from '@electron-toolkit/utils'

let db: HelmDb | null = null
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 880,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f3ec',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('close', (event) => {
    if (!shouldHideWindowToTray(isQuitting)) {
      return
    }

    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function ensureTray() {
  if (tray) {
    return
  }

  tray = new Tray(createTrayIcon())
  tray.setToolTip('Helm · 舵')
  tray.on('click', () => {
    showWindow()
  })
}

function updateTrayMenu() {
  tray?.setContextMenu(
    buildTrayMenu({
      onOpenMain: showWindow,
      onQuit: () => {
        isQuitting = true
        app.quit()
      }
    })
  )
}

app.whenReady().then(() => {
  const userDataPath = app.getPath('userData')
  db = createHelmDb(join(userDataPath, 'helm.db'))
  configureScreenPerception({
    db,
    captureDirectory: join(userDataPath, 'auto-captures'),
    runOcr: runConfiguredOcr
  })
  void pruneExpiredCaptures()
  registerIpc(db)
  ensureTray()
  updateTrayMenu()
  mainWindow = createWindow()

  app.on('activate', () => {
    showWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  stopScreenPerception()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  db?.close()
  db = null
})
