/** npx tsx scripts/test-multi-cast.ts — multi-character fields (multiCast.ts) + locationKey fallback / placeKey conflicts */
import assert from 'node:assert/strict'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { applyMultiCast } from '../src/lib/multiCast'
import { assignSceneGroups, breakCarries, locationKeyOf, placeKeyConflicts } from '../src/lib/sceneGroup'
import { locationNamer, normalizeLocation } from '../src/lib/locationNorm'
import { correctScenes } from '../src/lib/crosscutSplit'
import { unclearPronouns } from '../src/lib/shotAnnotate'

let pass = 0
const t = (name: string, fn: () => void) => { fn(); pass++; console.log(`✓ ${name}`) }
const SH = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['a'], prompt: 'p', visual: '', action: '', durationSec: 6, dialogue: '', speaker: null, speakerName: null,
  voiceOnly: [], sfx: [], overlayText: [], camera: '', size: '', emotion: '', refImage: null, timeOfDay: '日', placeKey: 'room', sceneId: 'room_day', timeBand: 'day', location: '客厅', ...p,
} as VideoPipelineShot)
const line = (speaker: string | null, text = 't') => [{ speaker, speakerName: speaker, text, startSec: 1, endSec: 4, voice: 'v' }] as never
const pack = (shots: VideoPipelineShot[]) => assignSceneGroups({ characters: [{ id: 'a', name: 'A', refImage: 'a.png' }, { id: 'b', name: 'B', refImage: null }], shots } as unknown as VideoPipelineExport)

t('two-shot: cast, castCountLock, screenPos locked per sceneGroup, listener mouth closed', () => {
  const { exp, report } = applyMultiCast(pack([
    SH({ id: '1', characterIds: ['a', 'b'], speaker: 'a', dialogueLines: line('a') }),
    SH({ id: '2', characterIds: ['b', 'a'], speaker: 'b', dialogueLines: line('b') }),
    SH({ id: '3', characterIds: ['b'] }),
  ]))
  const [s1, s2, s3] = exp.shots
  assert.equal(s1.castCountLock, 2)
  assert.deepEqual(s1.cast!.map((c) => [c.id, c.screenPos]), [['a', 'left'], ['b', 'right']])
  assert.deepEqual(s2.cast!.map((c) => [c.id, c.screenPos]), [['b', 'right'], ['a', 'left']])
  assert.equal(s1.cast![0].refImage, 'a.png')
  assert.deepEqual(s1.castDialogue, [{ speaker: 'S1', characterId: 'a', t: [1, 4], lang: 'Chinese', text: 't', onScreen: true, listenerMouth: 'closed' }])
  assert.equal(s2.castDialogue![0].speaker, 'S1')
  assert.equal(s1.maxSpeakersPerSegment, 1)
  assert.equal(s1.speakerFraming, 'two_shot_single_speaker')
  assert.equal(s3.cast![0].screenPos, 'center')
  assert.equal(s3.speakerFraming, 'single')
  // one establishing frame shared by the whole group
  assert.ok(s1.sceneKeyframe && s1.sceneKeyframe === s2.sceneKeyframe && s2.sceneKeyframe === s3.sceneKeyframe)
  assert.equal(report.multiCharacterShots, 2)
  assert.equal(report.multiCharacterWithDialogue, 2)
  assert.deepEqual(report.overSpeakerLimit, [])
})

t('off-screen speaker: speaker null, onScreen false, listener closed; solo group has no keyframe', () => {
  const { exp, report } = applyMultiCast(pack([SH({ id: '1', characterIds: ['a'], speaker: 'c9', voiceOnly: ['c9'], dialogueLines: line('c9') })]))
  assert.deepEqual(exp.shots[0].castDialogue![0], { speaker: null, characterId: 'c9', t: [1, 4], lang: 'Chinese', text: 't', onScreen: false, listenerMouth: 'closed' })
  assert.equal(exp.shots[0].sceneKeyframe, null)
  assert.equal(report.offscreenLines, 1)
})

t('legacy fields untouched (dialogue string, order, durations)', () => {
  const src = pack([SH({ id: '1', characterIds: ['a', 'b'], dialogue: 'A：hi', dialogueLines: line('a') }), SH({ id: '2' })])
  const { exp } = applyMultiCast(src)
  assert.equal(exp.shots[0].dialogue, 'A：hi')
  assert.deepEqual(exp.shots.map((s) => [s.id, s.durationSec]), src.shots.map((s) => [s.id, s.durationSec]))
})

t('locationKey: normalized location text wins over placeKey; placeKey / sceneId only without text', () => {
  assert.equal(locationKeyOf({ placeKey: 'room', sceneId: 'room_day', location: '客厅' } as never), '客厅')
  assert.equal(locationKeyOf({ placeKey: 'unknown', sceneId: 'unknown_dusk', location: '巷口' } as never), '巷口')
  assert.equal(locationKeyOf({ placeKey: 'room', sceneId: 'room_day' } as never), 'room')
  assert.equal(locationKeyOf({ placeKey: 'unknown', sceneId: 'unknown_dusk' } as never), 'unknown_dusk')
  const e = pack([SH({ id: '1', placeKey: 'unknown', location: '巷口' }), SH({ id: '2', placeKey: 'unknown', location: '车内' })])
  assert.notEqual(e.shots[0].sceneGroup, e.shots[1].sceneGroup)
  // one classifier bucket, two places → two groups; two buckets, one place → one group
  const f = pack([SH({ id: '1', placeKey: 'p', location: '甲地' }), SH({ id: '2', placeKey: 'p', location: '乙地' }), SH({ id: '3', placeKey: 'q', location: '乙地' })])
  assert.deepEqual(f.shots.map((s) => s.sceneGroup), ['ep1_g1', 'ep1_g2', 'ep1_g2'])
})

t('normalizeLocation: generic owner / building / institution / floor / state / access rules merge variants', () => {
  const nm = locationNamer([{ name: '甲乙（梦中）', baseName: '甲乙' }, { name: '丙丁戊' }])
  const n = (x: string) => normalizeLocation(x, nm)
  assert.equal(n('甲家别墅客厅'), '客厅')
  assert.equal(n('甲家客厅'), '客厅')
  assert.equal(n('甲乙卧室'), '卧室')
  assert.equal(n('丙丁戊住处巷口'), '巷口')
  assert.equal(n('老城区巷口'), '巷口')
  assert.equal(n('市一院单人病房'), '病房')
  assert.equal(n('现实病房'), '病房')
  assert.equal(n('医院走廊'), '医院走廊')
  assert.equal(n('二楼走廊'), '走廊')
  assert.equal(n('甲家别墅地下车库入口'), '地下车库')
  assert.equal(n('客厅·夜'), '客厅')
  assert.equal(n('楼顶'), '楼顶')
})

t('correctScenes: a text-explicit correction applies to every shot of the same normalized location + band', () => {
  const base = { timeBand: 'day', characterIds: ['a'] }
  const e = { characters: [{ id: 'a', name: 'A' }], shots: [
    SH({ id: 'r', placeKey: 'room', sceneId: 'room_day', sceneLabel: '饭厅·日', location: '饭厅', ...base }),
    SH({ id: 'x', placeKey: 'hall', sceneId: 'hall_day', sceneLabel: '走道·日', location: '饭厅', visual: '饭厅里', ...base }),
    SH({ id: 'y', placeKey: 'hall', sceneId: 'hall_day', sceneLabel: '走道·日', location: '饭厅', ...base }),
    SH({ id: 'z', placeKey: 'hall', sceneId: 'hall_day', sceneLabel: '走道·日', location: '走道', ...base }),
    SH({ id: 'w', placeKey: 'hall', sceneId: 'hall_day', sceneLabel: '走道·日', location: '饭厅', ...base }),
  ] } as unknown as VideoPipelineExport
  const r = correctScenes(e)
  const by = new Map(r.exp.shots.map((s) => [s.id, s.sceneId]))
  assert.equal(by.get('x'), 'room_day')
  assert.equal(by.get('y'), 'room_day')
  assert.ok(r.corrections.some((c) => c.id === 'y' && c.reason.includes('同一场景')))
  assert.equal(by.get('z'), 'hall_day')
  // another (non-contiguous) scene at that place keeps its own label
  assert.equal(by.get('w'), 'hall_day')
})

t('pronouns: 2-person timeline 他/她 → screen-position descriptor (gender when given, else actor/other); hold cleared', () => {
  const chars = [{ id: 'a', name: 'A', gender: 'female', age: '18岁' }, { id: 'b', name: 'B' }]
  const prompt = '竖屏\n0–3秒，她抬眼看他，他别过脸；\n3–6秒，他把本子递给她。'
  const e = assignSceneGroups({ characters: chars, shots: [SH({ id: '1', characterIds: ['a', 'b'], prompt })] } as unknown as VideoPipelineExport)
  const { exp, report } = applyMultiCast(e)
  const p = exp.shots[0].prompt
  assert.ok(!/[他她](?![们人])/.test(p.split('\n').slice(1).join('')), p)
  assert.ok(p.includes('0–3秒，画面左侧的少女抬眼看画面右侧的人，画面右侧的人别过脸'), p)
  assert.ok(p.includes('3–6秒，画面右侧的人把本子递给画面左侧的少女'), p)
  assert.equal(report.pronounsResolved, 5)
  assert.equal(unclearPronouns(p).length, 0)
  assert.ok(unclearPronouns(prompt).length > 0)
  // no gender at all: first pronoun of a clause = actor (first cast), later one = the other
  const g = applyMultiCast(assignSceneGroups({ characters: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], shots: [SH({ id: '1', characterIds: ['a', 'b'], prompt: 'x\n0–3秒，他看着她。' })] } as unknown as VideoPipelineExport))
  assert.ok(g.exp.shots[0].prompt.endsWith('0–3秒，画面左侧的人看着画面右侧的人。'), g.exp.shots[0].prompt)
  // no gender field: inferred from character data (FEMALE_RE / male words), as the beat builder does
  const h = applyMultiCast(assignSceneGroups({ characters: [{ id: 'a', name: 'A', role: '女主', age: '18岁' }, { id: 'b', name: 'B', visualLock: '清瘦少年', age: '19岁' }], shots: [SH({ id: '1', characterIds: ['a', 'b'], prompt: 'x\n0–3秒，她看着他，他只是眼皮一动。' })] } as unknown as VideoPipelineExport))
  assert.ok(h.exp.shots[0].prompt.endsWith('0–3秒，画面左侧的少女看着画面右侧的少年，画面右侧的少年只是眼皮一动。'), h.exp.shots[0].prompt)
  // solo shots untouched
  const s = applyMultiCast(assignSceneGroups({ characters: chars, shots: [SH({ id: '1', characterIds: ['a'], prompt: 'x\n0–3秒，她笑。' })] } as unknown as VideoPipelineExport))
  assert.ok(s.exp.shots[0].prompt.endsWith('她笑。'))
})

t('breakCarries: carry across a location / time-band change is broken; establishing + sceneKeyframe set', () => {
  const e = assignSceneGroups(pack([
    SH({ id: '1', location: '客厅' }),
    SH({ id: '2', location: '客厅·日', carryFromPrev: true }),
    SH({ id: '3', location: '书房', carryFromPrev: true }),
    SH({ id: '4', location: '书房', timeBand: 'night', carryFromPrev: true }),
    SH({ id: '5', location: '书房', timeBand: 'night', carryFromShotId: '1' } as never),
  ]))
  const { exp, breaks } = breakCarries(e)
  assert.deepEqual(exp.shots.map((s) => s.carryFromPrev ?? false), [false, true, false, false, false])
  assert.equal(exp.shots[4].carryFromShotId, null)
  assert.deepEqual(breaks.map((b) => b.id), ['3', '4', '5'])
  assert.deepEqual(exp.shots.map((s) => s.establishing), [true, false, true, true, true])
  assert.ok(exp.shots.every((s) => s.sceneKeyframe))
})

t('placeKeyConflicts: one placeKey over several location texts is reported', () => {
  const c = placeKeyConflicts([SH({ placeKey: 'villa', location: '玄关' }), SH({ placeKey: 'villa', location: '书房' }), SH({ placeKey: 'room', location: '客厅' })])
  assert.deepEqual(c, [{ placeKey: 'villa', locations: ['玄关', '书房'] }])
})

console.log(`\n${pass} passed`)
