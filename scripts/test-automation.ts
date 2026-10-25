/**
 * npx tsx scripts/test-automation.ts — generic (no hand override) rules: opt-in overrides, scene inference from the
 * shot's own text, beat contrast / performance / speech placement, and the renderer fields framing + wardrobeState.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { scanPack } from './scan-prompts'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBeatMode, BEAT_LINE_RE, buildBeatPrompt, charOverlapDup, listToClauses, sharedRunDup, CLOSE_DIALOGUE_FRAMING, dialogueFraming, isNearDup, LONG_SHOT_SEC, BEAT_MOUTH_CUE, BEAT_MOUTH_CLEAR } from '../src/lib/beatPrompt'
import { clearMouth, clearMouthClause, MOUTH_BLOCK_RE, MOUTH_CLEAR_MARK, mouthOcclusionRisks } from '../src/lib/mouthOcclusion'
import { actionCap, actionWeight, clauseCap, countActions, isVisibleAction, limitActions, visibleCap } from '../src/lib/actionDensity'
import { applyRenderHold, densityIssues } from '../src/lib/renderHold'
import { applyCrossCutSplit, correctScenes, explicitPlaces } from '../src/lib/crosscutSplit'
import { postProcessExport } from '../src/lib/segmentPost'
import {
  annotateShots, baseWardrobeState, castDescription, unclearPronouns, type WardrobeMeta, CLOSEUP_CAMERA, dropContradictions, multiSubjectLine, normalizeCamera, renderPrompt, closeupCamera, finalizePrompt, FRAMINGS, framingOf, missingAnnotations, NO_TEXT_CONSTRAINT, sha1Hex, shotSeed, timedDialogueLines,
  proposeWardrobeTimelines, wardrobeReport, wardrobeStates, knownLimitations, MULTI_REF_LIMITATION, CLOSEUP_FRAMING_GUARD } from '../src/lib/shotAnnotate'
import { autoVoiceDescription, autoVoiceId, characterVoices, lineVoice, missingVoices, normalizeVoice } from '../src/lib/voice'
import type { VideoPipelineExport, VideoPipelineShot } from '../src/lib/videoExport'
import { applyCastConsistency } from '../src/lib/castConsistency'
import { EMOTION_RE, HOLD_EXPRESSION, isVoiceClause, parseRewriteNote, promptTextRisks, QUOTE_RE, splitVoice, stripVoiceAdverbs, visualizePrompt } from '../src/lib/emotionVisual'
import { dialogueNeedSec, dialogueOverruns, dialogueSegmentNeeds, speechSec } from '../src/lib/dialogueTiming'
import { CONTEXTUAL_EMOTION, EMOTION_VISIBLE } from '../src/lib/emotionVocab'

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
  assert.ok(c.includes(`镜头：${CLOSEUP_CAMERA}。`), c) // push-in dropped (framing guard)
  assert.ok(!/侧打|半身|过肩/.test(c), c)
  assert.ok(c.endsWith(`\n景别：${CLOSEUP_CAMERA}，单人，${CLOSEUP_FRAMING_GUARD}。\n${NO_TEXT_CONSTRAINT}`), c)
  assert.equal(finalizePrompt(c, 'closeup_dialogue'), c, 'idempotent')
  const m = finalizePrompt(finalizePrompt(raw, 'closeup_dialogue'), 'medium')
  assert.ok(m.includes('景别：中景。') && !m.includes('景别：近景') && m.split(NO_TEXT_CONSTRAINT).length === 2, m)
  assert.ok(finalizePrompt(raw, 'medium').includes('镜头：侧打中景，半身，过肩，缓推。'), 'medium: size word normalized, angles kept')
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

// ---------------- round 4: multi-person subjects, contradictions, paraphrase repeats, camera vs framing ----------------
const WC = (id: string, extra: Record<string, unknown>) => ({ id, name: id, age: '17', ...extra })
const plainC = WC('p1', { name: '甲（前）', baseName: '甲', visualLock: '东亚少年，短发略乱，五官柔和', costumePrompt: '灰色连帽卫衣，牛仔裤', wardrobeState: 'plain' })
const upC = WC('p2', {
  name: '甲（后）', baseName: '甲', visualLock: '升级版：下颌线清晰，眼神自信', costume: '黑色拉链短夹克（胸口小刺绣标），白T恤', wardrobeState: 'up',
  wardrobeRefs: { up: { refSet: 'x' }, wet: { refSet: null, costume: '白色T恤', look: '湿发贴额' } },
})

t('multi-person subject: each character from their own look + outfit for their wardrobe state, never shared', () => {
  const cs = [plainC, upC]
  const a = castDescription(plainC, 'plain', cs)
  const b = castDescription(upC, 'up', cs)
  assert.ok(a.text.includes('灰色连帽卫衣') && !a.text.includes('夹克'), a.text)
  assert.ok(b.text.includes('黑色拉链短夹克') && !b.text.includes('卫衣') && !/刺绣|甲/.test(b.text), b.text)
  assert.ok(b.text.includes('下颌线清晰') && !b.text.includes('升级版'), 'visualLock label prefix dropped')
  const w = castDescription(upC, 'wet', cs)
  assert.ok(w.text.includes('湿发贴额') && w.text.includes('白色T恤') && !w.text.includes('夹克') && !w.note, w.text)
  const miss = castDescription(plainC, 'other', cs)
  assert.ok(miss.note && miss.text.includes('灰色连帽卫衣'), 'state without outfit data → base outfit + note')
  const r = multiSubjectLine(['p1', 'p2'], { p1: 'plain', p2: 'up' }, cs, '主体：甲，灰色卫衣；甲，黑夹克，前襟拉链拉开。')
  assert.ok(r.line.startsWith('主体：两人同框，外形与服装各不相同——其一：') && r.line.includes('；其二：'), r.line)
  const [x, y] = r.line.split('；')
  assert.ok(x.includes('卫衣') && !x.includes('夹克') && y.includes('夹克') && !y.includes('卫衣'), r.line)
  assert.ok(y.includes('拉链短夹克（前襟拉链拉开）'), 'zip state goes to the character whose piece named it')
  assert.deepEqual(r.notes, [])
  const same = multiSubjectLine(['p1', 'p3'], {}, [plainC, { ...plainC, id: 'p3' }])
  assert.ok(same.notes.some((n) => n.includes('描述相同')), 'identical descriptions are flagged')
  // annotateShots rewrites the subject of a 2-person shot (copied outfit in the input) and keeps solo subjects
  const pc = [PC('a1', '甲', { costume: '灰色连帽卫衣' }), PC('b1', '乙乙', { costume: '黑色短夹克' })]
  const e = annotateShots(pack([SH({ id: 'two', characterIds: ['a1', 'b1'], prompt: '竖屏9:16。主体：少年，灰色连帽卫衣；另一人：少年，灰色连帽卫衣。镜头：中景。' }), SH({ id: 'one' })], pc))
  const sub = e.shots[0].prompt.match(/主体：[^\n]*/)![0]
  assert.ok(sub.split('；')[1].includes('黑色短夹克') && !sub.split('；')[1].includes('卫衣'), sub)
  assert.ok(e.shots[1].prompt.includes('主体：17岁东亚少年，米白夹克。'), 'solo subject untouched')
})

t('contradictions: 无人物 / 空镜 dropped when people are on screen, person words dropped in empty shots, noted', () => {
  const p = '竖屏9:16，6秒单镜。夜，卧室，单人。\n0–2秒，正常节奏：纱帘晃动，无人物，靠帘角表现风。\n2–6秒，接着放慢：空镜，他抬头。\n风格：禁止二次元漫画脸。'
  const r = dropContradictions(p, 1)
  assert.ok(!/无人物|空镜/.test(r.prompt) && r.prompt.includes('纱帘晃动，靠帘角表现风') && r.prompt.includes('他抬头'), r.prompt)
  assert.equal(r.notes.length, 2)
  const e = '竖屏9:16，6秒单镜。夜，窗外，空镜无人物。\n0–3秒，正常节奏：蛋液往下淌，神情透出挑衅。\n3–6秒，接着放慢：他笑了。\n限制：服装无标志。'
  const q = dropContradictions(e, 0)
  assert.ok(q.prompt.includes('空镜无人物') && q.prompt.includes('蛋液往下淌。') && !/神情|他笑/.test(q.prompt), q.prompt)
  assert.ok(q.prompt.includes('3–6秒，接着放慢：画面静止'), 'an emptied segment keeps a neutral body')
  assert.ok(q.prompt.includes('限制：服装无标志。'), 'protected lines untouched')
  assert.equal(dropContradictions('0–2秒，正常节奏：其他杂物落下。', 0).notes.length, 0, '其他 is not a person')
  const out = annotateShots(pack([SH({ id: 'e', characterIds: [], prompt: '竖屏9:16。夜，窗外。时间轴：0–5s玻璃上的蛋液往下淌，神情透出挑衅。镜头：特写。' })]))
  assert.ok(out.shots[0].renderReview?.some((n) => n.includes('神情透出挑衅')), JSON.stringify(out.shots[0].renderReview))
})

t('paraphrase repeats inside a segment: character-overlap rule, with false-positive guards', () => {
  assert.ok(charOverlapDup('说完嘴角没忍住翘起来', '说完嘴角压不住地翘'))
  assert.ok(isNearDup('说完嘴角没忍住翘起来', '说完嘴角压不住地翘'))
  for (const [a, b] of [
    ['他抬起头看向窗外', '他低下头看向窗外'],
    ['手指在桌面敲了两下', '手指在桌面上划了一下'],
    ['说完低下头', '说完抬起头'],
    ['他转身走向门口', '他转身走向窗边'],
    ['眼睛盯着对面的窗', '眼睛没离开对面'],
    ['嘴角先动再出声', '说完嘴角翘起来'],
    ['肩膀往下一沉', '肩膀往上一耸'],
  ])
    assert.ok(!charOverlapDup(a, b) && !sharedRunDup(a, b) && !isNearDup(a, b), `${a} / ${b}`)
  assert.equal(listToClauses('先屏住呼吸、说话时声音压得很轻'), '先屏住呼吸，说话时声音压得很轻')
  assert.equal(listToClauses('靠窗帘、纸张、水面的细微动态表现空气流动'), '靠窗帘、纸张、水面的细微动态表现空气流动', 'noun list stays one clause')
  // same action repeated under a different lead-in
  for (const [a, b] of [
    ['开口前肩膀先往前一顶', '他喊话时肩膀往前一顶'],
    ['喊完偏头避开对面视线', '说完偏头避开视线'],
    ['眼神压向对面又迅速移开', '视线压向对面'],
    ['开口前先哼出一口气', '说完鼻子里哼出一口气'],
    ['对面窗灯灭的同一刻', '对面窗灯灭下去的瞬间'],
    ['指尖收回来时还在抖', '落下后手收回来还在微微发颤'], // 抖/颤, 指尖/手
    ['抬起的手停在半空悬了半拍才落下点了一下', '指尖先悬停半拍'], // 悬/悬停, short run = whole clause
  ])
    assert.ok(sharedRunDup(a, b), `${a} / ${b}`)
  for (const [a, b] of [
    ['眼睛盯着对面窗户', '手指向对面窗户'],
    ['指尖在台面上多停了一拍', '指尖在台面轻轻蹭了一下'],
    ['他抬手看向窗外', '他转头看向窗外'],
    ['把杯子放回桌上', '把书放回桌上'],
    ['手停在半空', '手停在桌上'],
    ['指尖轻轻发抖', '指尖敲了敲桌面'],
    ['喉结滚动', '喉咙发紧'],
    ['他抬手', '他低头'],
    ['侧脸微微避向穿校服的少年', '穿校服的少年斜眼扫过来'], // a shared person descriptor is not a shared action
    ['视线在杯子上钉了三秒', '眼神先落在杯子上'], // a shared place phrase (在杯子上) is not a shared action
    ['穿校服的少年的视线在杯子上钉了三秒', '穿校服的少年偏头，眼神先落在杯子上'],
  ])
    assert.ok(!sharedRunDup(a, b), `false positive: ${a} / ${b}`)
  const s = SH({
    durationSec: 5,
    dialogue: '真的。',
    speaker: 'a1',
    size: '近景',
    prompt: '竖屏9:16。夜，卧室。主体：17岁东亚少年。时间轴（一镜5秒，小节拍）：0–2s他抬手；2–5s随后他凑近半步，说完嘴角没忍住翘起来（甲开口说台词），表演：先屏住呼吸，说完嘴角压不住地翘。镜头：近景。',
  })
  const r = buildBeatPrompt(s, chars)
  assert.ok(r.prompt.includes('说完嘴角没忍住翘起来') && !r.prompt.includes('压不住地翘'), r.prompt)
})

t('bare 他 in a multi-person shot: resolved from the source beat, else left with a renderReview note', () => {
  const s = SH({
    id: 'pr', characterIds: ['a1', 'b1'], durationSec: 8, dialogue: '好。', speaker: 'b1', speakerName: '乙乙',
    prompt: '竖屏9:16。白天，教室。主体：17岁东亚少年甲，米白夹克；17岁东亚少年乙乙，蓝白运动校服。时间轴（一镜8秒，小节拍）：0–2s他抬眼看向乙乙，手停在半空；2–4s随后他把书推过去，嘴角压着（乙乙开口说台词）；4–6s随后甲转身，冲他点了一下头；6–8s随后他听到哨声顿住，肩膀一僵。镜头：中景，固定。',
  })
  const r = buildBeatPrompt(s, chars)
  const segs = r.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
  assert.ok(segs.some((l) => l.includes('穿夹克的少年抬眼看向穿校服的少年')), 'before the only other name → the other one')
  assert.ok(segs.some((l) => l.includes('穿校服的少年把书推过去')), "the beat's speaker mark")
  assert.ok(segs.some((l) => /(?<!的少年)他听到哨声/.test(l)), 'unresolved: left as is')
  const out = renderPrompt(r.prompt, 'medium', { onscreen: ['a1', 'b1'], wardrobeState: {}, chars: chars as WardrobeMeta[] })
  assert.ok(r.todo.includes('多人同框，「他/她」指代不明：他听到哨声顿住'), r.todo.join(' / '))
  const ann = annotateShots(pack([{ ...s, ...applyBeatMode(pack([s])).shots[0] }]))
  assert.ok(ann.shots[0].renderReview?.includes('多人同框，「他/她」指代不明：他听到哨声顿住'), JSON.stringify(ann.shots[0].renderReview))
  void out
  // object position (冲他): the other one of the beat's actor
  const o = buildBeatPrompt({ ...s, speaker: 'a1', speakerName: '甲', prompt: '竖屏9:16。白天，教室。主体：17岁东亚少年甲，米白夹克；17岁东亚少年乙乙，蓝白运动校服。时间轴（一镜8秒，小节拍）：0–3s乙乙抬眼看着窗外；3–8s随后甲把书合上，冲他点了一下头（甲开口说台词）。镜头：中景，固定。' }, chars)
  assert.ok(o.prompt.includes('穿夹克的少年把书合上，冲穿校服的少年点了一下头'), o.prompt)
  assert.ok(!/放慢：；/.test(o.prompt), 'a segment without actions starts with its speech cue')
  // two speakers in one segment + over-cap trim (synthetic s6-9 shape)
  {
    const two = { ...s, id: 'tw', durationSec: 8.5, speaker: 'b1', speakerName: '乙乙', dialogue: '这是什么。',
      dialogueLines: [{ speaker: 'b1', speakerName: '乙乙', text: '这是什么。' }, { speaker: 'a1', speakerName: '甲', text: '没什么。' }],
      prompt: '竖屏9:16。白天，教室。主体：17岁东亚少年甲，米白夹克；17岁东亚少年乙乙，蓝白运动校服。时间轴（一镜8.5秒，小节拍）：0–2.5s甲起身时肩线一转，本子从桌上滑到桌角；乙乙的视线跟着移过去，眉头慢慢皱起；2.5–4.5s随后乙乙的手指在笔身上收紧，喉结上下滚了一下，慢慢开口（乙乙开口说台词）；4.5–6.5s随后甲回头的瞬间脚步顿住，视线落到桌角，瞳孔一缩；6.5–8.5s随后甲掌心啪地压住本子，另一只手挡在桌沿外，抬头看向乙乙（甲开口说台词）。镜头：中景，固定。' }
    const r = buildBeatPrompt(two, chars)
    const lines = r.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
    const both = lines.find((l) => l.includes('先正脸朝镜头开口'))
    assert.ok(both, 'two lines in one segment: ' + lines.join(' / '))
    assert.ok(both!.includes('穿校服的少年先正脸朝镜头开口说一句短话，随后穿夹克的少年正脸朝镜头开口说一句短话'), both)
    assert.ok(!/[；：]正脸朝镜头/.test(r.prompt), 'no subjectless speaking clause')
    // the cap keeps the main action of the beat carrying the last line (压住), not the trailing glance
    assert.ok(both!.includes('穿夹克的少年掌心啪地压住本子'), both)
    assert.ok(r.trimmedActions.some((x) => x.includes('抬头看向')), r.trimmedActions.join(' / '))
    assert.ok(!/[\ue100-\ue1ff]/.test(r.prompt + r.trimmedActions.join('')), 'no internal person markers leak')
    // modifiers of a dropped clause keep its actor
    assert.ok(both!.includes('穿校服的少年喉结上下滚了一下'), both)
  }
  // a garment only one of them wears resolves it
  const g = buildBeatPrompt({ ...s, prompt: s.prompt.replace('6–8s随后他听到哨声顿住，肩膀一僵', '6–8s随后他听到哨声顿住，校服袖口滑下') }, chars)
  assert.ok(g.prompt.includes('穿校服的少年听到哨声'), g.prompt)
  assert.deepEqual(unclearPronouns('0–2秒，正常节奏：穿夹克的少年抬手，他又放下。'), [], 'a 他 after a descriptor in the segment reads')
})

t('camera size words follow the framing; angle and movement words stay', () => {
  assert.equal(normalizeCamera('侧打中近景，轻推', 'medium', 1), '侧打中近景，轻推', 'solo medium 中近景 is fine')
  assert.equal(normalizeCamera('侧打中近景，轻推，最后一秒推近镜面', 'medium', 2), '侧打双人中景，轻推，最后一秒推近镜面')
  assert.equal(normalizeCamera('近景，固定', 'medium', 2), '双人中景，固定')
  assert.equal(normalizeCamera('中景，缓慢横移', 'medium', 2), '双人中景，缓慢横移')
  assert.equal(normalizeCamera('侧打双人，固定', 'medium', 2), '侧打双人中景，固定')
  assert.equal(normalizeCamera('缓慢横移', 'medium', 2), '双人中景，缓慢横移')
  assert.equal(normalizeCamera('双人中景，固定', 'medium', 2), '双人中景，固定', 'already consistent')
  assert.equal(normalizeCamera('手部特写，缓推，最后一秒上摇', 'medium', 1), '中景，缓推，最后一秒上摇')
  assert.equal(normalizeCamera('中景，跟移', 'full', 1), '全景，跟移')
  assert.equal(normalizeCamera('大全景，缓推', 'full', 2), '大全景，缓推')
  assert.equal(normalizeCamera('特写，轻推', 'empty', 0), '特写，轻推', 'empty shots keep their insert size')
  assert.equal(normalizeCamera('缓慢横移', 'medium', 1), '缓慢横移', 'solo without a size word: untouched')
  assert.equal(normalizeCamera('，略仰拍', 'medium', 1), '略仰拍')
  const r = renderPrompt('镜头：近景，固定。', 'medium', { onscreen: ['a', 'b'], wardrobeState: {}, chars: [] })
  assert.ok(r.prompt.includes('镜头：双人中景，固定。') && r.prompt.includes('景别：双人中景，两人同框。'), r.prompt)
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
// ---------------- round 11: density after merge, in-segment order, voice words, empty segments, render hold ----------------
{
  const line = '让我试一下吧。'
  const L = (text = line) => ({ speaker: 'a1', speakerName: '甲', text })
  const segBody = (l: string) => l.replace(/^[^：]*：/, '').replace(/^动作放慢，?/, '').split('；')[0]
  const merged = SH({
    id: 'm1', durationSec: 6, size: '近景', camera: '近景', dialogue: line, speaker: 'a1', speakerName: '甲', dialogueLines: [L()],
    prompt: '竖屏9:16。白天，房间。主体：17岁东亚少年，米白夹克。时间轴（一镜6秒，小节拍）：0–4s开口前眼神先飘远，指腹来回搓衣角，他抬眼望向窗外，呼吸沉了一下，说完嘴唇轻轻合上（甲开口说台词）；4–6s随后语气轻得几乎自语，眼底有一点不好意思的认真。镜头：近景。',
  })
  t('density re-enforced after merge: dialogue segment ≤ 2 visible / ≤ 3 clauses, main action kept, extras moved or dropped (logged)', () => {
    const o = annotateShots(applyBeatMode(pack([merged]))).shots[0]
    const segs = o.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
    const di = o.beatSegments!.findIndex((g) => g.lipSync)
    const cls = segBody(segs[di]).split(/[，。]/).filter(Boolean)
    assert.ok(cls.length <= clauseCap('慢') && cls.filter(isVisibleAction).length <= visibleCap('慢'), segs[di])
    assert.ok(cls.some((c) => c.includes('搓衣角')), 'main action tied to the line stays')
    assert.ok(o.beatTrimmedActions!.some((x) => /超出动作密度/.test(x)), JSON.stringify(o.beatTrimmedActions))
    // the moved beat lands in a silent neighbour, not lost silently
    const moved = o.beatTrimmedActions!.filter((x) => x.includes('移到')).map((x) => x.split('：').pop()!)
    for (const m of moved) assert.ok(segs.some((l, i) => i !== di && l.includes(m)), m)
    for (const [i, l] of segs.entries()) {
      const g = o.beatSegments![i]
      const c = segBody(l).split(/[，。]/).filter(Boolean)
      assert.ok(c.filter(isVisibleAction).length <= visibleCap(g.speed) && countActions(c) <= actionCap(g.speed, g.dialogue), l)
    }
    assert.equal(densityIssues(o).length, 0)
  })
  t('dialogue segment order: lead-in → speaking cue → 说完…; a line starting at 0 s drops 开口前… (logged)', () => {
    const o = annotateShots(applyBeatMode(pack([merged]))).shots[0]
    const d = o.prompt.split('\n').find((l) => l.includes(BEAT_MOUTH_CUE))!
    assert.ok(d.indexOf('说完') > d.indexOf(BEAT_MOUTH_CUE), d)
    assert.equal(o.beatSegments!.find((g) => g.lipSync)!.start, 0)
    assert.ok(!o.prompt.includes('开口前'), 'no time before speech at 0 s')
    assert.ok(o.beatTrimmedActions!.some((x) => x.includes('无开口前时间') && x.includes('开口前眼神先飘远')))
    // a prior segment exists: the lead-in stays, before the cue
    const later = SH({
      id: 'm2', durationSec: 5, dialogue: line, speaker: 'a1', speakerName: '甲', dialogueLines: [L()],
      prompt: '竖屏9:16。白天，房间。主体：17岁东亚少年，米白夹克。时间轴（一镜5秒，小节拍）：0–2s他走到窗边，停住；2–5s随后开口前眼神先飘远，他手指敲了敲窗台（甲开口说台词）。镜头：中景。',
    })
    const p = annotateShots(applyBeatMode(pack([later]))).shots[0].prompt
    const dl = p.split('\n').find((l) => l.includes(BEAT_MOUTH_CUE))!
    assert.ok(dl.includes('开口前眼神先飘远') && dl.indexOf('开口前') < dl.indexOf(BEAT_MOUTH_CUE), dl)
  })
  t('voice words leave the picture → dialogueLines[].delivery; gate flags leftovers; visible halves / neutral mentions stay', () => {
    const o = annotateShots(applyBeatMode(pack([merged]))).shots[0]
    assert.ok(!/语气|几乎自语/.test(o.prompt), o.prompt)
    assert.equal(o.dialogueLines![0].delivery, '语气轻得几乎自语')
    assert.deepEqual(o.beatDelivery, ['语气轻得几乎自语'])
    assert.deepEqual(promptTextRisks(o.prompt), [])
    assert.deepEqual(splitVoice('语气轻但下颌收得紧'), { keep: '下颌收得紧', voice: '语气轻' })
    assert.ok(isVoiceClause('声音压得很低') && isVoiceClause('用只有自己能听到的音量嘀咕') && !isVoiceClause('听到声音抬头') && !isVoiceClause('他抬头'))
    assert.equal(stripVoiceAdverbs('嘴角抽了一下才低声说话'), '嘴角抽了一下才说话')
    const raw = '0–2秒，正常节奏：语气发紧，他轻轻点头，听到声音抬头。\n2–3秒，正常节奏：闷声开口，嘴角一沉。'
    assert.ok(promptTextRisks(raw).some((r) => r.startsWith('voice')), JSON.stringify(promptTextRisks(raw)))
    const v = visualizePrompt(raw)
    assert.ok(!/语气|闷声/.test(v.prompt) && v.prompt.includes('听到声音抬头') && v.prompt.includes('开口，嘴角一沉'), v.prompt)
    assert.deepEqual(v.rewrites.filter((r) => r.kind === 'voice').map((r) => r.from).sort(), ['语气发紧', '闷声'].sort())
    assert.deepEqual(promptTextRisks(v.prompt), [])
  })
  t('emotion table: 不好意思 / 怀念 / contextual 认真 rewritten; neutral 认真地… untouched; all visible parts weight 0', () => {
    const v = visualizePrompt('0–2秒，正常节奏：眼底有一点不好意思的认真，他认真地写字。\n2–4秒，正常节奏：他望着旧照片，神情透出怀念。')
    assert.ok(!/不好意思|怀念/.test(v.prompt) && v.prompt.includes('他认真地写字'), v.prompt)
    assert.ok(v.prompt.includes(EMOTION_VISIBLE['认真'].split('、')[0]) && v.prompt.includes(EMOTION_VISIBLE['不好意思'].split('、')[0]), v.prompt)
    assert.ok(!v.prompt.includes('眼底目光'), 'no dangling 眼底 before the visible part')
    assert.deepEqual(promptTextRisks(v.prompt), [])
    assert.deepEqual(promptTextRisks('0–2秒，正常节奏：他认真地写字。'), [], 'neutral 认真 passes the gate')
    assert.ok(promptTextRisks('0–2秒，正常节奏：眼底一点认真。').some((r) => r.startsWith('emotion')))
    for (const k of CONTEXTUAL_EMOTION) assert.ok(EMOTION_VISIBLE[k], k)
    // no visible replacement contains a table word (the gate would fire on its own output)
    for (const [k, vis] of Object.entries(EMOTION_VISIBLE)) assert.ok(!EMOTION_RE.test(vis), `${k} → ${vis}`)
  })
  t('no empty segment: nothing visible left → held expression; the gate flags an empty one', () => {
    const p = '竖屏9:16，5秒单镜。\n0–2秒，正常节奏：他点头。\n2–3秒，正常节奏：语气发紧。\n3–5秒，接着放慢：动作放慢，心想这下完了；正脸朝镜头开口说一句短话，嘴部清晰可见、无遮挡。'
    const v = visualizePrompt(p)
    const segs = v.prompt.split('\n').filter((l) => BEAT_LINE_RE.test(l))
    assert.equal(segs.length, 3)
    assert.ok(segs[1].endsWith(`${HOLD_EXPRESSION}。`), segs[1])
    assert.ok(segs[2].includes(`动作放慢，${HOLD_EXPRESSION}；`), segs[2])
    assert.equal(v.rewrites.filter((r) => r.kind === 'hold').length, 2)
    assert.ok(promptTextRisks('0–2秒，正常节奏：。').some((r) => r.startsWith('empty segment')))
    assert.deepEqual(promptTextRisks(v.prompt), [])
    assert.equal(visualizePrompt(v.prompt).prompt, v.prompt, 'idempotent')
  })
  t('render hold: set automatically from unresolved issues only; fixed issues never hold', () => {
    const seg = (speed: '快' | '慢' | '恢复常速', start: number, end: number, dialogue = false) => ({ start, end, speed, dialogue, lipSync: dialogue })
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十。'
    const e0 = annotateShots(pack([
      SH({ id: 'ok', prompt: '竖屏9:16，5秒单镜。\n0–5秒，正常节奏：他点头。', beatSegments: [seg('恢复常速', 0, 5)] }),
      SH({ id: 'cap', durationSec: 9, dialogue: long, speaker: 'a1', speakerName: '甲', dialogueLines: [L(long)] }),
      SH({ id: 'pron', characterIds: ['a1', 'b1'], prompt: '竖屏9:16，5秒单镜。双人。\n0–5秒，正常节奏：他转身离开。', beatSegments: [seg('恢复常速', 0, 5)] }),
      SH({ id: 'dens', prompt: '竖屏9:16，5秒单镜。\n0–5秒，动作利落快速：他猛地转身，一把推开门，抬头看向窗外。', beatSegments: [seg('快', 0, 5)] }),
      SH({ id: 'cast' }),
    ]))
    e0.warnings.push({ episode: 1, shotId: 'cast', code: 'cast_consistency', message: 'continuity_island: test' } as VideoPipelineExport['warnings'][number])
    const { exp, renderHold } = applyRenderHold(e0)
    const by = Object.fromEntries(exp.shots.map((s) => [s.id, s.hold]))
    assert.equal(by.ok, null)
    assert.ok(by.cap!.reason.some((r) => r.startsWith('dialogueOverrun') && r.includes('拆分')), JSON.stringify(by.cap))
    assert.ok(by.pron!.reason.some((r) => r.startsWith('pronoun')))
    assert.ok(by.dens!.reason.some((r) => r.startsWith('density')), JSON.stringify(by.dens))
    assert.ok(by.cast!.reason.some((r) => r.startsWith('cast_consistency')))
    assert.deepEqual(renderHold.map((x) => x.shotId), ['cap', 'pron', 'dens', 'cast'])
    assert.ok(exp.shots.every((s) => 'hold' in s), 'every shot carries hold (null = render)')
    // the same kinds of issue, fixed by the rules (merged density, short-shot overrun → extended, voice words), never hold
    const fixable = SH({ id: 'fx', durationSec: 3, dialogue: '一二三四五六七八九十十一十二。', speaker: 'a1', speakerName: '甲', dialogueLines: [L('一二三四五六七八九十十一十二。')], action: '他推门进来，开口说话' })
    const r = applyRenderHold(annotateShots(applyBeatMode(pack([merged, fixable]))))
    assert.deepEqual(r.renderHold, [], JSON.stringify(r.renderHold))
    assert.ok(r.exp.shots.every((s) => s.hold === null))
  })
  t('mouth occlusion: hand-to-mouth shout rewritten visible, occluders dropped in the line, kept outside it; gate + hold', () => {
    assert.ok(BEAT_MOUTH_CLEAR.includes(MOUTH_CLEAR_MARK))
    const sh = SH({
      id: 'mo', durationSec: 5, size: '近景', camera: '近景缓推', dialogue: line, speaker: 'a1', speakerName: '甲', dialogueLines: [L()],
      prompt: '竖屏9:16。夜，窗边。主体：17岁东亚少年，蓝白外套。时间轴（一镜5秒，小节拍）：0–2s他端起杯子喝水，放下杯子；2–5s随后他一手拢在嘴边喊（甲开口说台词）。镜头：近景缓推。',
    })
    const o = annotateShots(applyBeatMode(pack([sh]))).shots[0]
    const d = o.prompt.split('\n').find((l) => l.includes(BEAT_MOUTH_CUE))!
    assert.ok(!d.includes('拢在嘴边') && /张大?嘴喊/.test(d) && d.includes('下巴前伸'), d)
    assert.ok(o.beatTodo!.some((x) => x.includes('遮挡嘴部') && x.includes('拢在嘴边')), JSON.stringify(o.beatTodo))
    assert.ok(o.prompt.split('\n').some((l) => BEAT_LINE_RE.test(l) && !l.includes(BEAT_MOUTH_CUE) && l.includes('喝水')), 'outside the line it stays')
    assert.deepEqual(mouthOcclusionRisks(o.prompt), [])
    assert.ok(!/拢|捂|遮挡嘴/.test(clearMouthClause('他一手拢在嘴边喊').clause!))
    assert.equal(clearMouthClause('他捂着嘴').clause, null)
    assert.equal(clearMouthClause('耳根泛红、低头').clause, '耳根泛红', 'only the occluding part goes')
    assert.equal(clearMouthClause('他抬头看向窗外').changed, false)
    for (const c of ['捂住嘴', '手背擦了擦嘴', '咬着笔', '戴着口罩', '衣领遮住下巴', '埋头', '打哈欠']) assert.ok(MOUTH_BLOCK_RE.test(c), c)
    // final pass: a lip-sync line keeps its own cue (…无遮挡) untouched, drops a leftover occluder, idempotent
    const raw = `竖屏9:16，5秒单镜。\n0–2秒，正常节奏：他打哈欠。\n2–5秒，接着放慢：动作放慢，他捂着嘴，眨眼；${BEAT_MOUTH_CUE}。`
    assert.deepEqual(mouthOcclusionRisks(raw), ['他捂着嘴'])
    const c = clearMouth(raw)
    assert.ok(c.prompt.includes('0–2秒，正常节奏：他打哈欠。') && c.prompt.includes(`动作放慢，眨眼；${BEAT_MOUTH_CUE}`), c.prompt)
    assert.equal(c.notes.length, 1)
    assert.equal(clearMouth(c.prompt).prompt, c.prompt)
    // a timeline-less dialogue close-up: the whole action text counts as the line
    assert.deepEqual(mouthOcclusionRisks('竖屏9:16。\n他喝水，抬眼。\n镜头：近景。', true), ['他喝水'])
    // gate → render hold
    const held = applyRenderHold(pack([SH({ id: 'h', prompt: raw, beatSegments: [{ start: 0, end: 2, speed: '恢复常速', dialogue: false }, { start: 2, end: 5, speed: '慢', dialogue: true, lipSync: true }] })]))
    assert.ok(held.renderHold[0]?.reasons.some((r) => r.startsWith('mouth')), JSON.stringify(held.renderHold))
  })
  t('closeup_dialogue framing guard: chest-up held, no push-in to an extreme close-up', () => {
    assert.ok(!/推/.test(closeupCamera('近景缓推，不切镜')) && closeupCamera('近景缓推，不切镜').includes('不切镜'))
    assert.equal(closeupCamera('近景，轻微手持，最后一秒微推，不切镜'), `${CLOSEUP_CAMERA}，轻微手持，不切镜`)
    const o = annotateShots(applyBeatMode(pack([merged]))).shots[0]
    assert.equal(o.framing, 'closeup_dialogue')
    assert.ok(o.prompt.includes(CLOSEUP_FRAMING_GUARD), o.prompt)
    assert.ok(!/镜头[：:][^\n]*推/.test(o.prompt))
    assert.deepEqual(promptTextRisks(o.prompt), [])
  })
}

const P2 = '/workspace/h3/projects/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
if (existsSync(P2)) {
  const p2 = JSON.parse(readFileSync(P2, 'utf8')) as VideoPipelineExport
  t('limitActions: lead clause kept first; a dropped clause hands its person reference to the next subjectless one', () => {
    const subject = (c: string) => c.match(/^穿.{1,4}的少年/)?.[0] ?? null
    const r = limitActions(['穿夹克的少年推开门', '眉头一皱', '穿校服的少年举起手', '回头看向窗外'], 1, { preferLater: true, lead: '穿校服的少年举起手', subject })
    assert.deepEqual(r.dropped, ['穿夹克的少年推开门', '回头看向窗外'])
    assert.deepEqual(r.kept, ['穿夹克的少年眉头一皱', '穿校服的少年举起手'])
    // without lead: unchanged behaviour (latest main kept in a dialogue segment)
    assert.deepEqual(limitActions(['推开门', '举起手', '回头看向窗外'], 1, { preferLater: true }).kept, ['回头看向窗外'])
  })

  // ---------------- voice (TTS) per dialogue line ----------------
  {
    const vc = [
      PC('a1', '甲（之前）', { baseName: '甲', characterKey: 'key_a', voice: 'voice_a' }),
      PC('a2', '甲（之后）', { baseName: '甲', characterKey: 'key_a' }),
      PC('b1', '乙乙', { characterKey: 'key_b', voice: { description: '低沉少年音', id: 'voice_b' } }),
    ]
    const two = (cs: PackChar[], lines: { speaker: string | null; speakerName: string; text: string }[], voices?: Record<string, string>) => {
      const p0 = pack([SH({ id: 'v1', characterIds: ['a2', 'b1'], size: '中景', durationSec: 6, dialogue: lines[0].text, speaker: lines[0].speaker, speakerName: lines[0].speakerName, dialogueLines: lines })], cs)
      if (voices) p0.project.voices = voices
      return annotateShots(p0)
    }
    const L = [{ speaker: 'a2', speakerName: '甲', text: '我来吧。' }, { speaker: 'b1', speakerName: '乙乙', text: '随你。' }]
    t('voice: a look variant without voice inherits by characterKey; pack characters carry it; object form kept', () => {
      const e = two(vc, L)
      assert.equal(e.characters.find((c) => c.id === 'a2')!.voice, 'voice_a')
      const ls = e.shots[0].dialogueLines!
      assert.equal(ls[0].voice, 'voice_a')
      assert.deepEqual(ls[1].voice, { description: '低沉少年音', id: 'voice_b' })
      assert.deepEqual(missingVoices(e.shots), [])
    })
    t('voice: an explicit voice on the variant overrides the characterKey one', () => {
      const cs = vc.map((c) => (c.id === 'a2' ? { ...c, voice: 'voice_a_after' } : c))
      assert.equal(characterVoices(cs).get('a2'), 'voice_a_after')
      assert.equal(characterVoices(cs).get('a1'), 'voice_a')
      assert.equal(two(cs, L).shots[0].dialogueLines![0].voice, 'voice_a_after')
    })
    t('voice: object form needs id or description; strings are trimmed; empty → none', () => {
      assert.deepEqual(normalizeVoice({ description: ' 清亮女声 ' }), { description: '清亮女声' })
      assert.deepEqual(normalizeVoice({ id: 'x1' }), { id: 'x1' })
      assert.equal(normalizeVoice({}), null)
      assert.equal(normalizeVoice('  '), null)
      assert.equal(normalizeVoice(' v '), 'v')
      // speakerName fallback to a character name; off-list name via project.voices
      assert.deepEqual(lineVoice({ speaker: null, speakerName: '乙乙', text: 'x' }, vc), { description: '低沉少年音', id: 'voice_b' })
      assert.equal(lineVoice({ speaker: null, speakerName: '路人', text: 'x' }, vc, { 路人: 'voice_x' }), 'voice_x')
    })
    t('voice: missing → error only when truly unresolvable (listed character without voice / no speaker name); exit 3', () => {
      const cs = vc.map((c) => (c.characterKey === 'key_a' ? { ...c, voice: undefined } : c))
      const off = [...L, { speaker: null, speakerName: '路人', text: '让一让。' }, { speaker: null, speakerName: '', text: '喂！' }]
      const e = two(cs, off)
      assert.equal(e.shots[0].dialogueLines![0].voice, null, 'a listed character is never auto-voiced')
      assert.deepEqual(missingVoices(e.shots), ['v1: 甲「我来吧。」', 'v1: ?「喂！」'])
      assert.equal(e.shots[0].dialogueLines![2].autoVoice, true, 'off-list named speaker → auto voice')
      const dir = mkdtempSync(join(tmpdir(), 'voice-'))
      const inp = join(dir, 'in.json')
      const mk = (cc: PackChar[], ls: typeof off) => JSON.stringify(pack([SH({ id: 'v1', characterIds: ['a2', 'b1'], durationSec: 6, dialogue: '我来吧。', speaker: 'a2', speakerName: '甲', dialogueLines: ls })], cc))
      writeFileSync(inp, mk(cs, off))
      let code = 0
      let err = ''
      try {
        execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only'], { encoding: 'utf8', stdio: 'pipe' })
      } catch (x) {
        code = (x as { status: number }).status
        err = String((x as { stderr: string }).stderr)
      }
      assert.equal(code, 3)
      assert.ok(err.includes('甲「我来吧。」') && err.includes('?「喂！」') && !err.includes('路人'), err)
      assert.ok(!existsSync(join(dir, 'out.json')), 'no pack written')
      const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only', '--allow-missing-voice'], { encoding: 'utf8' }))
      assert.equal(rep.voiceMissing.length, 2)
      assert.equal(rep.dialogueLinesWithVoice, 2)
      // all named: the default repack passes; the auto voice is listed for review
      writeFileSync(inp, mk(vc, off.slice(0, 3)))
      const ok = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'ok.json'), '--beat-only'], { encoding: 'utf8' }))
      assert.deepEqual(ok.voiceMissing, [])
      assert.deepEqual(ok.voiceNeedsReview.map((x: { speakerName: string }) => x.speakerName), ['路人'])
      assert.equal(ok.dialogueLinesAutoVoice, 1)
      const out = JSON.parse(readFileSync(join(dir, 'ok.json'), 'utf8')) as VideoPipelineExport
      assert.equal(out.autoVoices!['路人'].autoVoice, true)
    })
    t('auto voice: stable id per project + name, distinct names → distinct ids, project.voices / character voice win', () => {
      const lines = (n: string) => [{ speaker: null, speakerName: n, text: '快看！' }]
      const shot = (id: string, n: string, extra: Partial<VideoPipelineShot> = {}) => SH({ id, characterIds: ['a1'], dialogue: '快看！', speakerName: n, dialogueLines: lines(n), ...extra })
      const e1 = annotateShots(pack([shot('e1', '学生甲'), shot('e2', '学生乙'), shot('e3', '学生甲', { episode: 2 })], vc))
      const id = (e: VideoPipelineExport, sid: string) => (e.shots.find((s) => s.id === sid)!.dialogueLines![0].voice as { id: string }).id
      assert.equal(id(e1, 'e1'), id(e1, 'e3'), 'same name → same voice across episodes')
      assert.notEqual(id(e1, 'e1'), id(e1, 'e2'), 'distinct names → distinct ids')
      assert.equal(id(e1, 'e1'), autoVoiceId('p', '学生甲'))
      assert.match(id(e1, 'e1'), /^auto_[0-9a-f]{12}$/)
      const again = annotateShots(pack([shot('e1', '学生甲')], vc))
      assert.equal(id(again, 'e1'), id(e1, 'e1'), 'stable across runs')
      const other = pack([shot('e1', '学生甲')], vc)
      other.project.id = 'q'
      assert.notEqual(id(annotateShots(other), 'e1'), id(e1, 'e1'), 'project-scoped')
      assert.deepEqual(Object.keys(e1.autoVoices!), ['学生甲', '学生乙'])
      // overrides win
      const pv = pack([shot('e1', '学生甲')], vc)
      pv.project.voices = { 学生甲: 'voice_lib_x' }
      const ev = annotateShots(pv)
      assert.equal(ev.shots[0].dialogueLines![0].voice, 'voice_lib_x')
      assert.equal(ev.shots[0].dialogueLines![0].autoVoice, undefined)
      assert.equal(ev.autoVoices, undefined)
      const ec = annotateShots(pack([shot('e1', '乙乙')], vc))
      assert.deepEqual(ec.shots[0].dialogueLines![0].voice, { description: '低沉少年音', id: 'voice_b' }, 'a character name match uses its voice')
    })
    t('auto voice description: generic role words → age band, gender only when stated, neutral fallback', () => {
      const d = (n: string, script = '', ls: string[] = []) => autoVoiceDescription(n, script, ls)
      assert.equal(d('体育老师').basis.age, '成年人')
      assert.equal(d('教练').basis.age, '成年人')
      assert.equal(d('同学乙').basis.age, '青少年')
      assert.equal(d('学生甲').basis.age, '青少年')
      assert.equal(d('门口的大爷').basis.age, '老年人')
      assert.equal(d('同学乙').basis.gender, null)
      assert.ok(d('同学乙').description.includes('中性音色'), d('同学乙').description)
      assert.ok(!/女声|男声/.test(d('老师').description))
      assert.equal(d('女同学').basis.gender, 'female')
      assert.equal(d('阿姨').basis.gender, 'female')
      // the script states it next to the role word
      const s = d('老师', '讲台上的女老师推了推眼镜')
      assert.deepEqual([s.basis.gender, s.basis.genderFrom], ['female', 'script'])
      assert.ok(s.description.startsWith('成年人女声'), s.description)
      assert.equal(d('老师', '男老师和女老师都在').basis.gender, null, 'conflicting script → neutral')
      assert.ok(d('老师').description.includes('威严'))
      assert.ok(d('同学', '', ['你再说一遍！']).description.includes('情绪外放'))
      assert.ok(d('同学', '', ['什么声音？']).description.includes('追问'))
      const n = d('路人')
      assert.equal(n.basis.age, null)
      assert.ok(n.description.startsWith('普通路人，中性音色'), n.description)
    })
    // ---- cast consistency (look variants sharing a characterKey; synthetic before / after pair)
    const VB = PC('x1', '阿乙（前）', { baseName: '阿乙', characterKey: 'kk', refImage: 'kk_before', wardrobeState: 'before', visualLock: '东亚少年，圆脸，短发乱', costume: '灰色卫衣',
      wardrobeTimeline: [{ state: 'after_coat', fromShotId: 'k3' }],
      wardrobeRefs: { before: { refSet: 'kk_before' }, after_coat: { refSet: null, fallbackRefSet: 'kk_after', look: '下颌利落，短发整齐', costume: '墨绿长大衣' } } } as Partial<PackChar>)
    const VA = PC('x2', '阿乙（后）', { baseName: '阿乙', characterKey: 'kk', refImage: 'kk_after', wardrobeState: 'after', visualLock: '东亚少年，下颌利落，短发整齐', costume: '黑色夹克',
      wardrobeRefs: { after: { refSet: 'kk_after', logoFree: true } } } as Partial<PackChar>)
    const VO = PC('o1', '丙丙', { characterKey: 'oo', refImage: 'oo' } as Partial<PackChar>)
    const vcs = [VB, VA, VO]
    const kshots = () => [
      SH({ id: 'k1', characterIds: ['x1'], visual: '阿乙（前）坐在床边' }),
      SH({ id: 'k2', characterIds: ['x1', 'x2'], visual: '阿乙（前）的脸变成阿乙（后）' }),
      SH({ id: 'k3', episode: 2, characterIds: ['x1', 'o1'], voiceOnly: [], visual: '阿乙（前）揉着眼睛坐起', action: '阿乙（前）打了个哈欠', prompt: '竖屏9:16。主体：阿乙（前），圆脸，短发乱。', dialogue: '早。', speaker: 'x1', speakerName: '阿乙', dialogueLines: [{ speaker: 'x1', speakerName: '阿乙', text: '早。' }] }),
      SH({ id: 'k4', episode: 2, characterIds: ['x1'], visual: '他下床', prompt: '竖屏9:16。主体：17岁东亚少年，圆脸，短发乱。' }),
      SH({ id: 'k5', episode: 2, characterIds: ['x2'], visual: '教室里' }),
    ]
    t('cast consistency: timeline state pointing at the other variant → re-cast (cast, speaker, lines, names), report + wardrobe state kept', () => {
      const r = applyCastConsistency(pack(kshots(), vcs))
      assert.deepEqual(r.corrections.map((c) => `${c.shotId}:${c.from}>${c.to}:${c.wardrobeState}`), ['k3:x1>x2:after_coat', 'k4:x1>x2:after_coat'])
      assert.ok(r.corrections[0].evidence.some((e) => e.includes('kk_after')), r.corrections[0].evidence.join())
      assert.ok(r.corrections[0].textConflict, 'stale text naming the replaced variant is reported')
      assert.equal(r.corrections[1].textConflict, undefined)
      assert.deepEqual(r.warnings, [])
      const [k1, k2, k3, k4] = r.exp.shots
      assert.deepEqual([k1.characterIds, k2.characterIds], [['x1'], ['x1', 'x2']], 'before the switch / the transformation shot untouched')
      assert.deepEqual(k3.characterIds, ['x2', 'o1'])
      assert.equal(k3.speaker, 'x2')
      assert.equal(k3.dialogueLines![0].speaker, 'x2')
      assert.ok(!k3.visual.includes('阿乙（前）') && k3.visual.includes('阿乙（后）') && k3.action.includes('阿乙（后）'))
      assert.deepEqual(k4.castCorrection, { from: 'x1', to: 'x2', characterKey: 'kk', wardrobeState: 'after_coat' })
      const x2 = r.exp.characters.find((c) => c.id === 'x2') as WardrobeMeta
      assert.equal(x2.wardrobeRefs!.after_coat.costume, '墨绿长大衣', 'state refs copied to the target variant')
      // final pass: wardrobe state + solo subject from the pack data (not the stale upstream subject)
      const e = annotateShots(r.exp)
      assert.deepEqual(e.shots[3].wardrobeState, { x2: 'after_coat' })
      assert.deepEqual(e.shots[4].wardrobeState, { x2: 'after' }, 'only the corrected shot keeps the timeline state')
      assert.ok(e.shots[3].prompt.includes('墨绿长大衣') && e.shots[3].prompt.includes('下颌利落') && !e.shots[3].prompt.includes('圆脸'), e.shots[3].prompt)
      assert.ok(e.shots[3].renderReview!.some((n) => n.includes('x1 改为 x2')))
      assert.ok(e.shots[2].prompt.includes('墨绿长大衣'), 'multi-person subject uses the kept state')
      // idempotent
      const again = applyCastConsistency(r.exp)
      assert.deepEqual([again.corrections, again.warnings], [[], []])
      // no shared characterKey → no-op
      assert.deepEqual(applyCastConsistency(pack(kshots(), [{ ...VB, characterKey: 'k_only' } as PackChar, VA, VO])).corrections, [])
    })
    t('cast consistency: ambiguous / text-only / continuity-only signals → unchanged + cast_consistency warning', () => {
      // the state points at two different variants (refs → x2, name → x3) → conflicting
      const VC = PC('x3', '阿乙（中）', { baseName: '阿乙', characterKey: 'kk', refImage: 'kk_mid', wardrobeState: 'after' } as Partial<PackChar>)
      const VA2 = { ...VA, wardrobeState: 'later' } as PackChar
      const r1 = applyCastConsistency(pack(kshots(), [VB, VA2, VC, VO]))
      assert.deepEqual(r1.corrections, [])
      assert.deepEqual([...new Set(r1.warnings.map((w) => `${w.reason}:${w.implied.join('/')}`))], ['conflicting_timeline:x2/x3'])
      assert.deepEqual(r1.exp.shots[2].characterIds, ['x1', 'o1'], 'not changed')
      assert.ok(r1.exp.warnings.some((w) => w.code === 'cast_consistency' && w.shotId === 'k3'))
      // no timeline: text names the other variant → warning only
      const noTl = { ...VB, wardrobeTimeline: [] } as PackChar
      const sh = [SH({ id: 'm1', characterIds: ['x2'] }), SH({ id: 'm2', characterIds: ['x1'], visual: '阿乙（后）站在门口' }), SH({ id: 'm3', characterIds: ['x1'] }), SH({ id: 'm4', characterIds: ['x2'] })]
      const r2 = applyCastConsistency(pack(sh, [noTl, VA, VO]))
      assert.deepEqual(r2.corrections, [])
      assert.deepEqual(r2.warnings.map((w) => `${w.shotId}:${w.reason}`), ['m2:text_names_other_variant', 'm3:continuity_island'])
      assert.deepEqual(r2.exp.shots.map((s) => s.characterIds[0]), ['x2', 'x1', 'x1', 'x2'])
      // warnings are not duplicated on a re-run
      assert.equal(applyCastConsistency(r2.exp).exp.warnings.filter((w) => w.code === 'cast_consistency').length, 2)
    })
    t('cast consistency: repack reports castCorrections / castConsistency', () => {
      const dir = mkdtempSync(join(tmpdir(), 'cast-'))
      const inp = join(dir, 'in.json')
      writeFileSync(inp, JSON.stringify(pack(kshots(), vcs)))
      const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only', '--allow-missing-voice'], { encoding: 'utf8' }))
      assert.deepEqual(rep.castCorrections.map((c: { shotId: string }) => c.shotId), ['k3', 'k4'])
      assert.deepEqual(rep.castConsistency, [])
      const out = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8')) as VideoPipelineExport
      assert.deepEqual(out.shots.find((s) => s.id === 'k4')!.characterIds, ['x2'])
    })
    // ---- drawable text: emotion words / inner monologue / quotes (synthetic text, generic vocabulary)
    t('visualize: emotion words → visible actions in every form (一脸X, X地, 带着X, 有点X, X的…, abstract clause), idempotent', () => {
      const v = (p: string) => visualizePrompt(p).prompt
      assert.equal(v('他一脸尴尬地站着。'), '他站着，视线乱飘、嘴角僵住。')
      assert.equal(v('她得意地笑了。'), '她笑了，嘴角上扬、下巴微抬。')
      assert.equal(v('眼神不闪躲却带点不服气。'), '眼神不闪躲却皱眉、撇嘴。')
      assert.equal(v('他有点紧张。'), '他指节发白、喉结滚动。')
      for (const [w, vis] of Object.entries(EMOTION_VISIBLE))
        for (const part of vis.split('、')) assert.equal(actionWeight(part), 0, `${w} → ${part}: expression-level only, never a new main action (density caps)`)
      assert.equal(v('表演：听到消息的震惊，手指发抖。'), '表演：瞪大眼睛、身体僵住，手指发抖。')
      assert.equal(v('带着委屈，嘴角下撇。'), '眼眶泛红，嘴角下撇。', 'visible parts already in the line are not repeated')
      assert.equal(v('嘴角挂着无奈的笑。'), '嘴角挂着笑，眉毛塌下、轻叹一口气。')
      assert.equal(v('0–2秒：他无奈地坐下。\n2–4秒：她无奈地摇头，嫌弃。'), '0–2秒：他坐下，眉毛塌下、轻叹一口气。\n2–4秒：她摇头，皱鼻、身子后仰。', 'a visible action is written once per prompt')
      const once = v('0–2秒，正常节奏：他害羞地低下头，有点生气。')
      assert.ok(!EMOTION_RE.test(once), once)
      assert.equal(v(once), once, 'idempotent')
      assert.deepEqual(visualizePrompt('他转身。').rewrites, [], 'no emotion word → untouched')
    })
    t('visualize: inner-monologue clauses dropped (visible action kept), quotes + quoted content stripped (speech → 嘴唇开合)', () => {
      const r = visualizePrompt('0–2秒，正常节奏：他攥紧拳头，心想这次不能输，眼睛盯着门。')
      assert.equal(r.prompt, '0–2秒，正常节奏：他攥紧拳头，眼睛盯着门。')
      assert.deepEqual(r.rewrites.map((x) => x.kind), ['inner'])
      assert.equal(visualizePrompt('他暗想：完了。').prompt, '')
      assert.equal(visualizePrompt('他抬头说：“走吧”。').prompt, '他抬头开口说话，嘴唇开合。')
      for (const q of ['「快跑」', '『快跑』', '‘快跑’', '"快跑"', "'快跑'", '《快跑》', '“快跑”']) {
        const p = visualizePrompt(`墙上贴着${q}的纸，他回头。`).prompt
        assert.ok(!QUOTE_RE.test(p) && !p.includes('快跑'), `${q}: ${p}`)
      }
      assert.equal(visualizePrompt('他回头”。').prompt, '他回头。', 'stray quote marks removed')
      assert.equal(visualizePrompt('限制：不出现“字”。').prompt, '限制：不出现“字”。', 'style / limit lines untouched (gate catches them)')
    })
    t('visualize in the final render pass: notes + prompt tail rules (景别 + no-text line) still hold; gate', () => {
      const raw = '竖屏9:16，5秒单镜。白天，教室，单人。\n主体：17岁东亚少年，米白夹克。\n时间轴（按秒变速）：\n0–2.5秒，正常节奏：他一脸慌张地站起，心里打鼓。\n2.5–5秒，接着放慢：他说：“我没有”。\n镜头：固定机位，不切镜。'
      const r = renderPrompt(raw, 'medium')
      const lines = r.prompt.split('\n')
      assert.equal(lines[lines.length - 1], NO_TEXT_CONSTRAINT)
      assert.ok(lines[lines.length - 2].startsWith('景别：'))
      assert.deepEqual(promptTextRisks(r.prompt), [], r.prompt)
      assert.ok(r.notes.some((n) => n.startsWith('情绪词改为可见动作：')) && r.notes.some((n) => n.startsWith('删去心理活动：')) && r.notes.some((n) => n.startsWith('删去引号内容：')), r.notes.join('|'))
      assert.deepEqual(parseRewriteNote(r.notes.find((n) => n.startsWith('删去心理活动：'))!), { kind: 'inner', from: '心里打鼓', to: '' })
      assert.equal(renderPrompt(r.prompt, 'medium').prompt, r.prompt, 'idempotent')
      assert.deepEqual(promptTextRisks('他“笑”。\n限制：无。'), ['quote “”'])
      assert.deepEqual(promptTextRisks('他很紧张，心想快跑。'), ['emotion 紧张', 'inner 心想'])
      // repack: a quote left in a line the rewrite never touches fails the run (exit 4), no pack written
      const dir = mkdtempSync(join(tmpdir(), 'txt-'))
      const inp = join(dir, 'in.json')
      writeFileSync(inp, JSON.stringify(pack([SH({ id: 'q1', prompt: '竖屏9:16。白天，房间。主体：17岁东亚少年，米白夹克。他有点紧张。风格：真人实拍“胶片”质感。' })])))
      let code = 0
      let err = ''
      try {
        execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only'], { encoding: 'utf8', stdio: 'pipe' })
      } catch (x) {
        code = (x as { status: number }).status
        err = String((x as { stderr: string }).stderr)
      }
      assert.equal(code, 4, err)
      assert.ok(err.includes('q1: quote'), err)
      assert.ok(!existsSync(join(dir, 'out.json')))
      writeFileSync(inp, JSON.stringify(pack([SH({ id: 'q1', durationSec: 5, prompt: '竖屏9:16。白天，房间。主体：17岁东亚少年，米白夹克。时间轴：0–5s他有点紧张，心想别出错。', action: '他有点紧张，心想别出错' })])))
      const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only'], { encoding: 'utf8' }))
      assert.ok(rep.emotionRewrites.length === 1 && rep.emotionRewrites[0].rewrites.some((x: { kind: string }) => x.kind === 'emotion'), JSON.stringify(rep.emotionRewrites))
    })
    t('dialogue overrun: estimated speech (chars / rate + pauses) vs the line slot, configurable rate, remedy within 5–9 s', () => {
      assert.ok(Math.abs(speechSec('一二三四五六七八……九十。') - 3.4) < 1e-9, 'calibration: 10 chars + …… + 。')
      assert.ok(Math.abs(speechSec('一二三四', { charsPerSec: 2 }) - 2) < 1e-9)
      const L = (text: string, startSec: number, endSec: number) => ({ speaker: 'a1', speakerName: '甲', text, startSec, endSec })
      const shots = [
        SH({ id: 'o1', durationSec: 6, dialogueLines: [L('一二三四五六七八……九十。', 2, 5)] }),
        SH({ id: 'o2', durationSec: 9, dialogueLines: [L('一二三四五六七八九十十一十二。', 6, 9)] }),
        SH({ id: 'o3', durationSec: 5, dialogueLines: [L('好。', 1, 4)] }),
        SH({ id: 'o4', durationSec: 3, dialogueLines: [L('一二三四五六七八九十。', 1, 3)] }),
      ]
      const o = dialogueOverruns(shots)
      assert.deepEqual(o.map((x) => [x.id, x.overrunSec]), [['o1', 0.4], ['o2', 0.8], ['o4', 0.8]])
      assert.ok(o[0].remedy.includes('6.5 秒') && o[0].remedy.includes('5–9'), o[0].remedy)
      assert.ok(o[1].remedy.includes('拆分'), o[1].remedy)
      assert.ok(o[2].remedy.includes('至 4 秒') && o[2].remedy.includes('仍短于 5 秒'), o[2].remedy)
      assert.deepEqual(dialogueOverruns(shots, { charsPerSec: 6 }).map((x) => x.id), [], 'faster rate → no overrun')
    })
    // ---- dialogue fit: lengthen a shot whose dialogue segment cannot hold estimated speech + head / tail pad
    const DL = (text: string, speaker = 'a1') => ({ speaker, speakerName: speaker === 'a1' ? '甲' : null, text })
    const timing = (s: VideoPipelineShot) => {
      const head = Number(s.prompt.match(/竖屏9:16，([\d.]+)秒单镜/)?.[1])
      const labels = [...s.prompt.matchAll(/^([\d.]+)–([\d.]+)秒/gm)].map((m) => [Number(m[1]), Number(m[2])])
      const g = s.beatSegments!
      assert.equal(head, s.durationSec, `${s.id} header`)
      assert.deepEqual(labels, g.map((x) => [x.start, x.end]), `${s.id} time labels = beat segments`)
      assert.equal(g[0].start, 0)
      assert.equal(g[g.length - 1].end, s.durationSec)
      g.slice(1).forEach((x, i) => assert.equal(x.start, g[i].end, `${s.id} contiguous`))
      for (const x of g) assert.ok(x.end - x.start >= 1 - 1e-9, `${s.id} segment ≥ 1 s`)
      for (const l of s.dialogueLines || []) assert.ok(l.startSec! >= 0 && l.endSec! <= s.durationSec + 1e-9, `${s.id} line inside`)
    }
    t('dialogue need: Σ estimated speech + head / tail pad, per dialogue segment in line order', () => {
      assert.ok(Math.abs(dialogueNeedSec(['一二三四五六七八……九十。']) - 4.1) < 1e-9, '3.4 + 0.3 + 0.4')
      assert.equal(dialogueNeedSec([]), 0)
      assert.ok(Math.abs(dialogueNeedSec(['一二三四'], { charsPerSec: 2 }, { headSec: 0, tailSec: 0.5 }) - 2.5) < 1e-9)
      const n = dialogueSegmentNeeds(['一二三四', '一二三四', '一二三四'], 2)
      assert.ok(Math.abs(n[0] - 1.7) < 1e-9 && Math.abs(n[1] - 2.7) < 1e-9, String(n))
    })
    t('dialogue fit: short dialogue shot lengthened to need (0.5 s grid, not more), segments / labels / lines re-timed, idempotent', () => {
      const line = '一二三四五六七八九十十一十二十三十四。' // 16 chars → 4.3 s speech, need 5.0 s
      const s = SH({ id: 'f1', durationSec: 3, action: '他推门进来，环顾四周，开口说话', dialogueLines: [DL(line)], dialogue: line, speaker: 'a1', speakerName: '甲' })
      const e = annotateShots(applyBeatMode(pack([s])))
      const o = e.shots[0]
      const need = dialogueNeedSec([line])
      const dseg = o.beatSegments!.find((g) => g.dialogue)!
      assert.ok(dseg.end - dseg.start >= need - 1e-9, `dialogue segment ${dseg.start}–${dseg.end} < ${need}`)
      assert.equal(o.durationSec, Math.ceil((need + 1) * 2) / 2, 'need + the ≥1 s other segment, rounded up to 0.5 s')
      assert.deepEqual({ ...o.durationAdjustment, reason: '' }, { fromSec: 3, toSec: o.durationSec, reason: '' })
      assert.ok(o.durationAdjustment!.reason.includes('留白'))
      timing(o)
      assert.deepEqual(dialogueOverruns(e.shots), [])
      for (const g of o.beatSegments!) {
        const l = o.prompt.split('\n').find((x) => x.startsWith(`${g.start}–${g.end}秒`))!
        const body = l.replace(/^[^：]*：/, '').replace(/动作放慢，?/, '').split('；')[0]
        assert.ok(countActions(body.split(/[，。]/).filter(Boolean)) <= actionCap(g.speed, g.dialogue), `density ${l}`)
      }
      const again = annotateShots(applyBeatMode(e))
      assert.equal(again.shots[0].durationSec, o.durationSec, 'idempotent: starts from the source length')
      assert.equal(again.shots[0].prompt, o.prompt)
      assert.deepEqual(again.shots[0].durationAdjustment, o.durationAdjustment)
    })
    t('dialogue fit: fits already → untouched; at 9 s cap → no extension past 9, overrun stays with split remedy; opt-out / hand beats', () => {
      const fits = SH({ id: 'f2', durationSec: 6, action: '他坐下，开口说话', dialogueLines: [DL('好。')], dialogue: '好。', speaker: 'a1', speakerName: '甲' })
      const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十。'
      const big = SH({ id: 'f3', durationSec: 6, action: '他站着，开口说话', dialogueLines: [DL(long)], dialogue: long, speaker: 'a1', speakerName: '甲' })
      const e = annotateShots(applyBeatMode(pack([fits, big])))
      assert.equal(e.shots[0].durationSec, 6)
      assert.equal(e.shots[0].durationAdjustment, undefined)
      assert.equal(e.shots[1].durationSec, 9, 'capped at 9')
      assert.equal(e.shots[1].durationAdjustment!.toSec, 9)
      timing(e.shots[1])
      const o = dialogueOverruns(e.shots)
      assert.equal(o.length, 1)
      assert.ok(o[0].remedy.includes('拆分镜头或缩短台词'), o[0].remedy)
      assert.equal(applyBeatMode(pack([big]), { fitDialogue: false }).shots[0].durationSec, 6, 'opt-out')
      assert.equal(applyBeatMode(pack([big]), { maxShotSec: 7 }).shots[0].durationSec, 7, 'configurable cap')
      const pad0 = applyBeatMode(pack([SH({ ...big, id: 'f4', dialogueLines: [DL('一二三四五六七八九十十一十二。')], dialogue: 'x' })]), { dialoguePad: { headSec: 0, tailSec: 0 } }).shots[0]
      const padBig = applyBeatMode(pack([SH({ ...big, id: 'f4', dialogueLines: [DL('一二三四五六七八九十十一十二。')], dialogue: 'x' })]), { dialoguePad: { headSec: 1, tailSec: 1 } }).shots[0]
      assert.ok(padBig.durationSec > pad0.durationSec, `pad configurable ${pad0.durationSec} / ${padBig.durationSec}`)
    })
    t('dialogue fit: two dialogue segments each hold their own line; source timeline times scale with the new length', () => {
      const a = '一二三四五六七八九十十一十二。'
      const b = '一二三四五六七八九十十一十二。'
      const two = SH({
        id: 'f5', durationSec: 5,
        prompt: '竖屏9:16，5秒单镜。白天，房间，单人。主体：17岁东亚少年，米白夹克。时间轴（一镜5秒，小节拍）：0–2.5s他抬头看向窗外（甲开口说台词）；2.5–5s随后他低头看手里的纸（甲开口说台词）。镜头：中景。',
        dialogueLines: [DL(a), DL(b)], dialogue: a + b, speaker: 'a1', speakerName: '甲',
      })
      const e = annotateShots(applyBeatMode(pack([two])))
      const o = e.shots[0]
      timing(o)
      const d = o.beatSegments!.filter((g) => g.dialogue)
      assert.equal(d.length, 2, 'two dialogue segments')
      const needs = dialogueSegmentNeeds([a, b], d.length)
      d.forEach((g, i) => assert.ok(g.end - g.start >= needs[i] - 1e-9, `segment ${i} ${g.start}–${g.end} < ${needs[i]}`))
      assert.ok(o.durationSec > 5 && o.durationSec <= 9, String(o.durationSec))
      assert.deepEqual(dialogueOverruns(e.shots), [])
    })
    t('dialogue fit in repack: durationAdjustments (shot, old, new, reason), --dialogue-pad, rhythm still reported', () => {
      const dir = mkdtempSync(join(tmpdir(), 'fit-'))
      const inp = join(dir, 'in.json')
      const line = '一二三四五六七八九十十一十二十三十四。'
      writeFileSync(inp, JSON.stringify(pack([
        SH({ id: 'r1', durationSec: 6, action: '他走进来，放下包' }),
        SH({ id: 'r2', durationSec: 3, action: '他推门进来，开口说话', dialogueLines: [DL(line)], dialogue: line, speaker: 'a1', speakerName: '甲' }),
      ])))
      const run = (...x: string[]) => JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', inp, join(dir, 'out.json'), '--beat-only', '--allow-missing-voice', ...x], { encoding: 'utf8' }))
      const rep = run()
      assert.deepEqual(rep.durationAdjustments.map((x: { shot: string; old: number }) => [x.shot, x.old]), [['r2', 3]])
      const nu = rep.durationAdjustments[0].new
      assert.ok(nu >= Math.ceil((dialogueNeedSec([line]) + 1) * 2) / 2 && nu <= 9 && nu * 2 === Math.round(nu * 2), String(nu))
      assert.ok(rep.durationAdjustments[0].reason)
      assert.deepEqual(rep.durationAdjustmentTotals, [{ ep: 1, shots: 1, addedSec: nu - 3 }])
      assert.deepEqual(rep.dialogueOverrun, [])
      assert.deepEqual(rep.renderHold, [], 'the extended (fixed) shot is not held')
      assert.ok(rep.rhythmCheck && typeof rep.rhythmCheck.ok === 'boolean')
      assert.equal(rep.perEp[0].secsAfter, 6 + nu, 'total episode duration change visible in perEp')
      const big = run('--dialogue-pad', '1,1.5')
      assert.ok(big.durationAdjustments[0].new > 6, JSON.stringify(big.durationAdjustments))
      assert.deepEqual(big.dialoguePad, { headSec: 1, tailSec: 1.5 })
    })
    t('known limitations: every medium / full shot with 2+ on screen gets the one-ref first-frame note (generic)', () => {
      const e = annotateShots(pack([
        SH({ id: 'm2', characterIds: ['a1', 'b1'], size: '中景' }),
        SH({ id: 'f2', characterIds: ['a1', 'b1'], size: '全景' }),
        SH({ id: 's1', characterIds: ['a1'], size: '近景', dialogue: '嗯。', speaker: 'a1', speakerName: '甲' }),
        SH({ id: 'vo', characterIds: ['a1', 'b1'], voiceOnly: ['b1'], size: '中景' }),
      ]))
      const k = knownLimitations(e)
      assert.deepEqual(k.map((x) => [x.id, x.framing, x.firstFrameRef]), [['m2', 'medium', 'a1'], ['f2', 'full', 'a1']])
      assert.ok(k.every((x) => x.note === MULTI_REF_LIMITATION))
    })
  }

  t('repack: override file is opt-in only (no flag → nothing read, no beatOverride, rule-only corrections)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repack-'))
    const out = join(dir, 'pack.json')
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', P2, out, '--beat-only', '--split-crosscut'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
    assert.deepEqual(rep.voiceMissing, [], 'default repack passes: every line voiced')
    // look variants: shots re-cast by the wardrobe timeline; the output pack has no remaining contradiction
    assert.ok(rep.castCorrections.length > 0 && rep.castCorrections.every((c: { from: string; to: string; evidence: string[] }) => c.from !== c.to && c.evidence.length))
    assert.ok(Array.isArray(rep.emotionRewrites) && Array.isArray(rep.dialogueOverrun) && rep.speechRate.charsPerSec > 0)
    // dialogue fit: lengthened shots stay on the 0.5 s grid ≤ 9 s; what still overruns is at the 9 s cap (split remedy)
    assert.ok(rep.durationAdjustments.length > 0 && rep.durationAdjustments.every((x: { old: number; new: number }) => x.new > x.old && x.new <= 9 && x.new * 2 === Math.round(x.new * 2)))
    assert.ok(rep.dialogueOverrun.every((o: { durationSec: number; remedy: string }) => o.durationSec >= 9 && o.remedy.includes('拆分')), JSON.stringify(rep.dialogueOverrun))
    assert.equal(rep.rhythmCheck.ok, true, rep.rhythmCheck.warnings.join('; '))
    assert.deepEqual(rep.carryChainErrors, [])
    // render hold: derived, every held shot has reasons; ep1 clear; s1-13a (merged density / voice / order) not held
    assert.ok(rep.renderHold.every((h: { shotId: string; reasons: string[] }) => h.reasons.length))
    assert.deepEqual(rep.renderHold.filter((h: { episode: number }) => h.episode === 1), [])
    const outPack = JSON.parse(readFileSync(out, 'utf8'))
    assert.equal(outPack.shots.find((s: VideoPipelineShot) => s.id === 's1-13a').hold, null)
    assert.ok(outPack.shots.every((s: VideoPipelineShot) => 'hold' in s))
    assert.deepEqual(rep.renderHold.map((h: { shotId: string }) => h.shotId), outPack.shots.filter((s: VideoPipelineShot) => s.hold).map((s: VideoPipelineShot) => s.id))
    for (const s of outPack.shots) assert.deepEqual(promptTextRisks(s.prompt), [], s.id)
    assert.deepEqual(applyCastConsistency(JSON.parse(readFileSync(out, 'utf8'))).corrections, [])
    assert.equal(rep.overridesFile, null)
    // every line of a listed character has a voice (look variants via characterKey); only off-list bit parts may lack one
    const e0 = JSON.parse(readFileSync(out, 'utf8')) as VideoPipelineExport
    for (const s of e0.shots) for (const l of s.dialogueLines || []) {
      assert.ok(l.voice, `${s.id} ${l.speakerName}`)
      assert.equal(Boolean(l.autoVoice), !l.speaker, `${s.id} ${l.speakerName}: auto only for off-list speakers`)
    }
    assert.ok(rep.knownLimitations.multiPersonFirstFrame.count > 0)
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
    // round 4: two-person subject from each character's own data + wardrobe state; no contradictions; no paraphrase repeat
    const sub18 = m['s1-18'].prompt.match(/主体：[^\n]*/)![0].split('；')
    const c1 = e.characters.find((c) => c.id === 'c1')!
    const c2 = e.characters.find((c) => c.id === 'c2')!
    assert.ok(sub18[0].includes((c1.costumePrompt || c1.costume).split('，')[0]) && !sub18[0].includes('夹克'), sub18[0])
    assert.ok(sub18[1].includes(c2.costume.split('，')[0]) && !sub18[1].includes('卫衣'), sub18[1])
    assert.ok(/穿夹克的少年正脸朝镜头开口/.test(m['s1-18'].prompt), 'the speaker (c2) is referred to by their own garment')
    assert.ok(!m['s1-18'].prompt.includes('压不住地翘'), 's1-18 paraphrase repeat')
    assert.ok(!/无人物/.test(m['s1-18'].prompt) && m['s1-18'].renderReview!.length > 0)
    assert.ok(/镜头：[^\n]*双人中景/.test(m['s1-18'].prompt), 's1-18 camera reads as a two-shot')
    // QA scan over every shot: no subject / framing / camera / 无人物 disagreement left
    const bad = scanPack(e).filter((x) => !['repeat', 'pronoun'].includes(x.kind))
    assert.deepEqual(bad, [], JSON.stringify(bad))
    for (const s of e.shots) {
      const lines = s.prompt.split('\n').slice(1).filter((l) => !/^(?:景别|风格|限制)/.test(l))
      if (s.framing !== 'empty') assert.ok(!lines.some((l) => /无人物|空镜/.test(l)), `${s.id} 无人物 with people on screen`)
      if (s.characterIds.length >= 2) {
        const parts = s.prompt.match(/主体：[^\n]*/)![0].split('；')
        assert.equal(new Set(parts.map((x) => x.replace(/^.*其.：/, ''))).size, parts.length, `${s.id} distinct subjects`)
      }
    }
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
    const rep = JSON.parse(execFileSync('npx', ['tsx', 'scripts/repack.ts', FIX, out, '--beat-only', '--split-crosscut', '--allow-missing-voice'], { encoding: 'utf8', maxBuffer: 64 << 20 }))
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
