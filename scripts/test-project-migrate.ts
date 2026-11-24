/** 状态：未执行。
 * 建议命令（由主 agent 审批执行）：
 *   npx tsc -b
 *   npx --yes tsx scripts/test-project-migrate.ts
 */
import assert from 'node:assert/strict'
import { loadProject, saveProject } from '../src/lib/storage'
import { migrateProject, shouldWritePreV2Backup } from '../src/lib/consistency/migrate'
import { shotsHash, scriptHash, factsHash, buildFingerprints } from '../src/lib/consistency/fingerprint'
import { KNOWN_SCHEMA_VERSION, PROJECT_BACKUP_KEY } from '../src/lib/consistency/types'
import type { Project } from '../src/types'
import { sha1Hex } from '../src/lib/hash'

const PROJECT_KEY = 'ai-short-drama-studio:project'

class MemoryStorage {
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
  get length(): number {
    return this.data.size
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true })

const baseProject = (): Record<string, unknown> => ({
  id: 'p1',
  title: '旧项目',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 60,
  style: '真人都市',
  logline: '一句简介',
  settingFacts: ['甲家境富裕，住高档小区'],
  characters: [
    {
      id: 'c1',
      name: '小李',
      role: '主角',
      visualLock: '短发',
      costume: '白衬衫',
      signatureProp: '手表',
    },
  ],
  outline: [{ episode: 1, title: '第一集', hook: 'h', summary: 's', cliffhanger: 'c' }],
  scripts: {
    1: {
      episode: 1,
      title: '第一集',
      beats: [{ label: '开场', content: '敲门', dialogue: '小李：谁？' }],
      fullText: '小李：谁？\n小李：你来了。',
    },
  },
  storyboards: {
    1: [
      {
        id: 's1-1',
        shotNo: 1,
        size: '近景',
        durationSec: 3,
        visual: '门口',
        action: '开门',
        dialogue: '小李：谁？',
        camera: '固定',
        emotion: '警惕',
        seedancePrompt: '门口近景',
      },
    ],
  },
  selectedEpisode: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

let pass = 0
const t = (name: string, fn: () => void) => {
  memory.clear()
  fn()
  pass++
  console.log('✓', name)
}

t('无 schemaVersion 的旧项目：视为版本 1，原字段原值相等，不丢字段，内存不写入 schemaVersion', () => {
  const raw = baseProject()
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.fromVersion, 1)
  assert.equal('schemaVersion' in result.project, false)
  const p = result.project
  assert.equal(p.id, raw.id)
  assert.equal(p.title, raw.title)
  assert.equal(p.genre, raw.genre)
  assert.equal(p.platform, raw.platform)
  assert.equal(p.episodeCount, raw.episodeCount)
  assert.equal(p.secondsPerEp, raw.secondsPerEp)
  assert.equal(p.style, raw.style)
  assert.equal(p.logline, raw.logline)
  assert.deepEqual(p.settingFacts, raw.settingFacts)
  assert.deepEqual(p.characters, raw.characters)
  assert.deepEqual(p.outline, raw.outline)
  assert.deepEqual(p.scripts, raw.scripts)
  assert.deepEqual(p.storyboards, raw.storyboards)
  assert.equal(p.selectedEpisode, raw.selectedEpisode)
  assert.equal(p.updatedAt, raw.updatedAt)
  assert.equal(p.fingerprints, undefined)
  assert.equal(p.acceptedRisks, undefined)
  assert.equal(p.dialogueAudit, undefined)
})

t('无 fingerprints、scripts 为空：不崩溃，可被后续视为 no_script', () => {
  const raw = baseProject()
  delete raw.fingerprints
  raw.scripts = {}
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.project.scripts, {})
  assert.equal(result.project.fingerprints, undefined)
  const hasScriptText = Object.values(result.project.scripts).some((s) => (s.fullText || '').trim())
  assert.equal(hasScriptText, false)
})

t('无 fingerprints、scripts 缺失：规范为空对象，不崩溃', () => {
  const raw = baseProject()
  delete raw.scripts
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.project.scripts, {})
})

t('只有 settingFacts 数组、无新字段：生成未锁定 items，settingFacts 不变，不创建 locks/stale', () => {
  const raw = baseProject()
  delete raw.locations
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.project.settingFacts, ['甲家境富裕，住高档小区'])
  const items = result.project.settingFactItems
  assert.ok(Array.isArray(items) && items.length === 1)
  assert.equal(items![0].text, '甲家境富裕，住高档小区')
  assert.equal(items![0].locked, false)
  assert.equal('locks' in (result.project as unknown as Record<string, unknown>), false)
  assert.equal('stale' in (result.project as unknown as Record<string, unknown>), false)
})

t('已是 schemaVersion 2：幂等，二次迁移深度相等', () => {
  const raw = { ...baseProject(), schemaVersion: 2, acceptedRisks: [] as unknown[] }
  const a = migrateProject(raw)
  assert.equal(a.ok, true)
  if (!a.ok) return
  const b = migrateProject(JSON.parse(JSON.stringify(a.project)))
  assert.equal(b.ok, true)
  if (!b.ok) return
  assert.deepEqual(b.project, a.project)
  assert.equal(a.project.schemaVersion, 2)
})

t('schemaVersion 99：不降级、不改写版本号，未知字段保留', () => {
  const raw = { ...baseProject(), schemaVersion: 99, futureOnly: { keep: true } }
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.project.schemaVersion, 99)
  assert.deepEqual((result.project as unknown as { futureOnly: { keep: boolean } }).futureOnly, { keep: true })
})

t('JSON 损坏：loadProject 不抛错，视为无项目，原串进入备份键', () => {
  memory.setItem(PROJECT_KEY, '{not json')
  const loaded = loadProject()
  assert.equal(loaded, null)
  assert.equal(memory.getItem(PROJECT_BACKUP_KEY), '{not json')
  assert.equal(memory.getItem(PROJECT_KEY), '{not json')
})

t('acceptedRisks 不是数组：loadProject 不抛错，视为无项目，原串备份且不覆盖原键', () => {
  const raw = { ...baseProject(), acceptedRisks: 'bad' }
  const text = JSON.stringify(raw)
  memory.setItem(PROJECT_KEY, text)
  const loaded = loadProject()
  assert.equal(loaded, null)
  assert.equal(memory.getItem(PROJECT_BACKUP_KEY), text)
  assert.equal(memory.getItem(PROJECT_KEY), text)
  const migrated = migrateProject(raw)
  assert.equal(migrated.ok, false)
  if (migrated.ok) return
  assert.equal(migrated.reason, 'accepted_risks_type')
})

t('字段类型异常：内存按空数组处理，不写回原值', () => {
  const raw = { ...baseProject(), settingFacts: { nope: 1 }, locations: 'x', characters: 'bad' }
  const text = JSON.stringify(raw)
  memory.setItem(PROJECT_KEY, text)
  const loaded = loadProject()
  assert.ok(loaded)
  assert.deepEqual(loaded!.settingFacts, [])
  assert.deepEqual(loaded!.locations, [])
  assert.deepEqual(loaded!.characters, [])
  assert.equal(memory.getItem(PROJECT_KEY), text)
})

t('往返：加载再保存后，除 schemaVersion、updatedAt 与追加的 items 外既有字段深度相等', () => {
  const raw = baseProject()
  const text = JSON.stringify(raw)
  memory.setItem(PROJECT_KEY, text)
  const loaded = loadProject()
  assert.ok(loaded)
  assert.equal('schemaVersion' in loaded!, false)
  saveProject(loaded!)
  const saved = JSON.parse(memory.getItem(PROJECT_KEY)!)
  assert.equal(saved.schemaVersion, KNOWN_SCHEMA_VERSION)
  const { schemaVersion: _sv, updatedAt: _ua, settingFactItems, ...restSaved } = saved
  const { updatedAt: _ub, ...restRaw } = raw
  assert.deepEqual(restSaved, restRaw)
  assert.ok(Array.isArray(settingFactItems))
  assert.deepEqual(
    settingFactItems.map((i: { text: string }) => i.text),
    raw.settingFacts,
  )
})

t('新建项目保存后写入 schemaVersion 2', () => {
  const fresh = migrateProject(baseProject())
  assert.equal(fresh.ok, true)
  if (!fresh.ok) return
  saveProject(fresh.project)
  const saved = JSON.parse(memory.getItem(PROJECT_KEY)!)
  assert.equal(saved.schemaVersion, 2)
})

t('首次从旧版本迁移才备份，不覆盖已有备份；v2 不备份', () => {
  const oldText = JSON.stringify(baseProject())
  memory.setItem(PROJECT_KEY, oldText)
  loadProject()
  assert.equal(memory.getItem(PROJECT_BACKUP_KEY), oldText)

  const v2 = { ...baseProject(), schemaVersion: 2, title: '新标题' }
  memory.setItem(PROJECT_KEY, JSON.stringify(v2))
  loadProject()
  assert.equal(memory.getItem(PROJECT_BACKUP_KEY), oldText, '不得用 v2 覆盖旧备份')

  assert.equal(shouldWritePreV2Backup({ schemaVersion: 2 }, true), false)
  assert.equal(shouldWritePreV2Backup({ schemaVersion: 99 }, false), false)
  assert.equal(shouldWritePreV2Backup(baseProject(), false), true)
})

t('shotsHash 按 shotNo 升序以换行拼接 dialogue', () => {
  const shots = [
    { shotNo: 2, dialogue: 'B' },
    { shotNo: 1, dialogue: 'A' },
  ]
  assert.equal(shotsHash(shots), sha1Hex('A\nB'))
  assert.equal(scriptHash('小李：你来了。'), sha1Hex('小李：你来了。'))
  assert.equal(factsHash(['对窗']), sha1Hex(JSON.stringify(['对窗'])))
  const fp = buildFingerprints({
    scripts: { 1: { episode: 1, title: 't', beats: [], fullText: '小李：你好' } },
    settingFacts: ['对窗'],
    locations: ['老旧小区'],
    characters: [
      {
        id: 'c1',
        name: '小李',
        role: '主角',
        visualLock: '短发',
        costume: '白衬衫',
        signatureProp: '手表',
      },
    ],
  })
  assert.equal(fp.scriptHashByEpisode![1], sha1Hex('小李：你好'))
  assert.ok(fp.factsHash)
  assert.ok(fp.locationsHash)
  assert.ok(fp.charactersLookHash)
})

t('loadProject 空键返回 null，不抛错', () => {
  assert.equal(loadProject(), null)
})

console.log(`\n${pass} tests passed`)
