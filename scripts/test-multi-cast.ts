/** npx tsx scripts/test-multi-cast.ts — multi-character fields (multiCast.ts) + locationKey fallback / placeKey conflicts */
import assert from 'node:assert/strict'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { applyMultiCast } from '../src/lib/multiCast'
import { assignSceneGroups, locationKeyOf, placeKeyConflicts } from '../src/lib/sceneGroup'

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

t('locationKey: unknown placeKey falls back to location text; distinct unknown places do not merge', () => {
  assert.equal(locationKeyOf({ placeKey: 'room', sceneId: 'room_day', location: '客厅' } as never), 'room')
  assert.equal(locationKeyOf({ placeKey: 'unknown', sceneId: 'unknown_dusk', location: '巷口' } as never), 'loc:巷口')
  assert.equal(locationKeyOf({ placeKey: 'unknown', sceneId: 'unknown_dusk' } as never), 'unknown_dusk')
  const e = pack([SH({ id: '1', placeKey: 'unknown', location: '巷口' }), SH({ id: '2', placeKey: 'unknown', location: '车内' })])
  assert.notEqual(e.shots[0].sceneGroup, e.shots[1].sceneGroup)
})

t('placeKeyConflicts: one placeKey over several location texts is reported', () => {
  const c = placeKeyConflicts([SH({ placeKey: 'villa', location: '玄关' }), SH({ placeKey: 'villa', location: '书房' }), SH({ placeKey: 'room', location: '客厅' })])
  assert.deepEqual(c, [{ placeKey: 'villa', locations: ['玄关', '书房'] }])
})

console.log(`\n${pass} passed`)
