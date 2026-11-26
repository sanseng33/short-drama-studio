/**
 * npx --yes tsx scripts/test-wardrobe-shot-state-rules.ts
 * Generic generate/export rules: explicit wardrobeRefs constraints, ref lookup fail-closed,
 * on-screen VO vs pure offscreen, delayed-entry structure. Does not mark reviews or run-ready as passed.
 */
import assert from 'node:assert/strict'
import { characterBrief, storyboardUser } from '../src/lib/prompts'
import { normalizeLlmShots } from '../src/lib/shotCast'
import { baseWardrobeState, firstFrameOnscreenIds, onscreenCast, wardrobeStates } from '../src/lib/shotAnnotate'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { splitDurations, finalizeDelayedEntryDurationWarnings, DELAYED_ENTRY_DURATION_BELOW_MIN_CODE, DELAYED_ENTRY_DURATION_EXTENDED_CODE } from '../src/lib/delayedEntrySplit'
import { SEGMENT_MIN_SEC } from '../src/lib/segmentPost'
import { parseExplicitWardrobeRefConstraints, lookupWardrobeRef, resolveWardrobeState } from '../src/lib/wardrobeConstraint'
import { shotStateFromShot } from '../src/lib/shotState/fromShot'
import { buildShotStateExportPack } from '../src/lib/shotState/export'
import type { Character, Project, Shot } from '../src/types'
import type { VideoPipelineShot } from '../src/lib/videoExport'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log('✓', name)
}

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id,
  name,
  role: '角色',
  visualLock: '短发',
  costume: '默认外套',
  signatureProp: '包',
  ...extra,
})

let n = 0
const S = (p: Partial<Shot> = {}): Shot => ({
  id: p.id || `s1-${++n}`,
  shotNo: p.shotNo || n,
  size: '中景',
  durationSec: 5,
  visual: '室内',
  action: '站立',
  dialogue: '',
  camera: '固定',
  emotion: '',
  seedancePrompt: '',
  ...p,
})

const P = (characters: Character[], shots: Shot[], extra: Partial<Project> = {}): Project => ({
  id: 'p_rules',
  title: '规则测试',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 60,
  style: '真人都市',
  logline: '',
  characters,
  outline: [{ episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }],
  scripts: { 1: { episode: 1, title: '一', beats: [], fullText: '' } },
  storyboards: { 1: shots },
  selectedEpisode: 1,
  updatedAt: '',
  ...extra,
})

const OPTS = { mergeToSegments: false } as const

const lin = C('c1', '林薇（梦中）', {
  baseName: '林薇',
  characterKey: 'linwei',
  refImage: 'linwei_formal_nologo',
  costume: '米白开衫配浅蓝连衣裙',
  wardrobeRefs: {
    formal: { refSet: 'linwei_formal_nologo', costume: '白色正装', look: 'formal look' },
    pajama: { refSet: 'linwei_pajama_box', costume: '粉色千鸟格长袖睡衣套装', look: 'pajama look' },
  },
})
const mom = C('c8', '母亲', {
  baseName: '母亲',
  characterKey: 'mother_temp',
  wardrobeState: 'hidden_face',
  wardrobeRefs: { hidden_face: { refSet: 'mother_temp_back', costume: '围裙家居装' } },
})
const dad = C('c5', '林天成', {
  characterKey: 'lintiancheng',
  refImage: 'lintiancheng_nologo',
  wardrobeRefs: { default: { refSet: 'lintiancheng_nologo', costume: '藏青西装' } },
})

t('多角色不同服装：无约束时按 refSet 精确匹配，不把 formal_nologo 误当成独立键', () => {
  assert.equal(baseWardrobeState(lin), 'formal')
  assert.equal(baseWardrobeState(dad), 'default')
  assert.equal(baseWardrobeState({ id: 'a', refImage: 'k_glowup', characterKey: 'k' }), 'glowup')
  const ws = wardrobeStates(
    [
      { id: 's1', episode: 1, shotNo: 1, characterIds: ['c1', 'c5'], prompt: '', visual: '', action: '', durationSec: 5, dialogue: '', camera: '', size: '中景', emotion: '' },
    ] as VideoPipelineShot[],
    [lin, dad],
  )
  assert.deepEqual(ws, [{ c1: 'formal', c5: 'default' }])
})

t('显式 wardrobeRefs 约束覆盖默认 formal，且不靠散文里的服装词', () => {
  const facts = [
    '第2集早晨从卧室到餐厅，林薇服装以角色卡 wardrobeRefs.pajama 为准，不得改成默认连衣裙，也不得提前换正装。',
  ]
  const parsed = parseExplicitWardrobeRefConstraints(facts, [lin, mom, dad])
  assert.deepEqual(
    parsed.applied.map((x) => `${x.characterId}:${x.state}`),
    ['c1:pajama'],
  )
  assert.equal(parsed.rejected.length, 0)
  const resolved = resolveWardrobeState(lin, { constraints: parsed.applied })
  assert.equal(resolved.state, 'pajama')
  assert.equal(resolved.source, 'constraint')

  const exportShots = [
    { id: 's1', episode: 1, shotNo: 1, characterIds: ['c1'], prompt: '', visual: '粉色千鸟格睡衣', action: '醒来', durationSec: 5, dialogue: '', camera: '', size: '中景', emotion: '' },
    { id: 's2', episode: 1, shotNo: 2, characterIds: ['c5'], prompt: '', visual: '藏青西装', action: '坐下', durationSec: 5, dialogue: '', camera: '', size: '中景', emotion: '' },
  ] as VideoPipelineShot[]
  const ws = wardrobeStates(exportShots, [lin, dad], { facts })
  assert.deepEqual(ws, [{ c1: 'pajama' }, { c5: 'default' }])

  const noFact = wardrobeStates(exportShots, [lin, dad], { facts: ['林薇穿着粉色千鸟格睡衣走进餐厅。'] })
  assert.equal(noFact[0].c1, 'formal', 'prose garment words are not a structured constraint')
})

t('错误 ref 映射被拒绝：formal_nologo 不能别名到 formal refSet', () => {
  const miss = lookupWardrobeRef(lin, 'formal_nologo')
  assert.equal(miss.unresolved, true)
  assert.equal(miss.ref, undefined)
  const ok = lookupWardrobeRef(lin, 'pajama')
  assert.equal(ok.unresolved, false)
  assert.equal(ok.ref?.refSet, 'linwei_pajama_box')

  const parsed = parseExplicitWardrobeRefConstraints(['乙乙以角色卡 wardrobeRefs.armor 为准'], [lin, dad])
  assert.ok(parsed.rejected.some((r) => r.reason === 'unknown_key' && r.state === 'armor'))
  assert.equal(parsed.applied.length, 0)

  const p = P(
    [lin],
    [S({ id: 's1-1', shotNo: 1, characterIds: ['c1'], wardrobeState: { c1: 'formal_nologo' }, dialogue: '林薇（梦中）：早。' })],
  )
  const exp = buildVideoPipelineExport(p, OPTS)
  const row = exp.assetContract?.characters.find((r) => r.characterId === 'c1')
  assert.ok(row)
  assert.equal(row!.wardrobeState, 'formal_nologo')
  assert.equal(row!.refSet, null)
  assert.equal(row!.file.origin, 'missing')
  assert.ok(exp.warnings.some((w) => w.code === 'asset_refset_missing'))
})

t('在场 VO 保留 characterIds；纯画外只在 voiceOnly', () => {
  const onScreenVo = S({
    id: 's1-7',
    shotNo: 7,
    characterIds: ['c1', 'c8'],
    voiceOnly: ['母亲'],
    voiceMode: 'offscreen',
    dialogue: '母亲（画外）：做噩梦了？这一头汗。',
    visual: '两人站姿拥抱，母亲只露肩背',
    action: '保持拥抱',
    startState: {
      '林薇（梦中）': { pose: '站' },
      母亲: { pose: '站' },
    },
    endState: {
      '林薇（梦中）': { pose: '站' },
      母亲: { pose: '站' },
    },
  })
  const offscreenOnly = S({
    id: 's1-3',
    shotNo: 3,
    characterIds: ['c1'],
    voiceOnly: ['母亲'],
    voiceMode: 'offscreen',
    dialogue: '母亲（画外）：薇薇——起床了！',
    visual: '走廊里只有林薇（梦中）一人',
    action: '停步听',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' } },
  })
  const exp = buildVideoPipelineExport(P([lin, mom], [onScreenVo, offscreenOnly]), OPTS)
  const hug = exp.shots.find((s) => s.id === 's1-7' || s.id.startsWith('s1-7'))!
  const hall = exp.shots.find((s) => s.id === 's1-3' || s.id.startsWith('s1-3'))!
  assert.ok(hug.characterIds.includes('c1') && hug.characterIds.includes('c8'), `hug characterIds=${hug.characterIds}`)
  assert.ok(hug.voiceOnly.includes('c8'), `hug voiceOnly=${hug.voiceOnly}`)
  assert.deepEqual(hall.characterIds, ['c1'])
  assert.ok(hall.voiceOnly.includes('c8'), `hall voiceOnly=${hall.voiceOnly}`)
  assert.ok(!hall.characterIds.includes('c8'))
})

t('延迟入画：startState 结构产生 offscreen + start_offscreen + enter，不把审查标为通过', () => {
  const entry = S({
    id: 's1-6',
    shotNo: 6,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中），母亲后段一臂内进入。这段散文不得单独变成 verified。',
    action: '走进，随后母亲进入',
    startState: { '林薇（梦中）': { pos: 'left', pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
  })
  const doc = shotStateFromShot(entry, [lin, mom])
  assert.equal(doc.migration?.origin, 'start_state')
  const ff = Object.fromEntries(doc.source.firstFrame.map((e) => [e.id, e.kind]))
  assert.equal(ff.c1, 'unverified')
  assert.equal(ff.c8, 'offscreen')
  assert.deepEqual(
    doc.source.events.map((e) => `${e.id}:${e.kind}`),
    ['c8:start_offscreen', 'c8:enter'],
  )
  assert.deepEqual(doc.reviews, [])
  assert.ok(!doc.source.firstFrame.some((e) => e.kind === 'full' || e.kind === 'verified'))
})

t('延迟入画经 opt-in 导出且不得 run-ready；散文 alone 不会写成 full', () => {
  const entry = S({
    id: 's1-6',
    shotNo: 6,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中）一人，母亲后段进入',
    action: '走进餐厅',
    seedancePrompt: '限制：首帧只有林薇（梦中）',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
  })
  const pack = buildShotStateExportPack(P([lin, mom], [entry]), { mode: 'compat' })
  const s = pack.shots[0]
  assert.equal(s.docOrigin, 'start_state')
  const ff = Object.fromEntries(s.source.firstFrame.map((e) => [e.id, e.kind]))
  assert.equal(ff.c1, 'unverified')
  assert.equal(ff.c8, 'offscreen')
  assert.ok(s.source.events.some((e) => e.id === 'c8' && e.kind === 'enter'))
  assert.equal(pack.claims.runReady, false)
  assert.equal(pack.claims.semanticPass, false)
  assert.equal(s.review.status, 'unknown')
  assert.equal(pack.h3.receiverDeclaresSupport, false)

  const proseOnly = S({
    id: 's1-x',
    shotNo: 8,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中）一人，母亲后段才从右侧进入，不要把这段文字当成 verified。',
    action: '走进',
  })
  const legacy = shotStateFromShot(proseOnly, [lin, mom])
  assert.equal(legacy.migration?.origin, 'legacy_migration')
  const kinds = Object.fromEntries(legacy.source.firstFrame.map((e) => [e.id, e.kind]))
  assert.equal(kinds.c1, 'unverified')
  assert.equal(kinds.c8, 'unverified')
  assert.deepEqual(legacy.source.events, [])
  assert.ok(!legacy.source.firstFrame.some((e) => e.kind === 'full' || e.kind === 'offscreen'))
})

t('镜头上显式 firstFrame/events 优先于 startState，且 LLM 规范化保留这些字段', () => {
  const raw = normalizeLlmShots(
    [
      {
        visual: '门口',
        action: '甲先入画',
        dialogue: '',
        characterIds: ['甲', '乙'],
        wardrobeState: { 甲: 'pajama', 乙: 'hidden_face' },
        firstFrame: [
          { id: '甲', kind: 'full' },
          { id: '乙', kind: 'offscreen' },
        ],
        events: [
          { id: '乙', kind: 'start_offscreen' },
          { id: '乙', kind: 'enter', atSec: 2 },
        ],
      },
    ],
    1,
    [C('c-a', '甲', { wardrobeRefs: { pajama: { refSet: 'a_pajama' } } }), C('c-b', '乙', { wardrobeRefs: { hidden_face: { refSet: 'b_back' } } })],
  )
  assert.deepEqual(raw[0].characterIds, ['c-a', 'c-b'])
  assert.deepEqual(raw[0].wardrobeState, { 'c-a': 'pajama', 'c-b': 'hidden_face' })
  assert.deepEqual(raw[0].firstFrame, [
    { id: 'c-a', kind: 'full' },
    { id: 'c-b', kind: 'offscreen' },
  ])
  assert.equal(raw[0].events?.[1].atSec, 2)
  const doc = shotStateFromShot(raw[0], [
    C('c-a', '甲'),
    C('c-b', '乙'),
  ])
  assert.equal(doc.migration?.origin, 'shot_fields')
  assert.equal(doc.source.firstFrame.find((e) => e.id === 'c-a')?.kind, 'full')
  assert.equal(doc.reviews.length, 0)
})

t('导出层：约束写入 wardrobeState 并解析到正确 refSet；默认导出不含 shotStateExport', () => {
  const facts = ['林薇服装以角色卡 wardrobeRefs.pajama 为准。']
  const p = P(
    [lin, mom],
    [
      S({
        id: 's1-6',
        shotNo: 6,
        characterIds: ['c1', 'c8'],
        dialogue: '',
        visual: '林薇（梦中）走进',
        startState: { '林薇（梦中）': { pose: '站' } },
        endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
      }),
    ],
    { settingFacts: facts },
  )
  const def = buildVideoPipelineExport(p, OPTS)
  assert.equal(Object.prototype.hasOwnProperty.call(def, 'shotStateExport'), false)
  assert.equal(def.shots[0].wardrobeState?.c1, 'pajama')
  const row = def.assetContract!.characters.find((r) => r.characterId === 'c1')!
  assert.equal(row.wardrobeState, 'pajama')
  assert.equal(row.refSet, 'linwei_pajama_box')
  assert.equal(row.file.origin, 'external_unverified')
  assert.equal(row.file.sha256, null, 'no bytes in the project: fail closed, do not invent a hash')

  const optin = buildVideoPipelineExport(p, { ...OPTS, shotStateExport: true })
  assert.equal(optin.shotStateExport?.claims.runReady, false)
  assert.equal(optin.shotStateExport?.h3.receiverDeclaresSupport, false)
  const sse = optin.shotStateExport!.shots[0]
  assert.equal(sse.source.firstFrame.find((e) => e.id === 'c8')?.kind, 'offscreen')
  assert.ok(sse.source.events.some((e) => e.id === 'c8' && e.kind === 'enter'))
  assert.equal(sse.review.status, 'unknown')
})

t('characterBrief 传播 wardrobeRefs 键，不含 note 路径；分镜提示要求结构化字段', () => {
  const brief = characterBrief({
    ...lin,
    wardrobeRefs: {
      pajama: {
        refSet: 'linwei_pajama_box',
        costume: '粉色睡衣',
        note: 'C:\\\\Users\\\\ROG\\\\secret\\\\linwei_pajama_box_00_000.png',
      },
    },
  }) as { wardrobeRefs?: Record<string, { note?: string; refSet?: string }> }
  assert.equal(brief.wardrobeRefs?.pajama.refSet, 'linwei_pajama_box')
  assert.equal(brief.wardrobeRefs?.pajama.note, undefined)
  const user = storyboardUser(P([lin], [], { settingFacts: ['林薇以 wardrobeRefs.pajama 为准'] }), { episode: 1, title: '', hook: '', summary: '', cliffhanger: '' }, '剧本')
  assert.ok(user.includes('wardrobeState'))
  assert.ok(user.includes('firstFrame'))
  assert.ok(user.includes('characterIds'))
})

t('镜头级 wardrobeState 覆盖集级约束', () => {
  const shots = [
    { id: 's1', episode: 1, shotNo: 1, characterIds: ['c1'], wardrobeState: { c1: 'formal' }, prompt: '', visual: '', action: '', durationSec: 5, dialogue: '', camera: '', size: '中景', emotion: '' },
  ] as VideoPipelineShot[]
  const ws = wardrobeStates(shots, [lin], { facts: ['林薇以角色卡 wardrobeRefs.pajama 为准'] })
  assert.deepEqual(ws, [{ c1: 'formal' }])
})


t('延迟入画：startState 只有一人时，导出提示词不得写成两人同框；双人已在首帧则仍同框', () => {
  const delayed = S({
    id: 's1-6',
    shotNo: 6,
    size: '全景',
    durationSec: 7,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中），后段母亲从右侧进入，不见正脸。',
    action: '前段林薇（梦中）走进；后段母亲进入。',
    camera: '侧向缓慢跟移，末段稳住',
    seedancePrompt: '竖屏9:16，全景。主体：18岁东亚少女，粉色睡衣。动作：林薇（梦中）走进，后段母亲从右侧入画。镜头：侧向缓慢跟移后稳住。',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
  })
  const together = S({
    id: 's1-7',
    shotNo: 7,
    size: '中近景',
    durationSec: 6,
    characterIds: ['c1', 'c8'],
    visual: '首帧即为两人站姿拥抱，母亲只露肩背。',
    action: '保持拥抱',
    camera: '固定',
    seedancePrompt: '竖屏9:16，中近景。主体：林薇（梦中）与母亲肩背。镜头：固定。',
    startState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
  })
  const legacy = S({
    id: 's1-8',
    shotNo: 8,
    size: '中景',
    durationSec: 5,
    characterIds: ['c1', 'c8'],
    visual: '两人面对面站在餐桌旁',
    action: '对视',
    camera: '固定',
    seedancePrompt: '竖屏9:16，中景。主体：林薇（梦中）。镜头：固定。',
  })
  assert.deepEqual(firstFrameOnscreenIds(delayed, [lin, mom]), ['c1'])
  assert.deepEqual(onscreenCast(delayed, [lin, mom]), ['c1'])
  const exp = buildVideoPipelineExport(P([lin, mom], [delayed, together, legacy]), OPTS)
  const pre = exp.shots.find((s) => s.id === 's1-6-a' || (s.splitFrom === 's1-6' && s.delayedEntrySplit === 'pre'))!
  const post = exp.shots.find((s) => s.id === 's1-6-b' || (s.splitFrom === 's1-6' && s.delayedEntrySplit === 'post'))!
  const g = exp.shots.find((s) => s.id === 's1-7' || s.id.startsWith('s1-7'))!
  const l = exp.shots.find((s) => s.id === 's1-8' || s.id.startsWith('s1-8'))!
  assert.ok(pre && post, 'delayed entry is split into pre/post shots')
  assert.deepEqual(pre.characterIds, ['c1'])
  assert.ok(!pre.characterIds.includes('c8'))
  assert.ok(post.characterIds.includes('c1') && post.characterIds.includes('c8'))
  assert.ok(!/两人同框|双人全景/.test(pre.prompt), pre.prompt)
  assert.ok(/景别：全景/.test(pre.prompt), pre.prompt)
  assert.ok(/两人同框/.test(g.prompt), g.prompt)
  assert.ok(/两人同框/.test(l.prompt), l.prompt)
})


t('延迟入画导出拆成前后两镜：前镜不挂入画角色参考，后镜首帧包含入画角色', () => {
  const delayed = S({
    id: 'entry-1',
    shotNo: 3,
    size: '全景',
    durationSec: 7,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中），后段母亲从右侧进入。',
    action: '林薇（梦中）走进，随后母亲进入。',
    camera: '侧向缓慢跟移，末段稳住',
    seedancePrompt: '竖屏9:16，全景。主体：林薇（梦中）。动作：走进后母亲进入。镜头：跟移。',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
    wardrobeState: { c1: 'pajama', c8: 'hidden_face' },
  })
  const timed = S({
    id: 'entry-2',
    shotNo: 4,
    size: '全景',
    durationSec: 7,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中）',
    action: '母亲后段进入',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
    firstFrame: [
      { id: 'c1', kind: 'unverified' },
      { id: 'c8', kind: 'offscreen' },
    ],
    events: [
      { id: 'c8', kind: 'start_offscreen' },
      { id: 'c8', kind: 'enter', atSec: 4 },
    ],
  })
  const exp = buildVideoPipelineExport(P([lin, mom], [delayed, timed]), OPTS)
  const pre = exp.shots.find((s) => s.delayedEntrySplit === 'pre' && (s.splitFrom === 'entry-1' || s.id.startsWith('entry-1-a')))!
  const post = exp.shots.find((s) => s.delayedEntrySplit === 'post' && (s.splitFrom === 'entry-1' || s.id.startsWith('entry-1-b')))!
  assert.equal(pre.delayedEntrySplit, 'pre')
  assert.equal(post.delayedEntrySplit, 'post')
  assert.equal(pre.durationSec, 5)
  assert.equal(post.durationSec, 5)
  assert.equal(pre.durationSec + post.durationSec, 10)
  assert.equal(pre.splitSourceDurationSec, 7)
  assert.ok(exp.warnings.some((w) => w.code === DELAYED_ENTRY_DURATION_EXTENDED_CODE && w.shotId === 'entry-1' && /源时长 7s 被执行扩展为 10s/.test(w.message)))
  assert.deepEqual(pre.characterIds, ['c1'])
  assert.ok(post.characterIds.includes('c8'))
  assert.ok(post.startState && 'c8' in post.startState)
  assert.ok(!/c8/.test(JSON.stringify(pre.wardrobeState || {})))
  const preRefs = (exp.assetContract?.characters || []).filter((r) => r.characterId === 'c8')
  // c8 may have a contract row from the POST shot only; the PRE shot must not list c8
  assert.ok(!pre.characterIds.includes('c8'))
  assert.ok(exp.warnings.some((w) => w.code === 'delayed_entry_split' && w.shotId === 'entry-1'))
  assert.ok(exp.warnings.some((w) => w.code === 'delayed_entry_split_untimed' && w.shotId === 'entry-1'))
  assert.ok(pre.prompt.includes('不得出现') && pre.prompt.includes('母亲'))
  assert.ok(post.prompt.includes('首帧即包含'))

  const pre2 = exp.shots.find((s) => s.delayedEntrySplit === 'pre' && (s.splitFrom === 'entry-2' || s.id.startsWith('entry-2-a')))!
  const post2 = exp.shots.find((s) => s.delayedEntrySplit === 'post' && (s.splitFrom === 'entry-2' || s.id.startsWith('entry-2-b')))!
  assert.equal(pre2.durationSec, 5)
  assert.equal(post2.durationSec, 5)
  assert.equal(pre2.splitSourceDurationSec, 7)
  assert.ok(exp.warnings.some((w) => w.code === DELAYED_ENTRY_DURATION_EXTENDED_CODE && w.shotId === 'entry-2' && /源时长 7s 被执行扩展为 10s/.test(w.message)))
  assert.ok(!exp.warnings.some((w) => w.code === 'delayed_entry_split_untimed' && w.shotId === 'entry-2'))

  // default merge must not glue the two parts back together
  const merged = buildVideoPipelineExport(P([lin, mom], [delayed]), { mergeToSegments: true })
  assert.ok(merged.shots.some((s) => s.delayedEntrySplit === 'pre'))
  assert.ok(merged.shots.some((s) => s.delayedEntrySplit === 'post'))
  assert.ok(merged.shots.filter((s) => s.splitFrom === 'entry-1' || s.id.startsWith('entry-1-')).length >= 2)
})

t('默认合同：无结构化延迟入画则不拆镜', () => {
  const shot = S({
    id: 'plain-2',
    shotNo: 1,
    size: '中景',
    durationSec: 5,
    characterIds: ['c1', 'c8'],
    visual: '两人面对面',
    action: '对视',
    seedancePrompt: '竖屏9:16，中景。主体：林薇（梦中）。镜头：固定。',
  })
  const exp = buildVideoPipelineExport(P([lin, mom], [shot]), OPTS)
  assert.equal(exp.shots.filter((s) => (s.segment?.parentId ?? s.id) === 'plain-2' || s.id === 'plain-2').length, 1)
  assert.ok(!exp.warnings.some((w) => w.code === 'delayed_entry_split'))
})


t('延迟入画时长：无atSec的7s源执行5+5=10且警告一致；有atSec尊重比例/边界，每段≥5，合计不少于源与10的较大者', () => {
  assert.equal(SEGMENT_MIN_SEC, 5)
  // 7s untimed: authorized execution is 5+5=10, source is not preserved
  assert.deepEqual(splitDurations(7, undefined), { preSec: 5, postSec: 5, untimed: true, sourceSec: 7, extended: true })
  assert.deepEqual(splitDurations(10, undefined), { preSec: 5, postSec: 5, untimed: true, sourceSec: 10, extended: false })
  assert.deepEqual(splitDurations(8, undefined), { preSec: 5, postSec: 5, untimed: true, sourceSec: 8, extended: true })
  assert.deepEqual(splitDurations(12, undefined), { preSec: 6, postSec: 6, untimed: true, sourceSec: 12, extended: false })
  // atSec on a short source is scaled/clamped to 5+5
  assert.deepEqual(splitDurations(7, 4), { preSec: 5, postSec: 5, untimed: false, sourceSec: 7, extended: true })
  assert.deepEqual(splitDurations(7, 3.5), { preSec: 5, postSec: 5, untimed: false, sourceSec: 7, extended: true })
  assert.deepEqual(splitDurations(7, 0.2), { preSec: 5, postSec: 5, untimed: false, sourceSec: 7, extended: true })
  assert.deepEqual(splitDurations(7, 6.9), { preSec: 5, postSec: 5, untimed: false, sourceSec: 7, extended: true })
  // atSec on a source already >=10: keep source total, clamp sides to >=5 (ratio then remainder)
  assert.deepEqual(splitDurations(12, 5), { preSec: 5, postSec: 7, untimed: false, sourceSec: 12, extended: false })
  assert.deepEqual(splitDurations(12, 2), { preSec: 5, postSec: 7, untimed: false, sourceSec: 12, extended: false })
  assert.deepEqual(splitDurations(12, 10), { preSec: 7, postSec: 5, untimed: false, sourceSec: 12, extended: false })
  assert.deepEqual(splitDurations(20, 3), { preSec: 5, postSec: 15, untimed: false, sourceSec: 20, extended: false })
  // minSec=0 recovers structural half of a 7s source
  assert.deepEqual(splitDurations(7, undefined, 0.5, 0), { preSec: 3.5, postSec: 3.5, untimed: true, sourceSec: 7, extended: false })

  const base = (id: string, durationSec: number, extra: Partial<Shot> = {}) => S({
    id,
    shotNo: 1,
    size: '全景',
    durationSec,
    characterIds: ['c1', 'c8'],
    visual: '首帧只有林薇（梦中），后段（4-7秒）母亲从右侧进入，不见正脸。',
    action: '前段（0-4秒）林薇（梦中）走进；后段（4-7秒）母亲进入。',
    camera: '侧向缓慢跟移',
    seedancePrompt: '竖屏9:16。动作：林薇走进，后段（4-7秒）母亲进入。',
    startState: { '林薇（梦中）': { pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
    wardrobeState: { c1: 'pajama', c8: 'hidden_face' },
    ...extra,
  })

  const warnDur = (
    exp: ReturnType<typeof buildVideoPipelineExport>,
    parent: string,
    preSec: number,
    postSec: number,
    source: number,
  ) => {
    const pre = exp.shots.find((s) => s.delayedEntrySplit === 'pre' && s.splitFrom === parent)!
    const post = exp.shots.find((s) => s.delayedEntrySplit === 'post' && s.splitFrom === parent)!
    assert.ok(pre && post, parent)
    assert.equal(pre.durationSec, preSec)
    assert.equal(post.durationSec, postSec)
    assert.equal(pre.durationSec + post.durationSec, preSec + postSec)
    assert.equal(pre.splitSourceDurationSec, source)
    assert.equal(post.splitSourceDurationSec, source)
    assert.equal(pre.splitPlannedDurationSec, preSec)
    assert.equal(post.splitPlannedDurationSec, postSec)
    const texts = exp.warnings.filter((w) => w.shotId === parent).map((w) => w.message).join('\n')
    assert.ok(texts.includes(`源时长 ${source}s`), texts)
    assert.ok(texts.includes(`执行计划 ${preSec}+${postSec}s`) || texts.includes(`执行计划与执行时长均为 ${preSec}+${postSec}s`), texts)
    assert.ok(texts.includes(`执行时长 ${preSec}+${postSec}s`) || texts.includes(`执行计划与执行时长均为 ${preSec}+${postSec}s`), texts)
    const execSum = preSec + postSec
    const extended = Math.abs(execSum - source) > 1e-9
    if (extended) {
      assert.ok(exp.warnings.some((w) => w.code === DELAYED_ENTRY_DURATION_EXTENDED_CODE && w.shotId === parent))
      assert.ok(texts.includes(`源时长 ${source}s 被执行扩展为 ${execSum}s`) && texts.includes('不得声称源'), texts)
      assert.ok(!/按前后合计保留/.test(texts), texts)
    } else {
      assert.ok(!exp.warnings.some((w) => w.code === DELAYED_ENTRY_DURATION_EXTENDED_CODE && w.shotId === parent), texts)
      assert.ok(texts.includes('源时长按前后合计保留'), texts)
    }
    assert.ok(!exp.warnings.some((w) => w.code === DELAYED_ENTRY_DURATION_BELOW_MIN_CODE && w.shotId === parent), texts)
    return { pre, post, texts }
  }

  const untimedDefault = buildVideoPipelineExport(P([lin, mom], [base('d7', 7)]), { mergeToSegments: true })
  const u = warnDur(untimedDefault, 'd7', 5, 5, 7)
  assert.ok(untimedDefault.warnings.some((w) => w.code === 'delayed_entry_split_untimed' && w.shotId === 'd7'))
  assert.ok(!untimedDefault.warnings.some((w) => w.code === 'segment_duration' && (w.shotId === u.pre.id || w.shotId === u.post.id)))
  // Residual 4-7s mother prose is still in the pre shot; a trailing constraint is not a clean rewrite.
  assert.ok(/4-7秒/.test(u.pre.visual + u.pre.action + u.pre.prompt), 'pre still contains residual 4-7s mother prose')
  assert.ok(/母亲/.test(u.pre.visual + u.pre.action + u.pre.prompt))
  assert.ok(/不得出现/.test(u.pre.prompt))

  warnDur(buildVideoPipelineExport(P([lin, mom], [base('d10', 10)]), { mergeToSegments: true }), 'd10', 5, 5, 10)

  const timed4 = buildVideoPipelineExport(P([lin, mom], [base('t4', 7, {
    firstFrame: [
      { id: 'c1', kind: 'unverified' },
      { id: 'c8', kind: 'offscreen' },
    ],
    events: [
      { id: 'c8', kind: 'start_offscreen' },
      { id: 'c8', kind: 'enter', atSec: 4 },
    ],
  })]), { mergeToSegments: true })
  warnDur(timed4, 't4', 5, 5, 7)
  assert.ok(!timed4.warnings.some((w) => w.code === 'delayed_entry_split_untimed' && w.shotId === 't4'))

  const ok12 = buildVideoPipelineExport(P([lin, mom], [base('t12', 12, {
    firstFrame: [
      { id: 'c1', kind: 'unverified' },
      { id: 'c8', kind: 'offscreen' },
    ],
    events: [{ id: 'c8', kind: 'enter', atSec: 5 }],
  })]), { mergeToSegments: true })
  warnDur(ok12, 't12', 5, 7, 12)

  const clamped = buildVideoPipelineExport(P([lin, mom], [base('t12c', 12, {
    firstFrame: [
      { id: 'c1', kind: 'unverified' },
      { id: 'c8', kind: 'offscreen' },
    ],
    events: [{ id: 'c8', kind: 'enter', atSec: 2 }],
  })]), { mergeToSegments: true })
  warnDur(clamped, 't12c', 5, 7, 12)

  // finalize still flags a drift if execution no longer matches the 5+5 plan
  const fake = finalizeDelayedEntryDurationWarnings([
    { id: 'x-a', delayedEntrySplit: 'pre', splitFrom: 'x', durationSec: 6, splitSourceDurationSec: 7, splitPlannedDurationSec: 5, splitUntimed: true },
    { id: 'x-b', delayedEntrySplit: 'post', splitFrom: 'x', durationSec: 6, splitSourceDurationSec: 7, splitPlannedDurationSec: 5, splitUntimed: true },
  ], [{ episode: 1, shotId: 'x', code: 'delayed_entry_split', message: '延迟入画（c8）已拆成前后两镜 x-a/x-b；前镜不挂入画角色参考，后镜首帧包含入画角色' }], 5)
  assert.ok(fake.some((w) => w.code === DELAYED_ENTRY_DURATION_EXTENDED_CODE && /与执行计划 5\+5s/.test(w.message) && /源时长未被保留/.test(w.message)))
})

console.log(`\n${pass} tests passed`)
