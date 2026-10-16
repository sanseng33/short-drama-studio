/** npx tsx scripts/test-video-export.ts — fixtures for video-pipeline@1 export */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildVideoPipelineExport, dialogueSec, indirectUiCue, INDIRECT_UI_CUE, extractOverlay } from '../src/lib/videoExport'
import type { Character, Project, Shot } from '../src/types'
import { writeFileSync } from 'node:fs'
import { parseDialogue } from '../src/lib/videoExport'
import { FACTS_HEADER, outlineUser, scriptUser, storyboardUser } from '../src/lib/prompts'
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
const out = buildVideoPipelineExport(project)
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
const ro = buildVideoPipelineExport(rp)
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
const r2 = buildVideoPipelineExport(r2p)
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
t('real2 C: 早上七点 then 夜戏 → time_conflict', () => assert.ok(r2.warnings.some((w) => w.code === 'time_conflict' && w.shotId === 's1-14')))
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
console.log('real2 stats', JSON.stringify({ segments: r2.shots.length, cueCount: cueIds.length, cueIds, overlayCount: r2.shots.flatMap((s) => s.overlayText).length,
  s1_12: { dialogue: r2s('s1-12').dialogue, speaker: r2s('s1-12').speaker }, s1_33: { dialogue: r2s('s1-33').dialogue, speaker: r2s('s1-33').speaker, overlay: r2s('s1-33').overlayText },
  timeConflicts: r2.warnings.filter((w) => w.code === 'time_conflict').map((w) => w.shotId) }))
if (process.env.REEXPORT) writeFileSync(process.env.REEXPORT, JSON.stringify(r2, null, 2))
console.log('real-export stats', JSON.stringify(stats))
console.log('real overlay:', JSON.stringify(allOv))
console.log(`\n${pass} tests passed; ${out.shots.length} segments from ${ep1.length} shots; warnings: ${out.warnings.length}`)
for (const s of out.shots) console.log(s.id, s.durationSec, s.speaker, JSON.stringify(s.dialogue))
