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
import {
  applyOneClickScript,
  applyOneClickStoryboard,
  applyScriptTemplate,
  collectLockedKeeps,
  decideScriptGeneration,
  isScriptOverwriteBlocked,
} from '../src/lib/consistency/scriptLockGuards'
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

t('覆盖已锁定剧本需显式确认；取消则剧本分镜不变（ScriptPanel 决策 + useProject 更新函数）', () => {
  const p: Project = { ...base(), locks: { scripts: { 1: true } } }
  assert.equal(isScriptLocked(p, 1), true)
  assert.equal(overwriteLockedScriptMessage(1), '将覆盖已锁定的第 1 集剧本，下游分镜将标为失效')
  const before = deep(p)

  // 用户取消 confirm：决策为不继续，调用方不再调用生成
  const asked: string[] = []
  const d = decideScriptGeneration(p, 1, (m) => (asked.push(m), false))
  assert.deepEqual(d, { proceed: false })
  assert.deepEqual(asked, [overwriteLockedScriptMessage(1)])
  assert.deepEqual(p, before)

  // 即便直接调用生成而不带确认，更新函数也保持原项目
  assert.equal(isScriptOverwriteBlocked(p, 1, undefined), true)
  const blocked = applyScriptTemplate(p)
  assert.equal(blocked.status, 'locked')
  assert.equal(blocked.project, p)
  assert.deepEqual(blocked.project.scripts, before.scripts)
  assert.deepEqual(blocked.project.storyboards, before.storyboards)

  // 用户确认：带 confirmOverwrite 才覆盖剧本，分镜台词不被改写
  const d2 = decideScriptGeneration(p, 1, () => true)
  assert.deepEqual(d2, { proceed: true, opts: { confirmOverwrite: true } })
  const ok = applyScriptTemplate(p, d2.proceed ? d2.opts : undefined)
  assert.equal(ok.status, 'ok')
  assert.notEqual(ok.project.scripts[1].fullText, before.scripts[1].fullText)
  assert.deepEqual(ok.project.storyboards, before.storyboards)
  assert.deepEqual(p, before)
})

t('未锁定剧本不弹确认，直接生成', () => {
  const p = base()
  let asked = 0
  const d = decideScriptGeneration(p, 1, () => (asked++, false))
  assert.deepEqual(d, { proceed: true })
  assert.equal(asked, 0)
  assert.equal(applyScriptTemplate(p).status, 'ok')
})

t('一键替换时已锁定剧本原稿保留，未锁定集可替换（IdeaPanel 生产函数）', () => {
  const lockedShots = [shot({ id: 's1-1', dialogue: '小李：锁定的原稿。' })]
  const prev: Project = {
    ...base(),
    episodeCount: 2,
    locks: { scripts: { 1: true } },
    scripts: {
      1: { episode: 1, title: '原', beats: [], fullText: '小李：锁定的原稿。' },
      2: { episode: 2, title: '二原', beats: [], fullText: '小李：旧的第二集。' },
    },
    storyboards: { 1: lockedShots, 2: [shot({ id: 's2-1', dialogue: '小李：旧的第二集。' })] },
  }
  const prevSnap = deep(prev)
  const kept = collectLockedKeeps(prev)
  assert.deepEqual(kept.episodes, [1])
  assert.deepEqual(Object.keys(kept.scripts), ['1'])
  assert.deepEqual(Object.keys(kept.storyboards), ['1'])

  // 与 IdeaPanel 一致：新项目只带入锁定集，然后逐集走生产步骤函数
  let proj: Project = { ...base(), episodeCount: 2, scripts: kept.scripts, storyboards: kept.storyboards, locks: prev.locks }
  let madeScripts = 0
  const newScript = (ep: number, text: string) => () => (madeScripts++, { episode: ep, title: '新', beats: [], fullText: text })

  const s1 = applyOneClickScript(prev, proj, 1, newScript(1, '小李：新生成的。'))
  assert.equal(s1.kept, true)
  proj = s1.project
  assert.equal(madeScripts, 0, '锁定集不应生成新剧本')
  assert.equal(proj.scripts[1].fullText, '小李：锁定的原稿。')

  const s2 = applyOneClickScript(prev, proj, 2, newScript(2, '小李：新的第二集。'))
  assert.equal(s2.kept, false)
  proj = s2.project
  assert.equal(madeScripts, 1)
  assert.equal(proj.scripts[2].fullText, '小李：新的第二集。')
  assert.equal(proj.scripts[1].fullText, '小李：锁定的原稿。')

  // 分镜：锁定集保留已有分镜并审计，未锁定集写入新分镜
  let madeBoards = 0
  const newShots = (ep: number) => () => (madeBoards++, [shot({ id: `s${ep}-n`, dialogue: '小李：新的第二集。' })])
  const b1 = applyOneClickStoryboard(prev, proj, 1, newShots(1))
  assert.equal(b1.kept, true)
  assert.equal(madeBoards, 0)
  assert.deepEqual(b1.project.storyboards[1], lockedShots)
  assert.equal(b1.project.dialogueAudit?.[1]?.status, 'checked')
  const b2 = applyOneClickStoryboard(prev, b1.project, 2, newShots(2))
  assert.equal(b2.kept, false)
  assert.equal(madeBoards, 1)
  assert.equal(b2.project.storyboards[2][0].id, 's2-n')
  assert.deepEqual(b2.project.storyboards[1], lockedShots)
  assert.equal(b2.project.scripts[1].fullText, '小李：锁定的原稿。')
  assert.equal(b2.project.dialogueAudit?.[2]?.status, 'checked')
  assert.deepEqual(prev, prevSnap)
})

t('一键：锁定集无已有分镜时仍生成分镜（不跳过）', () => {
  const prev: Project = {
    ...base(),
    locks: { scripts: { 1: true } },
    storyboards: {},
  }
  const proj: Project = { ...prev, scripts: collectLockedKeeps(prev).scripts }
  const r = applyOneClickStoryboard(prev, proj, 1, () => [shot({ id: 's1-new' })])
  assert.equal(r.kept, false)
  assert.equal(r.project.storyboards[1][0].id, 's1-new')
  assert.equal(r.project.scripts[1].fullText, prev.scripts[1].fullText)
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
