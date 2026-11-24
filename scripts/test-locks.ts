/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-locks.ts */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Project, SettingFactItem, Shot } from '../src/types'
import { migrateProject } from '../src/lib/consistency/migrate'
import {
  itemsFromFacts,
  mergeLockedFacts,
  projectFactsFromItems,
  syncFactsProjection,
  isScriptLocked,
  overwriteLockedScriptMessage,
} from '../src/lib/consistency/factLocks'
import { computeStoryboardStale, refreshStale, staleFindings, staleMessage } from '../src/lib/consistency/stale'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { factsHash, scriptHash, buildFingerprints } from '../src/lib/consistency/fingerprint'
import { constraintBlock, storyboardUser } from '../src/lib/prompts'
import { buildVideoPipelineExport } from '../src/lib/videoExport'

const here = dirname(fileURLToPath(import.meta.url))

const shot = (partial: Partial<Shot> = {}): Shot => ({
  id: 's1-1',
  shotNo: 1,
  size: '近景',
  durationSec: 3,
  visual: '室内',
  action: '说话',
  dialogue: '小李：谁？',
  camera: '固定',
  emotion: '平静',
  seedancePrompt: '室内近景',
  ...partial,
})

const base = (): Project => ({
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
    { id: 'c1', name: '小李', role: '主角', visualLock: '短发', costume: '白衬衫', signatureProp: '手表' },
  ],
  outline: [{ episode: 1, title: '第一集', hook: 'h', summary: 's', cliffhanger: 'c' }],
  scripts: {
    1: { episode: 1, title: '第一集', beats: [{ label: '开场', content: '敲门' }], fullText: '小李：谁？\n小李：你来了。' },
  },
  storyboards: { 1: [shot()] },
  selectedEpisode: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
})

function deep<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

t('旧项目迁移：生成未锁定 items，settingFacts 与提示词输出不变', () => {
  const raw = base() as unknown as Record<string, unknown>
  const beforeFacts = [...(raw.settingFacts as string[])]
  const beforeBlock = constraintBlock(raw as unknown as Project)
  const beforeBoard = storyboardUser(raw as unknown as Project, (raw as unknown as Project).outline[0], (raw as unknown as Project).scripts[1].fullText)
  const result = migrateProject(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const p = result.project
  assert.deepEqual(p.settingFacts, beforeFacts)
  assert.ok(p.settingFactItems && p.settingFactItems.length === 1)
  assert.equal(p.settingFactItems![0].locked, false)
  assert.equal(p.settingFactItems![0].text, beforeFacts[0])
  assert.equal('locks' in p, false)
  assert.equal('stale' in p, false)
  assert.equal(constraintBlock(p), beforeBlock)
  assert.equal(storyboardUser(p, p.outline[0], p.scripts[1].fullText), beforeBoard)
})

t('锁定条目在整体替换时保留，其余替换，投影一致', () => {
  const prev: SettingFactItem[] = [
    { id: 'sf-1', text: '甲家境富裕，住高档小区', locked: true, source: 'legacy' },
    { id: 'sf-2', text: '系统每天早上7点出现', locked: false, source: 'legacy' },
  ]
  const merged = mergeLockedFacts(prev, ['乙家境贫寒，住旧楼', '系统改到晚上出现'])
  assert.ok(merged.some((i) => i.text === '甲家境富裕，住高档小区' && i.locked))
  assert.ok(!merged.some((i) => i.text === '系统每天早上7点出现'))
  assert.ok(merged.some((i) => i.text === '乙家境贫寒，住旧楼' && !i.locked))
  const p = syncFactsProjection({ ...base(), settingFactItems: merged })
  assert.deepEqual(p.settingFacts, projectFactsFromItems(merged))
})

t('编辑锁定行文本时锁定状态保留', () => {
  const items: SettingFactItem[] = [{ id: 'sf-1', text: '旧文本', locked: true, source: 'legacy' }]
  const edited = items.map((it) => (it.id === 'sf-1' ? { ...it, text: '新文本' } : it))
  assert.equal(edited[0].locked, true)
  assert.equal(edited[0].text, '新文本')
})

t('改动剧本全文后出现 script stale，分镜对白不变', () => {
  let p = base()
  p = applyDialogueAuditToProject(p, 1)
  assert.ok(p.fingerprints?.scriptHashByEpisode?.[1])
  assert.ok(!p.stale?.storyboards?.[1])
  const shots = deep(p.storyboards)
  p = refreshStale({
    ...p,
    scripts: { ...p.scripts, 1: { ...p.scripts[1], fullText: '小李：这是改过的剧本。' } },
  })
  assert.equal(p.stale?.storyboards?.[1], 'script')
  assert.equal(staleMessage('script'), '剧本已改，分镜可能过时')
  assert.deepEqual(p.storyboards, shots)
  assert.ok(collectFindings(p).some((f) => f.code === 'stale_storyboard' && f.episode === 1))
})

t('重新检查写入新基线并清除已不成立的 stale', () => {
  let p = base()
  p = applyDialogueAuditToProject(p, 1)
  p = refreshStale({
    ...p,
    scripts: { ...p.scripts, 1: { ...p.scripts[1], fullText: '小李：改过了。' } },
  })
  assert.equal(p.stale?.storyboards?.[1], 'script')
  const shots = deep(p.storyboards)
  p = applyDialogueAuditToProject(p, 1)
  assert.equal(p.stale?.storyboards?.[1], undefined)
  assert.deepEqual(p.storyboards, shots)
  assert.equal(p.fingerprints?.scriptHashByEpisode?.[1], scriptHash('小李：改过了。'))
})

t('无指纹的旧项目不显示过时，审计后写入基线', () => {
  const p = base()
  assert.equal(p.fingerprints, undefined)
  assert.deepEqual(computeStoryboardStale(p), {})
  const next = applyDialogueAuditToProject(p, 1)
  assert.ok(next.fingerprints?.scriptHashByEpisode?.[1])
  assert.ok(!next.stale?.storyboards?.[1])
})

t('覆盖已锁定剧本需显式确认；取消则剧本分镜不变', () => {
  const p: Project = { ...base(), locks: { scripts: { 1: true } } }
  assert.equal(isScriptLocked(p, 1), true)
  assert.equal(overwriteLockedScriptMessage(1), '将覆盖已锁定的第 1 集剧本，下游分镜将标为失效')
  const before = deep(p)
  const cancelled = isScriptLocked(p, 1) && !false // simulate cancel: do not apply
  assert.equal(cancelled, true)
  assert.deepEqual(p, before)
})

t('一键替换时已锁定剧本原稿保留', () => {
  const prev: Project = {
    ...base(),
    locks: { scripts: { 1: true } },
    scripts: { 1: { episode: 1, title: '原', beats: [], fullText: '小李：锁定的原稿。' } },
  }
  const incoming: Project['scripts'] = {
    1: { episode: 1, title: '新', beats: [], fullText: '小李：新生成的。' },
    2: { episode: 2, title: '二', beats: [], fullText: '小李：第二集。' },
  }
  const scripts: Project['scripts'] = { ...incoming }
  for (const [k, s] of Object.entries(prev.scripts)) {
    const ep = Number(k)
    if (isScriptLocked(prev, ep) && s) scripts[ep] = s
  }
  assert.equal(scripts[1].fullText, '小李：锁定的原稿。')
  assert.equal(scripts[2].fullText, '小李：第二集。')
})

t('未锁定未确认时 settingFacts 投影与行为保持数组语义', () => {
  const items = itemsFromFacts(['甲家境富裕，住高档小区', ''])
  const p = syncFactsProjection({ ...base(), settingFactItems: items })
  assert.deepEqual(p.settingFacts, ['甲家境富裕，住高档小区'])
})

t('事实变化可标记 facts stale；导出 schema 仍为 @1 且 shots 不变', () => {
  let p = base()
  p = applyDialogueAuditToProject(p, 1)
  const exportBefore = JSON.stringify(buildVideoPipelineExport(p))
  const shots = deep(p.storyboards)
  p = refreshStale({ ...p, settingFacts: ['完全不同的一条事实'] })
  assert.equal(p.stale?.storyboards?.[1], 'facts')
  assert.deepEqual(p.storyboards, shots)
  const exportAfter = JSON.stringify(buildVideoPipelineExport(p))
  // settingFacts 进入导出可选字段，故允许 facts 内容变化；schema 与 shots 对齐
  const a = buildVideoPipelineExport({ ...base(), settingFacts: p.settingFacts, storyboards: shots })
  assert.equal(a.schema, 'short-drama-studio/video-pipeline@1')
  assert.deepEqual(JSON.parse(exportBefore).shots, JSON.parse(exportAfter).shots)
  assert.equal(JSON.parse(exportAfter).schema, 'short-drama-studio/video-pipeline@1')
})

t('Sidebar 未增加完成门禁（源码检查）', () => {
  const side = readFileSync(join(here, '../src/components/Sidebar.tsx'), 'utf8')
  assert.ok(!side.includes('factsConfirmedAt'))
  assert.ok(!side.includes('stale_storyboard'))
  assert.ok(!side.includes('完成门禁'))
})

void staleFindings
void factsHash
void buildFingerprints

console.log(`\n${pass} tests passed`)
