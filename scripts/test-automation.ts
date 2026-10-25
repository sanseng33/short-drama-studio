/**
 * npx tsx scripts/test-automation.ts — generic (no hand override) rules: opt-in overrides, scene inference from the
 * shot's own text, beat contrast / performance / speech placement, and the renderer fields framing + wardrobeState.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBeatMode, buildBeatPrompt, CLOSE_DIALOGUE_FRAMING, dialogueFraming, isNearDup, LONG_SHOT_SEC } from '../src/lib/beatPrompt'
import { actionCap, countActions } from '../src/lib/actionDensity'
import { applyCrossCutSplit, correctScenes, explicitPlaces } from '../src/lib/crosscutSplit'
import { postProcessExport } from '../src/lib/segmentPost'
import { annotateShots, baseWardrobeState, FRAMINGS, framingOf, missingAnnotations, wardrobeStates } from '../src/lib/shotAnnotate'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log(`✓ ${name}`)
}

type PackChar = VideoPipelineExport['characters'][number]
const PC = (id: string, name: string, extra: Partial<PackChar> = {}): PackChar => ({
  id, name, role: '主角', tags: [], visualLock: '东亚少年，短黑发', costume: '米白夹克', signatureProp: '', refImage: null, age: '17', ...extra,
})
const chars: PackChar[] = [PC('a1', '甲'), PC('b1', '乙乙', { costume: '蓝白运动校服' })]
const SH = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['a1'], prompt: '竖屏9:16。白天，房间。主体：17岁东亚少年，米白夹克。', visual: '', action: '', durationSec: 5,
  dialogue: '', speaker: null, speakerName: null, voiceOnly: [], sfx: [], overlayText: [], camera: '中景', size: '中景', emotion: '', refImage: null, timeOfDay: '白天', ...p,
})
const pack = (shots: VideoPipelineShot[], cs: PackChar[] = chars): VideoPipelineExport => ({
  schema: 'short-drama-studio/video-pipeline@1',
  project: { id: 'p', title: 't', style: '真人都市', platform: '', secondsPerEp: 60, settingFacts: [] },
  characters: cs,
  shots,
  warnings: [],
})
const speeds = (s: VideoPipelineShot) => s.beatSegments!.map((g) => g.speed)

// ---------------- scene inference ----------------
const room = { sceneId: 'room_day', sceneLabel: '教室·日', placeKey: 'room', timeBand: 'day' }
const winA = { sceneId: 'wina_day', sceneLabel: '旧楼窗·日', placeKey: 'wina', timeBand: 'day' }
const winB = { sceneId: 'winb_day', sceneLabel: '别墅卧室·日', placeKey: 'winb', timeBand: 'day' }

t('explicitPlaces: own-location cue counts, view phrases (窗外/对面/映在…) do not', () => {
  const places = new Map([['room', '教室·日'], ['wina', '旧楼窗·日']])
  assert.deepEqual(explicitPlaces({ visual: '两人隔着课桌站着，窗外旧楼墙面斑驳', action: '' }, places), ['room'])
  assert.deepEqual(explicitPlaces({ visual: '侧脸特写，窗外旧楼的轮廓映在他瞳孔里', action: '' }, places), [])
  assert.deepEqual(explicitPlaces({ visual: '他扒着旧楼窗台', action: '' }, places), ['wina'])
})

t('scene rule: explicit location in the shot text beats the label; solo reverse shot inherits the conversation scene', () => {
  const two = SH({ id: 'e1', characterIds: ['a1', 'b1'], ...winA, visual: '两人隔着课桌站着，背景是后排窗，窗外旧楼墙面斑驳', action: '甲站起来' })
  const rev = SH({ id: 'e2', characterIds: ['a1'], ...winA, visual: '甲侧脸特写，窗外旧楼映在瞳孔里', action: '视线落回乙乙脸上' })
  const other = SH({ id: 'e3', characterIds: ['a1'], ...room })
  const { exp, corrections } = correctScenes(pack([other, two, rev]))
  assert.deepEqual(corrections.map((c) => `${c.id}:${c.to}`), ['e1:room_day', 'e2:room_day'])
  assert.equal(exp.shots[2].sceneId, 'room_day')
  // no address to the other person → no continuity inheritance
  const rev2 = { ...rev, action: '他低头看手机' }
  assert.deepEqual(correctScenes(pack([other, two, rev2])).corrections.map((c) => c.id), ['e1'])
  // explicit override still wins when passed (opt-in)
  assert.equal(correctScenes(pack([other, two, rev]), { e2: 'wina_day' }).exp.shots[2].sceneId, 'wina_day')
  void winB
})

// ---------------- beat rules ----------------
t('contrast rule: an all-常速 timeline gets 快 on the impact / strongest-action segment, else 慢 on the expressive one', () => {
  const s = SH({
    durationSec: 5,
    prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年，米白夹克。时间轴（一镜5秒，小节拍）：0–1.5s小石子击中玻璃，他笔尖顿住半拍；1.5–3.5s随后眼皮抬起瞄向窗；3.5–5s随后嘴角先松后抿。镜头：中景。',
  })
  const r = buildBeatPrompt(s, chars)
  assert.deepEqual(r.segments.map((g) => g.speed), ['快', '恢复常速', '恢复常速'])
  assert.match(r.prompt, /0–1\.5秒【快】：小石子击中玻璃，他笔尖骤然顿住半拍/, 'sudden stop kept as 骤然顿住')
  const calm = SH({ durationSec: 4, prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜4秒，小节拍）：0–2s他望着窗外；2–4s随后嘴角抿了一下。镜头：中景。' })
  assert.ok(new Set(buildBeatPrompt(calm, chars).segments.map((g) => g.speed)).size >= 2, 'never one speed')
  const fast = SH({ durationSec: 4, prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜4秒，小节拍）：0–2s他猛地冲向门口；2–4s随后一把拽开门。镜头：中景。' })
  assert.ok(buildBeatPrompt(fast, chars).segments.some((g) => g.speed !== '快'), 'all 快 → one settles')
})

t(`performance rule: idle segments get a beat from the shot's own emotion text (long shots ≥ ${LONG_SHOT_SEC}s: every segment)`, () => {
  const s = SH({
    durationSec: 6,
    emotion: '平静→较劲→敷衍',
    prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜6秒，小节拍）：0–2s他猛地站起；2–4s随后保持姿态；4–6s随后他把门推开。镜头：中景。',
  })
  const r = buildBeatPrompt(s, chars)
  const lines = r.prompt.split('\n').filter((l) => /秒【/.test(l))
  assert.equal(lines.length, 3)
  assert.match(lines[1], /神情透出较劲/)
  for (const l of lines) assert.ok(!/^[^：]*：保持姿态，呼吸与眼神有细微变化。$/.test(l), `no empty stand: ${l}`)
})

t('speech placement: lead-ins (开口前/才出声) only in the dialogue segment, 说完+action moves to the next segment', () => {
  const s = SH({
    durationSec: 6,
    dialogue: '来了。',
    speaker: 'a1',
    speakerName: '甲',
    size: '近景',
    camera: '近景',
    prompt:
      '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜6秒，小节拍）：0–2s笔尖在纸上继续划，嘴角动了一下才出声；2–4.5s随后他抬眼（甲开口说台词），说完低下头扯了扯袖口；4.5–6s随后眼睛没离开纸面。镜头：近景。',
  })
  const r = buildBeatPrompt(s, chars)
  const lines = r.prompt.split('\n').filter((l) => /秒【/.test(l))
  const di = r.segments.findIndex((g) => g.lipSync)
  lines.forEach((l, i) => {
    if (i !== di) assert.ok(!/才出声|开口前/.test(l), `lead-in outside dialogue: ${l}`)
  })
  assert.match(lines[di], /才出声/)
  assert.ok(!/扯了扯袖口/.test(lines[di]) && /扯了扯袖口/.test(lines[di + 1]), 'post-speech action in the next segment')
  assert.ok(r.prompt.includes(`镜头：${CLOSE_DIALOGUE_FRAMING}`))
})

t('dedupe: same held-still body part and repeats across segments', () => {
  assert.ok(isNearDup('肩膀纹丝不动', '肩膀没动'))
  assert.ok(!isNearDup('肩膀纹丝不动', '眼皮抬起'))
  const s = SH({ durationSec: 5, prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜5秒，小节拍）：0–2.5s他猛地站起，眉头皱起；2.5–5s随后眉头皱起，他把门推开。镜头：中景。' })
  assert.equal((buildBeatPrompt(s, chars).prompt.match(/眉头皱起/g) || []).length, 1)
})

t('dialogueFraming: 近景 / 中近景 with lip-sync → 近景（胸口以上）; 中景 / 特写 unchanged', () => {
  assert.equal(dialogueFraming('中近景，固定', '中近景'), `${CLOSE_DIALOGUE_FRAMING}，固定`)
  assert.equal(dialogueFraming('侧打中景，轻推', '中景'), '侧打中景，轻推')
  assert.equal(dialogueFraming('特写', '特写'), '特写')
})

// ---------------- framing / wardrobeState ----------------
t('framing: from size + on-screen dialogue (never shot ids); engine passes through', () => {
  assert.equal(framingOf(SH({ size: '近景', dialogue: '走。', speaker: 'a1' })), 'closeup_dialogue')
  assert.equal(framingOf(SH({ size: '特写', dialogue: '走。', speaker: 'a1' })), 'closeup_dialogue')
  assert.equal(framingOf(SH({ size: '中近景', dialogue: '走。', speaker: 'a1' })), 'closeup_dialogue')
  assert.equal(framingOf(SH({ size: '近景', dialogue: '走。', speaker: 'a1', voiceOnly: ['a1'] })), 'medium', 'voiceOnly')
  assert.equal(framingOf(SH({ size: '近景', dialogue: '走。', speaker: 'b1' })), 'medium', 'speaker not on screen')
  assert.equal(framingOf(SH({ size: '近景' })), 'medium')
  assert.equal(framingOf(SH({ size: '大全景' })), 'full')
  assert.equal(framingOf(SH({ size: '', camera: '全景，固定' })), 'full')
  assert.equal(framingOf(SH({ size: '中景', dialogue: '走。', speaker: 'a1' })), 'medium')
  const out = annotateShots(pack([SH({ engine: 'wan-x', size: '近景' } as Partial<VideoPipelineShot>)]))
  assert.equal(out.shots[0].engine, 'wan-x')
})

t('wardrobeState: refImage-derived base, character timeline (shot / episode) and keyword cues carried forward', () => {
  assert.equal(baseWardrobeState({ id: 'a', refImage: 'k_glowup', characterKey: 'k' }), 'glowup')
  assert.equal(baseWardrobeState({ id: 'a', refImage: 'k', characterKey: 'k' }), 'default')
  assert.equal(baseWardrobeState({ id: 'a', wardrobeState: 'uniform', refImage: 'k_x', characterKey: 'k' }), 'uniform')
  const cs: PackChar[] = [
    PC('a1', '甲', { wardrobeTimeline: [{ state: 'suit', fromShotId: 's2' }, { state: 'pajamas', fromEpisode: 2 }] }),
    PC('b1', '乙乙', { wardrobeCues: [{ state: 'wet', keywords: ['浑身湿透'] }] }),
  ]
  const shots = [
    SH({ id: 's1', characterIds: ['a1', 'b1'] }),
    SH({ id: 's2a', splitFrom: 's2', characterIds: ['a1'] }),
    SH({ id: 's3', characterIds: ['b1'], action: '他浑身湿透地冲进来' }),
    SH({ id: 's4', characterIds: ['a1', 'b1'] }),
    SH({ id: 's5', episode: 2, characterIds: ['a1', 'b1'] }),
  ]
  assert.deepEqual(wardrobeStates(shots, cs), [
    { a1: 'default', b1: 'default' },
    { a1: 'suit' },
    { b1: 'wet' },
    { a1: 'suit', b1: 'wet' },
    { a1: 'pajamas', b1: 'wet' },
  ])
})

t('missingAnnotations: fails on any shot without framing or wardrobeState', () => {
  const ok = annotateShots(pack([SH({ id: 'a' }), SH({ id: 'b', characterIds: [] })]))
  assert.deepEqual(missingAnnotations(ok), [])
  const bad = { ...ok, shots: [{ ...ok.shots[0], framing: undefined }, { ...ok.shots[1], wardrobeState: undefined }] }
  assert.deepEqual(missingAnnotations(bad as VideoPipelineExport), ['a: framing', 'b: wardrobeState'])
  assert.ok(FRAMINGS.includes(ok.shots[0].framing!))
})

t('postProcessExport: every shot gets framing + wardrobeState (default, split, beat paths)', () => {
  const p = pack([SH({ id: 'q1', size: '近景', dialogue: '走。', speaker: 'a1' }), SH({ id: 'q2', characterIds: ['b1'], size: '全景' })])
  for (const o of [{}, { beatMode: 'speed' as const }, { splitCrossCut: true, beatMode: 'speed' as const }]) {
    const e = postProcessExport(p, { mergeToSegments: false, ...o })
    assert.deepEqual(missingAnnotations(e), [], JSON.stringify(o))
  }
})

// ---------------- the real pack, no override file ----------------
const P2 = '/workspace/h3/projects/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
if (existsSync(P2)) {
  const p2 = JSON.parse(readFileSync(P2, 'utf8')) as VideoPipelineExport
  t('repack: override file is opt-in only (no flag → nothing read, no beatOverride, rule-only corrections)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repack-'))
    const out = join(dir, 'pack.json')
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', P2, out, '--beat-only', '--split-crosscut'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
    assert.equal(rep.overridesFile, null)
    assert.ok(rep.sceneCorrections.every((c: { by: string }) => c.by === 'rule'))
    const e = JSON.parse(readFileSync(out, 'utf8')) as VideoPipelineExport
    assert.ok(e.shots.every((s) => !s.beatOverride), 'no hand-written beats')
    assert.deepEqual(missingAnnotations(e), [], 'framing + wardrobeState on every shot')
  })

  t('p2-clean auto (no overrides): split children solo, speed contrast, density caps, 近景 dialogue framing', () => {
    const e = annotateShots(applyBeatMode(applyCrossCutSplit(p2).exp))
    assert.deepEqual(missingAnnotations(e), [])
    const kids = e.shots.filter((s) => s.splitFrom)
    assert.ok(kids.length >= 20)
    for (const s of kids) {
      assert.equal(s.characterIds.length, 1, `${s.id} solo`)
      assert.ok(new Set(speeds(s)).size >= 2, `${s.id} speed contrast ${speeds(s)}`)
      assert.ok(!/白朴|吴耐/.test(s.prompt), `${s.id} names`)
    }
    for (const s of e.shots) {
      const segLines = s.prompt.split('\n').filter((l) => /秒【/.test(l))
      segLines.forEach((l, i) => {
        const g = s.beatSegments![i]
        const body = l.replace(/^[^：]*：/, '').replace(/动作放慢，?/, '').split('；')[0].replace(/，?动作利落不拖。?$/, '')
        const n = countActions(body.split(/[，。]/).filter(Boolean))
        assert.ok(n <= actionCap(g.speed, g.dialogue), `${s.id} ${l}: ${n}`)
      })
      if (s.beatSegments!.some((g) => g.lipSync) && /^(?:中)?近景$/.test(s.size)) assert.ok(s.prompt.includes(CLOSE_DIALOGUE_FRAMING), `${s.id} close dialogue framing`)
    }
    const m = Object.fromEntries(e.shots.map((s) => [s.id, s]))
    assert.ok(!m['s1-1a'].prompt.includes('安静听'), 'no phantom listener when the only line is the same character later')
    assert.deepEqual(m['s1-1a'].wardrobeState, { c1: 'plain' })
    // split children take their own size from their camera line (parent s1-1 is 大全景)
    assert.equal(m['s1-1c'].size, '近景')
    assert.equal(m['s1-1c'].framing, 'closeup_dialogue')
    assert.deepEqual(m['s1-21a'].wardrobeState, { c2: 'glowup' })
    assert.equal(e.shots.filter((s) => new Set(speeds(s)).size < 2).length <= 1, true, 'at most the all-dialogue shot lacks contrast')
  })
}

console.log(`\n${pass} automation tests passed`)
