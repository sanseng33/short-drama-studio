import type { EpisodeOutline, EpisodeScript, Project, Shot } from '../../types'
import { KNOWN_SCHEMA_VERSION, type AcceptedRisk, type DialogueAuditSnapshot, type SourceFingerprint } from './types'

export type MigrateFailureReason = 'not_object' | 'accepted_risks_type'

export type MigrateResult =
  | { ok: true; project: Project; fromVersion: number }
  | { ok: false; reason: MigrateFailureReason }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asArray<T>(v: unknown, fallback: T[]): T[] {
  return Array.isArray(v) ? (v as T[]) : fallback
}

function asRecord<T>(v: unknown, fallback: Record<number, T>): Record<number, T> {
  return isPlainObject(v) ? (v as Record<number, T>) : fallback
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeFingerprints(v: unknown): SourceFingerprint | undefined {
  if (v === undefined) return undefined
  if (!isPlainObject(v)) return undefined
  const scriptHashByEpisode = isPlainObject(v.scriptHashByEpisode)
    ? (v.scriptHashByEpisode as Record<number, string>)
    : undefined
  return {
    ...(scriptHashByEpisode ? { scriptHashByEpisode } : {}),
    ...(typeof v.factsHash === 'string' ? { factsHash: v.factsHash } : {}),
    ...(typeof v.locationsHash === 'string' ? { locationsHash: v.locationsHash } : {}),
    ...(typeof v.charactersLookHash === 'string' ? { charactersLookHash: v.charactersLookHash } : {}),
  }
}

function normalizeDialogueAudit(v: unknown): Record<number, DialogueAuditSnapshot> | undefined {
  if (v === undefined) return undefined
  if (!isPlainObject(v)) return undefined
  const out: Record<number, DialogueAuditSnapshot> = {}
  for (const [k, item] of Object.entries(v)) {
    const ep = Number(k)
    if (!Number.isFinite(ep) || !isPlainObject(item)) continue
    if (typeof item.scriptHash !== 'string' || typeof item.shotsHash !== 'string') continue
    if (typeof item.status !== 'string' || typeof item.checkedAt !== 'string') continue
    out[ep] = {
      scriptHash: item.scriptHash,
      shotsHash: item.shotsHash,
      status: item.status as DialogueAuditSnapshot['status'],
      findings: asArray(item.findings, []),
      checkedAt: item.checkedAt,
    }
  }
  return out
}

/**
 * 纯函数：把未知 JSON 迁成可打开的 Project。
 * 只追加可选字段，不删除、不改名现有字段，不生成 settingFactItems / locks / stale。
 * 缺 schemaVersion 视为 1，不在返回对象上写入 schemaVersion（保存路径才写 2）。
 * schemaVersion > 已知版本时不降级、不改写版本号，并保留未知字段。
 * acceptedRisks 存在且不是数组时失败（由 loadProject 备份原串并视为无项目）。
 */
export function migrateProject(raw: unknown): MigrateResult {
  if (!isPlainObject(raw)) return { ok: false, reason: 'not_object' }
  if (raw.acceptedRisks !== undefined && !Array.isArray(raw.acceptedRisks)) {
    return { ok: false, reason: 'accepted_risks_type' }
  }

  const versionRaw = raw.schemaVersion
  const hasVersion = typeof versionRaw === 'number' && Number.isFinite(versionRaw)
  const fromVersion = hasVersion ? versionRaw : 1

  // 保留未知字段：以原对象为底，只规范已知易错的集合字段。
  const next = { ...raw } as Record<string, unknown>

  next.characters = asArray(raw.characters, [])
  next.outline = asArray<EpisodeOutline>(raw.outline, [])
  next.scripts = asRecord<EpisodeScript>(raw.scripts, {} as Record<number, EpisodeScript>)
  next.storyboards = asRecord<Shot[]>(raw.storyboards, {} as Record<number, Shot[]>)
  next.id = asString(raw.id, next.id as string)
  next.title = asString(raw.title, next.title as string)
  next.logline = asString(raw.logline, (next.logline as string) ?? '')
  next.episodeCount = asNumber(raw.episodeCount, (next.episodeCount as number) ?? 0)
  next.secondsPerEp = asNumber(raw.secondsPerEp, (next.secondsPerEp as number) ?? 0)
  next.selectedEpisode = asNumber(raw.selectedEpisode, (next.selectedEpisode as number) ?? 1)
  next.updatedAt = asString(raw.updatedAt, (next.updatedAt as string) ?? '')

  if (raw.settingFacts !== undefined && !Array.isArray(raw.settingFacts)) next.settingFacts = []
  if (raw.locations !== undefined && !Array.isArray(raw.locations)) next.locations = []

  if (raw.fingerprints !== undefined) {
    const fp = normalizeFingerprints(raw.fingerprints)
    if (fp) next.fingerprints = fp
    else delete next.fingerprints
  }

  if (raw.acceptedRisks !== undefined) {
    next.acceptedRisks = raw.acceptedRisks as AcceptedRisk[]
  }

  if (raw.dialogueAudit !== undefined) {
    const audit = normalizeDialogueAudit(raw.dialogueAudit)
    if (audit) next.dialogueAudit = audit
    else delete next.dialogueAudit
  }

  if (hasVersion) {
    // 不降级、不改写已有版本号（包括 > 已知版本）
    next.schemaVersion = versionRaw
  } else {
    // 缺省视为 1，但不把 schemaVersion 写进内存对象
    delete next.schemaVersion
  }

  // 本包不创建 settingFactItems / locks / stale
  return { ok: true, project: next as unknown as Project, fromVersion }
}

export function shouldWritePreV2Backup(raw: unknown, backupExists: boolean): boolean {
  if (backupExists) return false
  if (!isPlainObject(raw)) return true // 损坏恢复：备份键不存在时写入原串
  if (raw.acceptedRisks !== undefined && !Array.isArray(raw.acceptedRisks)) return true
  const v = raw.schemaVersion
  if (typeof v === 'number' && Number.isFinite(v) && v >= KNOWN_SCHEMA_VERSION) return false
  return true // 无版本或旧版本，且备份键尚不存在
}
