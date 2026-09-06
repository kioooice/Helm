export const IPC_CHANNELS = {
  getStatus: 'helm:get-status',
  startPerception: 'helm:start-perception',
  stopPerception: 'helm:stop-perception',
  pauseForPrivacy: 'helm:pause-privacy',
  captureNow: 'helm:capture-now',
  previewReport: 'helm:preview-report',
  generateReport: 'helm:generate-report',
  getLatestReport: 'helm:get-latest-report',
  getAiConfig: 'helm:get-ai-config',
  saveAiConfig: 'helm:save-ai-config',
  testAiConfig: 'helm:test-ai-config',
  statusChanged: 'helm:status-changed',
  reportGenerated: 'helm:report-generated'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
