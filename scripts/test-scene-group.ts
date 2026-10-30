/** npx tsx scripts/test-scene-group.ts — sceneGroup / locationKey, silent-insert regroup, cross-cut budget */
import assert from 'node:assert/strict'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { applyCrosscutGate, assignSceneGroups, CROSSCUT_BUDGET_NOTE, DEFAULT_CROSSCUT_BUDGET, locationStats, parseCrosscutBudget, regroupSplitChildren } from '../src/lib/sceneGroup'
import { assignAngleKeys, validateCarryChain } from '../src/lib/crosscutSplit'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log(`✓ ${name}`)
}
const V = { placeKey: 'house', sceneId: 'house_night', timeBand: 'night' }
const W = { placeKey: 'window', sceneId: 'window_night', timeBand: 'night' }
const D = { placeKey: 'house', sceneId: 'house_day', timeBand: 'day' }
const line = (speaker: string, text: string) => [{ speaker, speakerName: speaker, text, startSec: 1, endSec: 3, voice: 'v' }]
const SH = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['c1'], prompt: 'p', visual: '', action: '', durationSec: 5, dialogue: '', speaker: null, speakerName: null,
  voiceOnly: [], sfx: [], overlayText: [], camera: '', size: '', emotion: '', refImage: null, timeOfDay: '夜', ...p,
} as VideoPipelineShot)
const pack = (shots: VideoPipelineShot[]) => ({ characters: [], shots } as unknown as VideoPipelineExport)
const spoken = (id: string, who: string, loc: object, extra: Partial<VideoPipelineShot> = {}) => SH({ id, characterIds: [who], ...loc, dialogue: id, speaker: who, dialogueLines: line(who, id) as never, ...extra })

// shape of the ep1 opener: split segment 1 = A(silent, house) B(silent, window) A(line, house), then window line
const opener = () => pack([
  SH({ id: 's1a', splitFrom: 's1', ...V }),
  SH({ id: 's1b', splitFrom: 's1', characterIds: ['c3'], ...W, durationSec: 3 }),
  spoken('s1c', 'c1', V, { splitFrom: 's1' }),
  spoken('s4', 'c3', W),
  SH({ id: 's6', characterIds: [], ...V }),
])

t('silent split insert moves to the side of its own location; lines keep their order', () => {
  const r = regroupSplitChildren(opener())
  assert.deepEqual(r.exp.shots.map((s) => s.id), ['s1a', 's1c', 's1b', 's4', 's6'])
  assert.equal(r.moves.length, 1)
  assert.equal(r.moves[0].id, 's1b')
  const lines = (e: VideoPipelineExport) => e.shots.flatMap((s) => (s.dialogueLines || []).map((l) => l.text))
  assert.deepEqual(lines(r.exp), lines(opener()))
})

t('children with lines never move, even if that would save a switch', () => {
  const e = pack([spoken('a1', 'c1', V, { splitFrom: 'a' }), spoken('a2', 'c3', W, { splitFrom: 'a' }), spoken('a3', 'c1', V, { splitFrom: 'a' })])
  const r = regroupSplitChildren(e)
  assert.equal(r.moves.length, 0)
  assert.deepEqual(r.exp.shots.map((s) => s.id), ['a1', 'a2', 'a3'])
})

t('unsplit shots (script order) are never reordered', () => {
  const e = pack([SH({ id: 'p', ...V }), SH({ id: 'q', ...W }), SH({ id: 'r', ...V })])
  assert.equal(regroupSplitChildren(e).moves.length, 0)
})

t('regroup does not cross a time-band boundary to count neighbours', () => {
  // last child is silent at window; next shot is a new day scene → no move just to touch it
  const e = pack([spoken('b1', 'c1', V, { splitFrom: 'b' }), SH({ id: 'b2', splitFrom: 'b', characterIds: ['c3'], ...W }), SH({ id: 'n', ...D })])
  assert.equal(regroupSplitChildren(e).moves.length, 0)
})

t('carry chains stay valid after regroup + angle keys', () => {
  const e = assignAngleKeys(regroupSplitChildren(opener()).exp)
  assert.deepEqual(validateCarryChain(e.shots), [])
  const c = e.shots.find((s) => s.id === 's1c')!
  assert.equal(c.carryFromShotId, 's1a')
  assert.equal(c.carryFromPrev, true)
})

t('sceneGroup: linked cross-cut places share a group; time band change starts a new one; locationKey = placeKey', () => {
  const e = assignSceneGroups(pack([...opener().shots, SH({ id: 's15', ...D }), SH({ id: 'e2', episode: 2, ...V })]))
  const g = Object.fromEntries(e.shots.map((s) => [s.id, s.sceneGroup]))
  assert.equal(g.s1a, 'ep1_g1')
  assert.equal(g.s4, 'ep1_g1')
  assert.equal(g.s6, 'ep1_g1')
  assert.equal(g.s15, 'ep1_g2')
  assert.equal(g.e2, 'ep2_g1')
  assert.equal(e.shots[3].locationKey, 'window')
})

t('unlinked new place in the same band is a new group (not budgeted)', () => {
  const e = assignSceneGroups(pack([SH({ id: 'a', ...V }), SH({ id: 'b', placeKey: 'school', sceneId: 'school_night', timeBand: 'night' })]))
  assert.notEqual(e.shots[0].sceneGroup, e.shots[1].sceneGroup)
  const st = locationStats(e)
  assert.equal(st.episodes[0].locationChanges, 1)
  assert.equal(st.episodes[0].inGroupChanges, 0)
})

t('stats: switches, longest run, alternation, source classification, turn-driven, budget', () => {
  const before = locationStats(assignSceneGroups(opener()))
  const after = locationStats(assignSceneGroups(regroupSplitChildren(opener()).exp))
  assert.equal(before.episodes[0].locationChanges, 4)
  assert.equal(after.episodes[0].locationChanges, 2)
  assert.equal(after.episodes[0].longestRun, 2)
  assert.equal(before.groups[0].longestAlternation, 5)
  const g = before.groups[0]
  assert.equal(g.splitInternal, 2)
  assert.equal(g.splitBoundary, 1)
  assert.equal(g.source, 1)
  assert.equal(g.allowed, 2)
  assert.equal(g.exceeded, true)
  assert.equal(after.groups[0].exceeded, false)
  const tg = locationStats(assignSceneGroups(pack([spoken('x', 'c1', V, { splitFrom: 'x0' }), spoken('y', 'c3', W, { splitFrom: 'x0' })]))).groups[0]
  assert.equal(tg.turnDriven, 1)
})

t('budget parsing: defaults, overrides, bad input', () => {
  assert.deepEqual(parseCrosscutBudget(undefined), DEFAULT_CROSSCUT_BUDGET)
  assert.deepEqual(parseCrosscutBudget('maxSwitchesPer=2,perShots=4,gate=hold'), { ...DEFAULT_CROSSCUT_BUDGET, maxSwitchesPer: 2, perShots: 4, gate: 'hold' })
  assert.throws(() => parseCrosscutBudget('gate=maybe'))
  assert.throws(() => parseCrosscutBudget('perShots=0'))
  assert.throws(() => parseCrosscutBudget('foo=1'))
})

t('gate=hold holds over-budget groups only and keeps existing reasons; warn leaves shots alone', () => {
  const e0 = assignSceneGroups(pack([...opener().shots.map((s) => (s.id === 's4' ? { ...s, hold: { reason: ['old'] } } : s)), SH({ id: 'z', ...D })]))
  const st = locationStats(e0)
  const b = parseCrosscutBudget('gate=hold')
  const e = applyCrosscutGate(e0, st.groups, b)
  assert.deepEqual(e.shots.find((s) => s.id === 's4')!.hold!.reason[0], 'old')
  assert.ok(e.shots.find((s) => s.id === 's4')!.hold!.reason[1].startsWith(CROSSCUT_BUDGET_NOTE))
  assert.ok(e.shots.find((s) => s.id === 's1a')!.hold)
  assert.equal(e.shots.find((s) => s.id === 'z')!.hold, undefined)
  assert.equal(applyCrosscutGate(e0, st.groups, DEFAULT_CROSSCUT_BUDGET), e0)
})

console.log(`\n${pass} scene-group tests passed`)
