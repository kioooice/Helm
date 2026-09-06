import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  AiProviderConfig,
  AiProviderConfigInput,
  AiProviderConnectionTestResult,
  DayReportPreview,
  DayReportResult,
  PerceptionStatus,
  ReportRecord
} from '../shared/types'

export type HelmApi = {
  getStatus: () => Promise<PerceptionStatus>
  startPerception: (intervalMs?: number) => Promise<PerceptionStatus>
  stopPerception: () => Promise<PerceptionStatus>
  pauseForPrivacy: () => Promise<PerceptionStatus>
  captureNow: () => Promise<PerceptionStatus>
  getLatestReport: () => Promise<ReportRecord | null>
  previewReport: (date: string) => Promise<DayReportPreview>
  generateReport: (date: string) => Promise<DayReportResult>
  getAiConfig: () => Promise<AiProviderConfig>
  saveAiConfig: (input: AiProviderConfigInput) => Promise<AiProviderConfig>
  testAiConfig: (input: AiProviderConfigInput) => Promise<AiProviderConnectionTestResult>
  onStatusChanged: (handler: (status: PerceptionStatus) => void) => () => void
  onReportGenerated: (handler: (result: DayReportResult) => void) => () => void
}

const api: HelmApi = {
  getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getStatus),
  startPerception: (intervalMs?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.startPerception, intervalMs),
  stopPerception: () => ipcRenderer.invoke(IPC_CHANNELS.stopPerception),
  pauseForPrivacy: () => ipcRenderer.invoke(IPC_CHANNELS.pauseForPrivacy),
  captureNow: () => ipcRenderer.invoke(IPC_CHANNELS.captureNow),
  getLatestReport: () => ipcRenderer.invoke(IPC_CHANNELS.getLatestReport),
  previewReport: (date: string) => ipcRenderer.invoke(IPC_CHANNELS.previewReport, date),
  generateReport: (date: string) => ipcRenderer.invoke(IPC_CHANNELS.generateReport, date),
  getAiConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getAiConfig),
  saveAiConfig: (input: AiProviderConfigInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveAiConfig, input),
  testAiConfig: (input: AiProviderConfigInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.testAiConfig, input),
  onStatusChanged: (handler) => {
    const listener = (_event: unknown, status: PerceptionStatus) => handler(status)
    ipcRenderer.on(IPC_CHANNELS.statusChanged, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.statusChanged, listener)
    }
  },
  onReportGenerated: (handler) => {
    const listener = (_event: unknown, result: DayReportResult) => handler(result)
    ipcRenderer.on(IPC_CHANNELS.reportGenerated, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.reportGenerated, listener)
    }
  }
}

contextBridge.exposeInMainWorld('helm', api)
