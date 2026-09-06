import { useCallback, useEffect, useState } from 'react'
import type {
  AiProviderConfig,
  DayReportCoverage,
  DayReportPreview,
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

function formatClock(iso: string) {
  if (!iso) return '未知'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function describeCoverage(coverage: DayReportCoverage) {
  const scope = `基于 ${coverage.captureCount} 条记录 · 覆盖 ${formatClock(coverage.coveredFrom)}–${formatClock(coverage.coveredTo)}`
  return coverage.truncated
    ? `${scope} · 仅取前 ${coverage.chunkCount} 条，其余未包含`
    : `${scope} · 共 ${coverage.chunkCount} 条`
}

function App(): React.JSX.Element {
  const [status, setStatus] = useState<PerceptionStatus | null>(null)
  const [report, setReport] = useState<ReportRecord | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pendingPreview, setPendingPreview] = useState<DayReportPreview | null>(null)
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

  // 第一步：只做本地预览，不发任何网络请求。
  const handleGenerateReport = async () => {
    setReportBusy(true)
    setMessage('')
    try {
      const preview = await window.helm.previewReport(todayLocalDate())
      if (!preview.ok || !preview.coverage) {
        setMessage(preview.reason || '这一天还没有感知记录。')
        return
      }
      setPendingPreview(preview)
    } finally {
      setReportBusy(false)
    }
  }

  const handleCancelSend = () => {
    setPendingPreview(null)
    setMessage('已取消，未发送任何数据。')
  }

  // 第二步：用户确认后才真正请求模型服务。
  const handleConfirmSend = async () => {
    setPendingPreview(null)
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

  const reportDateLabel = report ? new Date(report.periodStart).toLocaleDateString('zh-CN') : ''

  return (
    <main className="helm">
      <header className="helm-header">
        <div>
          <h1>舵 · Helm</h1>
          <p className="helm-tagline">从你允许的记录里，找出有依据的发现。</p>
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
          {reportBusy ? '处理中…' : '生成报告'}
        </button>
        <button type="button" className="ghost" onClick={() => setShowSettings((value) => !value)}>
          {showSettings ? '收起设置' : 'AI 设置'}
        </button>
      </section>

      {status?.lastError ? <p className="helm-error">感知异常：{status.lastError}</p> : null}
      {message ? <p className="helm-message">{message}</p> : null}

      {pendingPreview?.coverage ? (
        <section className="helm-confirm">
          <h2>发送前确认</h2>
          <p>
            将把 <strong>{pendingPreview.coverage.captureCount}</strong> 条屏幕 OCR 文本片段（
            {describeCoverage(pendingPreview.coverage)}）发送到{' '}
            <code>{pendingPreview.targetBaseUrl}</code>（模型 {pendingPreview.targetModel}）。
          </p>
          <p className="helm-confirm-warn">
            这些文本是原始 OCR
            内容，未经脱敏，可能包含屏幕上出现过的敏感信息；发送后由该服务按其隐私政策处理。
          </p>
          {pendingPreview.reason ? <p className="helm-message">{pendingPreview.reason}</p> : null}
          <div className="helm-settings-actions">
            <button type="button" onClick={handleConfirmSend}>
              确认发送
            </button>
            <button type="button" className="ghost" onClick={handleCancelSend}>
              取消
            </button>
          </div>
        </section>
      ) : null}

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
        <h2>{report ? `报告 · ${reportDateLabel}` : '报告'}</h2>
        {report ? (
          <>
            <pre className="helm-report-body">{report.narrative}</pre>
            <p className="helm-report-meta">
              生成于 {new Date(report.createdAt).toLocaleString('zh-CN')} · 原始截屏在采集运行期间按
              12 小时参数滚动清理（非严格定时删除）
            </p>
          </>
        ) : (
          <p className="helm-empty">
            还没有报告。开启感知，等今天结束时点“生成报告”。
            <br />
            生成前会先显示将要发送的内容，由你确认后才会请求模型服务。
          </p>
        )}
      </section>
    </main>
  )
}

export default App
