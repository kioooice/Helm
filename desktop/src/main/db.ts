import Database from 'better-sqlite3'
import type {
  BehaviorEvent,
  EventMode,
  EventSource,
  Goal,
  GoalStatus,
  NewBehaviorEvent,
  RawCapture,
  ReportKind,
  ReportRecord
} from '../shared/types'

export type HelmDb = {
  insertRawCapture: (imagePath: string, ocrText: string, createdAt?: string) => RawCapture
  pruneRawCapturesBefore: (cutoffIso: string) => string[]
  getRawCapturesBetween: (startIso: string, endIso: string) => RawCapture[]
  countRawCapturesBetween: (startIso: string, endIso: string) => number
  getRawCapturePath: (captureId: number) => string | null
  insertEvents: (events: NewBehaviorEvent[]) => void
  getEventsBetween: (startIso: string, endIso: string) => BehaviorEvent[]
  saveReport: (input: {
    kind: ReportKind
    periodStart: string
    periodEnd: string
    metrics: string
    narrative: string
  }) => ReportRecord
  getLatestReport: (kind?: ReportKind) => ReportRecord | null
  createGoal: (title: string, topicKeywords: string[], targetMode: EventMode | '') => Goal
  listGoals: (status?: GoalStatus) => Goal[]
  updateGoalStatus: (goalId: number, status: GoalStatus) => Goal | null
  upsertBaseline: (metric: string, period: string, value: number, sampleSize?: number) => void
  getBaseline: (metric: string, period: string) => { value: number; sampleSize: number } | null
  close: () => void
}

const EVENT_SOURCES: EventSource[] = ['screen', 'audio', 'manual', 'glasses']
const EVENT_MODES: EventMode[] = ['input', 'output', 'communication', 'consumption', 'other']
const GOAL_STATUSES: GoalStatus[] = ['active', 'paused', 'done']

function nowIso() {
  return new Date().toISOString()
}

function normalizeSource(value: string | null | undefined): EventSource {
  return EVENT_SOURCES.includes(value as EventSource) ? (value as EventSource) : 'screen'
}

function normalizeMode(value: string | null | undefined): EventMode {
  return EVENT_MODES.includes(value as EventMode) ? (value as EventMode) : 'other'
}

function normalizeGoalStatus(value: string | null | undefined): GoalStatus {
  return GOAL_STATUSES.includes(value as GoalStatus) ? (value as GoalStatus) : 'active'
}

function normalizeKeywords(keywords: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .forEach((keyword) => {
      const key = keyword.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        result.push(keyword)
      }
    })
  return result
}

function normalizeTargetMode(value: string | null | undefined): EventMode | '' {
  return value === '' ? '' : normalizeMode(value)
}

type RawEventRow = Omit<BehaviorEvent, 'artifacts' | 'mode' | 'source'> & {
  source: string | null
  mode: string | null
  artifacts: string | null
}

function eventFromRow(row: RawEventRow): BehaviorEvent {
  let artifacts: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.artifacts ?? '[]')
    if (Array.isArray(parsed)) {
      artifacts = parsed.filter((entry): entry is string => typeof entry === 'string')
    }
  } catch {
    artifacts = []
  }

  return {
    ...row,
    source: normalizeSource(row.source),
    mode: normalizeMode(row.mode),
    artifacts
  }
}

export function createHelmDb(filename: string): HelmDb {
  const db = new Database(filename)
  try {
    db.pragma('journal_mode = WAL')
  } catch {
    // In-memory databases and some filesystems do not support WAL; defaults are fine.
  }

  db.exec(`
    create table if not exists raw_captures (
      id integer primary key autoincrement,
      image_path text not null,
      ocr_text text not null default '',
      created_at text not null default ''
    );
    create table if not exists events (
      id integer primary key autoincrement,
      source text not null default 'screen',
      timestamp text not null,
      app_name text not null default '',
      window_title text not null default '',
      activity text not null default '',
      topic text not null default '',
      mode text not null default 'other',
      artifacts text not null default '[]',
      confidence real not null default 0.5,
      raw_ref text not null default '',
      created_at text not null default ''
    );
    create table if not exists reports (
      id integer primary key autoincrement,
      kind text not null default 'daily',
      period_start text not null,
      period_end text not null,
      metrics text not null default '',
      narrative text not null default '',
      created_at text not null default ''
    );
    create table if not exists goals (
      id integer primary key autoincrement,
      title text not null,
      topic_keywords text not null default '[]',
      target_mode text not null default '',
      status text not null default 'active',
      created_at text not null default '',
      updated_at text not null default ''
    );
    create table if not exists baselines (
      id integer primary key autoincrement,
      metric text not null,
      period text not null,
      value real not null,
      sample_size integer not null default 0,
      created_at text not null default '',
      unique(metric, period)
    );
  `)

  db.exec(`
    create index if not exists raw_captures_created_at on raw_captures (created_at);
    create index if not exists events_timestamp on events (timestamp);
    create index if not exists events_source_time on events (source, timestamp);
    create index if not exists events_topic on events (topic);
    create index if not exists reports_kind_period on reports (kind, period_start);
  `)

  const insertRawCaptureStatement = db.prepare(
    'insert into raw_captures (image_path, ocr_text, created_at) values (?, ?, ?)'
  )
  const insertEventStatement = db.prepare(`
    insert into events (source, timestamp, app_name, window_title, activity, topic, mode, artifacts, confidence, raw_ref, created_at)
    values (@source, @timestamp, @appName, @windowTitle, @activity, @topic, @mode, @artifacts, @confidence, @rawRef, @createdAt)
  `)

  return {
    insertRawCapture(imagePath: string, ocrText: string, createdAt?: string): RawCapture {
      const result = insertRawCaptureStatement.run(imagePath, ocrText, createdAt ?? nowIso())
      const id = Number(result.lastInsertRowid)
      return {
        id,
        imagePath,
        ocrText,
        createdAt: createdAt ?? nowIso()
      }
    },
    pruneRawCapturesBefore(cutoffIso: string): string[] {
      const removed = db
        .prepare('select id, image_path as imagePath from raw_captures where created_at < ?')
        .all(cutoffIso) as Array<{ id: number; imagePath: string }>
      db.prepare('delete from raw_captures where created_at < ?').run(cutoffIso)
      return removed.map((row) => row.imagePath)
    },
    getRawCapturesBetween(startIso: string, endIso: string): RawCapture[] {
      return db
        .prepare(
          'select id, image_path as imagePath, ocr_text as ocrText, created_at as createdAt from raw_captures where created_at >= ? and created_at < ? order by created_at asc'
        )
        .all(startIso, endIso) as RawCapture[]
    },
    countRawCapturesBetween(startIso: string, endIso: string): number {
      const row = db
        .prepare(
          'select count(*) as count from raw_captures where created_at >= ? and created_at < ?'
        )
        .get(startIso, endIso) as { count: number }
      return row.count
    },
    getRawCapturePath(captureId: number): string | null {
      const row = db
        .prepare('select image_path as imagePath from raw_captures where id = ?')
        .get(captureId) as { imagePath: string } | undefined
      return row?.imagePath ?? null
    },
    insertEvents(events: NewBehaviorEvent[]): void {
      const timestamp = nowIso()
      const insertMany = db.transaction((items: NewBehaviorEvent[]) => {
        items.forEach((event) => {
          insertEventStatement.run({
            source: normalizeSource(event.source),
            timestamp: event.timestamp,
            appName: event.appName,
            windowTitle: event.windowTitle,
            activity: event.activity,
            topic: event.topic,
            mode: normalizeMode(event.mode),
            artifacts: JSON.stringify(normalizeKeywords(event.artifacts)),
            confidence: Number.isFinite(event.confidence)
              ? Math.max(0, Math.min(1, event.confidence))
              : 0.5,
            rawRef: event.rawRef,
            createdAt: timestamp
          })
        })
      })
      insertMany(events)
    },
    getEventsBetween(startIso: string, endIso: string): BehaviorEvent[] {
      const rows = db
        .prepare(
          'select id, source, timestamp, app_name as appName, window_title as windowTitle, activity, topic, mode, artifacts, confidence, raw_ref as rawRef, created_at as createdAt from events where timestamp >= ? and timestamp < ? order by timestamp asc'
        )
        .all(startIso, endIso) as RawEventRow[]
      return rows.map(eventFromRow)
    },
    saveReport(input): ReportRecord {
      const createdAt = nowIso()
      const result = db
        .prepare(
          'insert into reports (kind, period_start, period_end, metrics, narrative, created_at) values (?, ?, ?, ?, ?, ?)'
        )
        .run(
          input.kind,
          input.periodStart,
          input.periodEnd,
          input.metrics,
          input.narrative,
          createdAt
        )
      const id = Number(result.lastInsertRowid)
      return {
        id,
        kind: input.kind,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        metrics: input.metrics,
        narrative: input.narrative,
        createdAt
      }
    },
    getLatestReport(kind?: ReportKind): ReportRecord | null {
      const row = (
        kind
          ? db
              .prepare(
                'select id, kind, period_start as periodStart, period_end as periodEnd, metrics, narrative, created_at as createdAt from reports where kind = ? order by period_start desc, id desc limit 1'
              )
              .get(kind)
          : db
              .prepare(
                'select id, kind, period_start as periodStart, period_end as periodEnd, metrics, narrative, created_at as createdAt from reports order by period_start desc, id desc limit 1'
              )
              .get()
      ) as ReportRecord | undefined
      return row ?? null
    },
    createGoal(title: string, topicKeywords: string[], targetMode: EventMode | ''): Goal {
      const trimmedTitle = title.trim()
      const timestamp = nowIso()
      const result = db
        .prepare(
          "insert into goals (title, topic_keywords, target_mode, status, created_at, updated_at) values (?, ?, ?, 'active', ?, ?)"
        )
        .run(
          trimmedTitle,
          JSON.stringify(normalizeKeywords(topicKeywords)),
          normalizeTargetMode(targetMode),
          timestamp,
          timestamp
        )
      const id = Number(result.lastInsertRowid)
      return {
        id,
        title: trimmedTitle,
        topicKeywords: normalizeKeywords(topicKeywords),
        targetMode: normalizeTargetMode(targetMode),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    },
    listGoals(status?: GoalStatus): Goal[] {
      const rows = (
        status
          ? db
              .prepare(
                'select id, title, topic_keywords as topicKeywordsRaw, target_mode as targetModeRaw, status, created_at as createdAt, updated_at as updatedAt from goals where status = ? order by id asc'
              )
              .all(status)
          : db
              .prepare(
                'select id, title, topic_keywords as topicKeywordsRaw, target_mode as targetModeRaw, status, created_at as createdAt, updated_at as updatedAt from goals order by id asc'
              )
              .all()
      ) as Array<{
        id: number
        title: string
        topicKeywordsRaw: string
        targetModeRaw: string
        status: string
        createdAt: string
        updatedAt: string
      }>

      return rows.map((row) => {
        let keywords: string[] = []
        try {
          const parsed: unknown = JSON.parse(row.topicKeywordsRaw)
          if (Array.isArray(parsed)) {
            keywords = parsed.filter((entry): entry is string => typeof entry === 'string')
          }
        } catch {
          keywords = []
        }
        return {
          id: row.id,
          title: row.title,
          topicKeywords: keywords,
          targetMode: normalizeTargetMode(row.targetModeRaw),
          status: normalizeGoalStatus(row.status),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
      })
    },
    updateGoalStatus(goalId: number, status: GoalStatus): Goal | null {
      const result = db
        .prepare('update goals set status = ?, updated_at = ? where id = ?')
        .run(normalizeGoalStatus(status), nowIso(), goalId)
      if (Number(result.changes ?? 0) === 0) {
        return null
      }
      return this.listGoals().find((goal) => goal.id === goalId) ?? null
    },
    upsertBaseline(metric: string, period: string, value: number, sampleSize = 0): void {
      db.prepare(
        'insert into baselines (metric, period, value, sample_size, created_at) values (?, ?, ?, ?, ?) on conflict(metric, period) do update set value = excluded.value, sample_size = excluded.sample_size, created_at = excluded.created_at'
      ).run(metric, period, value, sampleSize, nowIso())
    },
    getBaseline(metric: string, period: string): { value: number; sampleSize: number } | null {
      const row = db
        .prepare(
          'select value, sample_size as sampleSize from baselines where metric = ? and period = ?'
        )
        .get(metric, period) as { value: number; sampleSize: number } | undefined
      return row ?? null
    },
    close() {
      db.close()
    }
  }
}
