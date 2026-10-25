/**
 * npx tsx scripts/test-automation.ts — generic (no hand override) rules: opt-in overrides, scene inference from the
 * shot's own text, beat contrast / performance / speech placement, and the renderer fields framing + wardrobeState.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBeatMode, BEAT_LINE_RE, buildBeatPrompt, CLOSE_DIALOGUE_FRAMING, dialogueFraming, isNearDup, LONG_SHOT_SEC } from '../src/lib/beatPrompt'
import { actionCap, countActions } from '../src/lib/actionDensity'
import { applyCrossCutSplit, correctScenes, explicitPlaces } from '../src/lib/crosscutSplit'
import { postProcessExport } from '../src/lib/segmentPost'
import {
  annotateShots, baseWardrobeState, CLOSEUP_CAMERA, closeupCamera, finalizePrompt, FRAMINGS, framingOf, missingAnnotations, NO_TEXT_CONSTRAINT, sha1Hex, shotSeed, timedDialogueLines,
  proposeWardrobeTimelines, wardrobeReport, wardrobeStates } from '../src/lib/shotAnnotate'
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
  assert.match(r.prompt, /0–1\.5秒，动作利落快速：小石子击中玻璃，他笔尖骤然顿住半拍/, 'sudden stop kept as 骤然顿住')
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
  const lines = r.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
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
  const lines = r.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
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
  assert.equal(framingOf(SH({ size: '近景', dialogue: '走。', speaker: 'a1', voiceOnly: ['a1'] })), 'empty', 'voiceOnly cast not named in the visual is off screen')
  assert.equal(framingOf(SH({ size: '近景', visual: '甲低头', dialogue: '走。', speaker: 'b1', voiceOnly: ['a1'] }), chars), 'medium', 'voiceOnly but named in visual → on screen')
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
  const bad2 = { ...ok, shots: [{ ...ok.shots[0], seed: 1.5, audio: undefined }, { ...ok.shots[1], prompt: '【快】x', dialogueLines: undefined }] }
  assert.deepEqual(missingAnnotations(bad2 as unknown as VideoPipelineExport), ['a: seed', 'a: audio', 'b: dialogueLines', 'b: prompt'])
  assert.ok(FRAMINGS.includes(ok.shots[0].framing!))
})

t('postProcessExport: every shot gets framing + wardrobeState (default, split, beat paths)', () => {
  const p = pack([SH({ id: 'q1', size: '近景', dialogue: '走。', speaker: 'a1' }), SH({ id: 'q2', characterIds: ['b1'], size: '全景' })])
  for (const o of [{}, { beatMode: 'speed' as const }, { splitCrossCut: true, beatMode: 'speed' as const }]) {
    const e = postProcessExport(p, { mergeToSegments: false, ...o })
    assert.deepEqual(missingAnnotations(e), [], JSON.stringify(o))
  }
})

// ---------------- render-QA rules: tags, framing classes, camera wording, seed, per-shot audio ----------------
t('framing by on-screen count: 0 → empty, 1 → closeup allowed, 2+ → only medium / full', () => {
  assert.equal(framingOf(SH({ characterIds: [], size: '特写' })), 'empty')
  assert.equal(framingOf(SH({ characterIds: [], size: '全景' })), 'empty')
  const two = { characterIds: ['a1', 'b1'], dialogue: '走。', speaker: 'a1' }
  assert.equal(framingOf(SH({ ...two, size: '近景' })), 'medium')
  assert.equal(framingOf(SH({ ...two, size: '特写' })), 'medium')
  assert.equal(framingOf(SH({ ...two, size: '中近景' })), 'medium')
  assert.equal(framingOf(SH({ ...two, size: '全景' })), 'full')
  assert.equal(framingOf(SH({ characterIds: ['a1', 'b1'], voiceOnly: ['b1'], size: '近景', dialogue: '走。', speaker: 'a1' }), chars), 'closeup_dialogue', 'voice-only second cast member does not count')
})

t('finalizePrompt: no 【】, pacing words, framing words + fixed no-text line on every prompt, idempotent', () => {
  const raw = '竖屏9:16。主体：x。\n0–2秒【快】：他转身。\n2–4秒【恢复常速】：他坐下【注意】。\n镜头：侧打近景（胸口以上），半身，过肩，缓推。'
  const c = finalizePrompt(raw, 'closeup_dialogue')
  assert.ok(!/[【】]/.test(c), c)
  assert.ok(c.includes('0–2秒，动作利落快速：他转身') && c.includes('2–4秒，恢复正常节奏：他坐下注意'), c)
  assert.ok(c.includes(`镜头：${CLOSEUP_CAMERA}，缓推。`), c)
  assert.ok(!/侧打|半身|过肩/.test(c), c)
  assert.ok(c.endsWith(`\n景别：${CLOSEUP_CAMERA}，单人。\n${NO_TEXT_CONSTRAINT}`), c)
  assert.equal(finalizePrompt(c, 'closeup_dialogue'), c, 'idempotent')
  const m = finalizePrompt(finalizePrompt(raw, 'closeup_dialogue'), 'medium')
  assert.ok(m.includes('景别：中景。') && !m.includes('景别：近景') && m.split(NO_TEXT_CONSTRAINT).length === 2, m)
  assert.ok(finalizePrompt(raw, 'medium').includes('镜头：侧打近景'), 'non-closeup camera line untouched')
  assert.ok(finalizePrompt('镜头：特写空镜。', 'empty').includes('景别：空镜，画面中没有人物。'))
  assert.ok(finalizePrompt('x', 'full').includes('景别：全景。'))
  assert.equal(closeupCamera('侧身中景，固定'), `${CLOSEUP_CAMERA}，固定`)
})

t('seed: first 31 bits of sha1(projectId:shotId), stable and integer', () => {
  for (const s of ['', 'abc', 'p_1:s1-21b', '小黄鸭:s1-8a', 'x'.repeat(200)]) assert.equal(sha1Hex(s), createHash('sha1').update(s).digest('hex'), s)
  const v = shotSeed('p_1', 's1-1')
  assert.equal(v, parseInt(createHash('sha1').update('p_1:s1-1').digest('hex').slice(0, 8), 16) >>> 1)
  assert.ok(Number.isInteger(v) && v >= 0 && v <= 0x7fffffff)
  assert.equal(shotSeed('p_1', 's1-1'), v)
  assert.notEqual(shotSeed('p_1', 's1-2'), v)
  assert.notEqual(shotSeed('p_2', 's1-1'), v)
  const e = annotateShots(pack([SH({ id: 'k1' }), SH({ id: 'k2' })]))
  assert.deepEqual(e.shots.map((s) => s.seed), [shotSeed('p', 'k1'), shotSeed('p', 'k2')])
  assert.deepEqual(annotateShots(e).shots.map((s) => s.seed), e.shots.map((s) => s.seed), 're-annotation keeps the seed')
})

t('dialogueLines: always an array, timed from the lip-sync beat segment, voiceOnly marked, audio null', () => {
  const G = (start: number, end: number, dialogue = false) => ({ start, end, speed: '慢' as const, dialogue, lipSync: dialogue })
  const a = SH({ dialogue: '我来了。', speaker: 'a1', speakerName: '甲', durationSec: 6, beatSegments: [G(0, 2), G(2, 4.5, true), G(4.5, 6)] })
  assert.deepEqual(timedDialogueLines(a), [{ speaker: 'a1', speakerName: '甲', text: '我来了。', startSec: 2, endSec: 4.5 }])
  const two = SH({
    durationSec: 6,
    dialogueLines: [
      { speaker: 'a1', speakerName: '甲', text: '一二三四' },
      { speaker: 'b1', speakerName: '乙乙', text: '五六' },
    ],
    beatSegments: [G(0, 3, true), G(3, 6)],
  })
  const tl = timedDialogueLines(two)
  assert.deepEqual(tl.map((l) => [l.startSec, l.endSec, !!l.voiceOnly]), [[0, 2, false], [2, 3, true]], 'shared segment split by length; b1 not in cast → voiceOnly')
  const vo = SH({ dialogue: '想什么呢', speaker: 'a1', voiceOnly: ['a1'], durationSec: 4 })
  assert.deepEqual(timedDialogueLines(vo), [{ speaker: 'a1', speakerName: null, text: '想什么呢', startSec: 0, endSec: 4, voiceOnly: true }], 'no beats → whole shot')
  const off = SH({ dialogue: '谁？', speaker: null, speakerOffscreen: true, durationSec: 3 })
  assert.equal(timedDialogueLines(off)[0].voiceOnly, true)
  const e = annotateShots(pack([a, SH({ id: 'quiet' })]))
  assert.deepEqual(e.shots[1].dialogueLines, [])
  assert.ok(e.shots.every((s) => s.audio === null))
  assert.ok(e.shots.every((s) => !/[【】]/.test(s.prompt) && s.prompt.endsWith(NO_TEXT_CONSTRAINT)))
})

t('beat lines: pacing in words, near-dup reordered short clause dropped, solo shots drop other people', () => {
  assert.ok(isNearDup('他眯起眼', '眼睛眯起'))
  assert.ok(!isNearDup('他抬头', '他低头'))
  const s = SH({
    durationSec: 8,
    emotion: '平静→兴奋',
    prompt: '竖屏9:16。白天，教室。主体：17岁东亚少年。时间轴（一镜8秒，小节拍）：0–3s他眯起眼，头往前探一点，眼睛眯起；3–5s前排一个学生先拍手，他扭头；5–8s几双手跟上，有人跟着点头晃肩，被节奏带跑的集体兴奋，他笑了。镜头：中景。',
  })
  const r = buildBeatPrompt(s, chars)
  assert.ok(!/[【】]/.test(r.prompt), r.prompt)
  assert.ok(!r.prompt.includes('眼睛眯起'), r.prompt)
  assert.ok(!/学生|几双手|有人|集体/.test(r.prompt), r.prompt)
  assert.ok(/扭头/.test(r.prompt) && /他笑了/.test(r.prompt), r.prompt)
  const lines = r.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
  assert.equal(lines.length, r.segments.length)
  lines.forEach((l, i) => assert.ok(/^[\d.]+–[\d.]+秒，(?:动作利落快速|接着加快，动作利落快速|节奏放慢|接着放慢|正常节奏|随后恢复正常节奏|保持正常节奏)：/.test(l), `${i}: ${l}`))
  // two people: the other person stays
  const duo = buildBeatPrompt({ ...s, characterIds: ['a1', 'b1'] }, chars)
  assert.ok(/学生/.test(duo.prompt), 'only solo shots drop other people')
})

// ---------------- auto-proposed wardrobe timeline ----------------
t('proposeWardrobeTimelines: change-of-clothes cues, base-garment verbs, new-day reset, base-garment revert, attribution', () => {
  const cs: PackChar[] = [
    PC('a1', '甲', { wardrobeState: 'base', costume: '米白夹克，白色T恤，黑长裤' }),
    PC('b1', '乙乙', { wardrobeState: 'uni', costume: '蓝白运动校服外套' }),
    PC('k1', '丙', { wardrobeTimeline: [{ state: 'x', fromEpisode: 1 }] }),
  ]
  const shots = [
    SH({ id: 'p1', timeOfDay: '早上', characterIds: ['a1', 'b1'], action: '乙乙把鸡蛋换到另一只手上；甲穿着米白夹克站着' }),
    SH({ id: 'p2', timeOfDay: '黄昏', characterIds: ['a1', 'b1'], action: '甲低头把新换的白衬衫领口抚平；乙乙盯着那件衬衫' }),
    SH({ id: 'p3', timeOfDay: '黄昏', characterIds: ['a1'], visual: '他胸口的白衬衫沾了墨' }),
    SH({ id: 'p4', timeOfDay: '早上', characterIds: ['a1'], visual: '卧室晨光' }),
    SH({ id: 'p5', timeOfDay: '夜', characterIds: ['a1'], visual: '他刚洗完澡站在窗边，白色T恤领口湿了' }),
    SH({ id: 'p6', timeOfDay: '夜', characterIds: ['a1'], action: '他重新穿好米白夹克' }),
    SH({ id: 'p7', timeOfDay: '夜', characterIds: ['b1', 'a1'], action: '乙乙走下坡，校服外套搭在臂弯' }),
  ]
  const pr = Object.fromEntries(proposeWardrobeTimelines(shots, cs).map((p) => [p.characterId, p.timeline]))
  assert.ok(!pr.k1, 'hand timeline → no proposal')
  assert.deepEqual(pr.a1.map((e) => [e.state, e.fromShotId]), [
    ['base:白衬衫', 'p2'], // 换到另一只手 / 穿着 (no change) ignored; 乙乙's clause not attributed to 甲
    ['base', 'p4'], // new day (黄昏 → 早上)
    ['base:刚洗完澡', 'p5'], // base garment (T恤) → labelled by the cue
    ['base', 'p6'], // base garment named again without a change cue
  ])
  assert.deepEqual(pr.b1.map((e) => [e.state, e.fromShotId]), [['uni:搭在臂弯', 'p7']])
  assert.ok([...pr.a1, ...pr.b1].every((e) => e.autoProposed && e.evidence))
})

t('annotateShots applies proposals only without hand data; wardrobeReport flags auto-proposed + missing / logo refs', () => {
  const shot = SH({ id: 'w1', characterIds: ['a1'], action: '他换上一件西装' })
  const auto = annotateShots(pack([SH({ id: 'w0' }), shot], [PC('a1', '甲', { wardrobeState: 'base', wardrobeRefs: { base: { refSet: 'set_a', logoFree: false } } })]))
  assert.deepEqual(auto.shots.map((s) => s.wardrobeState), [{ a1: 'base' }, { a1: 'base:西装' }])
  const r = wardrobeReport(auto).a1
  assert.equal(r.timelineSource, 'auto-proposed (review)')
  assert.deepEqual(r.missingRefs, ['base:西装'])
  assert.deepEqual(r.notLogoFree, ['base'])
  const hand = annotateShots(pack([shot], [PC('a1', '甲', { wardrobeState: 'base', wardrobeTimeline: [{ state: 'suit', fromShotId: 'w1' }], wardrobeRefs: { suit: { refSet: 's', logoFree: true } } })]))
  assert.deepEqual(hand.shots[0].wardrobeState, { a1: 'suit' })
  const hr = wardrobeReport(hand).a1
  assert.equal(hr.timelineSource, 'data')
  assert.equal(hr.baseSource, 'data')
  assert.deepEqual([hr.missingRefs, hr.notLogoFree], [[], []])
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
      const segLines = s.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
      segLines.forEach((l, i) => {
        const g = s.beatSegments![i]
        const body = l.replace(/^[^：]*：/, '').replace(/动作放慢，?/, '').split('；')[0].replace(/，?动作利落不拖。?$/, '')
        const n = countActions(body.split(/[，。]/).filter(Boolean))
        assert.ok(n <= actionCap(g.speed, g.dialogue), `${s.id} ${l}: ${n}`)
      })
      if (s.framing === 'closeup_dialogue') assert.ok(s.prompt.includes(CLOSE_DIALOGUE_FRAMING), `${s.id} close dialogue framing`)
    }
    const m = Object.fromEntries(e.shots.map((s) => [s.id, s]))
    assert.ok(!m['s1-1a'].prompt.includes('安静听'), 'no phantom listener when the only line is the same character later')
    assert.deepEqual(m['s1-1a'].wardrobeState, { c1: 'plain' })
    // split children take their own size from their camera line (parent s1-1 is 大全景)
    assert.equal(m['s1-1c'].size, '近景')
    assert.equal(m['s1-1c'].framing, 'closeup_dialogue')
    // render-QA: framing follows the on-screen count; no tags; fixed no-text line; per-shot audio fields
    assert.equal(m['s1-18'].characterIds.length, 2)
    assert.notEqual(m['s1-18'].framing, 'closeup_dialogue')
    assert.ok(!m['s1-18'].prompt.includes(CLOSEUP_CAMERA), 'two-person shot has no close-up camera wording')
    assert.equal(m['s1-6'].framing, 'empty')
    for (const id of ['s1-21a', 's1-21b']) assert.equal(m[id].framing, /近景|特写/.test(m[id].size) ? 'closeup_dialogue' : /全景|远景/.test(m[id].size) ? 'full' : 'medium', `${id} framing vs size ${m[id].size}`)
    assert.ok(!m['s1-21b'].prompt.includes('眼睛眯起'), 's1-21b repeated phrase')
    assert.ok(!/学生|几双手|有人跟着|集体/.test(m['s5-18'].prompt), 's5-18 solo: no other people')
    for (const s of e.shots) {
      assert.ok(!/[【】]/.test(s.prompt), `${s.id} tag brackets`)
      assert.ok(s.prompt.endsWith(NO_TEXT_CONSTRAINT), `${s.id} no-text line`)
      assert.ok(/\n景别：[^\n]+。\n/.test(s.prompt), `${s.id} framing words`)
      if (s.framing === 'closeup_dialogue') assert.ok(!/侧打|侧身|半身|过肩/.test(s.prompt.match(/镜头：[^。\n]*/)?.[0] || ''), `${s.id} closeup angle`)
      if (s.framing === 'closeup_dialogue') assert.equal(s.characterIds.filter((c) => !(s.voiceOnly || []).includes(c)).length <= 1, true)
      assert.ok(Array.isArray(s.dialogueLines) && 'audio' in s && s.audio === null)
      const lip = s.beatSegments!.filter((g) => g.dialogue)
      for (const l of s.dialogueLines!) {
        assert.ok(l.startSec! >= 0 && l.endSec! <= s.durationSec + 1e-9 && l.startSec! < l.endSec!, `${s.id} line time`)
        if (lip.length) assert.ok(lip.some((g) => l.startSec! >= g.start - 1e-9 && l.endSec! <= g.end + 1e-9), `${s.id} line inside a dialogue segment`)
      }
    }
    // split children carry only their own lines
    for (const k of kids) {
      assert.ok(k.dialogueLines!.every((l) => l.voiceOnly || l.speaker === k.characterIds[0]), `${k.id} own lines`)
    }
    assert.deepEqual(m['s1-21a'].wardrobeState, { c2: 'glowup' })
    assert.equal(e.shots.filter((s) => new Set(speeds(s)).size < 2).length <= 1, true, 'at most the all-dialogue shot lacks contrast')
  })

  t('p2-clean character data: wardrobe timeline from the project JSON (hand data, not refImage, not auto)', () => {
    const e = annotateShots(applyCrossCutSplit(p2).exp)
    const rep = wardrobeReport(e)
    for (const id of ['c1', 'c2', 'c3']) {
      assert.equal(rep[id].baseSource, 'data', `${id} base from data`)
      assert.equal(rep[id].timelineSource, 'data', `${id} timeline from data`)
      const refs = (e.characters.find((c) => c.id === id)!.wardrobeRefs || {}) as Record<string, unknown>
      for (const st of Object.keys(rep[id].states)) assert.ok(refs[st], `${id}:${st} has a wardrobeRefs entry`)
    }
    const at = (id: string) => e.shots.find((s) => s.id === id || s.splitFrom === id)!.wardrobeState!
    assert.equal(at('s1-15').c1, 'plain')
    assert.equal(at('s1-18').c1 ?? at('s1-18').c2, at('s1-18').c1 ? 'plain' : 'glowup')
    assert.equal(at('s2-20').c2, 'glowup')
    assert.equal(at('s2-24').c2, 'glowup_white_shirt')
    assert.equal(at('s3-1').c2, 'glowup')
    assert.equal(at('s4-1').c1, 'glowup_hoodie')
    assert.equal(at('s4-23').c2, 'glowup_tee_wet')
    assert.equal(at('s5-27').c2, 'glowup_wig')
    assert.equal(at('s6-1').c2, 'glowup')
    assert.equal(at('s6-30').c3, 'uniform_jacket_off')
    assert.equal(at('s6-21').c3, 'uniform')
  })
}

const FIX = '/workspace/fixed/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
if (existsSync(FIX)) {
  t('original pack (no wardrobe data): repack auto-proposes timelines from script cues, marked for review', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repack-'))
    const out = join(dir, 'pack.json')
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', FIX, out, '--beat-only', '--split-crosscut'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
    const ap = Object.fromEntries(rep.wardrobeAutoProposed.map((x: { id: string; reviewRequired: boolean; timeline: { state: string; fromShotId: string; autoProposed: boolean }[] }) => {
      assert.equal(x.reviewRequired, true)
      assert.ok(x.timeline.every((e) => e.autoProposed))
      return [x.id, x.timeline.map((e) => e.fromShotId)]
    }))
    assert.deepEqual(ap.c2, ['s2-22a', 's3-1', 's4-21', 's5-1', 's5-27', 's6-1'])
    assert.deepEqual(ap.c3, ['s6-26'])
    assert.equal(rep.wardrobe.c2.timelineSource, 'auto-proposed (review)')
    const e = JSON.parse(readFileSync(out, 'utf8')) as VideoPipelineExport
    assert.deepEqual(missingAnnotations(e), [])
  })
}

console.log(`\n${pass} automation tests passed`)
