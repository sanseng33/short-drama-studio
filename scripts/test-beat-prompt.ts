/** npx tsx scripts/test-beat-prompt.ts — opt-in speed-beat prompts (beatMode: 'speed') */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  applyBeatMode,
  BEAT_HEADER,
  BEAT_MOUTH_CUE,
  BEAT_REALISM,
  buildBeatPrompt,
  CLOSE_DIALOGUE_FRAMING,
  fastify,
  isActionHeavy,
  isBeatPrompt,
  nameVariants,
  parseMergedTimeline,
  smallPropIn,
  stripNames,
  ZIP_OPEN,
  splitClauses,
} from '../src/lib/beatPrompt'
import { actionCap, actionWeight, countActions, expandCompounds, limitActions } from '../src/lib/actionDensity'
import { buildVideoPipelineExport, type VideoPipelineExport, type VideoPipelineShot } from '../src/lib/videoExport'
import { postProcessExport } from '../src/lib/segmentPost'
import type { Character, Project, Shot } from '../src/types'
import { onscreenCast, renderPrompt, type WardrobeMeta } from '../src/lib/shotAnnotate'
const rerender = (prompt: string, s: VideoPipelineShot, chars: WardrobeMeta[]) =>
  renderPrompt(prompt, s.framing!, { onscreen: onscreenCast(s, chars), wardrobeState: s.wardrobeState!, chars }).prompt

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
  pass++
  console.log(`✓ ${name}`)
}

type PackChar = VideoPipelineExport['characters'][number]
const PC = (id: string, name: string, extra: Partial<PackChar> = {}): PackChar => ({
  id, name, role: '主角', tags: [], visualLock: '东亚少年，短黑发', costume: '米白翻领拉链短夹克', signatureProp: '', refImage: null, age: '17',
  background: '富三代，刻意低调，怕被人知道家里有钱', ...extra,
})
const packChars: PackChar[] = [
  PC('c1', '白朴（变帅前）', { baseName: '白朴' }),
  PC('c2', '白朴（变帅后）', { baseName: '白朴', visualLock: '下颌线清晰，短黑发整齐上梳' }),
  PC('c3', '吴耐', { costume: '蓝白运动校服', background: '贫困家庭出身的校草' }),
]
const SH = (p: Partial<VideoPipelineShot>): VideoPipelineShot => ({
  episode: 1, shotNo: 1, id: 'x1', characterIds: ['c2'], prompt: '', visual: '', action: '', durationSec: 6, dialogue: '', speaker: null,
  speakerName: null, voiceOnly: [], sfx: [], overlayText: [], camera: '近景，轻微手持', size: '近景', emotion: '', refImage: null, ...p,
})
// merged segment shaped like p2-clean s1-24 (solo version)
const merged = SH({
  id: 's1-24',
  durationSec: 6.5,
  timeOfDay: '早上',
  sceneLabel: '江景别墅卧室·日',
  dialogue: '我就是白朴。',
  speaker: 'c2',
  speakerName: '白朴',
  camera: '近景，轻微手持，随后侧打中近景，随后近景特写，缓慢微推',
  carryFromPrev: true,
  prompt:
    '竖屏9:16。早上，别墅落地窗前。主体：17岁东亚少年白朴（变帅后），短黑发上梳，米白翻领拉链短夹克。时间轴（一镜6.5秒，小节拍）：0–2s他扭头看身后，确认没人，再转回来，手指点了点自己的胸口；2–4.5s随后他摊手又收回来摸了摸后颈（白朴开口说台词），表演：开口前先把眉毛放平装无事，眼神闪开半秒再强装对视；4.5–6.5s随后他眯眼盯住对面，指间的鸡蛋转了半圈，喉结滚了一下。镜头：近景。风格：真人实拍都市短剧质感，自然肤质，电影级布光，禁止二次元漫画脸。光线：早上晨光正面柔亮。限制：无任何文字，服装无任何标志、校徽、刺绣字样。',
})

t('parseMergedTimeline reads beats, times and speech markers', () => {
  const b = parseMergedTimeline(merged.prompt)!
  assert.equal(b.length, 3)
  assert.deepEqual(b.map((x) => [x.start, x.end]), [[0, 2], [2, 4.5], [4.5, 6.5]])
  assert.deepEqual(b.map((x) => x.speech), [false, true, false])
  assert.deepEqual(b[1].speakers, ['白朴'])
  assert.equal(parseMergedTimeline('主体：x。动作：y。'), null)
})

t('s1-24-like merged shot → header / 时间轴 / 快-慢-恢复常速 / footer', () => {
  const r = buildBeatPrompt(merged, packChars, { style: '真人都市' })
  const p = r.prompt
  assert.ok(p.startsWith('竖屏9:16，6.5秒单镜。早上，江景别墅卧室落地窗前，单人。'), p.split('\n')[0])
  assert.ok(p.includes(`${BEAT_HEADER}：`), 'p.includes(`${BEAT_HEADER}：`)')
  assert.deepEqual(r.segments.map((s) => s.speed), ['快', '慢', '恢复常速'])
  assert.deepEqual(r.segments.map((s) => [s.start, s.end]), [[0, 2], [2, 4.5], [4.5, 6.5]])
  assert.ok(/0–2秒，动作利落快速：他猛地扭头/.test(p), 'fast seg gets 猛地')
  assert.ok(p.includes('迅速转回正面') && !p.includes('动作利落不拖'), "p.includes('迅速转回正面') && !p.includes('动作利落不拖')")
  assert.ok(/2–4\.5秒，接着放慢：/.test(p) && /4\.5–6\.5秒，随后恢复正常节奏：/.test(p), 'pacing in words')
  assert.ok(!/[【】]/.test(p), 'no bracket tags')
  assert.ok(p.includes(BEAT_MOUTH_CUE), 'p.includes(BEAT_MOUTH_CUE)')
  assert.ok(p.includes('全程只有他一人，不出现第二个人物'), "p.includes('全程只有他一人，不出现第二个人物')")
  assert.ok(/镜头：近景（胸口以上），轻微手持，最后一秒缓慢微推，不切镜。/.test(p), p)
  assert.ok(p.includes(BEAT_REALISM) && !p.includes('自然肤质，') && p.includes('禁止二次元漫画脸'), "p.includes(BEAT_REALISM) && !p.includes('自然肤质，') && p.includ")
  assert.ok(/限制：无任何文字、字幕、汉字、字母、数字、Logo；服装无标志、校徽、刺绣字样/.test(p), '/限制：无任何文字、字幕、汉字、字母、数字、Logo；服装无标志、校徽、刺绣字样/.test(p)')
  assert.ok(p.includes('（无任何标志）'), "p.includes('（无任何标志）')")
})

t('beat prompt: no names, no background/bio, no dialogue text', () => {
  const p = buildBeatPrompt(merged, packChars).prompt
  for (const n of ['白朴', '吴耐', '变帅后']) assert.ok(!p.includes(n), `name leak ${n}`)
  assert.ok(!p.includes('富三代') && !p.includes('刻意低调'), 'background must not be injected')
  assert.ok(!p.includes('我就是'), 'dialogue text must not appear')
  assert.ok(!/[「」“”]/.test(p), '!/[「」“”]/.test(p)')
})

t('small hand props dropped and listed (转鸡蛋)', () => {
  const r = buildBeatPrompt(merged, packChars)
  assert.ok(!r.prompt.includes('鸡蛋'), "!r.prompt.includes('鸡蛋')")
  assert.equal(r.removedProps.length, 1)
  assert.ok(r.removedProps[0].startsWith('鸡蛋：'), "r.removedProps[0].startsWith('鸡蛋：')")
  assert.equal(smallPropIn('指间的鸡蛋转了半圈'), '鸡蛋')
  assert.equal(smallPropIn('蛋液在玻璃上炸开'), null, 'no handling verb → keep')
  assert.equal(smallPropIn('笔直地站着'), null)
})

t('segments always cover durationSec exactly with 2–3 segments', () => {
  for (const d of [2, 3, 4.5, 5, 6.5, 7, 9]) {
    for (const dlg of ['', '你来了。']) {
      const s = SH({ durationSec: d, dialogue: dlg, speaker: dlg ? 'c2' : null, action: '他猛地转身，抬手指向窗外，然后慢慢放下手，眼神发愣', prompt: '竖屏9:16。夜，卧室。主体：17岁少年，米白夹克。动作：转身。' })
      const r = buildBeatPrompt(s, packChars)
      assert.ok(r.segments.length >= 2 && r.segments.length <= 3, `${d}s → ${r.segments.length}`)
      assert.equal(r.segments[0].start, 0)
      assert.equal(r.segments[r.segments.length - 1].end, d)
      for (let i = 1; i < r.segments.length; i++) assert.equal(r.segments[i].start, r.segments[i - 1].end)
      if (dlg) assert.ok(r.segments.some((x) => x.speed === '慢' && x.lipSync), `${d}s dialogue → 慢 + lipSync`)
      else assert.ok(!r.segments.some((x) => x.lipSync), '!r.segments.some((x) => x.lipSync)')
    }
  }
})

t('single-action shot is split into 2 segments; dialogue gets mouth cue', () => {
  const s = SH({ durationSec: 4, dialogue: '行。', speaker: 'c2', action: '他点头', prompt: '主体：17岁少年，夹克。动作：他点头。' })
  const r = buildBeatPrompt(s, packChars)
  assert.equal(r.segments.length, 2)
  assert.ok(r.prompt.includes(BEAT_MOUTH_CUE), 'r.prompt.includes(BEAT_MOUTH_CUE)')
})

t('off-screen voice: 慢 but mouth closed, no lip-sync', () => {
  const s = SH({ durationSec: 5, dialogue: '开门！', speaker: null, speakerName: '王阿姨', speakerOffscreen: true, action: '他停下笔，抬头看门，王阿姨在门外喊', prompt: '主体：17岁少年，夹克。' })
  const r = buildBeatPrompt(s, packChars)
  const slow = r.segments.filter((x) => x.speed === '慢')
  assert.equal(slow.length, 1)
  assert.equal(slow[0].lipSync, false)
  assert.ok(r.prompt.includes('嘴唇闭合不说话'), "r.prompt.includes('嘴唇闭合不说话')")
  assert.ok(!r.prompt.includes('王阿姨'), 'bit-part name stripped')
  assert.ok(r.prompt.includes('画外人声的说话人不出镜'), "r.prompt.includes('画外人声的说话人不出镜')")
})

t('mouth-blocking clause removed from the talking segment only', () => {
  const s = SH({
    durationSec: 5, dialogue: '没事的。', speaker: 'c2',
    prompt: '主体：17岁少年，夹克。时间轴（一镜5秒，小节拍）：0–2s他低头系鞋带；2–5s随后他捂住嘴笑，抬眼看向对面（他开口说台词）。',
  })
  const r = buildBeatPrompt(s, packChars)
  assert.ok(!r.prompt.includes('捂住嘴'), 'speech-seg 捂嘴 removed')
  assert.ok(r.prompt.includes('低头系鞋带'), 'non-speech 低头 kept')
  assert.ok(r.todo.some((x) => x.includes('遮挡嘴部')), 'todo noted')
})

t('two-cast segment: names → wardrobe descriptors, cross-window flagged', () => {
  const s = SH({
    characterIds: ['c2', 'c3'],
    durationSec: 6,
    dialogue: '你看什么？',
    speaker: 'c3',
    speakerName: '吴耐',
    prompt: '竖屏9:16。早上，旧楼窗前。构图：两处隔窄巷相望的对窗空间。主体：17岁东亚少年白朴（变帅后），米白翻领拉链短夹克；17岁东亚少年吴耐，蓝白运动校服。时间轴（一镜6秒，小节拍）：0–3s白朴推开窗；3–6s随后吴耐瞪着对面（吴耐开口说台词）。镜头：过肩镜头，越白朴肩拍吴耐。',
    camera: '过肩镜头，越白朴肩拍吴耐',
  })
  const r = buildBeatPrompt(s, packChars)
  assert.ok(!/白朴|吴耐/.test(r.prompt), r.prompt)
  assert.ok(r.prompt.includes('穿夹克的少年') && r.prompt.includes('穿校服的少年'), "r.prompt.includes('穿夹克的少年') && r.prompt.includes('穿校服的少年')")
  assert.ok(r.prompt.includes('双人。'), "r.prompt.includes('双人。')")
  assert.ok(r.todo.some((x) => x.includes('对窗')), "r.todo.some((x) => x.includes('对窗'))")
  assert.deepEqual(r.segments.map((x) => x.speed), ['快', '慢'])
})

t('helpers: stripNames / fastify / isActionHeavy', () => {
  const v = nameVariants(packChars)
  assert.equal(stripNames('17岁东亚少年白朴（变帅后），短发', v, () => 'X'), '17岁东亚少年，短发')
  assert.equal(stripNames('白朴推开门', v, () => '他'), '他推开门')
  assert.equal(fastify('他扭头看窗外'), '他猛地扭头看窗外，动作利落不拖')
  assert.equal(fastify('肩膀一点点绷起来'), '肩膀一点点绷起来，动作利落不拖', 'never inside 一点点')
  assert.equal(fastify('靠液体流动表现冲击'), '靠液体流动表现冲击，动作利落不拖', 'never inside 冲击')
  assert.ok(isActionHeavy('他猛地转身'), "isActionHeavy('他猛地转身')")
  assert.ok(!isActionHeavy('肩膀一点点绷起来，呼吸停在半口'), "!isActionHeavy('肩膀一点点绷起来，呼吸停在半口')")
  assert.ok(!isActionHeavy('眼神不闪躲却带点不服气'), 'negated 躲 is not action')
})

t('applyBeatMode: metadata + idempotent re-run keeps promptDefault', () => {
  const exp: VideoPipelineExport = {
    schema: 'short-drama-studio/video-pipeline@1',
    project: { id: 'p', title: 't', style: '真人都市', platform: '', secondsPerEp: 60, settingFacts: [] },
    characters: packChars,
    shots: [merged],
    warnings: [],
  }
  const a = applyBeatMode(exp)
  const s = a.shots[0]
  assert.equal(s.beatMode, 'speed')
  assert.equal(s.promptDefault, merged.prompt)
  assert.ok(isBeatPrompt(s.prompt), 'isBeatPrompt(s.prompt)')
  assert.equal(s.beatSegments?.length, 3)
  assert.deepEqual(s.beatRemovedProps?.length, 1)
  const b = applyBeatMode(a)
  assert.equal(b.shots[0].prompt, s.prompt, 'idempotent')
  assert.equal(b.shots[0].promptDefault, merged.prompt)
  assert.equal(exp.shots[0].prompt, merged.prompt, 'input not mutated')
})

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id, name, role: '角色', visualLock: '短发', costume: '黑夹克', signatureProp: '芯片', age: '25', ...extra,
})
let n = 0
const S = (p: Partial<Shot>): Shot => ({
  id: `b${++n}`, shotNo: n, size: '中景', durationSec: 6, visual: '写字楼大堂', action: '站立', dialogue: '', camera: '固定', emotion: '', seedancePrompt: '', ...p,
})
const project: Project = {
  id: 'pb', title: 'beat', genre: '都市逆袭', style: '真人都市', platform: '红果', episodes: 1, secondsPerEp: 30, logline: '', settingFacts: [],
  characters: [C('c1', '林川'), C('c2', '赵泽')],
  outline: [],
  scripts: {},
  storyboards: {
    1: [
      S({ characterIds: ['c1'], timeOfDay: '夜', dialogue: '林川：「我回来了。」', action: '林川猛地推开门，随后站定看向镜头', seedancePrompt: '竖屏9:16。夜，写字楼大堂。主体：林川，黑夹克。动作：林川猛地推开门，随后站定看向镜头。限制：无任何文字。' }),
      S({ characterIds: ['c2'], timeOfDay: '夜', action: '赵泽转身离开，然后在门口停住', seedancePrompt: '竖屏9:16。夜，写字楼大堂。主体：赵泽，灰西装。动作：赵泽转身离开。限制：无任何文字。' }),
    ],
  },
  selectedEpisode: 1,
} as unknown as Project

t('buildVideoPipelineExport default (no beatMode) keeps existing prompts', () => {
  const def = buildVideoPipelineExport(project)
  assert.ok(def.shots.every((s) => !s.beatMode && !isBeatPrompt(s.prompt) && !s.beatSegments && !s.promptDefault), 'def.shots.every((s) => !s.beatMode && !isBeatPrompt(s.prompt')
  const off = buildVideoPipelineExport(project, { beatMode: 'off' })
  assert.deepEqual(off, def)
})

t('buildVideoPipelineExport beatMode=speed → every shot beat-converted, durations unchanged', () => {
  const def = buildVideoPipelineExport(project)
  const sp = buildVideoPipelineExport(project, { beatMode: 'speed' })
  assert.equal(sp.shots.length, def.shots.length)
  sp.shots.forEach((s, i) => {
    assert.equal(s.beatMode, 'speed')
    assert.equal(s.durationSec, def.shots[i].durationSec)
    assert.equal(rerender(s.promptDefault!, def.shots[i], def.characters as WardrobeMeta[]), def.shots[i].prompt, 'promptDefault = default scene prompt before the final render rules')
    assert.ok(!/林川|赵泽/.test(s.prompt), s.prompt)
    assert.ok(!s.prompt.includes('我回来了'), "!s.prompt.includes('我回来了')")
    assert.equal(s.beatSegments![s.beatSegments!.length - 1].end, s.durationSec)
  })
  assert.ok(sp.shots.some((s) => s.beatSegments!.some((x) => x.lipSync)), 'sp.shots.some((s) => s.beatSegments!.some((x) => x.lipSync))')
})


t('action density: 快 drops chest-tap; dialogue drops 摊手 keeps 摸后颈; zip + 近景（胸口以上）', () => {
  const r = buildBeatPrompt(merged, packChars, { style: '真人都市' })
  assert.ok(r.trimmedActions.some((x) => x.includes('胸口')), String(r.trimmedActions))
  assert.ok(r.trimmedActions.some((x) => x.includes('摊手')), String(r.trimmedActions))
  assert.ok(!/点了点自己的胸口|手指点/.test(r.prompt), 'chest-tap gone')
  assert.ok(!r.prompt.includes('摊手'), 'hand-spread gone')
  assert.ok(r.prompt.includes('摸了摸后颈'), 'neck touch kept')
  assert.ok(r.prompt.includes(ZIP_OPEN), 'zip open')
  assert.ok(r.prompt.includes(CLOSE_DIALOGUE_FRAMING), 'dialogue close-up framing')
  assert.ok(!r.prompt.includes('收回来摸'), 'return prefix polished away')
})

t('actionDensity helpers: caps, compounds, preferLater, 虚点+下颌 counts as small', () => {
  assert.equal(actionCap('快', false), 1)
  assert.equal(actionCap('慢', false), 2)
  assert.equal(actionCap('恢复常速', false), 2)
  assert.equal(actionCap('慢', true), 1)
  assert.equal(actionWeight('他指尖在玻璃上虚点了一下下颌'), 1, 'SMALL before MICRO')
  assert.equal(actionWeight('又飞快地拨了拨额前的头发'), 1)
  const compound = expandCompounds(['他摊手又收回来摸了摸后颈'])
  assert.deepEqual(compound, ['他摊手', '收回来摸了摸后颈'])
  const dlg = limitActions(compound, 1, { preferLater: true })
  assert.deepEqual(dlg.dropped, ['他摊手'])
  assert.ok(dlg.kept.some((x) => x.includes('摸了摸后颈')), String(dlg.kept))
  const fast = limitActions(splitClauses('他猛地扭头看身后，手指点了点自己的胸口'), 1)
  assert.ok(fast.dropped.some((x) => x.includes('胸口')), String(fast.dropped))
  assert.equal(countActions(splitClauses('他重新低头写卷子，笔尖在纸上继续划，另一只手把翘起的卷子角压平')), 3)
})

const P2 = '/workspace/fixed/小黄鸭砸出个帅系统-video-pipeline-p2-clean.json'
if (existsSync(P2)) {
  t('p2-clean pack: beat mode on every shot, no names / dialogue leaks, exact coverage', () => {
    const pack = JSON.parse(readFileSync(P2, 'utf8')) as VideoPipelineExport
    const out = applyBeatMode(pack)
    const names = ['白朴', '吴耐']
    for (const s of out.shots) {
      assert.ok(isBeatPrompt(s.prompt), s.id)
      assert.ok(!names.some((x) => s.prompt.includes(x)), `${s.id} name leak`)
      const segs = s.beatSegments!
      assert.ok(segs.length >= 2 && segs.length <= 3, `${s.id} ${segs.length}`)
      assert.equal(segs[0].start, 0)
      assert.equal(segs[segs.length - 1].end, s.durationSec, s.id)
      if (s.dialogue) assert.ok(segs.some((x) => x.speed === '慢'), `${s.id} dialogue → 慢`)
      for (const l of [s.dialogue, ...(s.dialogueLines || []).map((x) => x.text)])
        for (const f of (l || '').replace(/^[「“"]|[」”"]$/g, '').split(/[，。！？、；…,.!?;~～\s]+/))
          if ([...f].length >= 4) assert.ok(!s.prompt.includes(f), `${s.id} dialogue leak ${f}`)
    }
    const s124 = out.shots.find((s) => s.id === 's1-24')!
    assert.deepEqual(s124.beatSegments!.map((x) => x.speed), ['快', '慢', '恢复常速'])
    assert.ok(s124.beatRemovedProps?.some((x) => x.includes('鸡蛋')), "s124.beatRemovedProps?.some((x) => x.includes('鸡蛋'))")
  })
  t('postProcessExport(beatMode) on p2-clean leaves default untouched', () => {
    const pack = JSON.parse(readFileSync(P2, 'utf8')) as VideoPipelineExport
    const a = postProcessExport(pack, { mergeToSegments: false })
    const b = postProcessExport(pack, { mergeToSegments: false, beatMode: 'speed' })
    assert.ok(a.shots.every((s) => !s.beatMode), 'a.shots.every((s) => !s.beatMode)')
    assert.equal(a.shots.length, b.shots.length)
    b.shots.forEach((s, i) => assert.equal(rerender(s.promptDefault!, a.shots[i], a.characters as WardrobeMeta[]), a.shots[i].prompt, s.id))
  })
}

console.log(`\n${pass} beat-prompt tests passed`)
