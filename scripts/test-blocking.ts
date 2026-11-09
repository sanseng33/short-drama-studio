/** npx tsx scripts/test-blocking.ts — research P0-1/2/3: start / end states + carry continuity, scene blocking + camera side / axis, scene lighting, voice modes (blocking.ts), generator schema / self-check, export pass-through */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { applyMultiCast } from '../src/lib/multiCast'
import { assignSceneGroups } from '../src/lib/sceneGroup'
import { applyRenderSkip } from '../src/lib/renderSkip'
import { promptTextRisks } from '../src/lib/emotionVisual'
import { STORYBOARD_SYSTEM } from '../src/lib/llm'
import { autoFixStoryboard, complianceBlock, validateStoryboard, type RawShotLike } from '../src/lib/generatorRules'
import {
  applyBlocking, applyStateContinuity, handsOf, INNER_CUE, normCameraSide, normFacing, normPose, normSide, normVoiceMode, parseAxisGate, parseStateGate, poseOf, STATE_STAY,
} from '../src/lib/blocking'
import type { Project } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => { fn(); pass++; console.log(`✓ ${name}`) }
const PROMPT = (lines: string[], extra = '') => ['竖屏9:16，6秒单镜。实拍画面，无字幕。白天，客厅，双人。', '主体：两人。', '时间轴（按秒变速）：', ...lines, `镜头：固定机位${extra}，不切镜。`, '光线：自然光。', '风格：真人实拍都市短剧质感。', '限制：无任何文字。'].join('\n')
const SH = (p: Partial<VideoPipelineShot> & Record<string, unknown>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['a', 'b'], prompt: PROMPT(['0–3秒，正常节奏：两人对视。', '3–6秒，随后恢复正常节奏：画面左侧的少女低头。']), visual: '', action: '', durationSec: 6, dialogue: '', speaker: null, speakerName: null,
  voiceOnly: [], sfx: [], overlayText: [], camera: '固定机位', size: '中景', emotion: '', refImage: null, timeOfDay: '白天', placeKey: 'room', sceneId: 'room_day', timeBand: 'day', location: '客厅', dialogueLines: [], ...p,
} as VideoPipelineShot)
const CHARS = [{ id: 'a', name: '甲', gender: 'female', age: '18岁', refImage: null }, { id: 'b', name: '乙', gender: 'male', age: '30岁', refImage: null }]
const pack = (shots: VideoPipelineShot[]) => applyMultiCast(assignSceneGroups({ characters: CHARS, shots } as unknown as VideoPipelineExport)).exp
const run = (shots: VideoPipelineShot[], o: { axisGate?: 'warn' | 'hold' | 'fail'; stateGate?: 'fix' | 'warn' | 'fail' } = {}) => {
  const a = applyBlocking(pack(shots), { axisGate: o.axisGate })
  const r = applyRenderSkip(a.exp)
  const b = applyStateContinuity(r.exp as never, { stateGate: o.stateGate })
  return { a, b, shots: b.exp.shots as (VideoPipelineShot & Record<string, any>)[] }
}

t('normalisers: sides / facing / pose / camera side / voice mode / gates', () => {
  assert.equal(normSide('左'), 'left'); assert.equal(normSide('right'), 'right'); assert.equal(normSide('画面中间'), 'center'); assert.equal(normSide('x'), null)
  assert.equal(normFacing('镜头'), 'front'); assert.equal(normFacing('背对'), 'away'); assert.equal(normFacing('R'), 'right')
  assert.equal(normPose('坐在床上'), '坐'); assert.equal(normPose('standing'), '站')
  assert.equal(normCameraSide('a'), 'A'); assert.equal(normCameraSide('master'), 'master'); assert.equal(normCameraSide('C'), null)
  assert.equal(normVoiceMode('内心'), 'inner'); assert.equal(normVoiceMode('offscreen'), 'offscreen'); assert.equal(normVoiceMode('onscreen'), 'onscreen')
  assert.equal(parseAxisGate(undefined), 'warn'); assert.equal(parseStateGate(undefined), 'fix')
  assert.throws(() => parseAxisGate('x')); assert.throws(() => parseStateGate('hold'))
})

t('text inference: pose transitions / static poses, hands (props only, never people)', () => {
  assert.deepEqual(poseOf('她猛地坐起'), { start: '躺', end: '坐' })
  assert.deepEqual(poseOf('他站起身'), { start: '坐', end: '站' })
  assert.deepEqual(poseOf('她坐在沙发上'), { start: '坐', end: '坐' })
  assert.deepEqual(handsOf('他握着手机', '空手'), { start: '手机', end: '手机' })
  assert.deepEqual(handsOf('她接电话', '空手'), { start: '空手', end: '手机' })
  assert.deepEqual(handsOf('他放下杯子', '杯子'), { start: '杯子', end: '空手' })
  assert.deepEqual(handsOf('他握紧拳头', '空手'), { start: '空手', end: '空手' })
  assert.deepEqual(handsOf('他握着甲的手', '空手', (o) => o.includes('甲')), { start: '空手', end: '空手' })
})

t('P0-2 blocking: positions from the locked cast, facing toward the partner, eyeline, master / A sides, pack sceneBlocking', () => {
  const { a, shots } = run([
    SH({ id: '1', size: '全景', visual: '客厅落地窗前' }),
    SH({ id: '2', characterIds: ['a'], carryFromShotId: '1' }),
    SH({ id: '3', characterIds: ['b'], carryFromShotId: '2' }),
  ])
  const bl = (a.exp.sceneBlocking as any)[shots[0].blockingScene]
  assert.deepEqual(bl.positions, { a: 'left', b: 'right' }); assert.deepEqual(bl.facing, { a: 'right', b: 'left' })
  assert.equal(bl.window, 'back')
  assert.deepEqual(shots.map((s) => s.cameraSide), ['master', 'A', 'A'])
  assert.deepEqual(shots[1].eyeline, { a: { dir: 'right', target: 'b' } })
  assert.deepEqual(shots[2].eyeline, { b: { dir: 'left', target: 'a' } })
  assert.deepEqual(a.report.axisCross, [])
})

t('P0-2 axis: A → B without a master is axisCross (warn); hold gate holds the shot; a master in between clears it', () => {
  const shots = () => [SH({ id: '1', size: '全景' }), SH({ id: '2', characterIds: ['a'], cameraSide: 'A' }), SH({ id: '3', characterIds: ['b'], cameraSide: 'B' })]
  const w = run(shots())
  assert.deepEqual(w.a.report.axisCross.map((x) => [x.prevShotId, x.shotId, x.from, x.to]), [['2', '3', 'A', 'B']])
  assert.ok(!w.shots[2].hold)
  assert.deepEqual(w.shots[2].eyeline, { b: { dir: 'right', target: 'a' } }, 'B side mirrors the eyeline')
  const h = run(shots(), { axisGate: 'hold' })
  assert.ok(h.shots[2].hold!.reason.some((r: string) => r.startsWith('越轴')))
  assert.equal(h.shots[2].render, false)
  const ok = run([SH({ id: '1', size: '全景' }), SH({ id: '2', characterIds: ['a'], cameraSide: 'A' }), SH({ id: '3', size: '全景', cameraSide: 'master' }), SH({ id: '4', characterIds: ['b'], cameraSide: 'B' })])
  assert.deepEqual(ok.a.report.axisCross, [])
})

t('P0-1 states: inferred from text, transition backfills the defaulted earlier state, carry continuity holds', () => {
  const { b, shots } = run([
    SH({ id: '1', action: '乙盯着甲' }),
    SH({ id: '2', action: '乙猛地站起', carryFromShotId: '1', prompt: PROMPT(['0–3秒，正常节奏：画面右侧的男人猛地站起。', '3–6秒，随后恢复正常节奏：画面右侧的男人看向画面左侧的少女。']) }),
  ])
  assert.equal(shots[0].startState.b.pose, '坐', 'first evidence (站起 ← 坐) backfills the shot before')
  assert.equal(shots[1].startState.b.pose, '坐'); assert.equal(shots[1].endState.b.pose, '站')
  assert.equal(b.report.carriesChecked, 1); assert.deepEqual(b.report.stateJumps, [])
})

t('P0-1 states: a transition missing from the final timeline happened before the cut (start = end pose)', () => {
  const { shots } = run([SH({ id: '1', characterIds: ['a'], visual: '甲猛地坐起，被子滑落', prompt: PROMPT(['0–6秒，正常节奏：她抓住被角。']) })])
  assert.equal(shots[0].startState.a.pose, '坐'); assert.equal(shots[0].endState.a.pose, '坐')
})

t('P0-1 carry: generator state mismatch → stateJump, fix copies the source end state; warn keeps; fail reports', () => {
  const st = (pose: string, hands = '空手') => ({ 甲: { pos: 'left', facing: 'right', pose, gaze: '乙', hands }, 乙: { pos: 'right', facing: 'left', pose: '站', gaze: '甲', hands: '空手' } })
  const shots = () => [SH({ id: '1', startState: st('站'), endState: st('坐', '杯子') }), SH({ id: '2', carryFromShotId: '1', startState: st('站'), endState: st('站') })]
  const f = run(shots())
  assert.equal(f.b.report.stateJumps.length, 1)
  assert.deepEqual(f.b.report.stateJumps[0].fields.sort(), ['hands', 'pose'])
  assert.equal(f.shots[1].startState.a.pose, '坐'); assert.equal(f.shots[1].startState.a.hands, '杯子'); assert.equal(f.shots[1].stateFixedFrom, '1')
  assert.equal(f.shots[1].startState.a.gaze, 'b', 'gaze names map to ids')
  const w = run(shots(), { stateGate: 'warn' })
  assert.equal(w.shots[1].startState.a.pose, '站'); assert.equal(w.b.failed.length, 0)
  assert.equal(run(shots(), { stateGate: 'fail' }).b.failed.length, 1)
})

t('P0-1 prompt: 站位 line before the timeline; carry source holds its last ~1 s (timeline split + beatSegments); dialogue tail gets a clause', () => {
  const { shots } = run([
    SH({ id: '1', beatSegments: [{ start: 0, end: 3, speed: '恢复常速', dialogue: false, lipSync: false }, { start: 3, end: 6, speed: '恢复常速', dialogue: false, lipSync: false }] }),
    SH({ id: '2', carryFromShotId: '1', beatSegments: [{ start: 0, end: 3, speed: '恢复常速', dialogue: false, lipSync: false }, { start: 3, end: 6, speed: '慢', dialogue: true, lipSync: true }] }),
    SH({ id: '3', carryFromShotId: '2' }),
  ])
  const L = shots[0].prompt.split('\n')
  const si = L.findIndex((l: string) => l.startsWith('站位：'))
  assert.ok(si > L.findIndex((l: string) => l.startsWith('主体：')) && si < L.findIndex((l: string) => l.startsWith('时间轴')))
  assert.ok(/画面左侧的少女.*画面右侧的男人/.test(L[si]) && /不交换位置/.test(L[si]))
  assert.ok(L.includes(`5–6秒，${STATE_STAY}：姿态和位置不动，不加新动作。`) && L.includes('3–5秒，随后恢复正常节奏：画面左侧的少女低头。'))
  assert.deepEqual(shots[0].beatSegments.map((x: any) => [x.start, x.end]), [[0, 3], [3, 5], [5, 6]])
  assert.ok(L.some((l: string) => l.startsWith('结尾：') && l.includes('结尾构图与开头一致')))
  assert.ok(/最后约1秒姿态和位置不动/.test(shots[1].prompt), 'dialogue tail is not cut, a clause is added')
  assert.ok(!/结尾：/.test(shots[2].prompt), 'not a carry source → no hold tail')
  for (const s of shots) assert.deepEqual(promptTextRisks(s.prompt), [], s.id)
})

t('P0-1 prompt: solo shot locks the person in place; camera reveal toward a window / door is trimmed; walking to the window keeps the move', () => {
  const { b, shots } = run([
    SH({ id: '1', characterIds: ['a'], visual: '卧室阳光透过纱帘，甲坐在床上', prompt: PROMPT(['0–6秒，正常节奏：她抬头。'], '，带出窗外花园景色') }),
    SH({ id: '2', characterIds: ['a'], visual: '甲走向窗边', carryFromShotId: '1' }),
  ])
  const st = shots[0].prompt.split('\n').find((l: string) => l.startsWith('站位：'))!
  assert.ok(st.includes('她坐在床上') && st.includes('留在画面中间') && st.includes('窗户在画面右侧') && st.includes('不走向窗边'), st)
  assert.ok(!shots[0].prompt.includes('带出窗外'))
  assert.deepEqual(b.report.cameraAnchorTrims, [{ shotId: '1', removed: '带出窗外花园景色' }])
  assert.ok(!shots[1].prompt.split('\n').find((l: string) => l.startsWith('站位：'))!.includes('不走向窗边'))
})

t('P0-3 lighting: one set per scene, the same 光线 line on every shot; generator hint wins; conflicts reported', () => {
  const { a, shots } = run([
    SH({ id: '1', lightingHint: { key: '左侧窗光', soft: true, temp: '暖' } }),
    SH({ id: '2', carryFromShotId: '1', lightingHint: { key: '顶灯', soft: false, temp: '冷' } }),
    SH({ id: '3', prompt: PROMPT(['0–6秒，正常节奏：冷光打在画面左侧的少女脸上。']) }),
  ])
  const lines = shots.map((s) => s.prompt.split('\n').find((l: string) => l.startsWith('光线：')))
  assert.ok(lines[0]!.includes('左侧窗光') && lines[0]!.includes('暖色调'))
  assert.equal(new Set(lines).size, 1)
  assert.equal(shots[2].lighting.key, '左侧窗光')
  assert.deepEqual(a.report.lightingConflicts.map((c) => c.shotId), ['2', '3'])
  const inf = run([SH({ id: '1', timeBand: 'night', timeOfDay: '夜', visual: '病房监护仪亮着' })])
  assert.ok(/顶部灯光.*冷色调.*夜晚/.test(inf.shots[0].prompt))
})

t('P0-3 voice modes: inner / offscreen keep every mouth closed (listener + speaker), no lip-sync segment, inner cue', () => {
  const dl = (speaker: string | null, text: string, extra = {}) => [{ speaker, speakerName: speaker, text, startSec: 2, endSec: 5, voice: 'v', ...extra }]
  const { b, shots } = run([
    SH({ id: '1', characterIds: ['a'], size: '近景', dialogueLines: dl('a', '（内心）原来如此') as never, castDialogue: undefined, beatSegments: [{ start: 0, end: 2, speed: '恢复常速', dialogue: false, lipSync: false }, { start: 2, end: 5, speed: '慢', dialogue: true, lipSync: true }, { start: 5, end: 6, speed: '恢复常速', dialogue: false, lipSync: false }], prompt: PROMPT(['0–2秒，正常节奏：她抬头。', '2–5秒，接着放慢：她眨眼；正脸朝镜头开口说一句短话，嘴部清晰可见、无遮挡。', '5–6秒，随后恢复正常节奏：她低头。']) }),
    SH({ id: '2', dialogueLines: dl('b', '走吧') as never }),
    SH({ id: '3', characterIds: ['a'], dialogueLines: dl(null, '有人吗', { voiceOnly: true }) as never }),
  ])
  assert.equal(shots[0].castDialogue[0].voiceMode, 'inner'); assert.equal(shots[0].castDialogue[0].speakerMouth, 'closed'); assert.equal(shots[0].castDialogue[0].listenerMouth, 'closed')
  assert.ok(shots[0].prompt.includes(INNER_CUE) && !shots[0].prompt.includes('开口说一句短话'))
  assert.equal(shots[0].beatSegments[1].lipSync, false)
  assert.notEqual(shots[0].framing, 'closeup_dialogue')
  assert.equal(shots[1].castDialogue[0].voiceMode, 'onscreen'); assert.equal(shots[1].castDialogue[0].speakerMouth, undefined)
  assert.equal(shots[2].castDialogue[0].voiceMode, 'offscreen'); assert.equal(shots[2].castDialogue[0].speakerMouth, 'closed')
  assert.deepEqual(b.report.voiceModes, { onscreen: 1, inner: 1, offscreen: 1 })
  assert.deepEqual(promptTextRisks(shots[0].prompt), [])
})

t('multi-cast: generator blocking positions seed the scene sides', () => {
  const e = pack([SH({ id: '1', characterIds: ['a', 'b'], blockingHint: { positions: { 甲: 'right', 乙: 'left' } } })])
  assert.deepEqual(e.shots[0].cast!.map((c) => [c.id, c.screenPos]), [['a', 'right'], ['b', 'left']])
})

t('generator: prompt + compliance block carry the P0 fields; self-check finds stateJump / axisCross / lighting / missing state', () => {
  for (const k of ['startState', 'endState', 'cameraSide', 'eyeline', 'voiceMode', 'blocking', 'lighting']) assert.ok(STORYBOARD_SYSTEM.includes(k), k)
  assert.ok(/先写站位/.test(STORYBOARD_SYSTEM) && /最后约 1 秒只保持姿态/.test(STORYBOARD_SYSTEM))
  const cb = complianceBlock({ secondsPerEp: 75 })
  assert.ok(cb.includes('startState') && cb.includes('cameraSide') && cb.includes('lighting') && cb.includes('voiceMode'))
  const st = (pose: string) => ({ 甲: { pos: 'left', facing: 'right', pose, gaze: 'front', hands: '空手' } })
  const base = (p: Partial<RawShotLike>): RawShotLike => ({ durationSec: 7, visual: '', action: '甲抬头', dialogue: '', characters: ['甲'], location: '客厅', timeOfDay: '白天', startState: st('站'), endState: st('站'), cameraSide: 'A', lighting: { key: '左侧窗光', soft: true, temp: '暖' }, ...p })
  const ctx = { characters: [{ name: '甲' }, { name: '乙' }], locations: ['客厅'], secondsPerEp: 75 }
  const rules = (xs: RawShotLike[]) => validateStoryboard(xs, ctx).map((x) => x.rule)
  assert.deepEqual(rules([base({}), base({ carryFromPrev: true })]), [])
  assert.ok(rules([base({ endState: st('坐') }), base({ carryFromPrev: true })]).includes('stateJump'))
  assert.ok(rules([base({}), base({ cameraSide: 'B' })]).includes('axisCross'))
  assert.ok(!rules([base({}), base({ cameraSide: 'master' }), base({ cameraSide: 'B' })]).includes('axisCross'))
  assert.ok(rules([base({}), base({ lighting: { key: '顶灯', soft: false, temp: '冷' } })]).includes('lighting'))
  assert.ok(rules([base({ startState: undefined })]).includes('state'))
  // auto-fix: carry copies the previous end state; the run's lighting is locked
  const f = autoFixStoryboard([base({ endState: st('坐') }), base({ lighting: { key: '顶灯', soft: false, temp: '冷' } })], ctx)
  assert.equal((f[1].startState as any)['甲'].pose, '坐')
  assert.deepEqual(f[1].lighting, { key: '左侧窗光', soft: true, temp: '暖' })
  assert.ok(!validateStoryboard(f, ctx).some((x) => x.rule === 'stateJump' || x.rule === 'lighting'))
})

t('export: generator hints pass through with character ids (states, eyeline, blocking, lighting, voice mode)', () => {
  const p = {
    id: 'p', title: 'T', genre: '都市逆袭', platform: '红果', episodeCount: 1, secondsPerEp: 75, style: '真人都市', logline: '', settingFacts: [], locations: ['客厅'],
    characters: [{ id: 'c1', name: '甲', role: '主角', visualLock: '', costume: '', signatureProp: '' }, { id: 'c2', name: '乙', role: '', visualLock: '', costume: '', signatureProp: '' }],
    outline: [], scripts: {}, selectedEpisode: 1, updatedAt: '',
    storyboards: { 1: [{ id: 's1-1', shotNo: 1, size: '中景', durationSec: 7, visual: '甲和乙', action: '甲抬头', dialogue: '', camera: '固定', emotion: '', seedancePrompt: '甲抬头', characterIds: ['c1', 'c2'], location: '客厅', timeOfDay: '白天',
      startState: { 甲: { pos: 'left', facing: 'right', pose: '坐', gaze: '乙', hands: '空手' } }, endState: { 甲: { pos: 'left', facing: 'right', pose: '站', gaze: '乙', hands: '空手' } },
      cameraSide: 'master', eyeline: { 甲: 'right' }, voiceMode: 'onscreen', blocking: { positions: { 甲: 'left', 乙: 'right' }, window: 'back' }, lighting: { key: '左侧窗光', soft: true, temp: '暖' } }] },
  } as unknown as Project
  const s = buildVideoPipelineExport(p).shots[0] as any
  assert.deepEqual(Object.keys(s.startState), ['c1']); assert.equal(s.endState.c1.pose, '站')
  assert.equal(s.cameraSide, 'master'); assert.deepEqual(s.eyeline, { c1: 'right' }); assert.equal(s.voiceMode, 'onscreen')
  assert.deepEqual(s.blockingHint.positions, { c1: 'left', c2: 'right' }); assert.equal(s.lightingHint.key, '左侧窗光')
})

t('repack CLI: P0 report sections, every shot carries the fields; --axis-gate fail exits 9 on a crossing; old scripts get inferred fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blk-'))
  const shots = [SH({ id: 's1-1', size: '全景', visual: '甲和乙在客厅' }), SH({ id: 's1-2', characterIds: ['a'], cameraSide: 'A' }), SH({ id: 's1-3', characterIds: ['b'], cameraSide: 'B' })].map((s) => {
    const { dialogueLines: _d, ...rest } = s as any
    return { ...rest, prompt: '甲和乙在客厅对视', visual: '甲和乙在客厅对视', action: '甲看向乙' }
  })
  const inp = { schema: 'short-drama-studio/video-pipeline@1', project: { id: 'p', title: 'T', style: '真人都市', platform: '红果', secondsPerEp: 75, settingFacts: [] },
    characters: CHARS.map((c) => ({ ...c, role: '', tags: [], visualLock: c.gender === 'female' ? '18岁东亚少女' : '30岁东亚男人', costume: '白衬衫', signatureProp: '', voice: { description: '自然', id: `v_${c.id}` } })), shots, warnings: [] }
  writeFileSync(join(dir, 'in.json'), JSON.stringify(inp))
  const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', join(dir, 'in.json'), join(dir, 'out.json'), '--beat-only', '--split-crosscut'], { encoding: 'utf8' }))
  assert.equal(rep.blocking.axisCross.length, 1); assert.ok(rep.stateContinuity && rep.lighting && rep.voiceModes)
  const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'))
  for (const s of out.shots) for (const k of ['startState', 'endState', 'cameraSide', 'eyeline', 'lighting']) assert.ok(s[k], `${s.id} ${k}`)
  assert.ok(out.sceneBlocking && out.sceneLighting)
  let code = 0
  try { execFileSync('npx', ['tsx', 'scripts/repack.ts', join(dir, 'in.json'), join(dir, 'out2.json'), '--beat-only', '--split-crosscut', '--axis-gate', 'fail'], { stdio: 'pipe' }) } catch (e) { code = (e as { status: number }).status }
  assert.equal(code, 9)
})

console.log(`\n${pass} blocking tests passed`)
