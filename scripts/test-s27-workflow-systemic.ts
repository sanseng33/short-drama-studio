/**
 * Systemic workflow fixes A–D from s2-7 cand01 diagnosis (generic gates, not a one-shot patch).
 * Run: npx tsc -b && npx --yes tsx scripts/test-s27-workflow-systemic.ts
 */
import assert from 'node:assert/strict'
import { applySceneContinuity, CARRY_WARDROBE_CONSTRAINT, SAME_SCENE_WARDROBE_CONSTRAINT } from '../src/lib/sceneContinuity'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { attemptPipelineExport } from '../src/lib/consistency/pipelineExportGate'
import { collectEpisodeDurationWarnings, evaluateExportHardGates } from '../src/lib/exportHardGates'
import { evaluateStartFrameConsistency } from '../src/lib/startFrameStill'
import { validateContinuity, repairPrompt, complianceBlock, type RawShotLike } from '../src/lib/generatorRules'
import { locationNamer } from '../src/lib/locationNorm'
import { generateStoryboardChecked } from '../src/lib/generator'
import { lockConstraintBlock, lockedShotsOf, mergeGeneratedWithLocked, replaceEpisodeShot } from '../src/lib/consistency/storyboardLocks'
import { timedDialogueLines } from '../src/lib/shotAnnotate'
import { buildBeatPrompt } from '../src/lib/beatPrompt'
import { OFFSCREEN_CUE } from '../src/lib/blocking'
import { LIFE_MOTION_CONSTRAINT } from '../src/lib/lifeMotion'
import { extractAnchors } from '../src/lib/sceneAnchors'
import type { Character, Project, Shot } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void | Promise<void>) => {
  const r = fn()
  if (r && typeof (r as Promise<void>).then === 'function') {
    return (r as Promise<void>).then(() => {
      pass++
      console.log('✓', name)
    })
  }
  pass++
  console.log('✓', name)
}

const C = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id,
  name,
  role: '角色',
  visualLock: '短发',
  costume: '默认外套',
  signatureProp: '包',
  ...extra,
})

const lin = C('c1', '林薇（梦中）', { baseName: '林薇', characterKey: 'linwei' })
const mom = C('c8', '母亲', { baseName: '母亲' })

const baseProject = (shots: Shot[]): Project => ({
  id: 'p_sys',
  title: '系统修复回归',
  genre: '都市逆袭',
  platform: '红果',
  episodeCount: 1,
  secondsPerEp: 75,
  style: '真人都市',
  logline: 'l',
  locations: ['餐厅'],
  characters: [lin, mom],
  outline: [{ episode: 2, title: '二', hook: '', summary: '', cliffhanger: '' }],
  scripts: { 2: { episode: 2, title: '二', beats: [], fullText: '母亲：做噩梦了？这一头汗。' } },
  storyboards: { 2: shots },
  selectedEpisode: 2,
  updatedAt: '2026-11-26T00:00:00.000Z',
})

const shot = (partial: Partial<Shot> & Pick<Shot, 'id' | 'shotNo'>): Shot => ({
  size: '全景',
  durationSec: 6,
  visual: '餐厅',
  action: '站着',
  dialogue: '',
  camera: '固定',
  emotion: '平静',
  seedancePrompt: '餐厅',
  location: '餐厅',
  timeOfDay: '白天',
  realm: 'dream',
  ...partial,
})

const MARBLE_INV =
  '大理石长桌、水晶吊灯、白纱帘、鲜花；左右全身站姿拥抱；母亲背后系带、背对镜头'
const WOOD_BODY =
  '原木长餐桌上的煎蛋与牛奶杯、胡桃木餐边柜、窗边绿植；侧后方中全景，轻微手持；林薇与母亲左右全身站姿拥抱'

const s26 = shot({
  id: 's2-6',
  shotNo: 6,
  size: '全景',
  visual: '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花，林薇一人站在桌边',
  seedancePrompt: '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花，林薇一人站在桌边',
  camera: '固定',
  characterIds: ['c1'],
  endState: { 林薇: { pos: 'left', facing: 'right', pose: '站', gaze: 'front', hands: '空手' } },
  startState: { 林薇: { pos: 'left', facing: 'right', pose: '站', gaze: 'front', hands: '空手' } },
  lighting: { key: '窗光', soft: true, temp: '暖' },
  cameraSide: 'master',
  carryFromPrev: false,
})

const s27Conflict = shot({
  id: 's2-7',
  shotNo: 7,
  size: '中全景',
  visual: WOOD_BODY,
  seedancePrompt: WOOD_BODY,
  camera: '侧后方中全景，轻微手持',
  characterIds: ['c1', 'c8'],
  voiceOnly: ['母亲'],
  voiceMode: 'offscreen',
  dialogue: '母亲（OS）：做噩梦了？这一头汗。',
  groupNote: '母亲仅画外音，林薇无对白、嘴唇闭合',
  carryFromPrev: false,
  startState: {
    林薇: { pos: 'left', facing: 'right', pose: '站', gaze: '母亲', hands: '抱着母亲' },
    母亲: { pos: 'right', facing: 'away', pose: '站', gaze: 'away', hands: '回抱' },
  },
  endState: {
    林薇: { pos: 'left', facing: 'right', pose: '站', gaze: '母亲', hands: '抱着母亲' },
    母亲: { pos: 'right', facing: 'away', pose: '站', gaze: 'away', hands: '回抱' },
  },
  cameraSide: 'A',
  lighting: { key: '窗光', soft: true, temp: '暖' },
  startFrameStill: {
    sha256: '5a08483fd700e4ea396f18534630c267ffc62b77ae7e2ad78a679f688cbe6f64',
    width: 720,
    height: 1280,
    source: 'cand01.jpg',
    origin: 'imported_manifest',
    inventory: MARBLE_INV,
  },
})

const s27Aligned = shot({
  ...s27Conflict,
  visual: '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花；左右全身站姿拥抱；母亲背后系带、背对镜头',
  seedancePrompt:
    '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花；左右全身站姿拥抱；母亲背后系带、背对镜头；林薇嘴唇闭合不说话，同时有呼吸与眨眼',
  camera: '固定全景',
  size: '全景',
})

const main = async () => {
  await t('C: applySceneContinuity keeps carryFromPrev=false when author opted out / state jumps / still bound', () => {
    const annotated = applySceneContinuity([
      {
        id: 's2-6',
        episode: 2,
        prompt: s26.seedancePrompt,
        visual: s26.visual,
        action: s26.action,
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1'],
        overlayText: [],
        endState: s26.endState,
      },
      {
        id: 's2-7',
        episode: 2,
        prompt: s27Conflict.seedancePrompt,
        visual: s27Conflict.visual,
        action: s27Conflict.action,
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1', 'c8'],
        overlayText: [],
        carryFromPrev: false,
        startState: s27Conflict.startState,
        startFrameStill: s27Conflict.startFrameStill,
      },
    ])
    assert.equal(annotated[0].sceneId, annotated[1].sceneId)
    assert.equal(annotated[1].carryFromPrev, false)
  })

  await t('C: same-scene contiguous states without still still carry=true', () => {
    const annotated = applySceneContinuity([
      {
        id: 'a',
        episode: 1,
        prompt: '餐厅大理石',
        visual: '餐厅大理石',
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1'],
        overlayText: [],
        endState: { 林薇: { pos: 'left', facing: 'right', pose: '站', gaze: 'front', hands: '空手' } },
      },
      {
        id: 'b',
        episode: 1,
        prompt: '餐厅大理石',
        visual: '餐厅大理石',
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1'],
        overlayText: [],
        startState: { 林薇: { pos: 'left', facing: 'right', pose: '站', gaze: 'front', hands: '空手' } },
      },
    ])
    assert.equal(annotated[1].carryFromPrev, true)
  })

  await t('C: export keeps carry=false and never appends last-frame staging constraint', () => {
    const p = baseProject([s26, s27Aligned])
    const exp = buildVideoPipelineExport(p, { mergeToSegments: false })
    const s = exp.shots.find((x) => x.id === 's2-7')!
    assert.equal(s.carryFromPrev, false)
    assert.ok(!s.prompt.includes('保持与上一镜末帧一致'), s.prompt)
    assert.ok(!s.prompt.includes(CARRY_WARDROBE_CONSTRAINT), s.prompt)
    assert.ok(s.prompt.includes(SAME_SCENE_WARDROBE_CONSTRAINT) || s.prompt.includes('禁止换装'), s.prompt)
  })

  await t('D: complianceBlock requires life motion with closed lips', () => {
    const block = complianceBlock({ secondsPerEp: 75, locations: ['餐厅'] })
    assert.ok(block.includes('生命感微动'))
    assert.ok(block.includes('无对白且非 inner/offscreen'))
  })

  await t('D: OFFSCREEN_CUE no longer freezes the body; beat mode uses it', () => {
    assert.ok(!OFFSCREEN_CUE.includes('停住倾听'))
    assert.ok(/呼吸|眨眼|肩线|重心|微动/.test(OFFSCREEN_CUE))
    const packShot = {
      episode: 2,
      shotNo: 7,
      id: 's2-7',
      characterIds: ['c1'],
      prompt: '竖屏9:16。主体：林薇。动作：她停下。',
      visual: '餐厅',
      action: '她停下',
      durationSec: 5,
      dialogue: '开门！',
      speaker: null as string | null,
      speakerName: '母亲',
      speakerOffscreen: true,
      voiceOnly: [] as string[],
      sfx: [] as string[],
      overlayText: [] as string[],
      camera: '近景',
      size: '近景',
      emotion: '',
      refImage: null as string | null,
    }
    const r = buildBeatPrompt(packShot as never, [{ id: 'c1', name: '林薇', visualLock: '短发', costume: '睡衣', role: '主角' }])
    assert.ok(r.prompt.includes('嘴唇闭合'))
    assert.ok(!r.prompt.includes('停住倾听'))
    assert.ok(/呼吸|眨眼|肩线|重心|微动/.test(r.prompt), r.prompt)
  })

  await t('D: timedDialogueLines marks offscreen/voiceOnly even when speaker is on screen; short VO not 0–duration', () => {
    const line = {
      episode: 2,
      shotNo: 7,
      id: 's2-7',
      characterIds: ['c1', 'c8'],
      prompt: 'x',
      visual: '母亲背影与林薇拥抱',
      action: '拥抱',
      durationSec: 7,
      dialogue: '做噩梦了？这一头汗。',
      speaker: 'c8',
      speakerName: '母亲',
      voiceOnly: ['c8'],
      voiceMode: 'offscreen',
      sfx: [],
      overlayText: [],
      camera: '全景',
      size: '全景',
      emotion: '',
      refImage: null,
    }
    const tl = timedDialogueLines(line as never, [
      { id: 'c1', name: '林薇' },
      { id: 'c8', name: '母亲' },
    ])
    assert.equal(tl.length, 1)
    assert.equal(tl[0].voiceOnly, true)
    assert.ok(tl[0].endSec < 7, `endSec=${tl[0].endSec}`)
    assert.ok(tl[0].endSec - tl[0].startSec >= 0.5)
  })

  await t('D: export prompt for offscreen closed-lips shot carries life-motion constraint', () => {
    const p = baseProject([
      {
        ...s27Aligned,
        seedancePrompt: '餐厅大理石长桌；林薇嘴唇闭合不说话；左右全身拥抱',
      },
    ])
    const exp = buildVideoPipelineExport(p, { mergeToSegments: false })
    const s = exp.shots[0]
    assert.ok(s.prompt.includes('嘴唇闭合') || s.prompt.includes(LIFE_MOTION_CONSTRAINT), s.prompt)
    assert.ok(s.prompt.includes(LIFE_MOTION_CONSTRAINT) || /呼吸|眨眼|肩线|重心|微动/.test(s.prompt), s.prompt)
  })

  await t('A: bound still vs wood mid-shot prose fails start-frame consistency', () => {
    const p = baseProject([s27Conflict])
    const r = evaluateStartFrameConsistency(p)
    assert.equal(r.ok, false)
    assert.ok(r.conflicts.some((c) => c.axis === 'table_material'))
    assert.ok(r.conflicts.some((c) => c.axis === 'shot_size' || c.axis === 'camera_angle'))
  })

  await t('A: bound still aligned with marble full-body prose passes', () => {
    const p = baseProject([s27Aligned])
    const r = evaluateStartFrameConsistency(p)
    assert.equal(r.ok, true)
  })

  await t('A: pipeline export hard-blocks conflicting still; passes when aligned', () => {
    const bad = baseProject([s27Conflict])
    const hard = evaluateExportHardGates(bad)
    assert.equal(hard.ok, false)
    assert.ok(hard.issues.some((i) => i.code === 'start_frame_conflict'))
    const flash: string[] = []
    const r = attemptPipelineExport(bad, {
      download: () => {
        throw new Error('must not download')
      },
      flash: (m) => flash.push(m),
      setProject: () => {},
    })
    assert.equal(r.status, 'blocked_consistency')

    const good = baseProject([s26, s27Aligned])
    // good still has no wood conflict; décor continuity also ok (aligned marble)
    const hard2 = evaluateExportHardGates(good)
    assert.equal(hard2.ok, true, JSON.stringify(hard2.issues))
  })

  await t('A: export carries startFrameStill sha256 as-is (no bytes)', () => {
    const p = baseProject([s27Aligned])
    const exp = buildVideoPipelineExport(p, { mergeToSegments: false })
    const s = exp.shots.find((x) => x.id === 's2-7')!
    assert.ok(s.startFrameStill)
    assert.equal(s.startFrameStill!.sha256, s27Aligned.startFrameStill!.sha256)
    assert.equal((s.startFrameStill as { bytes?: unknown }).bytes, undefined)
  })

  await t('A: bound still forces carryFromPrev false even if author left it unset', () => {
    const annotated = applySceneContinuity([
      {
        id: 's2-6',
        episode: 2,
        prompt: '餐厅',
        visual: '餐厅大理石',
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1'],
        overlayText: [],
        endState: s26.endState,
      },
      {
        id: 's2-7',
        episode: 2,
        prompt: '餐厅',
        visual: '餐厅大理石',
        location: '餐厅',
        timeOfDay: '白天',
        characterIds: ['c1'],
        overlayText: [],
        startState: s26.endState,
        startFrameStill: s27Aligned.startFrameStill,
      },
    ])
    assert.equal(annotated[1].carryFromPrev, false)
  })

  await t('B: marble establishing + wood hug fails validateContinuity sceneDecor', () => {
    const issues = validateContinuity([s26, s27Conflict] as RawShotLike[], locationNamer([lin, mom]))
    assert.ok(issues.some((x) => x.rule === 'sceneDecor'), JSON.stringify(issues))
  })

  await t('B: marble establishing + marble hug passes décor continuity', () => {
    const issues = validateContinuity([s26, s27Aligned] as RawShotLike[], locationNamer([lin, mom]))
    assert.ok(!issues.some((x) => x.rule === 'sceneDecor'), JSON.stringify(issues))
  })

  await t('B: locked s2-6 is not rewritten by generateStoryboardChecked', async () => {
    const lockedBody = { ...s26, visual: '餐厅大理石长桌与水晶吊灯（锁定正文）', seedancePrompt: '锁定正文' }
    const p = baseProject([lockedBody, { ...s27Aligned, startFrameStill: undefined }])
    p.locks = { shots: { 's2-6': true } }
    assert.equal(lockedShotsOf(p, 2).length, 1)
    assert.ok(lockConstraintBlock(lockedShotsOf(p, 2)).includes('禁止改写'))
    assert.ok(repairPrompt([{ shot: 7, rule: 'sceneDecor', detail: 'x' }], { lockedShots: true }).includes('不要输出已锁定镜头'))
    const llm = async () =>
      JSON.stringify([
        {
          shotNo: 6,
          id: 's2-6',
          size: '全景',
          durationSec: 6,
          visual: '被改写的原木餐厅',
          action: '站',
          dialogue: '',
          camera: '固定',
          emotion: '平静',
          seedancePrompt: '被改写的原木餐厅',
          location: '餐厅',
          timeOfDay: '白天',
          characters: ['林薇（梦中）'],
          startState: lockedBody.startState,
          endState: lockedBody.endState,
          cameraSide: 'master',
          lighting: lockedBody.lighting,
          realm: 'dream',
        },
        {
          shotNo: 7,
          id: 's2-7',
          size: '全景',
          durationSec: 7,
          visual: '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花；左右全身站姿拥抱',
          action: '拥抱',
          dialogue: '',
          camera: '固定',
          emotion: '平静',
          seedancePrompt: '餐厅大理石长桌与水晶吊灯、白纱帘、鲜花；左右全身站姿拥抱',
          location: '餐厅',
          timeOfDay: '白天',
          characters: ['林薇（梦中）', '母亲'],
          startState: s27Aligned.startState,
          endState: s27Aligned.endState,
          cameraSide: 'A',
          lighting: s27Aligned.lighting,
          realm: 'dream',
          carryFromPrev: false,
        },
      ])
    const r = await generateStoryboardChecked(llm, p, p.outline[0], p.scripts[2].fullText, { maxRepairs: 0 })
    const kept = r.shots.find((s) => s.id === 's2-6')!
    assert.equal(kept.visual, lockedBody.visual)
    assert.ok(!kept.visual.includes('被改写'))
  })

  await t('B: replaceEpisodeShot re-runs continuity and surfaces wood vs marble', () => {
    const p = baseProject([s26, s27Aligned])
    const r = replaceEpisodeShot(p, 2, { ...s27Conflict, startFrameStill: undefined })
    assert.ok(r.issues.some((x) => x.rule === 'sceneDecor'), JSON.stringify(r.issues))
  })

  await t('B: mergeGeneratedWithLocked prefers locked bodies', () => {
    const locked = [{ id: 's2-6', shotNo: 6, visual: '锁定' }]
    const gen = [
      { id: 's2-6', shotNo: 6, visual: '新' },
      { id: 's2-7', shotNo: 7, visual: '新7' },
    ]
    assert.deepEqual(mergeGeneratedWithLocked(gen, locked), [
      { id: 's2-6', shotNo: 6, visual: '锁定' },
      { id: 's2-7', shotNo: 7, visual: '新7' },
    ])
  })

  await t('A/B helpers: marble inventory extracts expected décor anchors', () => {
    const a = extractAnchors(MARBLE_INV)
    assert.ok(a.some((x) => x.axis === 'table_material' && x.group === 'marble'))
    assert.ok(a.some((x) => x.axis === 'chandelier' && x.group === 'present'))
    const w = extractAnchors(WOOD_BODY)
    assert.ok(w.some((x) => x.axis === 'table_material' && x.group === 'wood'))
  })

  await t('B: episode total 76 vs secondsPerEp 75 is a warning, not a validate block', () => {
    const p = baseProject([
      { ...s26, durationSec: 69 },
      { ...s27Aligned, durationSec: 7, startFrameStill: undefined },
    ])
    p.secondsPerEp = 75
    const issues = validateContinuity(p.storyboards[2] as RawShotLike[], locationNamer([lin, mom]))
    assert.ok(!issues.some((x) => x.rule === 'episodeSeconds'), JSON.stringify(issues))
    const warns = collectEpisodeDurationWarnings(p)
    assert.ok(warns.some((w) => w.code === 'episode_duration_mismatch' && /76/.test(w.message) && /75/.test(w.message)), JSON.stringify(warns))
  })

  console.log(`\n${pass} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
