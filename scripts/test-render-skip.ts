import assert from 'node:assert/strict'
import { applyRenderSkip } from '../src/lib/renderSkip'
const sh = (id: string, o: any = {}) => ({ id, episode: 1, sceneGroup: 'g1', locationKey: 'L', timeBand: 'day', angleKey: 'a', castDialogue: [{ onScreen: true }], ...o })
let n = 0
const t = (name: string, f: () => void) => { f(); n++ }
t('off-screen-voice reaction and empty frames render and stay carry sources', () => {
  const r = applyRenderSkip({ shots: [sh('1'), sh('2', { castDialogue: [{ onScreen: false }], carryFromShotId: '1', carryFromPrev: true }), sh('3', { carryFromShotId: '2', carryFromPrev: true }), sh('4', { cast: [], castDialogue: [], framing: 'empty', carryFromShotId: '3' }), sh('5', { carryFromShotId: '4' })] } as any)
  const s = r.exp.shots as any[]
  assert.ok(s.every((x) => x.render === true && x.renderSkip === null))
  assert.equal(s[2].carryFromShotId, '2'); assert.equal(s[4].carryFromShotId, '4'); assert.equal(r.rewired.length, 0)
})
t('held source rewired to nearest rendered shot', () => {
  const r = applyRenderSkip({ shots: [sh('1'), sh('2', { hold: { reason: ['x'] }, carryFromShotId: '1' }), sh('3', { carryFromShotId: '2', carryFromPrev: true })] } as any)
  const s = r.exp.shots as any[]
  assert.equal(s[1].render, false); assert.equal(s[2].carryFromShotId, '1'); assert.equal(s[2].carryFromPrev, false)
  assert.deepEqual(r.rewired.map((x) => [x.id, x.from, x.to]), [['3', '2', '1']])
})
t('held source with no rendered peer → carry dropped, establishing', () => {
  const r = applyRenderSkip({ shots: [sh('1', { timeBand: 'night' }), sh('2', { hold: { reason: ['x'] } }), sh('3', { carryFromPrev: true })] } as any)
  const s = r.exp.shots as any[]
  assert.equal(s[1].renderSkip.reason, 'hold'); assert.equal(s[2].carryFromPrev, false); assert.equal(s[2].establishing, true)
})
t('explicit render:false honored; other episode never used', () => {
  const r = applyRenderSkip({ shots: [sh('0', { episode: 0 }), sh('1', { render: false }), sh('2', { carryFromShotId: '1' })] } as any)
  const s = r.exp.shots as any[]
  assert.equal(s[1].renderSkip.reason, 'explicit'); assert.equal(s[2].carryFromShotId, null); assert.equal(s[2].establishing, true)
})
t('rendered sources untouched', () => {
  const r = applyRenderSkip({ shots: [sh('1'), sh('2', { carryFromShotId: '1', carryFromPrev: true })] } as any)
  assert.equal(r.rewired.length, 0); assert.equal((r.exp.shots as any[])[1].carryFromShotId, '1')
})
console.log(`${n} render-skip tests passed`)
