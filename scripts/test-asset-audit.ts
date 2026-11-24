/** 状态：未执行。建议：npx tsc -b && npx --yes tsx scripts/test-asset-audit.ts */
import assert from 'node:assert/strict'
import type { Project, Shot } from '../src/types'
import { auditAssets, canonicalizeLocations, lookCandidates } from '../src/lib/assetAudit'
import { applyDialogueAuditToProject, collectFindings } from '../src/lib/consistency/collect'
import { refreshStale } from '../src/lib/consistency/stale'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { acceptRisksForFindings, isPipelineJsonBlocked } from '../src/lib/consistency/exportWarnings'

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

t('asset 检查不读写 assetContract：清单字节不变，且不引入 hash', () => {
  const p = base()
  p.storyboards[1] = [shot({ visual: '窗边', dialogue: '小李：你好。', characterIds: ['c1'] })]
  const before = JSON.stringify(buildVideoPipelineExport(p).assetContract)
  auditAssets(p)
  collectFindings(p)
  const after = JSON.stringify(buildVideoPipelineExport(p).assetContract)
  assert.equal(before, after)
  assert.equal(JSON.parse(after).version, 'h3-feed@1')
  assert.ok(!/"sha256":"[0-9a-f]{64}"/.test(after))
})

t('场景表去空并按 normalizeLocation 去重等价项', () => {
  const list = canonicalizeLocations(['  别墅客厅  ', '', '别墅客厅', '客厅'])
  // 「客厅」与「别墅客厅」经 normalize 可能不同；至少去空与完全相同项
  assert.ok(!list.some((x) => x === ''))
  assert.equal(list.filter((x) => x === '别墅客厅').length, 1)
})

t('collectFindings 含资产检查 location_not_in_table；该提醒不改项目、不触发流水线 JSON 闸门', () => {
  const p = base()
  p.locations = ['客厅']
  p.storyboards[1] = [shot({ location: '教室', visual: '窗边', dialogue: '小李：你好。', characterIds: ['c1'] })]
  const before = JSON.stringify(p)
  const all = collectFindings(p)
  assert.ok(all.some((f) => f.code === 'location_not_in_table'))
  assert.equal(JSON.stringify(p), before)
  // 资产提醒不是确定缺词，pipeline 导出闸门不拦截
  assert.equal(isPipelineJsonBlocked(p), false)
})

// 第 1 镜带上与 base() 剧本一致的对白，确保没有确定缺词，闸门断言只受地点提醒影响
const locShots = (): Shot[] => [
  shot({ id: 'a', shotNo: 1, location: '教室', visual: '教室', dialogue: '小李：你好。', characterIds: ['c1'] }),
  shot({ id: 'b', shotNo: 2, location: '教室', visual: '教室', characterIds: ['c1'] }),
  shot({ id: 'c', shotNo: 3, location: '教室', visual: '教室', characterIds: ['c1'] }),
  shot({ id: 'd', shotNo: 4, location: '教室', visual: '教室', characterIds: ['c1'] }),
]

t('同一地点出现在多个镜头：只产生一条 location_not_in_table', () => {
  const p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = locShots()
  const found = auditAssets(p).filter((f) => f.code === 'location_not_in_table')
  assert.equal(found.length, 1)
  assert.equal(found[0].evidence, '教室')
  assert.equal(found[0].shotId, 'a')
  assert.ok(found[0].targetKey)
})

t('合并后的文案含镜头数与镜号', () => {
  const p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = locShots()
  const [f] = auditAssets(p).filter((x) => x.code === 'location_not_in_table')
  assert.equal(f.message, '分镜地点「教室」不在场景表（4 个镜头：#1 #2 #3 #4）')
})

t('不同地点仍是两条，且各自带自己的镜号', () => {
  const p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = [
    ...locShots().slice(0, 2),
    shot({ id: 'e', shotNo: 3, location: '操场', visual: '操场', characterIds: ['c1'] }),
  ]
  const found = auditAssets(p).filter((f) => f.code === 'location_not_in_table')
  assert.equal(found.length, 2)
  assert.notEqual(found[0].targetKey, found[1].targetKey)
  const classroom = found.find((f) => f.evidence === '教室')
  const field = found.find((f) => f.evidence === '操场')
  assert.ok(classroom?.message.includes('2 个镜头：#1 #2'))
  assert.ok(field?.message.includes('1 个镜头：#3'))
})

t('忽略合并后的一条，该地点的提醒整体消失，其他地点保留', () => {
  const p = base()
  p.locations = ['别墅客厅']
  p.storyboards[1] = [
    ...locShots(),
    shot({ id: 'e', shotNo: 5, location: '操场', visual: '操场', characterIds: ['c1'] }),
  ]
  const found = auditAssets(p).filter((f) => f.code === 'location_not_in_table')
  assert.equal(found.length, 2)
  const classroom = found.find((f) => f.evidence === '教室')!
  const next = acceptRisksForFindings(p, [classroom], '忽略', '2026-11-24T04:00:00.000Z')
  const after = auditAssets(next).filter((f) => f.code === 'location_not_in_table')
  assert.equal(after.length, 1)
  assert.equal(after[0].evidence, '操场')
  assert.equal(isPipelineJsonBlocked(next), false)
})

t('character_look_not_in_shot 对同一角色多镜头只出一条，不同角色各一条', () => {
  const p = base()
  p.characters.push({ id: 'c2', name: '小王', role: '配角', visualLock: '长发', costume: '蓝色西装', signatureProp: '公文包' })
  p.storyboards[1] = [
    shot({ id: 'a', shotNo: 1, visual: '窗边', characterIds: ['c1', 'c2'] }),
    shot({ id: 'b', shotNo: 2, visual: '走廊', characterIds: ['c1', 'c2'] }),
    shot({ id: 'c', shotNo: 3, visual: '门口', characterIds: ['c1'] }),
  ]
  const found = auditAssets(p).filter((f) => f.code === 'character_look_not_in_shot')
  assert.equal(found.length, 2)
  assert.deepEqual(found.map((f) => f.characterId).sort(), ['c1', 'c2'])
})

console.log(`\n${pass} tests passed`)
