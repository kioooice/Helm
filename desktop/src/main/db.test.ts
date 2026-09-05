import { beforeEach, describe, expect, it } from 'vitest'
import { createHelmDb, type HelmDb } from './db'
import type { NewBehaviorEvent } from '../shared/types'

let db: HelmDb

beforeEach(() => {
  db = createHelmDb(':memory:')
})

describe('raw captures', () => {
  it('inserts, counts, lists and prunes captures by time', () => {
    db.insertRawCapture('C:/captures/one.jpg', '第一条', '2026-09-05T01:00:00.000Z')
    db.insertRawCapture('C:/captures/two.jpg', '第二条', '2026-09-05T05:00:00.000Z')
    db.insertRawCapture('C:/captures/old.jpg', '旧记录', '2026-09-01T05:00:00.000Z')

    expect(db.countRawCapturesBetween('2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z')).toBe(
      2
    )

    const listed = db.getRawCapturesBetween('2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z')
    expect(listed.map((capture) => capture.ocrText)).toEqual(['第一条', '第二条'])

    const pruned = db.pruneRawCapturesBefore('2026-09-03T00:00:00.000Z')
    expect(pruned).toEqual(['C:/captures/old.jpg'])
    expect(db.countRawCapturesBetween('2026-09-01T00:00:00.000Z', '2026-09-06T00:00:00.000Z')).toBe(
      2
    )

    expect(db.getRawCapturePath(1)).toBe('C:/captures/one.jpg')
    expect(db.getRawCapturePath(999)).toBeNull()
  })
})

describe('behavior events', () => {
  it('inserts and reads events with artifacts and confidence', () => {
    const event: NewBehaviorEvent = {
      source: 'screen',
      timestamp: '2026-09-05T08:30:00.000Z',
      appName: 'Chrome',
      windowTitle: 'Helm · 舵 - GitHub',
      activity: '阅读',
      topic: 'Rust 学习',
      mode: 'consumption',
      artifacts: ['https://github.com/kioooice/Helm'],
      confidence: 0.9,
      rawRef: 'raw-12'
    }
    db.insertEvents([event])

    const events = db.getEventsBetween('2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z')
    expect(events).toHaveLength(1)
    expect(events[0].topic).toBe('Rust 学习')
    expect(events[0].artifacts).toEqual(['https://github.com/kioooice/Helm'])
    expect(events[0].confidence).toBeCloseTo(0.9)
  })

  it('normalizes unknown mode and source values and clamps confidence', () => {
    db.insertEvents([
      {
        source: 'telepathy' as NewBehaviorEvent['source'],
        timestamp: '2026-09-05T08:30:00.000Z',
        appName: '',
        windowTitle: '',
        activity: '',
        topic: '',
        mode: 'napping' as NewBehaviorEvent['mode'],
        artifacts: [],
        confidence: 42,
        rawRef: ''
      }
    ])

    const [event] = db.getEventsBetween('2026-09-05T00:00:00.000Z', '2026-09-06T00:00:00.000Z')
    expect(event.source).toBe('screen')
    expect(event.mode).toBe('other')
    expect(event.confidence).toBe(1)
  })
})

describe('reports', () => {
  it('saves and reads the latest report', () => {
    db.saveReport({
      kind: 'daily',
      periodStart: '2026-09-04T00:00:00.000Z',
      periodEnd: '2026-09-05T00:00:00.000Z',
      metrics: '{}',
      narrative: '昨天的报告'
    })
    const latest = db.saveReport({
      kind: 'daily',
      periodStart: '2026-09-05T00:00:00.000Z',
      periodEnd: '2026-09-06T00:00:00.000Z',
      metrics: '{"captureCount":3}',
      narrative: '今天的报告'
    })

    expect(db.getLatestReport('daily')?.id).toBe(latest.id)
    expect(db.getLatestReport('daily')?.narrative).toBe('今天的报告')
    expect(db.getLatestReport('weekly')).toBeNull()
  })
})

describe('goals', () => {
  it('creates, lists and updates goals', () => {
    const goal = db.createGoal('每天写一点 Rust', ['rust', '学习'], 'output')
    expect(goal.status).toBe('active')
    expect(goal.topicKeywords).toEqual(['rust', '学习'])

    expect(db.listGoals('active')).toHaveLength(1)
    expect(db.listGoals('done')).toHaveLength(0)

    const updated = db.updateGoalStatus(goal.id, 'paused')
    expect(updated?.status).toBe('paused')
    expect(db.listGoals('active')).toHaveLength(0)
    expect(db.updateGoalStatus(999, 'done')).toBeNull()
  })

  it('dedupes and trims topic keywords', () => {
    const goal = db.createGoal('目标', [' rust ', 'RUST', '', '学习'], '')
    expect(goal.topicKeywords).toEqual(['rust', '学习'])
  })
})

describe('baselines', () => {
  it('upserts the latest value per metric and period', () => {
    db.upsertBaseline('output_ratio', '2026-W36', 0.2, 40)
    db.upsertBaseline('output_ratio', '2026-W36', 0.35, 50)

    expect(db.getBaseline('output_ratio', '2026-W36')).toEqual({ value: 0.35, sampleSize: 50 })
    expect(db.getBaseline('output_ratio', '2026-W37')).toBeNull()
  })
})
