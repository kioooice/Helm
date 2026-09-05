import { useCallback, useEffect, useState } from 'react'
import type {
  AiProviderConfig,
  DayReportResult,
  PerceptionStatus,
  ReportRecord
} from '../../shared/types'

function todayLocalDate() {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function describeStatus(status: PerceptionStatus | null) {
  if (!status) {
    return '状态加载中…'
  }
  if (status.running) {
    return `感知运行中 · 每 ${Math.round(status.intervalMs / 1000)} 秒一次`
  }
  if (status.pauseReason === 'privacy') {
    return '已暂停（隐私模式）'
  }
  return '已暂停'
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<PerceptionStatus | null>(null)
  const [report, setReport] = useState<ReportRecord | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [aiConfig, setAiConfig] = useState<AiProviderConfig | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [aiMessage, setAiMessage] = useState('')

  const refreshReport = useCallback(async () => {
    const latest = await window.helm.getLatestReport()
    setReport(latest)
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const [initialStatus, latestReport, config] = await Promise.all([
        window.helm.getStatus(),
        window.helm.getLatestReport(),
        window.helm.getAiConfig()
      ])
      setStatus(initialStatus)
      setReport(latestReport)
      setAiConfig(config)
      setBaseUrl(config.baseUrl)
      setModel(config.model)
    }
    void bootstrap()
    const unsubscribeStatus = window.helm.onStatusChanged(setStatus)
    const unsubscribeReport = window.helm.onReportGenerated(() => {
      void refreshReport()
    })
    return () => {
      unsubscribeStatus()
      unsubscribeReport()
    }
  }, [refreshReport])

  const handleTogglePerception = async () => {
    if (!status) return
    const next = status.running
      ? await window.helm.stopPerception()
      : await window.helm.startPerception()
    setStatus(next)
  }

  const handlePrivacyPause = async () => {
    setStatus(await window.helm.pauseForPrivacy())
  }

  const handleCaptureNow = async () => {
    setStatus(await window.helm.captureNow())
    setMessage('已截屏一次。')
  }

  const handleGenerateReport = async () => {
    setReportBusy(true)
    setMessage('')
    try {
      const result: DayReportResult = await window.helm.generateReport(todayLocalDate())
      setMessage(result.reason)
      if (result.ok) {
        await refreshReport()
      }
    } finally {
      setReportBusy(false)
    }
  }

  const handleSaveAiConfig = async () => {
    const saved = await window.helm.saveAiConfig({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
    })
    setAiConfig(saved)
    setApiKey('')
    setAiMessage('已保存 AI 配置。')
  }

  const handleTestAiConfig = async () => {
    setAiMessage('正在测试连接…')
    const result = await window.helm.testAiConfig({
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
    })
    setAiMessage(result.reason)
  }

  return (
    <main className="helm">
      <header className="helm-header">
        <div>
          <h1>舵 · Helm</h1>
          <p className="helm-tagline">一个私有的注意力记录，和一个帮你掌舵的教练。</p>
        </div>
        <span className={`helm-status ${status?.running ? 'is-running' : 'is-paused'}`}>
          {describeStatus(status)}
        </span>
      </header>

      <section className="helm-actions">
        <button type="button" onClick={handleTogglePerception} disabled={!status}>
          {status?.running ? '暂停感知' : '开启感知'}
        </button>
        <button type="button" onClick={handlePrivacyPause} disabled={!status || !status.running}>
          隐私暂停
        </button>
        <button type="button" onClick={handleCaptureNow} disabled={!status}>
          立即截屏
        </button>
        <button type="button" onClick={handleGenerateReport} disabled={reportBusy}>
          {reportBusy ? '生成中…' : '生成今日报告'}
        </button>
        <button type="button" className="ghost" onClick={() => setShowSettings((value) => !value)}>
          {showSettings ? '收起设置' : 'AI 设置'}
        </button>
      </section>

      {status?.lastError ? <p className="helm-error">感知异常：{status.lastError}</p> : null}
      {message ? <p className="helm-message">{message}</p> : null}

      {showSettings ? (
        <section className="helm-settings">
          <h2>AI 配置（DeepSeek）</h2>
          <label>
            Base URL
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label>
            模型
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="deepseek-v4-flash"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                aiConfig?.apiKeyConfigured ? `已配置（${aiConfig.apiKeyPreview}）` : 'sk-...'
              }
            />
          </label>
          <div className="helm-settings-actions">
            <button type="button" onClick={handleSaveAiConfig}>
              保存
            </button>
            <button type="button" onClick={handleTestAiConfig}>
              测试连接
            </button>
          </div>
          {aiMessage ? <p className="helm-message">{aiMessage}</p> : null}
        </section>
      ) : null}

      <section className="helm-report">
        <h2>今日报告</h2>
        {report ? (
          <>
            <pre className="helm-report-body">{report.narrative}</pre>
            <p className="helm-report-meta">
              生成于 {new Date(report.createdAt).toLocaleString('zh-CN')} · 原始截屏{' '}
              {status ? '12 小时后自动删除' : ''}
            </p>
          </>
        ) : (
          <p className="helm-empty">
            还没有报告。开启感知，等今天结束时点“生成今日报告”。
            <br />
            原始截屏只保留 12 小时，报告是唯一值得留下的东西。
          </p>
        )}
      </section>
    </main>
  )
}

export default App
