/** npx tsx scripts/test-realm.ts — scene realm (reality / dream / memory): inference, look-variant switches at a realm boundary (no island / hold), carry + state-continuity boundary, generator schema / auto-fix, export pass-through */
import assert from 'node:assert/strict'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { assignRealms, characterRealm, lookSwitch, normRealm, realmOfText, variantKeys } from '../src/lib/realm'
import { applyCastConsistency } from '../src/lib/castConsistency'
import { postProcessExport } from '../src/lib/segmentPost'
import { applyRenderHold } from '../src/lib/renderHold'
import { assignSceneGroups, breakCarries } from '../src/lib/sceneGroup'
import { applyStateContinuity } from '../src/lib/blocking'
import { STORYBOARD_SYSTEM } from '../src/lib/llm'
import { autoFixStoryboard, complianceBlock, validateStoryboard, type RawShotLike } from '../src/lib/generatorRules'
import type { Project } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => { fn(); pass++; console.log(`✓ ${name}`) }
const SH = (p: Partial<VideoPipelineShot> & Record<string, unknown>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['r'], prompt: '主体：甲。\n光线：自然光。', visual: '', action: '', durationSec: 5, dialogue: '', speaker: null, speakerName: null,
  voiceOnly: [], sfx: [], overlayText: [], camera: '固定机位', size: '中景', emotion: '', refImage: null, timeOfDay: '夜', placeKey: 'ward', sceneId: 'ward_night', timeBand: 'night', location: '病房', dialogueLines: [], ...p,
} as VideoPipelineShot)
// two look variants of one person (generic names), one other person
const CH = [
  { id: 'd', name: '甲（梦中）', baseName: '甲', characterKey: 'k', gender: 'female', age: '18岁', refImage: null },
  { id: 'r', name: '甲（现实）', baseName: '甲', characterKey: 'k', gender: 'female', age: '18岁', refImage: null },
  { id: 'o', name: '乙', gender: 'male', age: '40岁', refImage: null },
]
const pack = (shots: VideoPipelineShot[], chars = CH) => ({ characters: chars, shots, warnings: [] }) as unknown as VideoPipelineExport
const villa = { placeKey: 'villa', sceneId: 'villa_day', timeBand: 'day', timeOfDay: '白天', location: '别墅客厅' }
// reality ward → dream villa (variant d, text names the dream variant) → reality ward
const story = () => [
  SH({ id: 'a1', characterIds: ['r', 'o'] }), SH({ id: 'a2', characterIds: ['r', 'o'], carryFromPrev: true }),
  SH({ id: 'b1', characterIds: ['d'], visual: '甲（梦中）站在客厅', ...villa }), SH({ id: 'b2', characterIds: ['d'], visual: '甲（梦中）转身', ...villa, carryFromPrev: true }),
  SH({ id: 'c1', characterIds: ['r', 'o'], carryFromPrev: true }), SH({ id: 'c2', characterIds: ['r'], carryFromPrev: true }),
]

t('realm words: normRealm / realmOfText / characterRealm (waking up from a dream is reality)', () => {
  assert.deepEqual(['dream', '梦境', 'memory', '闪回', 'reality', '现实', 'x', ''].map(normRealm), ['dream', 'dream', 'memory', 'memory', 'reality', 'reality', null, null])
  assert.equal(realmOfText('她在梦里回到别墅'), 'dream')
  assert.equal(realmOfText('闪回：多年前的校园'), 'memory')
  assert.equal(realmOfText('她从噩梦中惊醒'), null)
  assert.equal(realmOfText('病房里很安静'), null)
  assert.deepEqual(CH.map((c) => characterRealm(c as never)), ['dream', 'reality', null])
  assert.equal(characterRealm({ id: 'm', name: '丙', wardrobeState: '回忆·少年' } as never), 'memory')
})

t('assignRealms: generator value > location words > shot-text / variant vote > reality; one realm per scene run', () => {
  const r = assignRealms(pack([...story(), SH({ id: 'e1', location: '梦境走廊', placeKey: 'hall', sceneId: 'hall', characterIds: ['o'] }), SH({ id: 'f1', placeKey: 'yard', sceneId: 'yard', location: '院子', characterIds: ['o'], realm: 'memory' }), SH({ id: 'f2', placeKey: 'yard', sceneId: 'yard', location: '院子', characterIds: ['o'] })]))
  assert.deepEqual(r.exp.shots.map((s: any) => s.realm), ['reality', 'reality', 'dream', 'dream', 'reality', 'reality', 'dream', 'memory', 'memory'])
  assert.deepEqual(r.report.scenes.map((x) => x.source), ['default', 'text', 'default', 'location', 'generator'])
  assert.deepEqual(r.report.characters, { d: 'dream', r: 'reality' })
  // idempotent: inferred realms are re-inferred, generator realms stay explicit
  const again = assignRealms(r.exp)
  assert.deepEqual(again.exp.shots.map((s: any) => s.realm), r.exp.shots.map((s: any) => s.realm))
  assert.deepEqual(again.report.scenes.map((x) => x.source), r.report.scenes.map((x) => x.source))
  // realm → look variant: a reality-tagged variant cast in a dream scene → mismatch (expects the dream variant)
  const m = assignRealms(pack([SH({ id: 'g1', characterIds: ['r'], ...villa, location: '梦境别墅' })]))
  assert.deepEqual(m.report.variantMismatches, [{ shotId: 'g1', realm: 'dream', cast: 'r', expected: 'd' }])
})

t('cast consistency: a look switch at a realm boundary is not an island (no warning, no hold); same-realm island still warns', () => {
  const real = applyCastConsistency(assignRealms(pack(story())).exp)
  assert.deepEqual(real.warnings, [])
  assert.deepEqual(real.realmSwitches.map((x) => `${x.shotId}:${x.realm}`), ['b1:dream', 'b2:dream'])
  assert.ok(!applyRenderHold(real.exp).exp.shots.some((s: any) => s.hold), 'no render hold')
  // a stale island warning from an earlier realm-unaware pass is dropped; others are kept
  const old = { ...assignRealms(pack(story())).exp, warnings: [{ episode: 1, shotId: 'b1', code: 'cast_consistency', message: 'continuity_island: old' }, { episode: 1, shotId: 'a1', code: 'cast_consistency', message: 'continuity_island: other' }] } as never
  assert.deepEqual(applyCastConsistency(old).exp.warnings.map((w) => w.shotId), ['a1'])
  // the export post-process (realm-unaware input) adds no island warning either
  const pp = postProcessExport({ ...pack(story()), project: { style: '' } } as never)
  assert.ok(!pp.warnings.some((w) => w.code === 'cast_consistency'))
  // untagged variants + no realm words (same realm everywhere) → the island is still flagged
  const plain = story().map((s) => ({ ...s, visual: '' }))
  const UN = CH.map((c) => (c.characterKey ? { ...c, name: c.id === 'd' ? '甲（长发）' : '甲（短发）' } : c))
  const w = applyCastConsistency(assignRealms(pack(plain, UN as never)).exp)
  assert.ok(w.warnings.some((x) => x.reason === 'continuity_island'))
})

t('carry breaks at a realm change or a look-variant switch; state continuity never crosses the boundary', () => {
  const e = breakCarries(assignSceneGroups(assignRealms(pack(story())).exp))
  const r = e.breaks.map((b) => `${b.id}:${b.reason.split(' ')[0]}`)
  assert.ok(r.includes('c1:地点'))
  // same place + band but realm changes / look switches
  const same = [SH({ id: 'p1', characterIds: ['r'], realm: 'reality' }), SH({ id: 'p2', characterIds: ['r'], realm: 'dream', carryFromPrev: true }), SH({ id: 'p3', characterIds: ['d'], realm: 'dream', carryFromPrev: true }), SH({ id: 'p4', characterIds: ['d'], realm: 'dream', carryFromPrev: true })]
  const b = breakCarries(assignSceneGroups(assignRealms(pack(same)).exp))
  assert.deepEqual(b.breaks.map((x) => `${x.id}:${x.reason}`), ['p2:场景层 reality → dream', 'p3:造型切换 r → d'])
  assert.deepEqual(b.exp.shots.map((s) => [s.carryFromPrev, s.establishing]), [[undefined, true], [false, true], [false, true], [true, false]])
  assert.equal(lookSwitch(same[0], same[2], variantKeys(CH as never)), 'r → d')
  // state continuity: a carry across realms (if one survives) is not checked
  const st = (pose: string) => ({ o: { pos: 'left', facing: 'right', pose, gaze: 'front', hands: 'empty' } })
  const x = [SH({ id: 'q1', characterIds: ['o'], realm: 'reality', endState: st('sit') }), SH({ id: 'q2', characterIds: ['o'], realm: 'dream', carryFromPrev: true, startState: st('stand'), endState: st('stand') })]
  const c = applyStateContinuity(pack(x) as never)
  assert.equal(c.report.carriesChecked, 0)
  assert.deepEqual(c.report.stateJumps, [])
  const y = x.map((s) => ({ ...s, realm: 'reality' }))
  assert.equal(applyStateContinuity(pack(y) as never).report.stateJumps.length, 1, 'same realm is still checked')
})

t('generator: schema + compliance carry realm; auto-fix fills / normalises realm, realm change = establishing, no carry; invalid realm flagged', () => {
  assert.ok(STORYBOARD_SYSTEM.includes('realm') && /reality.*dream.*memory/.test(STORYBOARD_SYSTEM))
  assert.ok(complianceBlock({ characters: [{ name: '甲' }] } as never).includes('realm'))
  const ctx = { characters: [{ name: '甲' }], locations: ['病房'] }
  const base = (p: Partial<RawShotLike>): RawShotLike => ({ shotNo: 1, durationSec: 5, visual: '甲坐着', action: '甲抬头', dialogue: '', characters: ['甲'], location: '病房', timeOfDay: '夜', carryFromPrev: true, ...p } as RawShotLike)
  const f = autoFixStoryboard([base({ realm: '现实' }), base({}), base({ realm: 'dream' }), base({ visual: '梦境里甲奔跑', location: '花园' })], ctx)
  assert.deepEqual(f.map((s) => s.realm), ['reality', 'reality', 'dream', 'dream'])
  assert.deepEqual(f.map((s) => [s.establishing, s.carryFromPrev]), [[true, false], [false, true], [true, false], [true, false]])
  assert.ok(!validateStoryboard(f, ctx).some((x) => x.rule === 'realm'))
  assert.ok(validateStoryboard([base({ realm: '平行宇宙' })], ctx).some((x) => x.rule === 'realm'))
  assert.ok(validateStoryboard([base({ realm: 'reality', carryFromPrev: false }), base({ realm: 'dream', carryFromPrev: true })], ctx).some((x) => x.rule === 'realm' && x.detail.includes('carry')))
})

t('export: generator realm passes through to the pack shot', () => {
  const p = {
    id: 'p', title: 'T', genre: '', platform: '', episodeCount: 1, secondsPerEp: 75, style: '', logline: '', settingFacts: [], locations: ['客厅'],
    characters: [{ id: 'c1', name: '甲', role: '主角', visualLock: '', costume: '', signatureProp: '' }], outline: [], scripts: {}, selectedEpisode: 1, updatedAt: '',
    storyboards: { 1: [{ id: 's1-1', shotNo: 1, size: '中景', durationSec: 5, visual: '甲', action: '甲抬头', dialogue: '', camera: '固定', emotion: '', seedancePrompt: '甲抬头', characterIds: ['c1'], location: '客厅', timeOfDay: '白天', realm: 'memory' }] },
  } as unknown as Project
  assert.equal((buildVideoPipelineExport(p).shots[0] as any).realm, 'memory')
})

console.log(`\n${pass} passed`)
