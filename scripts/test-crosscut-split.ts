/** npx tsx scripts/test-crosscut-split.ts — opt-in cross-cut split + angleKey / carryFromShotId */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { applyBeatMode, BEAT_MOUTH_CUE, dedupeClauses, DIALOGUE_PAD_SEC, isBeatPrompt, SOLO_SPLIT_LIMIT } from '../src/lib/beatPrompt'
import {
  allocateSplitDurations,
  angleKeyOf,
  applyCrossCutSplit,
  assignAngleKeys,
  characterHomes,
  correctScenes,
  isCrossCutShot,
  reviewCarryChains,
  splitCrossCutShots,
  validateCarryChain,
} from '../src/lib/crosscutSplit'
import { CARRY_WARDROBE_CONSTRAINT } from '../src/lib/sceneContinuity'
import { postProcessExport } from '../src/lib/segmentPost'
import { buildVideoPipelineExport, type VideoPipelineExport, type VideoPipelineShot } from '../src/lib/videoExport'
import type { Character, Project, Shot } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log(`✓ ${name}`)
}

type PackChar = VideoPipelineExport['characters'][number]
const PC = (id: string, name: string, extra: Partial<PackChar> = {}): PackChar => ({
  id, name, role: '主角', tags: [], visualLock: '东亚少年，短黑发', costume: '米白翻领拉链短夹克', signatureProp: '', refImage: null, age: '17', ...extra,
})
const chars: PackChar[] = [
  PC('c1', '白朴（变帅前）', { baseName: '白朴' }),
  PC('c2', '白朴（变帅后）', { baseName: '白朴' }),
  PC('c3', '吴耐', { costume: '蓝白运动校服', visualLock: '窄脸，深色刘海遮眉' }),
]
const SH = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['c2'], prompt: '竖屏9:16。早上，卧室。主体：少年。动作：站着。', visual: '', action: '', durationSec: 5,
  dialogue: '', speaker: null, speakerName: null, voiceOnly: [], sfx: [], overlayText: [], camera: '近景', size: '近景', emotion: '', refImage: null,
  timeOfDay: '早上', ...p,
})
const villa = { sceneId: 'villa_bedroom_day', sceneLabel: '江景别墅卧室·日', placeKey: 'villa_bedroom', timeBand: 'day' }
const alley = { sceneId: 'alley_window_day', sceneLabel: '旧楼窗·日', placeKey: 'alley_window', timeBand: 'day' }
const S124 = SH({
  id: 's1-24', shotNo: 24, characterIds: ['c2', 'c3'], durationSec: 6.5, dialogue: '我就是白朴。', speaker: 'c2', speakerName: '白朴', carryFromPrev: true,
  mergedFrom: ['s1-24', 's1-25', 's1-26'], ...villa,
  visual: '白朴（变帅后）站在窗前，先扭头瞥了一眼身后的空房间；白朴（变帅后）朝对窗摊了摊手；吴耐的脸部特写：深色刘海压着眼睛，晨光从侧面切进来，铁栏杆的影子横在他脸上',
  camera: '近景，轻微手持，随后侧打中近景，随后近景特写，缓慢微推',
  emotion: '茫然→心虚→审视',
  prompt:
    '竖屏9:16。早上，别墅落地窗前。构图：两处隔窄巷相望的对窗空间，越窗长焦在两窗之间切换视角（同一时空的对切），两人始终各在自己窗内。主体：17岁东亚少年白朴（变帅后），短黑发上梳，米白翻领拉链短夹克；17岁东亚少年吴耐，深色中长刘海遮眉，偏小的蓝白运动校服。时间轴（一镜6.5秒，小节拍）：0–2s他扭头看身后，确认没人，再转回来，手指点了点自己的胸口，表演：眨眼两次；2–4.5s随后他摊手又收回来摸了摸后颈（白朴开口说台词），表演：开口前先把眉毛放平装无事；4.5–6.5s随后他眯眼盯住对面，指间的鸡蛋转了半圈，喉结滚了一下，表演：下唇往里咬了一下又松开。镜头：近景。风格：真人实拍都市短剧质感，自然肤质，禁止二次元漫画脸。光线：早上晨光正面柔亮。限制：竖屏9:16，无任何文字，服装无任何标志、样，服装无任何标志、校徽、刺绣字样，' +
    CARRY_WARDROBE_CONSTRAINT + '。',
})
// solo shots that tell where each character lives (c2 → villa, c3 → alley window)
const soloC2 = SH({ id: 's1-22', shotNo: 22, characterIds: ['c2'], ...villa })
const soloC3 = SH({ id: 's1-20', shotNo: 20, characterIds: ['c3'], ...alley })
const after = SH({ id: 's1-27', shotNo: 27, characterIds: ['c3'], carryFromPrev: true, ...alley })
const pack = (shots: VideoPipelineShot[]): VideoPipelineExport => ({
  schema: 'short-drama-studio/video-pipeline@1',
  project: { id: 'p', title: 't', style: '真人都市', platform: '', secondsPerEp: 60, settingFacts: [] },
  characters: chars,
  shots,
  warnings: [],
})
const base = pack([soloC3, soloC2, S124, after])

t('isCrossCutShot: ≥2 cast + 对窗/对切 only', () => {
  assert.equal(isCrossCutShot(S124), true)
  assert.equal(isCrossCutShot({ ...S124, characterIds: ['c2'] }), false, 'solo')
  assert.equal(isCrossCutShot({ ...S124, prompt: '竖屏9:16。教室。主体：两人并排。', visual: '' }), false, 'same-room two-shot')
  assert.equal(isCrossCutShot({ ...S124, splitFrom: 's1-24' }), false, 'children never re-split')
})

t('allocateSplitDurations: ≥3 s, 5–9 s when possible, dialogue floor, 0.5 grid, total ≈ original', () => {
  assert.deepEqual(allocateSplitDurations([4.5, 2], 6.5), [3.5, 3])
  assert.deepEqual(allocateSplitDurations([2.5, 2, 2.5], 7), [3, 3, 3], 'never <3 s → total grows')
  assert.deepEqual(allocateSplitDurations([8, 4], 12), [7, 5], 'prefer ≥5 s when the original allows')
  assert.deepEqual(allocateSplitDurations([3, 2.5], 5.5, [3.7, 0]), [4, 3], 'dialogue child gets its speaking time')
  for (const [raw, o] of [[[1, 1, 1, 1], 9], [[6, 1], 7], [[0.3, 8.7], 9], [[12, 2], 14]] as [number[], number][]) {
    const d = allocateSplitDurations(raw, o)
    assert.ok(d.every((x) => x >= 3 && Number.isInteger(x * 2)), JSON.stringify(d))
    assert.equal(d.reduce((a, b) => a + b, 0), Math.max(o, 3 * raw.length))
  }
})

t('s1-24-like segment → s1-24a (c2, speaks) + s1-24b (c3, listens)', () => {
  const { exp, splits } = splitCrossCutShots(base)
  assert.deepEqual(exp.shots.map((s) => s.id), ['s1-20', 's1-22', 's1-24a', 's1-24b', 's1-27'])
  const [a, b] = [exp.shots[2], exp.shots[3]]
  assert.equal(splits.length, 1)
  assert.deepEqual([a.characterIds, b.characterIds], [['c2'], ['c3']])
  assert.equal(a.splitFrom, 's1-24')
  assert.equal(b.splitFrom, 's1-24')
  assert.deepEqual([a.durationSec, b.durationSec], [3.5, 3])
  assert.equal(a.dialogue, '我就是白朴。')
  assert.equal(a.speaker, 'c2')
  assert.equal(b.dialogue, '')
  assert.equal(b.speaker, null)
  assert.ok(b.prompt.includes('嘴唇闭合安静听对面说话'), 'listener lips closed')
  assert.ok(!a.prompt.includes('嘴唇闭合安静听'), 'speaker is not told to listen')
  assert.ok(a.prompt.includes('（白朴开口说台词）'), 'speech marker kept on the speaker child')
  // single subject each
  assert.ok(/主体：17岁东亚少年白朴（变帅后），短黑发上梳，米白翻领拉链短夹克。/.test(a.prompt), a.prompt)
  assert.ok(!a.prompt.includes('吴耐') && !a.prompt.includes('校服'), 'no second subject in a')
  assert.ok(!b.prompt.includes('白朴') && !b.prompt.includes('夹克'), 'no second subject in b')
  assert.ok(!/对切|两人始终/.test(a.prompt + b.prompt), 'cross-cut composition removed')
  // own beats in order
  assert.ok(a.prompt.includes('扭头看身后') && a.prompt.includes('摊手') && !a.prompt.includes('眯眼'))
  assert.ok(b.prompt.includes('眯眼盯住对面') && !b.prompt.includes('扭头'))
  // places / camera / meta
  assert.equal(a.sceneId, 'villa_bedroom_day')
  assert.equal(b.sceneId, 'alley_window_day')
  assert.equal(b.sceneLabel, '旧楼窗·日')
  assert.ok(b.prompt.startsWith('竖屏9:16。早上，旧楼窗前。'), b.prompt.slice(0, 30))
  assert.ok(b.prompt.includes('光线：晨光从侧面切进来'), 'light from own visual')
  assert.equal(b.camera, '近景特写，缓慢微推')
  assert.deepEqual(a.mergedFrom, ['s1-24', 's1-25'])
  assert.deepEqual(b.mergedFrom, ['s1-26'])
  assert.equal(a.emotion, '茫然→心虚')
  assert.ok(a.prompt.includes(SOLO_SPLIT_LIMIT) && b.prompt.includes(SOLO_SPLIT_LIMIT))
  assert.ok(!a.prompt.includes('服装无任何标志、样，'), 'mangled limit fragment dropped')
  assert.equal(a.carryFromPrev, true, 'first child keeps carryFromPrev before angle pass')
  assert.equal(b.carryFromPrev, false, 'later children never chain from the other character')
})

t('angleKey / carryFromShotId on every shot; split children chain by angle', () => {
  const { exp } = applyCrossCutSplit(base)
  const m = Object.fromEntries(exp.shots.map((s) => [s.id, s]))
  assert.equal(m['s1-20'].angleKey, 'alley_window_day_c3')
  assert.equal(m['s1-24a'].angleKey, 'villa_bedroom_day_c2')
  assert.equal(m['s1-24b'].angleKey, 'alley_window_day_c3')
  assert.equal(m['s1-20'].carryFromShotId, null)
  assert.equal(m['s1-22'].carryFromShotId, null)
  assert.equal(m['s1-24a'].carryFromShotId, 's1-22')
  assert.equal(m['s1-24b'].carryFromShotId, 's1-20')
  assert.equal(m['s1-27'].carryFromShotId, 's1-24b')
  assert.equal(m['s1-24a'].carryFromPrev, true, 'carryFromShotId is the previous shot')
  assert.equal(m['s1-24b'].carryFromPrev, false, 'previous shot is the other character')
  assert.equal(m['s1-27'].carryFromPrev, true, 'non-split carryFromPrev unchanged')
  assert.ok(m['s1-24b'].prompt.includes(CARRY_WARDROBE_CONSTRAINT), 'carry child keeps wardrobe constraint')
  assert.deepEqual(validateCarryChain(exp.shots), [])
  for (const s of exp.shots) assert.ok('carryFromShotId' in s && typeof s.angleKey === 'string', s.id)
})

t('angleKeyOf: sorted cast, empty, fallbacks', () => {
  assert.equal(angleKeyOf({ sceneId: 'classroom_day', characterIds: ['c3', 'c2'] }), 'classroom_day_c2+c3')
  assert.equal(angleKeyOf({ sceneId: 'villa_bedroom_night', characterIds: [] }), 'villa_bedroom_night_empty')
  assert.equal(angleKeyOf({ placeKey: 'villa_window', timeBand: 'day', characterIds: ['c2'] }), 'villa_window_day_c2')
  assert.equal(angleKeyOf({ characterIds: ['c2'] }), 'scene_c2')
})

t('validateCarryChain catches missing / later / mismatched / cyclic refs', () => {
  const S = (id: string, angleKey: string, carryFromShotId: string | null | undefined) => ({ id, angleKey, carryFromShotId })
  assert.deepEqual(validateCarryChain([S('a', 'k', null), S('b', 'k', 'a')]), [])
  assert.ok(validateCarryChain([S('a', 'k', null), S('b', 'k', 'zz')]).some((e) => e.includes('不存在')), 'missing')
  assert.ok(validateCarryChain([S('a', 'k', 'b'), S('b', 'k', null)]).some((e) => e.includes('不是更早')), 'later')
  assert.ok(validateCarryChain([S('a', 'k', null), S('b', 'j', 'a')]).some((e) => e.includes('angleKey 不一致')), 'mismatch')
  assert.ok(validateCarryChain([S('a', 'k', 'b'), S('b', 'k', 'a')]).some((e) => e.includes('环')), 'cycle')
  assert.ok(validateCarryChain([S('a', 'k', undefined)]).some((e) => e.includes('缺少 carryFromShotId')), 'missing field')
  assert.ok(validateCarryChain([S('a', 'k', null), S('a', 'k', null)]).some((e) => e.includes('重复')), 'dup ids')
})

t('mixed beat (two named subjects) is divided by subject; other names → 对面窗口', () => {
  const s = SH({
    id: 's3-6', characterIds: ['c2', 'c3'], durationSec: 7, ...alley,
    visual: '白朴半侧身拉窗帘；对窗旧楼：吴耐拉开窗帘',
    prompt:
      '竖屏9:16。早上，窗前。构图：对窗。主体：白朴（变帅后），短黑发；吴耐，蓝白运动校服。时间轴（一镜7秒，小节拍）：0–2.5s白朴把窗帘拉到一半停住，视线落在对面；2.5–5s随后吴耐拉开窗帘，两人隔着空地撞上视线；白朴肩膀一紧，吴耐的眉毛抬起半寸，表演：白朴视线被钉住；吴耐眼神倔强；5–7s随后白朴把小黄鸭藏到身后，耳根有点热。镜头：近景。限制：无任何文字。',
  })
  const { exp, splits } = splitCrossCutShots(pack([soloC2, soloC3, s]))
  const kids = exp.shots.filter((x) => x.splitFrom === 's3-6')
  assert.deepEqual(kids.map((k) => [k.id, k.characterIds[0]]), [['s3-6a', 'c2'], ['s3-6b', 'c3'], ['s3-6c', 'c2']])
  assert.ok(kids[2].prompt.includes('肩膀一紧') && kids[2].prompt.includes('小黄鸭'), 'c2 reaction joins the next c2 run')
  assert.ok(!kids[0].prompt.includes('眉毛抬起') && !kids[2].prompt.includes('眉毛抬起'), 'c3 reaction not in c2 children')
  assert.ok(kids[1].prompt.includes('眉毛抬起') && kids[1].prompt.includes('他与对面窗口'), kids[1].prompt)
  assert.ok(!kids.some((k) => k.prompt.includes('白朴') && k.characterIds[0] === 'c3'))
  assert.ok(kids.every((k) => k.durationSec >= 3))
  assert.ok(splits[0].notes.some((n) => n.includes('按主语拆')))
})

t('episode boundary: chains restart per episode; validation rejects cross-episode refs', () => {
  const e2 = (p: Partial<VideoPipelineShot>) => SH({ episode: 2, ...p })
  const { exp } = applyCrossCutSplit(pack([soloC3, soloC2, S124, after, e2({ id: 's2-1', ...villa }), e2({ id: 's2-2', ...villa })]))
  const m = Object.fromEntries(exp.shots.map((s) => [s.id, s]))
  assert.equal(m['s2-1'].angleKey, 'villa_bedroom_day_c2')
  assert.equal(m['s2-1'].carryFromShotId, null, 'first of its angle in episode 2 → null (not s1-24a)')
  assert.equal(m['s2-2'].carryFromShotId, 's2-1')
  assert.deepEqual(validateCarryChain(exp.shots), [])
  const bad = [
    { id: 'a', episode: 1, angleKey: 'k', carryFromShotId: null },
    { id: 'b', episode: 2, angleKey: 'k', carryFromShotId: 'a' },
  ]
  assert.ok(validateCarryChain(bad).some((e) => e.includes('跨集')), 'cross-episode ref is an error')
})

t('scene correction rule: solo shot at the other character\'s facing-window home moves to its own home', () => {
  const night = { sceneId: 'villa_bedroom_night', sceneLabel: '江景别墅卧室·夜', placeKey: 'villa_bedroom', timeBand: 'night' }
  const alleyN = { sceneId: 'alley_window_night', sceneLabel: '旧楼窗·夜', placeKey: 'alley_window', timeBand: 'night' }
  const cross = SH({ id: 'x1', characterIds: ['c2', 'c3'], prompt: '竖屏9:16。构图：对窗。主体：两人。', ...villa })
  const shots = [
    cross,
    SH({ id: 'v1', ...villa }), SH({ id: 'v2', ...villa }), SH({ id: 'v3', ...night }),
    SH({ id: 'a1', characterIds: ['c3'], ...alley }), SH({ id: 'a2', characterIds: ['c3'], ...alleyN }),
    SH({ id: 'bad1', characterIds: ['c2'], ...alleyN }), // 白朴 labelled at 吴耐's window
    SH({ id: 'bad2', characterIds: ['c3'], ...villa }), // 吴耐 labelled in 白朴's bedroom
    SH({ id: 'cls', characterIds: ['c2'], sceneId: 'classroom_day', sceneLabel: '教室·日', placeKey: 'classroom', timeBand: 'day' }),
    SH({ id: 'two', characterIds: ['c2', 'c3'], prompt: '竖屏9:16。构图：两窗对切。主体：两人。', ...alley }),
  ]
  const h = characterHomes(shots)
  assert.equal(h.home.get('c2'), 'villa_bedroom')
  assert.equal(h.home.get('c3'), 'alley_window')
  const { exp, corrections } = correctScenes(pack(shots))
  const m = Object.fromEntries(exp.shots.map((s) => [s.id, s]))
  assert.deepEqual(corrections.map((c) => [c.id, c.from, c.to, c.by]), [
    ['bad1', 'alley_window_night', 'villa_bedroom_night', 'rule'],
    ['bad2', 'villa_bedroom_day', 'alley_window_day', 'rule'],
  ])
  assert.equal(m.bad1.sceneLabel, '江景别墅卧室·夜')
  assert.equal(m.bad1.placeKey, 'villa_bedroom')
  assert.equal(m.bad1.timeBand, 'night')
  assert.equal(m.cls.sceneId, 'classroom_day', 'non-window places untouched')
  assert.equal(m.two.sceneId, 'alley_window_day', 'multi-person shots untouched by the rule')
  // explicit override wins, unknown sceneId throws
  const o = correctScenes(pack(shots), { bad1: 'classroom_day', two: 'classroom_day' })
  assert.deepEqual(o.corrections.map((c) => [c.id, c.to, c.by]), [['bad1', 'classroom_day', 'override'], ['bad2', 'alley_window_day', 'rule'], ['two', 'classroom_day', 'override']])
  assert.throws(() => correctScenes(pack(shots), { bad1: 'moon_base' }), /unknown sceneId/)
  // no clear majority → no home → no correction
  const tie = [cross, shots[shots.length - 1], SH({ id: 't1', characterIds: ['c3'], ...villa }), SH({ id: 't2', characterIds: ['c3'], ...alley })]
  assert.equal(characterHomes(tie).home.get('c3'), undefined)
  assert.deepEqual(correctScenes(pack(tie)).corrections, [])
})

t('near-duplicate clauses: filler-insensitive containment keeps the fuller wording', () => {
  assert.deepEqual(dedupeClauses(['眉毛抬起半寸', '手还搭在窗框上', '手搭在窗框上没放下', '眼神带着倔强']), ['眉毛抬起半寸', '手搭在窗框上没放下', '眼神带着倔强'])
  assert.deepEqual(dedupeClauses(['手还搭在窗框上', '手指敲着桌面']), ['手还搭在窗框上', '手指敲着桌面'], 'different actions kept')
  assert.deepEqual(dedupeClauses(['他笑了', '他又笑了']), ['他笑了', '他又笑了'], 'too short to judge')
})

t('solo child header / limits drop the two-space composition; X别墅 → 对面别墅', () => {
  const s = SH({
    id: 's2-22', characterIds: ['c2', 'c3'], durationSec: 5.5, dialogue: '这件我可是挑了很久的。', speaker: 'c2', speakerName: '白朴', timeOfDay: '黄昏',
    sceneId: 'villa_bedroom_dusk', sceneLabel: '江景别墅卧室·黄昏', placeKey: 'villa_bedroom', timeBand: 'dusk',
    visual: '白朴整理衬衫；对面旧楼窗口：吴耐捏着杂志，盯着白朴别墅的落地窗',
    prompt:
      '竖屏9:16。左右双窗同框的构图：左侧是江景别墅落地窗，右侧是旧楼窗。构图：对窗。主体：17岁少年白朴（变帅后），白衬衫；17岁少年吴耐，蓝白运动校服。时间轴（一镜5.5秒，小节拍）：0–3.5s白朴把领口抚平（白朴开口说台词）；3.5–5.5s随后吴耐把杂志角捏紧，盯着白朴别墅的落地窗。镜头：全景。限制：无任何文字，同框仅两人。',
  })
  const alleyD = { sceneId: 'alley_window_dusk', sceneLabel: '旧楼窗·黄昏', placeKey: 'alley_window', timeBand: 'dusk' }
  const { exp } = splitCrossCutShots(pack([SH({ id: 'h1', characterIds: ['c3'], ...alleyD }), SH({ id: 'h2', ...villa }), s]))
  const [a, b] = exp.shots.filter((x) => x.splitFrom)
  assert.ok(a.prompt.startsWith('竖屏9:16。黄昏，江景别墅卧室窗前。'), a.prompt.slice(0, 40))
  assert.ok(!/双窗|同框|两人/.test(a.prompt + b.prompt), 'no two-person composition / limit in solo children')
  assert.ok(b.prompt.includes('对面别墅的落地窗'), b.prompt)
  // dialogue child long enough for line/4.5 + 0.5 s plus one other segment
  const need = [...'这件我可是挑了很久的'].length / 4.5 + DIALOGUE_PAD_SEC + 1
  assert.ok(a.durationSec >= need, `${a.durationSec} ≥ ${need}`)
})

t('default stays off: no split / angle fields without the flag', () => {
  const a = postProcessExport(base, { mergeToSegments: false })
  assert.ok(a.shots.every((s) => !s.splitFrom && !('angleKey' in s) && !('carryFromShotId' in s)))
  const b = postProcessExport(base, { mergeToSegments: false, splitCrossCut: true })
  assert.ok(b.shots.some((s) => s.splitFrom === 's1-24'))
  assert.deepEqual(validateCarryChain(b.shots), [])
})

t('split + beat mode: solo beat prompts, no names, dialogue only on the speaker child', () => {
  const exp = applyBeatMode(applyCrossCutSplit(base).exp)
  const a = exp.shots.find((s) => s.id === 's1-24a')!
  const b = exp.shots.find((s) => s.id === 's1-24b')!
  assert.ok(isBeatPrompt(a.prompt) && isBeatPrompt(b.prompt))
  assert.ok(a.prompt.includes('单人。') && b.prompt.includes('单人。'))
  assert.ok(a.prompt.includes(BEAT_MOUTH_CUE) && !b.prompt.includes(BEAT_MOUTH_CUE))
  assert.ok(!b.beatSegments!.some((x) => x.lipSync), 'listener has no lip-sync segment')
  const listenLine = b.prompt.split('\n').find((l) => l.includes('安静听'))
  assert.ok(listenLine && !listenLine.includes('【快】'), `listening segment is never 快: ${listenLine}`)
  assert.ok(![a, b].some((s) => /白朴|吴耐|我就是/.test(s.prompt)), 'no names / dialogue text')
  assert.ok(a.prompt.includes(SOLO_SPLIT_LIMIT) && b.prompt.includes(CARRY_WARDROBE_CONSTRAINT))
  for (const s of [a, b]) assert.equal(s.beatSegments![s.beatSegments!.length - 1].end, s.durationSec)
})

t('idempotent: splitting a split pack changes nothing', () => {
  const once = applyCrossCutSplit(base).exp
  const twice = applyCrossCutSplit(once)
  assert.deepEqual(twice.exp, once)
  assert.equal(twice.splits.length, 0)
  const bo = applyBeatMode(once)
  assert.deepEqual(applyBeatMode(applyCrossCutSplit(bo).exp), bo, 'split→beat→split→beat stable')
})

const C = (id: string, name: string): Character => ({ id, name, role: '角色', visualLock: '短发', costume: '黑夹克', signatureProp: '芯片', age: '25' })
let n = 0
const SS = (p: Partial<Shot>): Shot => ({ id: `b${++n}`, shotNo: n, size: '中景', durationSec: 6, visual: '写字楼大堂', action: '站立', dialogue: '', camera: '固定', emotion: '', seedancePrompt: '', ...p })
const project = {
  id: 'pb', title: 'x', genre: '都市逆袭', style: '真人都市', platform: '红果', episodes: 1, secondsPerEp: 30, logline: '', settingFacts: [],
  characters: [C('c1', '林川'), C('c2', '赵泽')], outline: [], scripts: {},
  storyboards: { 1: [SS({ characterIds: ['c1'], action: '林川推开门' }), SS({ characterIds: ['c1', 'c2'], action: '两人对视' })] },
  selectedEpisode: 1,
} as unknown as Project
t('buildVideoPipelineExport: splitCrossCut option wires through, default unchanged', () => {
  const d = buildVideoPipelineExport(project)
  assert.deepEqual(buildVideoPipelineExport(project, { splitCrossCut: false }), d)
  const s = buildVideoPipelineExport(project, { splitCrossCut: true })
  assert.ok(s.shots.every((x) => typeof x.angleKey === 'string' && 'carryFromShotId' in x))
  assert.deepEqual(s.shots.map((x) => x.prompt), d.shots.map((x) => x.prompt), 'no cross-cut → prompts unchanged')
  assert.deepEqual(validateCarryChain(s.shots), [])
})

const P2 = '/workspace/fixed/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
if (existsSync(P2)) {
  const p2 = JSON.parse(readFileSync(P2, 'utf8')) as VideoPipelineExport
  const FLAGGED = ['s1-1', 's1-8', 's1-13', 's1-21', 's1-24', 's1-30', 's2-22', 's3-6', 's3-25', 's4-1']
  const OV = JSON.parse(readFileSync(new URL('./scene-overrides/xiaohuangya-p2-clean.json', import.meta.url), 'utf8')).overrides as Record<string, string>
  t('p2-clean: scene corrections (rule + override file), chains stay inside episodes', () => {
    const { exp, corrections } = applyCrossCutSplit(p2, { sceneOverrides: OV })
    assert.deepEqual(corrections.map((c) => `${c.id}:${c.to}:${c.by}`), [
      's2-1:alley_window_day:rule',
      's3-29:villa_bedroom_night:rule',
      's4-25:villa_bedroom_night:rule',
      's5-4:villa_bedroom_day:rule',
      's6-13:classroom_day:override',
      's6-16:classroom_day:override',
    ])
    // without the override file the rule alone would put s6-16 in the bedroom (why it is an explicit override)
    assert.equal(applyCrossCutSplit(p2).corrections.find((c) => c.id === 's6-16')?.to, 'villa_bedroom_day')
    assert.deepEqual(validateCarryChain(exp.shots), [])
    const r = reviewCarryChains(exp.shots)
    assert.deepEqual(r.crossEpisode, [])
    assert.deepEqual(r.placeConflict, [])
    assert.deepEqual(r.longGap, [])
    assert.deepEqual(r.splitResolved.map((x) => x.split(':')[0]), ['s1-11', 's2-24', 's3-29'])
    const ep = new Map(exp.shots.map((s) => [s.id, s.episode]))
    for (const s of exp.shots) if (s.carryFromShotId) assert.equal(ep.get(s.carryFromShotId), s.episode, s.id)
    const m = Object.fromEntries(exp.shots.map((s) => [s.id, s]))
    assert.equal(m['s3-29'].carryFromShotId, 's3-25a', 'c2 night window continues from s3-25a')
    assert.equal(m['s4-25'].carryFromShotId, 's4-21')
    assert.equal(m['s2-2'].carryFromShotId, null, 'no carry from 吴耐 window / previous episode')
  })
  t('p2-clean: exactly the flagged cross-cut segments are split; chain valid', () => {
    assert.deepEqual(p2.shots.filter(isCrossCutShot).map((s) => s.id), FLAGGED)
    const { exp, splits } = applyCrossCutSplit(p2)
    assert.deepEqual(splits.map((x) => x.id), FLAGGED)
    assert.deepEqual(validateCarryChain(exp.shots), [])
    const orig = new Map(p2.shots.map((s) => [s.id, s]))
    for (const s of exp.shots) {
      assert.ok(typeof s.angleKey === 'string' && 'carryFromShotId' in s, s.id)
      if (s.splitFrom) {
        assert.equal(s.characterIds.length, 1, s.id)
        assert.ok(s.durationSec >= 3 && s.durationSec <= 9, `${s.id} ${s.durationSec}`)
        assert.match(s.id, new RegExp(`^${s.splitFrom}[a-z]$`))
      } else {
        const o = orig.get(s.id)!
        assert.equal(s.prompt, o.prompt, `${s.id} prompt untouched`)
        assert.equal(s.carryFromPrev, o.carryFromPrev, `${s.id} carryFromPrev untouched`)
      }
    }
    // every dialogue line survives exactly once
    const linesOf = (ss: VideoPipelineShot[]) =>
      ss.flatMap((s) => (s.dialogueLines?.length ? s.dialogueLines.map((l) => `${l.speaker}:${l.text}`) : s.dialogue ? [`${s.speaker}:${s.dialogue}`] : [])).sort()
    assert.deepEqual(linesOf(exp.shots), linesOf(p2.shots))
    // dialogue sits with its speaker
    for (const s of exp.shots.filter((x) => x.splitFrom && x.speaker)) assert.ok(s.characterIds.includes(s.speaker!), s.id)
    for (const x of splits) {
      const tot = x.children.reduce((a, c) => a + c.durationSec, 0)
      assert.ok(tot >= x.durationSec && tot <= x.durationSec + 2.5, `${x.id} ${x.durationSec}→${tot}`)
    }
    const r = reviewCarryChains(exp.shots)
    assert.ok(Array.isArray(r.crossEpisode) && Array.isArray(r.legacyMismatch))
  })
  t('p2-clean split + beat: s1-24a/b solo prompts; no names or dialogue leaks in children', () => {
    const exp = applyBeatMode(applyCrossCutSplit(p2, { sceneOverrides: OV }).exp)
    for (const s of exp.shots) {
      const lines = s.dialogueLines?.length ? s.dialogueLines.map((l) => l.text) : s.dialogue ? [s.dialogue] : []
      const dlg = lines.reduce((a, l) => a + [...(l || '')].filter((ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch)).length / 4.5, 0)
      const slow = s.beatSegments!.filter((x) => x.speed === '慢').reduce((a, x) => a + x.end - x.start, 0)
      if (dlg > 0) assert.ok(slow >= dlg + DIALOGUE_PAD_SEC - 1e-9, `${s.id}: 慢 ${slow}s < ${dlg.toFixed(2)}+0.5`)
    }
    assert.ok(!exp.shots.find((s) => s.id === 's3-6b')!.prompt.includes('手还搭在窗框上'), 's3-6b duplicate clause removed')
    const m = Object.fromEntries(exp.shots.map((s) => [s.id, s]))
    assert.deepEqual([m['s1-24a'].characterIds, m['s1-24b'].characterIds], [['c2'], ['c3']])
    assert.equal(m['s1-24a'].dialogue, '我就是白朴。')
    assert.deepEqual(m['s1-24a'].beatSegments!.map((x) => x.speed), ['快', '慢'])
    assert.ok(m['s1-24a'].prompt.includes('他猛地扭头看身后'))
    assert.ok(m['s1-24b'].prompt.includes('眯眼盯住对面') && m['s1-24b'].prompt.includes('嘴唇闭合'))
    assert.equal(m['s1-24a'].carryFromShotId, 's1-21a')
    assert.equal(m['s1-24b'].carryFromShotId, 's1-21b')
    assert.equal(m['s4-1a'].characterIds[0], 'c1', '吴耐家的旧楼 is a place, not 吴耐 on screen')
    for (const s of exp.shots.filter((x) => x.splitFrom)) {
      assert.ok(!/白朴|吴耐|双人|另一人/.test(s.prompt), `${s.id} name / two-person leak`)
      for (const l of [s.dialogue, ...(s.dialogueLines || []).map((x) => x.text)])
        for (const f of (l || '').split(/[，。！？、；…,.!?;~～\s]+/)) if ([...f].length >= 4) assert.ok(!s.prompt.includes(f), `${s.id} dialogue leak ${f}`)
      if (s.dialogue) assert.ok(s.beatSegments!.some((x) => x.lipSync), `${s.id} speaker gets lip-sync segment`)
      else assert.ok(!s.beatSegments!.some((x) => x.lipSync), `${s.id} listener has no lip-sync`)
    }
  })
}

console.log(`\n${pass} crosscut-split tests passed`)
