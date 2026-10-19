/** npx tsx scripts/test-video-export.ts — fixtures for video-pipeline@1 export */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildVideoPipelineExport, dialogueSec, indirectUiCue, INDIRECT_UI_CUE, extractOverlay, type VideoPipelineExport, type VideoPipelineShot } from '../src/lib/videoExport'
import { addConstraint, ensureSinglePrefixedClause, fixTimeWords, hasNightConflict, lockPromptStyle, mergeEpisodeShots, NO_BADGE_CONSTRAINT, OFFSCREEN_VOICE_CONSTRAINT, postProcessExport, stripLogoText } from '../src/lib/segmentPost'
import { classifySettingFact, factsForShotPrompts, tierSettingFacts } from '../src/lib/settingFacts'
import { styleTag } from '../src/lib/templates/styleTag'
import type { Character, Project, Shot } from '../src/types'
import { writeFileSync } from 'node:fs'
import { parseDialogue } from '../src/lib/videoExport'
import { FACTS_HEADER, outlineUser, scriptUser, shotCountRange, storyboardUser } from '../src/lib/prompts'
import { OUTLINE_SYSTEM, SCRIPT_SYSTEM, STORYBOARD_SYSTEM } from '../src/lib/llm'
import { IDEA_SYSTEM, mergeLockedCharacters, parseIdeaJson, toCharacters } from '../src/lib/idea'
import { generateScript, generateStoryboard } from '../src/lib/templates'

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id, name, role: '角色', visualLock: '短发', costume: '黑夹克', signatureProp: '芯片', ...extra,
})
const chars = [
  C('c1', '林川'), C('c2', '赵泽'), C('c3', '苏晴', { costume: '' }),
  C('c4', '白朴（变帅前）', { baseName: '白朴' }), C('c5', '白朴（变帅后）', { baseName: '白朴' }),
  C('c6', '系统小转', { role: '导师·系统化身', tags: ['mentor'] }),
]
let n = 0
const S = (p: Partial<Shot>): Shot => ({
  id: `t${++n}`, shotNo: n, size: '中景', durationSec: 4, visual: '写字楼大堂', action: '站立', dialogue: '',
  camera: '固定', emotion: '', seedancePrompt: '', ...p,
})
const ep1: Shot[] = [
  S({ durationSec: 3, characterIds: ['c1'], dialogue: '林川：「我今天就要让你们所有人都知道，这家公司本来就是我父亲的，你们欠他的全部都要还回来！」' }),
  S({ durationSec: 6, characterIds: [] , visual: '空镜，城市夜景', action: '镜头缓缓推进' }),
  S({ durationSec: 5, characterIds: ['c1', 'c2'], dialogue: '林川：「你输了。」赵泽（冷笑）：「是吗？」' }),
  S({ durationSec: 4, characterIds: ['c2'], dialogue: '无', action: '赵泽转身，音效：砰' }),
  S({ durationSec: 1, characterIds: [], visual: '走廊', action: '灯光闪烁' }),
  S({ durationSec: 1.5, characterIds: [], visual: '门口', action: '门被推开' }),
  S({ durationSec: 4, characterIds: ['c1'], dialogue: '苏晴（OS）：「小心身后。」' }),
  S({ durationSec: 5, characterIds: ['c1'], visual: '林川面前弹出系统视窗，显示『任务：反击』', seedancePrompt: '竖屏9:16。主体：林川面前弹出系统视窗，显示『任务：反击』。动作：抬手。', dialogue: '系统：「检测到宿主觉醒」' }),
  S({ durationSec: 6, characterIds: ['c1'], action: '林川拿起芯片，随后插入电脑', seedancePrompt: '主体：林川。动作：林川拿起芯片，随后插入电脑。' }),
  S({ durationSec: 4, characterIds: ['c2'], dialogue: '【音效】玻璃碎裂 赵泽：「谁？」' }),
  S({ durationSec: 4, characterIds: ['c1'], voiceOnly: ['苏晴'], dialogue: '苏晴：「我在电话里。」' }),
  S({ durationSec: 4, characterIds: ['c1'], dialogue: '「这一次，我不会再退。」' }),
  S({ durationSec: 4, characterIds: ['c5'], dialogue: '白朴：「认得我吗？」' }),
  S({ durationSec: 3, characterIds: ['c1', 'c2'], dialogue: '「谁在说话？」' }),
  S({ durationSec: 14, characterIds: ['c2'], dialogue: '赵泽：「三年前你父亲签下那份合同的时候，就已经注定了今天的结局。你以为一枚芯片能翻盘？我告诉你，整座城市都是赵家的棋盘！」' }),
  S({ durationSec: 4, characterIds: ['c1'], dialogue: '林川（内心）：「不能再退了。」' }),
  // t17 constraint + description in overlay/prompt, quoted UI kept
  S({ durationSec: 4, characterIds: ['c1'], visual: '手机屏幕弹出消息「本月第47枚」，小转眼睛是两个转盘', overlayText: ['限制：不出现文字与界面元素', '眼睛是两个不停旋转的转盘', '颜值 +100', '颜值 +100', '无字幕无水印'],
    seedancePrompt: '主体：林川低头看手机。限制：不出现文字与界面元素，无字幕无水印。' }),
  // t18 no UI at all → no cue, constraint stays in prompt
  S({ durationSec: 4, characterIds: ['c2'], seedancePrompt: '主体：赵泽站在窗边。限制：画面内不出现任何文字与界面元素。' }),
  // t19 system character lines → overlay only; human line split
  S({ durationSec: 6, characterIds: ['c1', 'c6'], dialogue: '系统小转：「检测到宿主忍耐值归零。」林川：「什么东西？」' }),
  // t20 two onscreen
  S({ durationSec: 4, characterIds: ['c1', 'c3'], dialogue: '苏晴：「走吧。」' }),
  // t21 off-list bit part
  S({ durationSec: 4, characterIds: ['c1'], dialogue: '收银员：「余额不足。」' }),
  // t22 系统提示： label
  S({ durationSec: 4, characterIds: ['c1'], visual: '系统提示：愿望已记录', seedancePrompt: '主体：林川。' }),
]
const project: Project = {
  id: 'p_test', title: '测试', genre: '都市逆袭', platform: '红果', episodeCount: 1, secondsPerEp: 60, style: '真人都市',
  logline: '', characters: chars, outline: [], scripts: {}, storyboards: { 1: ep1 }, selectedEpisode: 1, updatedAt: '',
}
const out = buildVideoPipelineExport(project, { mergeToSegments: false })
let pass = 0
const t = (name: string, fn: () => void) => { fn(); pass++; console.log('✓', name) }
const parent = (id: string) => out.shots.filter((s) => (s.segment?.parentId ?? s.id) === id)

t('episode total preserved', () => {
  const orig = ep1.reduce((a, s) => a + s.durationSec, 0)
  const got = out.shots.reduce((a, s) => a + s.durationSec, 0)
  assert.equal(Math.round(got * 10), Math.round(orig * 10))
})
t('all segments 2–10s', () => out.shots.forEach((s) => assert.ok(s.durationSec >= 2 && s.durationSec <= 10, `${s.id} ${s.durationSec}`)))
t('dialogue fits pace or warned', () => out.shots.forEach((s) => {
  if (dialogueSec(s.dialogue) > s.durationSec + 1e-9) assert.ok(out.warnings.some((w) => w.shotId === s.id && w.code === 'dialogue_too_long'), s.id)
}))
t('long dialogue (3s, 36+ chars) lengthened/split', () => {
  const p = parent('t1')
  assert.ok(p.reduce((a, s) => a + s.durationSec, 0) > 3)
  p.forEach((s) => { assert.equal(s.speaker, 'c1'); assert.ok(!s.dialogue.startsWith('林川')) })
})
t('multi-speaker split per speaker', () => {
  const p = parent('t3')
  assert.equal(p.length, 2)
  assert.deepEqual(p.map((s) => s.speaker), ['c1', 'c2'])
  assert.deepEqual(p.map((s) => s.dialogue), ['你输了。', '是吗？'])
})
t('无 → empty dialogue; 音效：砰 → sfx', () => {
  const [s] = parent('t4')
  assert.equal(s.dialogue, ''); assert.equal(s.speaker, null); assert.deepEqual(s.sfx, ['砰']); assert.ok(!s.action.includes('音效'))
})
t('1s / 1.5s shots ≥2s', () => { assert.ok(parent('t5')[0].durationSec >= 2); assert.ok(parent('t6')[0].durationSec >= 2) })
t('OS voice → voiceOnly, speaker filled', () => {
  const [s] = parent('t7')
  assert.equal(s.speaker, 'c3'); assert.deepEqual(s.voiceOnly, ['c3']); assert.deepEqual(s.characterIds, ['c1'])
})
t('系统视窗 → overlayText, prompt indirect, 系统 not speaker', () => {
  const [s] = parent('t8')
  assert.ok(s.overlayText.includes('任务：反击')); assert.ok(s.overlayText.includes('检测到宿主觉醒'))
  assert.ok(!/系统视窗|『/.test(s.prompt), s.prompt); assert.ok(s.prompt.includes('蓝光映在角色脸上'))
  assert.equal(s.dialogue, ''); assert.equal(s.speaker, null)
})
t('随后 → sequential segments with action parts', () => {
  const p = parent('t9')
  assert.deepEqual(p.map((s) => s.action), ['林川拿起芯片', '插入电脑'])
  assert.ok(p[1].prompt.includes('插入电脑') && !p[1].prompt.includes('随后'))
  p.forEach((s) => assert.ok(s.durationSec >= 2))
})
t('【音效】 removed from dialogue', () => { const [s] = parent('t10'); assert.deepEqual(s.sfx, ['玻璃碎裂']); assert.equal(s.dialogue, '谁？'); assert.equal(s.speaker, 'c2') })
t('onscreen char + voiceOnly speaker with prefix', () => {
  const [s] = parent('t11'); assert.equal(s.speaker, 'c3'); assert.deepEqual(s.voiceOnly, ['c3']); assert.deepEqual(s.characterIds, ['c1'])
})
t('no prefix, single candidate → that char', () => assert.equal(parent('t12')[0].speaker, 'c1'))
t('baseName prefix picks onscreen variant', () => { const [s] = parent('t13'); assert.equal(s.speaker, 'c5'); assert.equal(s.speakerName, '白朴') })
t('ambiguous no-prefix → null + warning', () => {
  const [s] = parent('t14'); assert.equal(s.speaker, null)
  assert.ok(out.warnings.some((w) => w.shotId === s.id && w.code === 'speaker_unresolved'))
})
t('characters: baseName + costume warning', () => {
  assert.equal(out.characters.find((c) => c.id === 'c4')?.baseName, '白朴')
  assert.ok(out.warnings.some((w) => w.characterId === 'c3' && w.code === 'character_missing_costume'))
})
t('>10s dialogue split at sentence punctuation', () => {
  const p = parent('t15')
  assert.ok(p.filter((s) => s.dialogue).length >= 2); p.filter((s) => s.dialogue).forEach((s) => { assert.equal(s.speaker, 'c2'); assert.ok(dialogueSec(s.dialogue) <= s.durationSec + 1e-9, s.id) })
})
t('indirectUiCue helper', () => assert.equal(indirectUiCue('主体：少年，转盘在空中旋转。'), '主体：少年，蓝光映在角色脸上，神情专注。'))
t('indirectUiCue keeps constraint clauses', () => assert.equal(indirectUiCue('主体：少年。限制：不出现文字与界面元素。'), '主体：少年。限制：不出现文字与界面元素。'))
t('constraint lines not in overlay; constraint kept in prompt', () => {
  const [s] = parent('t17')
  assert.ok(!s.overlayText.some((o) => /不出现|限制|禁止|无字幕/.test(o)), JSON.stringify(s.overlayText))
  assert.ok(s.prompt.includes('不出现文字与界面元素'), s.prompt)
})
t('description not in overlay', () => assert.ok(!parent('t17')[0].overlayText.some((o) => /转盘|眼睛/.test(o))))
t('quoted UI text kept + deduped', () => assert.deepEqual(parent('t17')[0].overlayText, ['颜值 +100', '本月第47枚']))
t('extractOverlay: 「」 after UI keyword only', () => {
  assert.deepEqual(extractOverlay('屏幕显示「余额不足」，他说「好」'), ['余额不足'])
  assert.deepEqual(extractOverlay('小人眼睛是两个转盘，限制：不出现文字'), [])
})
t('系统提示： label → overlay', () => assert.deepEqual(parent('t22')[0].overlayText, ['愿望已记录']))
t('cue only on UI segments', () => {
  out.shots.forEach((s) => { if (s.prompt.includes(INDIRECT_UI_CUE)) assert.ok(s.overlayText.length, `${s.id} cue without overlay`) })
  assert.ok(!parent('t18')[0].prompt.includes(INDIRECT_UI_CUE)); assert.ok(parent('t17')[0].prompt.includes(INDIRECT_UI_CUE))
})
t('system character lines overlay-only', () => {
  const p = parent('t19')
  assert.ok(p.some((s) => s.overlayText.includes('检测到宿主忍耐值归零。')))
  p.forEach((s) => { assert.ok(!s.dialogue.includes('检测到')); assert.ok(!s.voiceOnly.includes('c6')); if (s.speaker) assert.notEqual(s.speaker, 'c6') })
  assert.ok(p.some((s) => s.speaker === 'c1' && s.dialogue === '什么东西？'))
  assert.ok(p.every((s) => s.characterIds.includes('c6')), 'system onscreen status preserved')
})
t('multi_character_shot warning', () => {
  for (const id of ['t3', 't19', 't20']) assert.ok(out.warnings.some((w) => w.code === 'multi_character_shot' && parent(id).some((s) => s.id === w.shotId)), id)
  assert.ok(!out.warnings.some((w) => w.code === 'multi_character_shot' && w.shotId === 't21'))
})
t('off-list speaker → speakerName, speaker null, speaker_offlist', () => {
  const [s] = parent('t21')
  assert.equal(s.speaker, null); assert.equal(s.speakerName, '收银员'); assert.equal(s.dialogue, '余额不足。')
  assert.ok(out.warnings.some((w) => w.shotId === s.id && w.code === 'speaker_offlist'))
  assert.ok(!out.warnings.some((w) => w.shotId === s.id && w.code === 'speaker_unresolved'))
})
t('内心 onscreen → stay in characterIds + voiceOnly, speaker filled', () => {
  const [s] = parent('t16')
  assert.equal(s.speaker, 'c1')
  assert.ok(s.characterIds.includes('c1'), 'onscreen 内心 should remain in characterIds')
  assert.ok(s.voiceOnly.includes('c1'), 'onscreen 内心 should also be in voiceOnly')
  assert.equal(s.dialogue, '不能再退了。')
})
t('all durationSec multiples of 0.5 (fixtures)', () => {
  out.shots.forEach((s) => assert.ok(Math.abs(s.durationSec % 0.5) < 1e-9, `${s.id} ${s.durationSec}`))
})
t('all durationSec multiples of 0.5 (sample)', () => {
  const sample = JSON.parse(readFileSync('samples/video-pipeline.sample.json', 'utf8')) as { shots: { id: string; durationSec: number }[] }
  sample.shots.forEach((s) => assert.ok(Math.abs(s.durationSec % 0.5) < 1e-9, `sample ${s.id} ${s.durationSec}`))
})
// ---------- real export 《每天变帅一点点》 reconstructed into a Project ----------
type XS = { episode: number; shotNo: number; id: string; characterIds: string[]; prompt: string; visual: string; action: string; durationSec: number
  dialogue: string; speakerName: string | null; voiceOnly: string[]; sfx: string[]; overlayText: string[]; camera: string; size: string; emotion: string; segment?: { parentId: string } }
const real = JSON.parse(readFileSync('scripts/fixtures/real-export-meitian.json', 'utf8')) as { project: Project; characters: Character[]; shots: XS[] }
const rsb: Project['storyboards'] = {}
const byP = new Map<string, XS[]>()
for (const x of real.shots) { const k = x.segment?.parentId ?? x.id; byP.set(k, [...(byP.get(k) || []), x]) }
for (const [pid, g] of byP) {
  const f = g[0]
  // old export dropped unresolved bit-part names; re-prefix them with a role name (as the new prompt requires)
  const lines = g.filter((x) => x.dialogue).map((x) => (x.speakerName ? `${x.speakerName}：「${x.dialogue}」` : `路人：「${x.dialogue}」`))
  const ov = [...new Set(g.flatMap((x) => x.overlayText))]
  // system lines leaked into overlay in old export → put back into dialogue to exercise system routing
  for (const o of ov.filter((o) => /^系统小转[：:]/.test(o))) lines.push(o)
  ;(rsb[f.episode] ||= []).push({
    id: pid, shotNo: f.shotNo, size: f.size, camera: f.camera, emotion: f.emotion, visual: f.visual,
    action: [...new Set(g.map((x) => x.action))].join('，随后'), dialogue: lines.join('\n'),
    seedancePrompt: f.prompt.replace(new RegExp(`[，,]?${INDIRECT_UI_CUE}`, 'g'), ''),
    durationSec: g.reduce((a, x) => a + x.durationSec, 0), characterIds: [...new Set(g.flatMap((x) => x.characterIds))],
    voiceOnly: [...new Set(g.flatMap((x) => x.voiceOnly))], sfx: [...new Set(g.flatMap((x) => x.sfx))],
    overlayText: ov.filter((o) => !/^系统小转[：:]/.test(o)),
  } as Shot)
}
const rp: Project = { ...(project as Project), ...real.project, characters: real.characters, storyboards: rsb } as Project
const ro = buildVideoPipelineExport(rp, { mergeToSegments: false })
const allOv = ro.shots.flatMap((s) => s.overlayText)
const stats = {
  parentShots: byP.size, segments: ro.shots.length, overlayCount: allOv.length, overlayUnique: new Set(allOv).size,
  cueCount: ro.shots.filter((s) => s.prompt.includes(INDIRECT_UI_CUE)).length,
  multiChar: ro.warnings.filter((w) => w.code === 'multi_character_shot').length,
  speakerNameFills: ro.shots.filter((s) => s.dialogue && !s.speaker && s.speakerName).length,
  unresolved: ro.warnings.filter((w) => w.code === 'speaker_unresolved').length,
}
t('real export: overlay 20–30, no constraint text', () => {
  assert.ok(allOv.length >= 20 && allOv.length <= 30, `overlay ${allOv.length}`)
  assert.ok(!allOv.some((o) => /不出现|限制|禁止/.test(o)), JSON.stringify(allOv))
})
t('real export: cue only where overlay non-empty', () => ro.shots.forEach((s) => { if (s.prompt.includes(INDIRECT_UI_CUE)) assert.ok(s.overlayText.length, s.id) }))
t('real export: no system-character dialogue', () => ro.shots.forEach((s) => assert.notEqual(s.speaker, 'c4', s.id)))
t('real export: totals + 2–10s + 0.5 steps', () => {
  for (const [ep, list] of Object.entries(rsb)) {
    const a = list.reduce((x, s) => x + s.durationSec, 0); const b = ro.shots.filter((s) => s.episode === +ep).reduce((x, s) => x + s.durationSec, 0)
    assert.equal(Math.round(a * 10), Math.round(b * 10), `ep${ep}`)
  }
  ro.shots.forEach((s) => assert.ok(s.durationSec >= 2 && s.durationSec <= 10 && Math.abs(s.durationSec % 0.5) < 1e-9, `${s.id} ${s.durationSec}`))
})
// ---------- real export #2 《每天只能变帅一次》 (从想法一键生成 + DeepSeek) ----------
const real2 = JSON.parse(readFileSync('scripts/fixtures/real-export-meitian2.json', 'utf8')) as { project: Project; characters: Character[]; shots: XS[] }
const r2sb: Project['storyboards'] = {}
for (const x of real2.shots) {
  const hasPrefix = /^[^：:「」\n]{1,20}[：:]/.test(x.dialogue)
  ;(r2sb[x.episode] ||= []).push({
    id: x.id, shotNo: x.shotNo, size: x.size, camera: x.camera, emotion: x.emotion, visual: x.visual, action: x.action,
    dialogue: x.dialogue && !hasPrefix && x.speakerName ? `${x.speakerName}：「${x.dialogue}」` : x.dialogue,
    seedancePrompt: x.prompt, durationSec: x.durationSec, characterIds: x.characterIds, voiceOnly: x.voiceOnly, sfx: x.sfx, overlayText: x.overlayText,
  } as Shot)
}
const r2chars: Character[] = real2.characters.map((c) => (c.id === 'c1' ? { ...c, refImage: 'bai_pu_plain' } : c))
const r2p: Project = { ...(project as Project), ...real2.project, characters: r2chars, storyboards: r2sb } as Project
const r2 = buildVideoPipelineExport(r2p, { mergeToSegments: false })
const r2s = (id: string) => r2.shots.find((s) => s.id === id)!
const cueIds = r2.shots.filter((s) => s.prompt.includes(INDIRECT_UI_CUE)).map((s) => s.id)
t('real2 B: cue only with overlay + onscreen character', () => r2.shots.forEach((s) => {
  if (s.prompt.includes(INDIRECT_UI_CUE)) { assert.ok(s.overlayText.length, `${s.id} no overlay`); assert.ok(s.characterIds.length, `${s.id} no chars`) }
}))
t('real2 B: empty-scene shots s1-5/6/34 stripped', () => ['s1-5', 's1-6', 's1-34'].forEach((id) => assert.ok(!r2s(id).prompt.includes('蓝光映在'), r2s(id).prompt)))
t('real2 B: daytime mirror s1-24 no cue, cue never as opener', () => {
  assert.ok(!r2s('s1-24').prompt.includes(INDIRECT_UI_CUE), r2s('s1-24').prompt)
  r2.shots.forEach((s) => assert.ok(!s.prompt.startsWith('蓝光'), s.id))
})
t('real2 D: s1-12 variant name + emotion prefix stripped', () => {
  const s = r2s('s1-12'); assert.equal(s.dialogue, '让我变帅一点吧……'); assert.equal(s.speaker, 'c1'); assert.equal(s.speakerName, '白朴')
})
t('real2 D: s1-33 human line moved overlay → dialogue', () => {
  const s = r2s('s1-33'); assert.deepEqual(s.overlayText, []); assert.equal(s.dialogue, '……行。'); assert.equal(s.speaker, 'c2')
})
t('parseDialogue: variant + extra paren', () => {
  assert.deepEqual(parseDialogue('白朴（变帅前）（小声）：让我变帅', chars), [{ name: '白朴（变帅前）', tag: '小声', text: '让我变帅' }])
  assert.deepEqual(parseDialogue('白朴（变帅后）(OS)：嗯', chars)[0].tag, 'OS')
})
t('real2 C: 早上七点 then 夜戏 → rewritten to daytime, time_conflict resolved', () => {
  assert.ok(!/夜戏/.test(r2s('s1-14').prompt), r2s('s1-14').prompt); assert.ok(/早晨戏/.test(r2s('s1-14').prompt), r2s('s1-14').prompt)
  assert.ok(!r2.warnings.some((w) => w.code === 'time_conflict' && w.shotId === 's1-14'))
})
t('characters[].refImage exported; shot refImage own value or null', () => {
  assert.equal(r2.characters.find((c) => c.id === 'c1')!.refImage, 'bai_pu_plain'); assert.equal(r2.characters.find((c) => c.id === 'c3')!.refImage, null)
  r2.shots.forEach((s) => assert.equal(s.refImage, null))
})
// ---------- prompt builders (A / C / E) ----------
const fp: Project = {
  ...project, source: 'idea', genre: '都市逆袭', settingFacts: ['白朴是富三代，家住高档小区', '吴耐家境贫寒，住老楼', '系统每天早上7点出现'],
  characters: [C('c1', '白朴（变帅前）', { baseName: '白朴', tags: ['protagonist'], role: '主角·富三代', age: '17', background: '富三代，住高档小区' }), C('c2', '吴耐', { age: '17', background: '家境贫寒' })],
  outline: [{ episode: 1, title: '小黄鸭', hook: '早上7点', summary: '系统出现', cliffhanger: '' }],
}
t('prompts include settingFacts + age/background as hard constraints', () => {
  for (const u of [outlineUser(fp), scriptUser(fp, fp.outline[0]), storyboardUser(fp, fp.outline[0], '场1 白朴卧室 · 早上')]) {
    assert.ok(u.includes(FACTS_HEADER)); assert.ok(u.includes('白朴是富三代，家住高档小区')); assert.ok(u.includes('17岁')); assert.ok(!/逆袭/.test(u), u)
  }
  assert.ok(storyboardUser(fp, fp.outline[0], '').includes('timeOfDay'))
})
t('system prompts: no stock cue example, no 夜戏 default, facts rule', () => {
  assert.ok(!STORYBOARD_SYSTEM.includes(INDIRECT_UI_CUE)); assert.ok(STORYBOARD_SYSTEM.includes('timeOfDay'))
  assert.ok(SCRIPT_SYSTEM.includes('不得与之矛盾')); assert.ok(!/压抑-开挂-打脸/.test(OUTLINE_SYSTEM)); assert.ok(!/旧手机|外卖箱/.test(IDEA_SYSTEM))
})
t('templates: 富三代 protagonist gets no 老旧居民楼 / 夜戏 defaults', () => {
  const sc = generateScript(fp.genre, 1, fp.outline[0], fp.characters, 60)
  const sb = generateStoryboard(fp.genre, 1, fp.outline[0], sc, fp.characters, '真人都市', 60)
  const all = sb.map((x) => `${x.visual}${x.seedancePrompt}`).join('\n') + sc.fullText
  assert.ok(!/老旧|居民楼|出租屋|旧窗|旧书桌|夜戏|夜景/.test(all), all.match(/.{0,20}(老旧|居民楼|出租屋|夜戏|夜景).{0,20}/)?.[0])
})
t('idea normalize: settingFacts / age / background', () => {
  const r = parseIdeaJson(JSON.stringify({ title: 'x', settingFacts: ['白朴是富三代'], characters: [{ name: '白朴', age: 17, background: '富三代' }], episodes: [{ title: 'a' }] }))
  assert.deepEqual(r.settingFacts, ['白朴是富三代']); assert.equal(r.characters[0].age, '17')
  assert.equal(toCharacters(r.characters)[0].background, '富三代')
})
t('locked / refImage characters survive regeneration', () => {
  const prev = [C('c1', '白朴（变帅前）', { refImage: 'bai_pu_plain', visualLock: 'LOCK', costume: 'COS' }), C('c2', '吴耐', { visualLock: 'old' })]
  const next = [C('c1', '白朴（变帅前）', { visualLock: 'new', costume: 'new' }), C('c2', '吴耐', { visualLock: 'new2' })]
  const m = mergeLockedCharacters(prev, next)
  assert.equal(m[0].visualLock, 'LOCK'); assert.equal(m[0].costume, 'COS'); assert.equal(m[0].refImage, 'bai_pu_plain'); assert.equal(m[1].visualLock, 'new2')
})
// ---------- storyboard P1: style lock / 5–9s merge / dedupe / time / offlist / logo ----------
const LIVE = styleTag('真人都市')
const countOf = (h: string, n: string) => h.split(n).length - 1
t('P1 style: 真人都市 strips 2D日漫/赛璐璐/细线条, styleTag exactly once', () => {
  const raw = '夜，江景别墅二楼卧室，2D日漫风。主体：少年。光线：暖光。风格：2D日漫，干净线条，写实光影。限制：竖屏9:16，无任何文字。'
  const r = lockPromptStyle(raw, '真人都市')
  assert.ok(r.drifted); assert.ok(!/日漫|2D|赛璐璐|线条/.test(r.text.split(LIVE).join('')), r.text)
  assert.equal(countOf(r.text, LIVE), 1); assert.ok(r.text.indexOf(LIVE) < r.text.indexOf('限制'), r.text)
  const r2x = lockPromptStyle('竖屏9:16，2D日漫风。主体：白朴。2D日漫赛璐璐上色，细线条，明亮白日光。限制：单人。', '真人都市')
  assert.ok(!/日漫|赛璐璐|细线条/.test(r2x.text.split(LIVE).join('')), r2x.text); assert.ok(r2x.text.includes('明亮白日光')); assert.equal(countOf(r2x.text, LIVE), 1)
  // idempotent; already-locked prompt is not drift
  const again = lockPromptStyle(r.text, '真人都市'); assert.equal(again.text, r.text); assert.ok(!again.drifted)
  // other styles untouched
  assert.equal(lockPromptStyle(raw, '2D日漫').text, raw)
})
t('P1 storyboard prompt: styleTag hard constraint + forbidden styles + 5–9s / shot count', () => {
  const u = storyboardUser({ ...fp, secondsPerEp: 75 }, fp.outline[0], '')
  assert.ok(u.includes(LIVE)); assert.ok(/禁止2D\/日漫\/动漫\/赛璐璐\/二次元/.test(u)); assert.ok(u.includes('5–9 秒'))
  assert.deepEqual(shotCountRange(75), [9, 13]); assert.ok(u.includes('9–13 镜'))
  assert.ok(!/2D日漫/.test(STORYBOARD_SYSTEM)); assert.ok(/5–9 秒/.test(STORYBOARD_SYSTEM)); assert.ok(/不出镜/.test(STORYBOARD_SYSTEM))
  assert.ok(!/至少 30% 镜头为 2–3\.5 秒/.test(STORYBOARD_SYSTEM))
  const lu = storyboardUser({ ...fp, characters: [C('c9', '吴耐', { costume: '蓝白校服、左胸校徽' })] }, fp.outline[0], '')
  assert.ok(!/左胸校徽/.test(lu), 'storyboard brief costume has no 校徽 trigger')
})
const V = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x', characterIds: ['c1'], prompt: '夜，别墅卧室。主体：林川。动作：抬头。表演：眨眼。镜头：近景。光线：暖光。限制：无任何文字。',
  visual: '别墅卧室', action: '抬头', durationSec: 2, dialogue: '', speaker: null, speakerName: null, voiceOnly: [], sfx: [], overlayText: [],
  camera: '近景', size: '近景', emotion: '', refImage: null, timeOfDay: '夜', ...p,
})
t('P1 merge: short shots → 5–9s segments, action+reaction, dialogueLines, ids', () => {
  const list = [
    V({ id: 's1-1', shotNo: 1, durationSec: 2.5, action: '石子打在玻璃上', sfx: ['啪'] }),
    V({ id: 's1-2', shotNo: 2, durationSec: 2, action: '林川笔尖顿住', dialogue: '来了。', speaker: 'c1', speakerName: '林川' }),
    V({ id: 's1-3', shotNo: 3, durationSec: 2.5, action: '赵泽探头', characterIds: ['c2'], dialogue: '写你的卷子。', speaker: 'c2', speakerName: '赵泽', camera: '侧打，轻推' }),
    V({ id: 's1-4', shotNo: 4, durationSec: 3, action: '林川叹气', overlayText: ['本月第47枚'] }),
    V({ id: 's1-5', shotNo: 5, durationSec: 2, action: '窗外天亮', timeOfDay: '早上', characterIds: [] }),
  ]
  const m = mergeEpisodeShots(list, { nameOf: (id) => ({ c1: '林川', c2: '赵泽' })[id] || id })
  m.forEach((s) => { assert.ok(s.durationSec >= 5 && s.durationSec <= 9, `${s.id} ${s.durationSec}`); assert.ok(Math.abs(s.durationSec % 0.5) < 1e-9) })
  assert.equal(m[0].id, 's1-1'); assert.ok(m[0].mergedFrom!.length >= 2); assert.ok(m[0].action.includes('；随后'))
  const all = m.find((s) => s.mergedFrom?.includes('s1-3'))!
  assert.ok(all.characterIds.length <= 2)
  const lines = m.flatMap((s) => s.dialogueLines || (s.dialogue ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue }] : []))
  assert.deepEqual(lines.map((l) => `${l.speakerName}:${l.text}`), ['林川:来了。', '赵泽:写你的卷子。'])
  const withLines = m.find((s) => s.dialogueLines)
  if (withLines) { assert.equal(withLines.dialogue, withLines.dialogueLines![0].text); assert.equal(withLines.speaker, withLines.dialogueLines![0].speaker) }
  assert.ok(m.some((s) => s.sfx.includes('啪'))); assert.ok(m.some((s) => s.overlayText.includes('本月第47枚')))
  // timeOfDay change never merged; lone 2s 早上 shot extended to 5s
  const last = m[m.length - 1]; assert.deepEqual(last.mergedFrom, undefined); assert.equal(last.id, 's1-5'); assert.equal(last.durationSec, 5)
  assert.ok(m[0].prompt.includes('时间轴') && m[0].prompt.includes('随后'), m[0].prompt)
  assert.ok(/镜头：近景/.test(m[0].prompt), m[0].prompt)
})
t('P1 merge: never exceeds 9s, different places not merged', () => {
  const list = [6, 2, 2, 2, 2].map((d, i) => V({ id: `s2-${i + 1}`, shotNo: i + 1, durationSec: d }))
  const m = mergeEpisodeShots(list)
  m.forEach((s) => assert.ok(s.durationSec <= 9 && s.durationSec >= 5, `${s.id} ${s.durationSec}`))
  const a = V({ id: 'a', prompt: '白天，教室。主体：林川。', visual: '教室', timeOfDay: '白天' })
  const b = V({ id: 'b', prompt: '白天，食堂。主体：林川。', visual: '食堂', timeOfDay: '白天' })
  assert.equal(mergeEpisodeShots([a, b]).length, 2)
})
t('P1 dedupe: identical consecutive visuals (s1-7-a / s1-7-b) fused', () => {
  const seg = (i: number) => V({ id: `s1-7-${'ab'[i]}`, shotNo: 7, characterIds: [], durationSec: 2, visual: '一本卷边的旧杂志拍在窗玻璃上，纸页被撞得翻开一角，顺着玻璃往下滑', action: i ? '顺着蛋液往下溜' : '杂志贴上玻璃', segment: { index: i, total: 2, parentId: 's1-7' } })
  const m = mergeEpisodeShots([seg(0), seg(1)])
  assert.equal(m.length, 1); assert.equal(m[0].id, 's1-7'); assert.deepEqual(m[0].mergedFrom, ['s1-7-a', 's1-7-b']); assert.equal(m[0].durationSec, 5)
  assert.equal(m[0].segment, undefined)
})
t('P1 time: daytime timeOfDay rewrites night light words; constraint 无夜景 untouched', () => {
  const p = '早上，别墅卧室。光线：冷蓝夜色，夜景灯火。限制：无夜景。'
  const f = fixTimeWords(p, '早晨')
  assert.ok(!hasNightConflict(f), f); assert.ok(f.includes('无夜景')); assert.ok(f.includes('清冷晨光'))
  assert.ok(fixTimeWords('脸上有昨晚的红印，夜戏。', '白天').includes('昨晚'))
  const exp: VideoPipelineExport = { schema: 'short-drama-studio/video-pipeline@1', project: { id: 'p', title: 't', style: '真人都市', platform: '红果', secondsPerEp: 60, settingFacts: [] },
    characters: [], shots: [V({ id: 'd1', timeOfDay: '清晨', prompt: '夜，卧室。主体：林川。光线：夜色。限制：无夜景。' })],
    warnings: [{ episode: 1, shotId: 'd1', code: 'time_conflict', message: '剧情时间为「清晨」，提示词却写了夜景/夜戏' }] }
  const o = postProcessExport(exp)
  assert.ok(!o.warnings.some((w) => w.code === 'time_conflict')); assert.ok(o.shots[0].prompt.startsWith('清晨'), o.shots[0].prompt)
  assert.ok(o.warnings.some((w) => w.code === 'style_drift') === false)
})
t('P1 offlist: bit-part line → speakerOffscreen / voiceOnly line, not depicted', () => {
  const exp: VideoPipelineExport = { schema: 'short-drama-studio/video-pipeline@1', project: { id: 'p', title: 't', style: '真人都市', platform: '红果', secondsPerEp: 60, settingFacts: [] },
    characters: [], shots: [
      V({ id: 'o1', timeOfDay: '白天', durationSec: 3, prompt: '白天，教室。主体：林川，同学甲站在他身后拍他肩。动作：林川回头。限制：无任何文字。', dialogue: '什么情况？', speakerName: '同学甲' }),
      V({ id: 'o2', timeOfDay: '白天', durationSec: 3, prompt: '白天，教室。主体：林川。动作：林川笑。', dialogue: '没事。', speaker: 'c1', speakerName: '林川' }),
    ], warnings: [{ episode: 1, shotId: 'o1', code: 'speaker_offlist', message: '说话人「同学甲」不在角色表（仅字幕名）' }] }
  const o = postProcessExport(exp, { mergeToSegments: false })
  assert.equal(o.shots[0].speakerOffscreen, true); assert.ok(!o.shots[0].prompt.includes('同学甲'), o.shots[0].prompt); assert.ok(o.shots[0].prompt.includes(OFFSCREEN_VOICE_CONSTRAINT))
  assert.ok(o.warnings.some((w) => w.code === 'speaker_offlist' && /画外音/.test(w.message)))
  const m = postProcessExport(exp)
  assert.equal(m.shots.length, 1); const s = m.shots[0]
  assert.equal(s.speakerOffscreen, true); assert.equal(s.dialogueLines![0].voiceOnly, true); assert.equal(s.dialogueLines![1].speaker, 'c1')
  assert.ok(!s.prompt.includes('同学甲')); assert.ok(s.prompt.includes(OFFSCREEN_VOICE_CONSTRAINT)); assert.equal(m.warnings.find((w) => w.code === 'speaker_offlist')!.shotId, 'o1')
})
t('P1 logo: 刺绣标/校徽/logo stripped from prompts, no-badge constraint added, character data untouched', () => {
  assert.equal(stripLogoText('米白色宽松连帽卫衣（胸口小刺绣标），浅蓝牛仔裤'), '米白色宽松连帽卫衣，浅蓝牛仔裤')
  assert.equal(stripLogoText('白色拉链外套配蓝色插肩袖与双白条、左胸校徽；蓝色运动裤'), '白色拉链外套配蓝色插肩袖与双白条；蓝色运动裤')
  assert.ok(!/logo/i.test(stripLogoText('白朴放下深灰无logo书包')))
  const pr = addConstraint('主体：吴耐。限制：无任何文字。', NO_BADGE_CONSTRAINT)
  assert.equal(pr, `主体：吴耐。限制：无任何文字，${NO_BADGE_CONSTRAINT}。`); assert.equal(addConstraint(pr, NO_BADGE_CONSTRAINT), pr)
  const ch = { ...project, characters: [C('c1', '吴耐', { costume: '蓝白校服、左胸校徽' })], storyboards: { 1: [S({ id: 'g1', characterIds: ['c1'], durationSec: 6, seedancePrompt: '主体：吴耐，蓝白校服、左胸校徽。动作：站立。限制：无任何文字。' })] } }
  const o = buildVideoPipelineExport(ch)
  assert.ok(!o.shots[0].prompt.replace(NO_BADGE_CONSTRAINT, '').includes('校徽'), o.shots[0].prompt); assert.ok(o.shots[0].prompt.includes(NO_BADGE_CONSTRAINT))
  assert.equal(o.characters[0].costume, '蓝白校服、左胸校徽'); assert.equal(o.characters[0].costumePrompt, '蓝白校服')
})
t('P1 default export merges to 5–9s with style lock + style_drift warning', () => {
  const sp: Project = { ...project, storyboards: { 1: [1, 2, 3, 4, 5, 6].map((i) => S({ id: `m${i}`, shotNo: i, durationSec: 2.5, characterIds: ['c1'], visual: `写字楼大堂第${i}处细节${'甲乙丙丁戊己'[i - 1]}角落`, seedancePrompt: '写字楼大堂。主体：林川。动作：看表。风格：2D日漫风，赛璐璐上色。限制：无任何文字。' })) } }
  const o = buildVideoPipelineExport(sp)
  assert.ok(o.shots.length >= 2 && o.shots.length <= 3, String(o.shots.length))
  o.shots.forEach((s) => { assert.ok(s.durationSec >= 5 && s.durationSec <= 9); assert.equal(countOf(s.prompt, LIVE), 1); assert.ok(!/日漫|赛璐璐/.test(s.prompt.split(LIVE).join('')), s.prompt) })
  assert.ok(o.warnings.some((w) => w.code === 'style_drift'))
  assert.equal(o.shots.reduce((a, s) => a + s.durationSec, 0), 15)
})
t('P1 real pack fixture: 0 anime prompts, all live-action, 5–9s', () => {
  const rp2 = postProcessExport(r2)
  rp2.shots.forEach((s) => { assert.ok(s.durationSec >= 5 && s.durationSec <= 10, `${s.id} ${s.durationSec}`); assert.ok(!/日漫|赛璐璐|二次元风/.test(s.prompt.split(LIVE).join('')), s.id) })
  assert.ok(rp2.shots.length < r2.shots.length)
})

// ---------- storyboard P1.1: tier settingFacts + ensureSinglePrefixedClause ----------
const DUCK_FACTS = [
  '白朴是富三代，长相普通，脾气极好，家住江景别墅。',
  '吴耐是白朴的同班班草，长得帅但家里穷，嫉妒白朴有钱。',
  '吴耐每天隔着窗户往白朴家扔东西，从小石子、鸡蛋一路升级到旧杂志和洗澡用的小黄鸭。',
  '白朴脾气好，被砸从不还手。',
  '某晚白朴被小黄鸭砸中额头，忍不住许愿：“让我变帅一点吧，少点钱也行。”',
  '第二天早上七点，白朴脑子里弹出一个系统，每天一个选择框，正向只能选“变帅”。',
  '负向由转盘随机抽一个，当天生效，第二天重抽。',
  '白朴的外貌只有变帅前（普通）和变帅后（帅气）两种，第一次选择后直接切换成变帅后的样子，之后的“变帅”只体现为气质、自信和周围人的反应。',
  '最后吴耐发现白朴一直在偷偷帮他家还债，两人从对头变成死党。',
  '全剧只有白朴和吴耐两个主要角色，每集固定结构：早上抽奖、白天因副作用出糗、结尾吴耐又扔来一样新东西做钩子。',
]
t('P1.1 tier: 小黄鸭 10 facts → world/ongoing/ending', () => {
  assert.deepEqual(DUCK_FACTS.map(classifySettingFact), [
    'world', 'world', 'ongoing', 'ongoing', 'ongoing', 'ongoing', 'ongoing', 'ongoing', 'ending', 'ongoing',
  ])
  const tier = tierSettingFacts(DUCK_FACTS)
  assert.equal(tier.ending.length, 1)
  assert.ok(tier.ending[0].includes('还债') && tier.ending[0].includes('死党'))
  assert.equal(tier.world.length, 2)
  assert.equal(tier.ongoing.length, 7)
  assert.deepEqual(factsForShotPrompts(DUCK_FACTS), [...tier.world, ...tier.ongoing])
  assert.ok(!factsForShotPrompts(DUCK_FACTS).some((f) => /还债|死党/.test(f)))
})
t('P1.1 storyboardUser hides ending; outline/script keep full facts; export emits tiers', () => {
  const duck: Project = { ...fp, settingFacts: DUCK_FACTS }
  const sb = storyboardUser(duck, duck.outline[0], '')
  assert.ok(sb.includes('白朴是富三代')); assert.ok(sb.includes('每集固定结构'))
  assert.ok(!sb.includes('还债'), sb); assert.ok(!sb.includes('死党'), sb); assert.ok(!/从对头变成/.test(sb))
  const ou = outlineUser(duck); assert.ok(ou.includes('还债') && ou.includes('死党'))
  const duckBoard: Project = {
    ...duck,
    storyboards: { 1: [S({ id: 'df1', durationSec: 6, characterIds: ['c1'], seedancePrompt: '主体：白朴。动作：抬头。风格：2D日漫。光线：暖光。限制：无任何文字。' })] },
  }
  const exp = buildVideoPipelineExport(duckBoard)
  assert.deepEqual(exp.project.settingFacts, DUCK_FACTS.map((f) => f.trim()))
  assert.deepEqual(exp.project.settingFactsByTier, tierSettingFacts(DUCK_FACTS))
  assert.equal(countOf(exp.shots[0].prompt, '风格：'), 1)
  assert.ok(countOf(exp.shots[0].prompt, '光线：') <= 1)
  assert.ok(!/还债|死党|从对头变成/.test(exp.shots.map((s) => s.prompt).join('\n')))
})
t('P1.1 ensureSinglePrefixedClause: no second 风格/光线 copy', () => {
  const base = '主体：林川。光线：暖光。限制：无任何文字。'
  const a = ensureSinglePrefixedClause(base, '光线：', '光线：明亮天光。')
  assert.equal(countOf(a, '光线：'), 1); assert.ok(a.includes('暖光')); assert.ok(!a.includes('明亮天光'))
  const b = ensureSinglePrefixedClause('主体：林川。限制：无。', '光线：', '光线：明亮天光。')
  assert.equal(countOf(b, '光线：'), 1); assert.ok(b.includes('明亮天光'))
  const c = ensureSinglePrefixedClause('光线：a。主体：x。光线：b。限制：无。', '光线：', '')
  assert.equal(countOf(c, '光线：'), 1); assert.ok(c.includes('光线：a')); assert.ok(!c.includes('光线：b'))
  const d = ensureSinglePrefixedClause('主体：x。风格：旧画风。限制：无。', '风格：', `风格：${LIVE}。`, { replace: true })
  assert.equal(countOf(d, '风格：'), 1); assert.ok(d.includes(LIVE)); assert.ok(!d.includes('旧画风'))
  // lockPromptStyle still exactly one styleTag
  const e = lockPromptStyle('风格：2D日漫。主体：x。风格：赛璐璐。光线：暖光。光线：冷光。限制：无。', '真人都市')
  assert.equal(countOf(e.text, '风格：'), 1); assert.equal(countOf(e.text, LIVE), 1)
  const f = ensureSinglePrefixedClause(e.text, '光线：', '')
  assert.equal(countOf(f, '光线：'), 1)
})

console.log('real2 stats', JSON.stringify({ segments: r2.shots.length, cueCount: cueIds.length, cueIds, overlayCount: r2.shots.flatMap((s) => s.overlayText).length,
  s1_12: { dialogue: r2s('s1-12').dialogue, speaker: r2s('s1-12').speaker }, s1_33: { dialogue: r2s('s1-33').dialogue, speaker: r2s('s1-33').speaker, overlay: r2s('s1-33').overlayText },
  timeConflicts: r2.warnings.filter((w) => w.code === 'time_conflict').map((w) => w.shotId) }))
if (process.env.REEXPORT) writeFileSync(process.env.REEXPORT, JSON.stringify(r2, null, 2))
console.log('real-export stats', JSON.stringify(stats))
console.log('real overlay:', JSON.stringify(allOv))
console.log(`\n${pass} tests passed; ${out.shots.length} segments from ${ep1.length} shots; warnings: ${out.warnings.length}`)
for (const s of out.shots) console.log(s.id, s.durationSec, s.speaker, JSON.stringify(s.dialogue))
