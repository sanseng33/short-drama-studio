/** PK-01 新增字段清单（供 PK-03 / PK-05 引用）
 * Project 可选字段：schemaVersion, fingerprints, acceptedRisks, dialogueAudit
 * 新类型：CheckSeverity, CheckFinding, SourceFingerprint, AcceptedRisk, DialogueAuditSnapshot
 * 已知 schemaVersion 写入值：2；缺省读取按 1。不在本包创建 settingFactItems / locks / stale。
 */
export const KNOWN_SCHEMA_VERSION = 2
export const PROJECT_BACKUP_KEY = 'ai-short-drama-studio:project:pre-v2'

export type CheckSeverity = 'info' | 'warning' | 'error'

export interface CheckFinding {
  id: string
  code: string
  severity: CheckSeverity
  episode?: number
  shotId?: string
  characterId?: string
  message: string
  evidence?: string
  confidence?: 'definite' | 'fuzzy' | 'unknown'
  targetKey?: string
}

export interface SourceFingerprint {
  scriptHashByEpisode?: Record<number, string> // sha1Hex(fullText)
  // 项目级基线：首次补基线时的设定快照，单集重新检查不改写。未单独复核的集与它比较。
  factsHash?: string // sha1Hex(JSON settingFacts)
  locationsHash?: string
  charactersLookHash?: string
  // 按集基线：该集上次被重新检查时的设定快照。存在时优先于项目级基线。
  factsHashByEpisode?: Record<number, string>
  locationsHashByEpisode?: Record<number, string>
  charactersLookHashByEpisode?: Record<number, string>
}

export interface AcceptedRisk {
  code: string
  episode?: number
  note?: string
  at: string // ISO
  targetKey?: string
}

export interface DialogueAuditSnapshot {
  scriptHash: string // sha1Hex(fullText)
  shotsHash: string // sha1Hex(各镜 dialogue 按 shotNo 升序、以 \n 拼接)
  status: 'checked' | 'no_script' | 'no_storyboard' | 'unparseable'
  findings: CheckFinding[]
  checkedAt: string // ISO
}

export interface SettingFactItem {
  id: string
  text: string
  locked?: boolean
  source?: string
}

export type StaleReason = 'script' | 'facts' | 'locations' | 'characters'

export interface ProjectLocks {
  outline?: boolean
  scripts?: Record<number, boolean>
}

export interface ProjectStale {
  storyboards?: Record<number, StaleReason>
}
