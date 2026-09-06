import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type { AiProviderConfigInput } from '../shared/types'
import type { HelmDb } from './db'
import {
  captureOnce,
  getPerceptionStatus,
  pausePerceptionForPrivacy,
  startScreenPerception,
  stopScreenPerception,
  subscribePerceptionStatus
} from './perception/screen-capture'
import { generateDayReport, previewDayReport } from './ai/report'
import {
  getAiProviderConfigStatus,
  saveAiProviderConfig,
  testAiProviderConnection
} from './ai/config'
import { getOcrConfigStatus, saveOcrConfig } from './ocr-config'
import type { OcrConfigInput } from '../shared/types'

export function registerIpc(db: HelmDb) {
  const broadcastStatus = () => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.statusChanged, getPerceptionStatus())
      }
    })
  }

  subscribePerceptionStatus(broadcastStatus)

  ipcMain.handle(IPC_CHANNELS.getStatus, () => getPerceptionStatus())
  ipcMain.handle(IPC_CHANNELS.startPerception, (_event, intervalMs?: number) =>
    startScreenPerception(intervalMs)
  )
  ipcMain.handle(IPC_CHANNELS.stopPerception, () => stopScreenPerception())
  ipcMain.handle(IPC_CHANNELS.pauseForPrivacy, () => pausePerceptionForPrivacy())
  ipcMain.handle(IPC_CHANNELS.captureNow, () => captureOnce())
  ipcMain.handle(IPC_CHANNELS.getLatestReport, () => db.getLatestReport('daily'))
  ipcMain.handle(IPC_CHANNELS.previewReport, (_event, date: string) => previewDayReport(db, date))
  ipcMain.handle(IPC_CHANNELS.generateReport, async (_event, date: string) => {
    const result = await generateDayReport(db, date)
    if (result.ok) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC_CHANNELS.reportGenerated, result)
        }
      })
    }
    return result
  })
  ipcMain.handle(IPC_CHANNELS.getAiConfig, () => getAiProviderConfigStatus())
  ipcMain.handle(IPC_CHANNELS.saveAiConfig, (_event, input: AiProviderConfigInput) =>
    saveAiProviderConfig(input)
  )
  ipcMain.handle(IPC_CHANNELS.testAiConfig, (_event, input: AiProviderConfigInput) =>
    testAiProviderConnection(input)
  )
  ipcMain.handle(IPC_CHANNELS.getOcrConfig, () => getOcrConfigStatus())
  ipcMain.handle(IPC_CHANNELS.saveOcrConfig, (_event, input: OcrConfigInput) =>
    saveOcrConfig(input)
  )
}
