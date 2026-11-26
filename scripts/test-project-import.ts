/** 状态：未执行。
 * 建议命令（由主 agent 审批执行）：
 *   npx tsc -b
 *   npx --yes tsx scripts/test-project-import.ts
 *   npx --yes tsx scripts/test-video-export.ts
 *   npx --yes tsx scripts/test-project-migrate.ts
 *   npm run build
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { Character, Project, Shot } from '../src/types'
import { KNOWN_SCHEMA_VERSION } from '../src/lib/consistency/types'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import {
  IMPORT_BACKUP_KEY,
  IMPORT_ERROR_MESSAGES,
  LLM_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  commitImportedProject,
  parseProjectImportJson,
  type StorageLike,
} from '../src/lib/projectImport'

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value))
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
  clear(): void {
    this.data.clear()
  }
}

const character = (): Character => ({
  id: 'c1',
  name: '甲',
  role: '主角',
  visualLock: '短发',
  costume: '白衬衫',
  signatureProp: '手表',
})

const shot = (): Shot => ({
  id: 's1-1',
  shotNo: 1,
  size: '近景',
  durationSec: 6,
  visual: '门口',
  action: '开门',
  dialogue: '甲：谁？',
  camera: '固定',
  emotion: '平静',
  seedancePrompt: '主体：甲。动作：开门。',
})

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p_current',
  title: '当前工程',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 60,
  style: '真人都市',
  logline: '当前简介',
  characters: [character()],
  outline: [{ episode: 1, title: '第一集', hook: 'h', summary: 's', cliffhanger: 'c' }],
  scripts: {
    1: { episode: 1, title: '第一集', beats: [{ label: '开场', content: '敲门', dialogue: '甲：谁？' }], fullText: '甲：谁？' },
  },
  storyboards: { 1: [shot()] },
  selectedEpisode: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  schemaVersion: 2,
  ...over,
})

const downloadJson = (p: Project): string => JSON.stringify(p, null, 2)

const incoming = (): Project =>
  project({
    id: 'p_incoming',
    title: '导入工程',
    logline: '导入简介',
    sourceMode: 'user-export',
    updatedAt: '2026-02-02T00:00:00.000Z',
  })

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

t('正例：兼容下载 JSON，确认后导入并保留未知扩展与来源', () => {
  const current = project()
  const src = incoming() as Project & { provenance?: { note: string } }
  src.provenance = { note: 'keep-me' }
  const storage = new MemoryStorage()
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(current))
  const now = new Date('2026-03-03T00:00:00.000Z')
  const result = commitImportedProject({
    current,
    raw: downloadJson(src),
    confirmed: true,
    storage,
    now,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.project.title, '导入工程')
  assert.equal(result.project.id, 'p_incoming')
  assert.equal(result.project.sourceMode, 'user-export')
  assert.equal((result.project as Project & { provenance?: { note: string } }).provenance?.note, 'keep-me')
  assert.equal(result.preview.characterCount, 1)
  assert.equal(result.preview.hasScripts, true)
  assert.equal(result.preview.hasStoryboards, true)
  assert.equal(result.backupKey, IMPORT_BACKUP_KEY)
  const backup = JSON.parse(storage.getItem(IMPORT_BACKUP_KEY) || 'null')
  assert.equal(backup.reason, 'project-json-import')
  assert.equal(backup.project.id, 'p_current')
  assert.equal(backup.project.title, '当前工程')
  const stored = JSON.parse(storage.getItem(PROJECT_STORAGE_KEY) || 'null')
  assert.equal(stored.id, 'p_incoming')
  assert.equal(stored.updatedAt, now.toISOString())
})

t('反例：损坏 JSON 不改当前工程、不写备份', () => {
  const current = project()
  const storage = new MemoryStorage()
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(current))
  const result = commitImportedProject({ current, raw: '{ not json', confirmed: true, storage })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'invalid_json')
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), JSON.stringify(current))
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('反例：非对象根值', () => {
  const r = parseProjectImportJson('[]')
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'not_object')
})

t('反例：缺关键结构', () => {
  const r = parseProjectImportJson(JSON.stringify({ title: '只有标题' }))
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'invalid_structure')
})

t('反例：错误字段类型', () => {
  const r = parseProjectImportJson(JSON.stringify({ ...incoming(), characters: 'nope' }))
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'invalid_structure')
})

t('反例：定妆包形态', () => {
  const r = parseProjectImportJson(
    JSON.stringify({
      schema: 'h3-character-pack@1',
      characters: [{ displayName: '甲', refImage: 'a.png' }],
    }),
  )
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'wrong_kind')
})

t('反例：video-pipeline 合同形态', () => {
  const r = parseProjectImportJson(
    JSON.stringify({
      schema: 'short-drama-studio/video-pipeline@1',
      project: { id: 'p_official', title: '合同' },
      characters: [],
      shots: [],
      contractSource: 'official',
      warnings: [],
    }),
  )
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'wrong_kind')
})

t('取消确认：无备份、无覆盖、当前工程不变', () => {
  const current = project()
  const storage = new MemoryStorage()
  const before = JSON.stringify(current)
  storage.setItem(PROJECT_STORAGE_KEY, before)
  const result = commitImportedProject({
    current,
    raw: downloadJson(incoming()),
    confirmed: false,
    storage,
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'cancelled')
  assert.equal(result.message, IMPORT_ERROR_MESSAGES.cancelled)
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), before)
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('备份失败：不覆盖，当前工程不变', () => {
  const current = project()
  const storage = new MemoryStorage()
  const before = JSON.stringify(current)
  storage.setItem(PROJECT_STORAGE_KEY, before)
  const failing: StorageLike = {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => {
      if (k === IMPORT_BACKUP_KEY) throw new Error('quota')
      storage.setItem(k, v)
    },
  }
  const result = commitImportedProject({
    current,
    raw: downloadJson(incoming()),
    confirmed: true,
    storage: failing,
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'backup_failed')
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), before)
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('导入 JSON 夹带 llm/apiKey：不写入 LLM 存储，凭据被剥离', () => {
  const current = project()
  const storage = new MemoryStorage()
  const llmRaw = JSON.stringify({ apiKey: 'keep-me', baseURL: 'https://example.invalid/v1', model: 'keep' })
  storage.setItem(LLM_STORAGE_KEY, llmRaw)
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(current))
  const rawObj = {
    ...incoming(),
    apiKey: 'steal-me',
    llm: { apiKey: 'also-steal', baseURL: 'https://evil.example' },
  }
  const result = commitImportedProject({
    current,
    raw: JSON.stringify(rawObj, null, 2),
    confirmed: true,
    storage,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(storage.getItem(LLM_STORAGE_KEY), llmRaw)
  assert.ok(result.strippedCredentialKeys.includes('apiKey'))
  assert.ok(result.strippedCredentialKeys.includes('llm'))
  assert.equal('apiKey' in (result.project as unknown as Record<string, unknown>), false)
  assert.equal('llm' in (result.project as unknown as Record<string, unknown>), false)
})

t('恶意原型键：拒绝且当前工程不变', () => {
  const current = project()
  const storage = new MemoryStorage()
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(current))
  const raw = '{"id":"p","title":"x","characters":[],"scripts":{},"__proto__":{"polluted":true}}'
  const result = commitImportedProject({ current, raw, confirmed: true, storage })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'prototype_key')
  assert.equal(({} as { polluted?: boolean }).polluted, undefined)
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), JSON.stringify(current))
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('超大输入：拒绝且当前工程不变', () => {
  const current = project()
  const storage = new MemoryStorage()
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(current))
  const raw = downloadJson(incoming())
  const result = commitImportedProject({
    current,
    raw,
    confirmed: true,
    storage,
    limits: { maxBytes: 16 },
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'too_large')
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), JSON.stringify(current))
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('导入与迁移不得伪造 runReady 或 verified', () => {
  const current = project()
  const storage = new MemoryStorage()
  const result = commitImportedProject({
    current,
    raw: downloadJson(incoming()),
    confirmed: true,
    storage,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  const rec = result.project as unknown as Record<string, unknown>
  assert.equal('claims' in rec, false)
  assert.equal(rec.runReady, undefined)
  const board = result.project.storyboards[1] || result.project.storyboards['1' as unknown as number]
  const first = board && board[0] as Shot & { firstFrame?: { kind?: string } }
  assert.ok(first)
  assert.equal(first.firstFrame, undefined)
  const packed = JSON.stringify(result.project)
  assert.equal(packed.includes('runReady'), false)
  assert.equal(/"verified"/.test(packed), false)
})

t('不受支持的 schemaVersion 被拒绝', () => {
  const r = parseProjectImportJson(JSON.stringify({ ...incoming(), schemaVersion: 'v-next' }))
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.code, 'unsupported_version')
})


t('未来数字 schemaVersion 明确拒绝，不迁移接受', () => {
  const current = project()
  const storage = new MemoryStorage()
  const before = JSON.stringify(current)
  storage.setItem(PROJECT_STORAGE_KEY, before)
  const raw = downloadJson({ ...incoming(), schemaVersion: KNOWN_SCHEMA_VERSION + 1 })
  const result = commitImportedProject({ current, raw, confirmed: true, storage })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'unsupported_version')
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), before)
  assert.equal(storage.getItem(IMPORT_BACKUP_KEY), null)
})

t('写入后读回校验失败时恢复当前工程', () => {
  const current = project()
  const storage = new MemoryStorage()
  const before = JSON.stringify(current)
  storage.setItem(PROJECT_STORAGE_KEY, before)
  const wrapping: StorageLike = {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => {
      storage.setItem(k, v)
      if (k === PROJECT_STORAGE_KEY && v !== before) {
        // Simulate a write that does not read back as written, leaving a bad value until restore.
        storage.setItem(k, '{"corrupted":true}')
      }
    },
  }
  const result = commitImportedProject({
    current,
    raw: downloadJson(incoming()),
    confirmed: true,
    storage: wrapping,
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.equal(result.code, 'backup_failed')
  assert.equal(storage.getItem(PROJECT_STORAGE_KEY), before)
})

t('默认 buildVideoPipelineExport 无 shotStateExport，字节含默认限制条款且固定', () => {
  const c = character()
  const s = shot()
  const fixed: Project = {
    id: 'p_compat_fixed',
    title: '兼容对照',
    genre: '都市逆袭',
    platform: '红果',
    episodeCount: 1,
    secondsPerEp: 60,
    style: '真人都市',
    logline: '一句简介',
    characters: [c],
    outline: [{ episode: 1, title: '第一集', hook: 'h', summary: 's', cliffhanger: 'c' }],
    scripts: {
      1: { episode: 1, title: '第一集', beats: [{ label: '开场', content: '敲门', dialogue: '甲：谁？' }], fullText: '甲：谁？' },
    },
    storyboards: { 1: [s] },
    selectedEpisode: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    schemaVersion: 2,
  }
  const exp = buildVideoPipelineExport(fixed)
  assert.equal(exp.schema, 'short-drama-studio/video-pipeline@1')
  assert.equal(Object.prototype.hasOwnProperty.call(exp, 'shotStateExport'), false)
  const hex = createHash('sha256').update(JSON.stringify(exp)).digest('hex')
  // Digest includes the default 限制 clauses assembled on export (spark ban + life motion).
  assert.equal(hex, 'aa6b85a4a3e8a03424ae80878d6135ab4c4a5a6fa7290e4059cfc1a68f4bb3b9')
})

console.log(`\n${pass} tests passed`)
