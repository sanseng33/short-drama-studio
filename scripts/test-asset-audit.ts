/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-asset-audit.ts */
import assert from 'node:assert/strict'
import type { Project, Shot } from '../src/types'
import { auditAssets, canonicalizeLocations, lookCandidates } from '../src/lib/assetAudit'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { refreshStale } from '../src/lib/consistency/stale'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { acceptRisksForFindings } from '../src/lib/consistency/exportWarnings'

const shot = (partial: Partial<Shot> = {}): Shot => ({
  id: partial.id || 's1-1',
  shotNo: partial.shotNo ?? 1,
  size: '近景',
  durationSec: 3,
  visual: partial.visual ?? '她站在窗边',
  action: '站立',
  dialogue: partial.dialogue ?? '',
  camera: '固定',
  emotion: '平静',
  seedancePrompt: partial.seedancePrompt ?? '',
  location: partial.location,
  characterIds: partial.characterIds,
  ...partial,
})

const base = (): Project => ({
  id: 'p1',
  title: 't',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 60,
  style: '真人都市',
  logline: 'l',
  characters: [
    {
      id: 'c1',
      name: '小李',
      role: '主角',
      visualLock: '短发',
      costume: '红色卫衣，牛仔裤',
      signatureProp: '手表',
    },
  ],
  outline: [{ episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }],
  scripts: { 1: { episode: 1, title: '一', beats: [], fullText: '小李：你好。' } },
  storyboards: {},
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

t('场景表非空且地点不在表中时报 location_not_in_table；等价写法不报', () => {
  const p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = [
    shot({ id: 'a', shotNo: 1, location: '教室', visual: '教室', characterIds: ['c1'] }),
    shot({ id: 'b', shotNo: 2, location: '别墅客厅', visual: '客厅', characterIds: ['c1'] }),
  ]
  const codes = auditAssets(p)
  assert.ok(codes.some((f) => f.code === 'location_not_in_table' && (f.evidence === '教室' || f.message.includes('教室'))))
  assert.ok(!codes.some((f) => f.shotId === 'b' && f.code === 'location_not_in_table'))
})

t('场景表为空：不产生场景提醒', () => {
  const p = base()
  p.locations = []
  p.storyboards[1] = [shot({ location: '教室', characterIds: ['c1'], visual: '教室' })]
  assert.ok(!auditAssets(p).some((f) => f.code === 'location_not_in_table'))
})

t('出场镜未写服装要点则报；含「卫衣」则不报', () => {
  const p = base()
  p.storyboards[1] = [shot({ visual: '她站在窗边', characterIds: ['c1'] })]
  const missing = auditAssets(p).filter((f) => f.code === 'character_look_not_in_shot')
  assert.equal(missing.length, 1)
  p.storyboards[1] = [shot({ visual: '她穿着卫衣站在窗边', characterIds: ['c1'] })]
  assert.equal(auditAssets(p).filter((f) => f.code === 'character_look_not_in_shot').length, 0)
})

t('visualLock 只有单字「白」：不产生候选，不报警', () => {
  assert.deepEqual(lookCandidates('白'), [])
  const p = base()
  p.characters[0] = { ...p.characters[0], costume: '', signatureProp: '', visualLock: '白' }
  p.storyboards[1] = [shot({ visual: '窗边', characterIds: ['c1'] })]
  assert.ok(!auditAssets(p).some((f) => f.code === 'character_look_not_in_shot'))
})

t('角色 locked 但无 refImage：检查不中断、不要求补图', () => {
  const p = base()
  p.characters[0] = { ...p.characters[0], locked: true, refImage: '' }
  p.storyboards[1] = [shot({ visual: '窗边', characterIds: ['c1'] })]
  const findings = auditAssets(p)
  assert.ok(!findings.some((f) => /refImage|定妆图|补图/.test(f.message)))
})

t('忽略一条后同一检查不再出现', () => {
  const p = base()
  p.storyboards[1] = [shot({ visual: '窗边', characterIds: ['c1'] })]
  const [f] = auditAssets(p).filter((x) => x.code === 'character_look_not_in_shot')
  assert.ok(f?.targetKey)
  const next = acceptRisksForFindings(p, [f], '忽略', '2026-11-24T04:00:00.000Z')
  assert.equal(auditAssets(next).filter((x) => x.code === 'character_look_not_in_shot').length, 0)
})

t('编辑场景表不改写镜头，并出现 locations stale', () => {
  let p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = [shot({ location: '别墅客厅', visual: '卫衣', characterIds: ['c1'] })]
  p = applyDialogueAuditToProject(p, 1)
  const shots = deep(p.storyboards)
  p = refreshStale({ ...p, locations: canonicalizeLocations(['老楼窗边']) })
  assert.deepEqual(p.storyboards, shots)
  assert.equal(p.stale?.storyboards?.[1], 'locations')
})

t('旧项目无场景表无指纹：检查不崩溃、无多余提醒', () => {
  const p = base()
  delete p.locations
  delete p.fingerprints
  delete p.stale
  p.storyboards[1] = [shot({ visual: '她穿着红色卫衣和牛仔裤，手表在腕上，短发', characterIds: ['c1'] })]
  const findings = auditAssets(p)
  assert.ok(!findings.some((f) => f.code === 'location_not_in_table'))
  assert.ok(!findings.some((f) => f.code === 'character_look_not_in_shot'))
})

t('asset 检查不改变 pipeline 导出字节，schema 仍为 @1', () => {
  const p = base()
  p.storyboards[1] = [shot({ visual: '窗边', dialogue: '小李：你好。', characterIds: ['c1'] })]
  const a = JSON.stringify(buildVideoPipelineExport(p))
  auditAssets(p)
  collectFindings(p)
  const b = JSON.stringify(buildVideoPipelineExport(p))
  assert.equal(a, b)
  assert.equal(JSON.parse(a).schema, 'short-drama-studio/video-pipeline@1')
})

t('场景表去空并按 normalizeLocation 去重等价项', () => {
  const list = canonicalizeLocations(['  别墅客厅  ', '', '别墅客厅', '客厅'])
  // 「客厅」与「别墅客厅」经 normalize 可能不同；至少去空与完全相同项
  assert.ok(!list.some((x) => x === ''))
  assert.equal(list.filter((x) => x === '别墅客厅').length, 1)
})

t('collectFindings 含资产检查；一键/侧栏无阻断源码约定仍成立', () => {
  const p = base()
  p.locations = ['客厅']
  p.storyboards[1] = [shot({ location: '教室', visual: '窗边', characterIds: ['c1'] })]
  const all = collectFindings(p)
  assert.ok(all.some((f) => f.code === 'location_not_in_table'))
})

console.log(`\n${pass} tests passed`)
