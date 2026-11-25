/**
 * Generic project JSON import, compatible with the Export panel「下载 JSON」shape
 * (`JSON.stringify(project, null, 2)`). Pure parse / preview / backup / commit.
 * Never reads, writes, or returns LLM credentials.
 */
import { KNOWN_SCHEMA_VERSION } from './consistency/types'
import { migrateProject } from './consistency/migrate'
import { CHARACTER_PACK_SCHEMA } from './characterPack'
import type { Project } from '../types'

export const PROJECT_STORAGE_KEY = 'ai-short-drama-studio:project'
export const IMPORT_BACKUP_KEY = 'ai-short-drama-studio:project:import-backup'
/** LLM settings live on this key. Import must never read or write it. */
export const LLM_STORAGE_KEY = 'ai-short-drama-studio:llm'

export const VIDEO_PIPELINE_SCHEMA_PREFIX = 'short-drama-studio/video-pipeline'

export interface ImportLimits {
  maxBytes: number
  maxDepth: number
  maxArrayLength: number
  maxKeysPerObject: number
  maxTotalKeys: number
  maxStringLength: number
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 48,
  maxArrayLength: 20_000,
  maxKeysPerObject: 5_000,
  maxTotalKeys: 80_000,
  maxStringLength: 1_500_000,
}

export type ImportErrorCode =
  | 'empty'
  | 'too_large'
  | 'invalid_json'
  | 'not_object'
  | 'too_deep'
  | 'too_many_keys'
  | 'array_too_long'
  | 'string_too_long'
  | 'prototype_key'
  | 'wrong_kind'
  | 'invalid_structure'
  | 'unsupported_version'
  | 'backup_failed'
  | 'cancelled'

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  empty: '文件是空的，不是可导入的项目 JSON。',
  too_large: '文件过大，已拒绝导入；当前工程未被修改。',
  invalid_json: '不是合法 JSON，已拒绝导入；当前工程未被修改。',
  not_object: 'JSON 根值必须是对象，已拒绝导入；当前工程未被修改。',
  too_deep: 'JSON 嵌套过深，已拒绝导入；当前工程未被修改。',
  too_many_keys: 'JSON 字段过多，已拒绝导入；当前工程未被修改。',
  array_too_long: 'JSON 数组过长，已拒绝导入；当前工程未被修改。',
  string_too_long: 'JSON 字符串过长，已拒绝导入；当前工程未被修改。',
  prototype_key: 'JSON 含有不安全的原型键，已拒绝导入；当前工程未被修改。',
  wrong_kind: '这不是工作室「下载 JSON」项目文件（例如视频流水线合同或定妆包），已拒绝导入；当前工程未被修改。',
  invalid_structure: '项目结构不完整或字段类型不正确，已拒绝导入；当前工程未被修改。',
  unsupported_version: 'schemaVersion 不受支持，已拒绝导入；当前工程未被修改。',
  backup_failed: '当前工程备份失败，已中止覆盖；当前工程保持原样。',
  cancelled: '已取消导入；当前工程未被修改。',
}

export interface ProjectImportPreview {
  title: string
  id: string
  schemaVersion: number | null
  updatedAt: string
  episodeCount: number
  selectedEpisode: number
  characterCount: number
  hasScripts: boolean
  hasStoryboards: boolean
  sourceMode?: string
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type ParseProjectImportResult =
  | {
      ok: true
      project: Project
      preview: ProjectImportPreview
      strippedCredentialKeys: string[]
    }
  | { ok: false; code: ImportErrorCode; message: string }

export type CommitProjectImportResult =
  | {
      ok: true
      project: Project
      preview: ProjectImportPreview
      backupKey: string
      strippedCredentialKeys: string[]
    }
  | { ok: false; code: ImportErrorCode; message: string }

export interface ImportBackupPayload {
  backedUpAt: string
  reason: 'project-json-import'
  project: Project
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const CREDENTIAL_KEY_RE =
  /^(api[_-]?key|x-api-key|llm|llm[_-]?settings|access[_-]?token|auth[_-]?token|authorization|password|secret|credentials|anthropic[_-]?(auth[_-]?token|api[_-]?key)|openai[_-]?api[_-]?key|deepseek[_-]?api[_-]?key|openrouter[_-]?api[_-]?key)$/i

class ImportLimitError extends Error {
  code: ImportErrorCode
  constructor(code: ImportErrorCode) {
    super(code)
    this.code = code
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function importError(code: ImportErrorCode): { ok: false; code: ImportErrorCode; message: string } {
  return { ok: false, code, message: IMPORT_ERROR_MESSAGES[code] }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

function parseJsonRejectingPrototype(text: string): unknown {
  return JSON.parse(text, (key, value) => {
    if (PROTOTYPE_KEYS.has(key)) throw new ImportLimitError('prototype_key')
    return value
  })
}

function walkLimits(value: unknown, depth: number, limits: ImportLimits, acc: { keys: number }): void {
  if (depth > limits.maxDepth) throw new ImportLimitError('too_deep')
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) throw new ImportLimitError('string_too_long')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) throw new ImportLimitError('array_too_long')
    for (const item of value) walkLimits(item, depth + 1, limits, acc)
    return
  }
  const keys = Object.keys(value as object)
  if (keys.length > limits.maxKeysPerObject) throw new ImportLimitError('too_many_keys')
  acc.keys += keys.length
  if (acc.keys > limits.maxTotalKeys) throw new ImportLimitError('too_many_keys')
  for (const key of keys) {
    if (PROTOTYPE_KEYS.has(key)) throw new ImportLimitError('prototype_key')
    walkLimits((value as Record<string, unknown>)[key], depth + 1, limits, acc)
  }
}

function isVideoPipelineShape(obj: Record<string, unknown>): boolean {
  const schema = obj.schema
  if (typeof schema === 'string' && schema.startsWith(VIDEO_PIPELINE_SCHEMA_PREFIX)) return true
  if (Array.isArray(obj.shots) && (obj.contractSource != null || obj.warnings != null) && !isPlainObject(obj.scripts) && !isPlainObject(obj.storyboards)) {
    return true
  }
  return false
}

function isCharacterPackShape(obj: Record<string, unknown>): boolean {
  if (typeof obj.schema === 'string' && obj.schema.startsWith('h3-character-pack')) return true
  if (obj.schema === CHARACTER_PACK_SCHEMA) return true
  if (!Array.isArray(obj.characters) || obj.characters.length === 0) return false
  const first = obj.characters[0]
  if (!isPlainObject(first)) return false
  const looksLikePackRow = typeof first.displayName === 'string' && !('id' in first && 'name' in first)
  const missingProjectCollections = !isPlainObject(obj.scripts) && !isPlainObject(obj.storyboards) && !Array.isArray(obj.outline)
  return looksLikePackRow && missingProjectCollections
}

function detectWrongKind(obj: Record<string, unknown>): boolean {
  return isVideoPipelineShape(obj) || isCharacterPackShape(obj)
}

function validateProjectShape(obj: Record<string, unknown>): ImportErrorCode | null {
  if (typeof obj.title !== 'string') return 'invalid_structure'
  if (obj.id !== undefined && typeof obj.id !== 'string') return 'invalid_structure'
  if (!Array.isArray(obj.characters)) return 'invalid_structure'
  if (!isPlainObject(obj.scripts)) return 'invalid_structure'
  if (obj.storyboards !== undefined && !isPlainObject(obj.storyboards)) return 'invalid_structure'
  if (obj.outline !== undefined && !Array.isArray(obj.outline)) return 'invalid_structure'
  if (obj.settingFacts !== undefined && !Array.isArray(obj.settingFacts)) return 'invalid_structure'
  if (obj.locations !== undefined && !Array.isArray(obj.locations)) return 'invalid_structure'
  if (obj.acceptedRisks !== undefined && !Array.isArray(obj.acceptedRisks)) return 'invalid_structure'
  for (const numKey of ['episodeCount', 'secondsPerEp', 'selectedEpisode'] as const) {
    if (obj[numKey] !== undefined && (typeof obj[numKey] !== 'number' || !Number.isFinite(obj[numKey]))) {
      return 'invalid_structure'
    }
  }
  if (obj.schemaVersion !== undefined) {
    if (
      typeof obj.schemaVersion !== 'number' ||
      !Number.isFinite(obj.schemaVersion) ||
      obj.schemaVersion < 0 ||
      obj.schemaVersion > KNOWN_SCHEMA_VERSION
    ) {
      return 'unsupported_version'
    }
  }
  return null
}

function stripCredentials(value: unknown, path: string, stripped: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, i) => stripCredentials(item, `${path}[${i}]`, stripped))
  }
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(key)) {
      stripped.push(path ? `${path}.${key}` : key)
      continue
    }
    out[key] = stripCredentials(child, path ? `${path}.${key}` : key, stripped)
  }
  return out
}

function recordHasItems(record: unknown): boolean {
  if (!isPlainObject(record)) return false
  return Object.values(record).some((v) => {
    if (Array.isArray(v)) return v.length > 0
    if (isPlainObject(v) && typeof v.fullText === 'string') return v.fullText.length > 0
    if (isPlainObject(v) && Array.isArray(v.beats)) return v.beats.length > 0
    return v != null && v !== ''
  })
}

export function previewFromProject(project: Project): ProjectImportPreview {
  const characterCount = Array.isArray(project.characters) ? project.characters.length : 0
  const preview: ProjectImportPreview = {
    title: project.title || '',
    id: project.id || '',
    schemaVersion: typeof project.schemaVersion === 'number' ? project.schemaVersion : null,
    updatedAt: project.updatedAt || '',
    episodeCount: project.episodeCount,
    selectedEpisode: project.selectedEpisode,
    characterCount,
    hasScripts: recordHasItems(project.scripts),
    hasStoryboards: recordHasItems(project.storyboards),
  }
  if (typeof project.sourceMode === 'string' && project.sourceMode) preview.sourceMode = project.sourceMode
  return preview
}

export function parseProjectImportJson(raw: string, limits: Partial<ImportLimits> = {}): ParseProjectImportResult {
  const resolved: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...limits }
  if (typeof raw !== 'string' || !raw.replace(/^\uFEFF/, '').trim()) return importError('empty')
  const text = raw.replace(/^\uFEFF/, '')
  if (utf8Bytes(text) > resolved.maxBytes) return importError('too_large')

  let parsed: unknown
  try {
    parsed = parseJsonRejectingPrototype(text)
  } catch (e) {
    if (e instanceof ImportLimitError) return importError(e.code)
    return importError('invalid_json')
  }
  if (!isPlainObject(parsed)) return importError('not_object')

  try {
    walkLimits(parsed, 1, resolved, { keys: 0 })
  } catch (e) {
    if (e instanceof ImportLimitError) return importError(e.code)
    return importError('invalid_structure')
  }

  if (detectWrongKind(parsed)) return importError('wrong_kind')
  const shape = validateProjectShape(parsed)
  if (shape) return importError(shape)

  const strippedCredentialKeys: string[] = []
  const stripped = stripCredentials(parsed, '', strippedCredentialKeys) as Record<string, unknown>
  const migrated = migrateProject(stripped)
  if (!migrated.ok) return importError('invalid_structure')

  return {
    ok: true,
    project: migrated.project,
    preview: previewFromProject(migrated.project),
    strippedCredentialKeys,
  }
}

function writeBackup(storage: StorageLike, current: Project, now: Date): { ok: true; payload: string } | { ok: false } {
  const payload = JSON.stringify({
    backedUpAt: now.toISOString(),
    reason: 'project-json-import',
    project: current,
  } satisfies ImportBackupPayload)
  try {
    storage.setItem(IMPORT_BACKUP_KEY, payload)
    if (storage.getItem(IMPORT_BACKUP_KEY) !== payload) return { ok: false }
    return { ok: true, payload }
  } catch {
    return { ok: false }
  }
}

function restoreProjectKey(storage: StorageLike, previous: string | null): void {
  try {
    if (previous === null) {
      if (typeof (storage as StorageLike & { removeItem?: (k: string) => void }).removeItem === 'function') {
        ;(storage as StorageLike & { removeItem: (k: string) => void }).removeItem(PROJECT_STORAGE_KEY)
      } else {
        storage.setItem(PROJECT_STORAGE_KEY, '')
      }
      return
    }
    storage.setItem(PROJECT_STORAGE_KEY, previous)
  } catch {
    // Best-effort restore; caller already treats the write as failed.
  }
}

function writeProject(storage: StorageLike, project: Project, now: Date, previousRaw: string | null): Project | null {
  const next: Project = {
    ...project,
    updatedAt: now.toISOString(),
    schemaVersion: KNOWN_SCHEMA_VERSION,
  }
  const raw = JSON.stringify(next)
  try {
    storage.setItem(PROJECT_STORAGE_KEY, raw)
    if (storage.getItem(PROJECT_STORAGE_KEY) !== raw) {
      restoreProjectKey(storage, previousRaw)
      return null
    }
    return next
  } catch {
    restoreProjectKey(storage, previousRaw)
    return null
  }
}

export function commitImportedProject(opts: {
  current: Project
  raw: string
  confirmed: boolean
  storage: StorageLike
  now?: Date
  limits?: Partial<ImportLimits>
}): CommitProjectImportResult {
  if (!opts.confirmed) return importError('cancelled')
  const parsed = parseProjectImportJson(opts.raw, opts.limits)
  if (!parsed.ok) return parsed

  const now = opts.now ?? new Date()
  const backup = writeBackup(opts.storage, opts.current, now)
  if (!backup.ok) return importError('backup_failed')

  const previousRaw = opts.storage.getItem(PROJECT_STORAGE_KEY)
  const saved = writeProject(opts.storage, parsed.project, now, previousRaw)
  if (!saved) return importError('backup_failed')

  return {
    ok: true,
    project: saved,
    preview: previewFromProject(saved),
    backupKey: IMPORT_BACKUP_KEY,
    strippedCredentialKeys: parsed.strippedCredentialKeys,
  }
}
