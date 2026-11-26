/**
 * Default picture constraints: spark ban, realm labels out of picture prose,
 * life-motion inside 「限制」, stable head/body turns.
 * Run: npx tsc -b && npx --yes tsx scripts/test-picture-constraints.ts
 *
 * The s2-7 regen pack failed these checks: 限制 did not ban decorative light,
 * visual/seedance still said 林薇（梦中）, breathing lived only in action,
 * and a head turn had no stability constraint.
 */
import assert from 'node:assert/strict'
import { autoFixStoryboard, complianceBlock, repairPrompt, type RawShotLike } from '../src/lib/generatorRules'
import { generateStoryboardChecked } from '../src/lib/generator'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import { buildBeatPrompt } from '../src/lib/beatPrompt'
import { renderPrompt } from '../src/lib/shotAnnotate'
import {
  LIFE_MOTION_CONSTRAINT,
  OFFSCREEN_LISTEN_CUE,
  ensureLifeMotionConstraint,
  limitClause,
  pictureBody,
} from '../src/lib/lifeMotion'
import {
  DECORATIVE_LIGHT_BAN,
  LIFE_MOTION_HARD_CONSTRAINT,
  TURN_STABILITY_CONSTRAINT,
  applyPictureConstraints,
} from '../src/lib/pictureRules'
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

const lin: Character = {
  id: 'c1',
  name: '林薇（梦中）',
  baseName: '林薇',
  role: '主角',
  visualLock: '长发',
  costume: '睡衣',
  signatureProp: '发带',
  characterKey: 'linwei',
  wardrobeRefs: { pajama: { costume: '粉色睡衣', refSet: 'linwei_pajama' } },
}
const mom: Character = { id: 'c8', name: '母亲', baseName: '母亲', role: '母亲', visualLock: '背影', costume: '家居服', signatureProp: '围裙' }

const DIRTY_LIMIT = '不出现母亲正脸，禁止背后拥抱，不出现第三人，不出现画面文字'
const DIRTY_VISUAL = '画面左侧为林薇（梦中），母亲背对镜头'
const DIRTY_ACTION = '林薇（梦中）缓缓转头，呼吸，眨眼，拍了拍母亲的背，手指收紧'
const DIRTY_SEEDANCE = `画面左侧为林薇（梦中）。时间轴：0-3秒呼吸眨眼拍背，3-6秒转头。限制：${DIRTY_LIMIT}。`
const DIALOGUE = '林薇（梦中）（内心）：别走。'

const dirty = (): RawShotLike & {
  screenPos: Record<string, string>
  wardrobeState: Record<string, string>
  dialogue: string
} => ({
  id: 's2-7',
  shotNo: 7,
  durationSec: 6,
  visual: DIRTY_VISUAL,
  action: DIRTY_ACTION,
  dialogue: DIALOGUE,
  seedancePrompt: DIRTY_SEEDANCE,
  characters: ['林薇（梦中）', '母亲'],
  characterIds: ['c1', 'c8'],
  voiceOnly: ['c8'],
  voiceMode: 'offscreen',
  location: '餐厅',
  timeOfDay: '白天',
  realm: 'dream',
  cameraSide: 'A',
  lighting: { key: '窗光', soft: true, temp: '暖' },
  screenPos: { '林薇（梦中）': 'left', 母亲: 'right' },
  startState: {
    '林薇（梦中）': { pos: 'left', facing: 'right', pose: '站', gaze: '母亲', hands: '抱着母亲' },
    母亲: { pos: 'right', facing: 'away', pose: '站', gaze: 'away', hands: '回抱' },
  },
  endState: {
    '林薇（梦中）': { pos: 'left', facing: 'right', pose: '站', gaze: '母亲', hands: '抱着母亲' },
    母亲: { pos: 'right', facing: 'away', pose: '站', gaze: 'away', hands: '回抱' },
  },
  wardrobeState: { c1: 'pajama' },
})

const ctx = { characters: [lin, mom], locations: ['餐厅'], secondsPerEp: 75 }

const main = async () => {
  await t('s2-7 wording: 限制 gains spark ban, life-motion, and stable turn; picture prose drops （梦中）', () => {
    const src = dirty()
    const [s] = autoFixStoryboard([src], ctx)
    const limit = limitClause(s.seedancePrompt || '')
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), limit)
    assert.ok(limit.includes(LIFE_MOTION_HARD_CONSTRAINT), limit)
    assert.ok(limit.includes(LIFE_MOTION_CONSTRAINT), limit)
    assert.ok(limit.includes(TURN_STABILITY_CONSTRAINT), limit)
    assert.ok(limit.includes('不出现母亲正脸'), 'original bans stay')
    assert.ok(!limit.includes('（梦中）'), limit)
    assert.ok(!pictureBody(s.seedancePrompt || '').includes('（梦中）'), s.seedancePrompt)
    assert.ok((s.visual || '').includes('林薇') && !(s.visual || '').includes('（梦中）'), s.visual)
    assert.ok((s.action || '').includes('转头') && (s.action || '').includes('呼吸'), s.action)
    assert.ok(!(s.action || '').includes('（梦中）'), s.action)
    assert.equal(s.dialogue, DIALOGUE)
    assert.ok('林薇（梦中）' in (s.startState || {}), 'startState key is metadata')
    assert.equal((s as { screenPos: Record<string, string> }).screenPos['林薇（梦中）'], 'left')
    assert.equal((s as { wardrobeState: Record<string, string> }).wardrobeState.c1, 'pajama')
    assert.equal(lin.name, '林薇（梦中）')
    assert.equal(lin.wardrobeRefs?.pajama?.refSet, 'linwei_pajama')
  })

  await t('life-motion only in action still lands in 限制, and a shot without a turn does not get the turn clause', () => {
    const [s] = autoFixStoryboard(
      [
        {
          ...dirty(),
          action: '林薇站着，呼吸，眨眼，肩线微动，手指收紧',
          visual: '餐厅里林薇（梦中）与母亲',
          seedancePrompt: '画面左侧为林薇（梦中）。限制：不出现画面文字。',
          voiceMode: 'onscreen',
          dialogue: '林薇（梦中）：早。',
        },
      ],
      ctx,
    )
    const limit = limitClause(s.seedancePrompt || '')
    assert.ok(limit.includes(LIFE_MOTION_HARD_CONSTRAINT), limit)
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), limit)
    assert.ok(!limit.includes(TURN_STABILITY_CONSTRAINT), limit)
    assert.ok(!limit.includes('闭唇') && !limit.includes('嘴唇闭合'), limit)
    assert.ok((s.action || '').includes('呼吸'), 'action axis is kept')
    assert.ok(!(s.visual || '').includes('（梦中）'), s.visual)
    assert.equal(s.dialogue, '林薇（梦中）：早。')
  })

  await t('wardrobe variant （变帅前） and a spinning prop are not treated as a dream label or a body turn', () => {
    const [s] = autoFixStoryboard(
      [
        {
          durationSec: 6,
          visual: '白朴（变帅前）看着转盘转动',
          action: '白朴（变帅前）站着',
          dialogue: '',
          seedancePrompt: '主体：白朴（变帅前）。动作：看转盘。限制：无文字。',
          characters: ['白朴（变帅前）'],
          location: '餐厅',
          timeOfDay: '白天',
          realm: 'reality',
          cameraSide: 'master',
          lighting: { key: '窗光', soft: true, temp: '暖' },
          startState: { '白朴（变帅前）': { pos: 'center', facing: 'front', pose: '站', gaze: 'front', hands: '空手' } },
          endState: { '白朴（变帅前）': { pos: 'center', facing: 'front', pose: '站', gaze: 'front', hands: '空手' } },
        },
      ],
      { characters: [{ name: '白朴（变帅前）', baseName: '白朴' }], locations: ['餐厅'], secondsPerEp: 75 },
    )
    assert.ok((s.visual || '').includes('（变帅前）'), s.visual)
    assert.ok((s.seedancePrompt || '').includes('（变帅前）'), s.seedancePrompt)
    assert.ok(limitClause(s.seedancePrompt || '').includes(DECORATIVE_LIGHT_BAN))
    assert.ok(!limitClause(s.seedancePrompt || '').includes(TURN_STABILITY_CONSTRAINT), s.seedancePrompt)
  })

  await t('empty shot gets the spark ban and not a breathing constraint', () => {
    const [s] = autoFixStoryboard(
      [
        {
          durationSec: 6,
          visual: '窗外下雨',
          action: '雨丝落下',
          dialogue: '',
          seedancePrompt: '窗外下雨。限制：无文字。',
          characters: [],
          location: '餐厅',
          timeOfDay: '白天',
          realm: 'reality',
          cameraSide: 'master',
          lighting: { key: '窗光', soft: true, temp: '暖' },
        },
      ],
      ctx,
    )
    const limit = limitClause(s.seedancePrompt || '')
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), limit)
    assert.ok(!limit.includes(LIFE_MOTION_HARD_CONSTRAINT), limit)
    assert.ok(!limit.includes(TURN_STABILITY_CONSTRAINT), limit)
  })

  await t('ensureLifeMotionConstraint writes into 限制 even when the listen cue is already in the picture', () => {
    const prompt = `主体：林薇。动作：呼吸、眨眼、手指收紧。${OFFSCREEN_LISTEN_CUE}。限制：${DIRTY_LIMIT}。`
    const out = ensureLifeMotionConstraint(prompt, 'offscreen')
    assert.ok(limitClause(out).includes(LIFE_MOTION_CONSTRAINT), out)
    assert.ok(pictureBody(out).includes('呼吸'), 'action-axis life motion stays')
    const again = ensureLifeMotionConstraint(out, 'offscreen')
    assert.equal(again, out)
  })

  await t('applyPictureConstraints is idempotent and does not treat its own turn clause as a new turn', () => {
    const once = applyPictureConstraints('画面左侧为林薇（梦中）。限制：无文字。', {
      hasPerson: true,
      action: '缓缓转头',
    })
    const twice = applyPictureConstraints(once, { hasPerson: true, action: '缓缓转头' })
    assert.equal(twice, once)
    assert.equal((once.match(new RegExp(TURN_STABILITY_CONSTRAINT, 'g')) || []).length, 1)
    assert.ok(!once.includes('（梦中）'))
  })

  await t('export prompt 限制 carries the defaults and does not echo （梦中）; character metadata stays', () => {
    const shot: Shot = {
      id: 's2-7',
      shotNo: 7,
      size: '全景',
      durationSec: 6,
      visual: DIRTY_VISUAL,
      action: DIRTY_ACTION,
      dialogue: DIALOGUE,
      camera: '固定',
      emotion: '难过',
      seedancePrompt: DIRTY_SEEDANCE,
      location: '餐厅',
      timeOfDay: '白天',
      realm: 'dream',
      characterIds: ['c1', 'c8'],
      voiceOnly: ['c8'],
      voiceMode: 'offscreen',
      screenPos: { '林薇（梦中）': 'left', 母亲: 'right' },
      startState: dirty().startState as Shot['startState'],
      endState: dirty().endState as Shot['endState'],
      wardrobeState: { c1: 'pajama' },
    }
    const project: Project = {
      id: 'p',
      title: '画面规则',
      genre: '都市逆袭',
      platform: '红果',
      episodeCount: 1,
      secondsPerEp: 75,
      style: '真人都市',
      logline: 'l',
      locations: ['餐厅'],
      characters: [lin, mom],
      outline: [],
      scripts: {},
      storyboards: { 2: [shot] },
      selectedEpisode: 2,
      updatedAt: '2026-11-26T00:00:00.000Z',
    }
    const exp = buildVideoPipelineExport(project, { mergeToSegments: false })
    const out = exp.shots.find((x) => x.id === 's2-7' || x.id.startsWith('s2-7'))!
    const limit = limitClause(out.prompt)
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), out.prompt)
    assert.ok(limit.includes(LIFE_MOTION_HARD_CONSTRAINT), out.prompt)
    assert.ok(limit.includes(TURN_STABILITY_CONSTRAINT), out.prompt)
    assert.ok(!pictureBody(out.prompt).includes('（梦中）'), out.prompt)
    assert.ok(!out.visual.includes('（梦中）'), out.visual)
    assert.ok(!out.action.includes('（梦中）'), out.action)
    assert.equal(project.characters[0].name, '林薇（梦中）')
    assert.equal(exp.characters.find((c) => c.id === 'c1')!.name, '林薇（梦中）')
    assert.equal(project.storyboards[2][0].dialogue, DIALOGUE)
    assert.ok('林薇（梦中）' in (project.storyboards[2][0].startState || {}))
    assert.equal(project.storyboards[2][0].screenPos?.['林薇（梦中）'], 'left')
    assert.equal(project.storyboards[2][0].wardrobeState?.c1, 'pajama')
  })

  await t('renderPrompt puts a turn that exists only in action into 限制', () => {
    const r = renderPrompt('竖屏9:16，6秒单镜。餐厅，单人。\n主体：林薇（梦中）。\n镜头：固定。\n限制：不出现画面文字。', 'medium', {
      onscreen: ['c1'],
      wardrobeState: { c1: 'pajama' },
      chars: [],
      action: '她缓缓转头',
      voiceMode: 'onscreen',
    })
    const limit = limitClause(r.prompt)
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), r.prompt)
    assert.ok(limit.includes(LIFE_MOTION_HARD_CONSTRAINT), r.prompt)
    assert.ok(limit.includes(TURN_STABILITY_CONSTRAINT), r.prompt)
    assert.ok(!r.prompt.includes('（梦中）'), r.prompt)
  })

  await t('beat-mode 限制 is rebuilt with the same clauses', () => {
    const r = buildBeatPrompt(
      {
        episode: 2,
        shotNo: 7,
        id: 's2-7',
        characterIds: ['c1'],
        prompt: '竖屏9:16。主体：林薇（梦中）。动作：她停下。限制：不出现画面文字。',
        visual: '画面左侧为林薇（梦中）',
        action: '林薇（梦中）转头',
        durationSec: 6,
        dialogue: '',
        speaker: null,
        speakerName: null,
        voiceOnly: [],
        sfx: [],
        overlayText: [],
        camera: '全景',
        size: '全景',
        emotion: '',
        refImage: null,
      } as never,
      [lin],
    )
    const limit = limitClause(r.prompt)
    assert.ok(limit.includes(DECORATIVE_LIGHT_BAN), r.prompt)
    assert.ok(limit.includes(LIFE_MOTION_HARD_CONSTRAINT), r.prompt)
    assert.ok(limit.includes(TURN_STABILITY_CONSTRAINT), r.prompt)
    assert.ok(!pictureBody(r.prompt).includes('（梦中）'), r.prompt)
  })

  await t('generate keeps a locked （梦中） body and cleans the unlocked shot; character name stays', async () => {
    const lockedVisual = '画面左侧为林薇（梦中）（锁定正文）'
    const locked: Shot = {
      id: 's2-6',
      shotNo: 6,
      size: '全景',
      durationSec: 6,
      visual: lockedVisual,
      action: '站着',
      dialogue: '',
      camera: '固定',
      emotion: '平静',
      seedancePrompt: '锁定正文',
      location: '餐厅',
      timeOfDay: '白天',
      realm: 'dream',
      characterIds: ['c1'],
      startState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '空手' } },
      endState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '空手' } },
      cameraSide: 'master',
      lighting: { key: '窗光', soft: true, temp: '暖' },
    }
    const project: Project = {
      id: 'p',
      title: '画面规则',
      genre: '都市逆袭',
      platform: '红果',
      episodeCount: 1,
      secondsPerEp: 75,
      style: '真人都市',
      logline: 'l',
      locations: ['餐厅'],
      characters: [lin, mom],
      outline: [{ episode: 2, title: '二', hook: '', summary: '', cliffhanger: '' }],
      scripts: { 2: { episode: 2, title: '二', beats: [], fullText: '' } },
      storyboards: { 2: [locked, { ...locked, id: 's2-7', shotNo: 7, visual: DIRTY_VISUAL, seedancePrompt: DIRTY_SEEDANCE }] },
      selectedEpisode: 2,
      updatedAt: '2026-11-26T00:00:00.000Z',
      locks: { shots: { 's2-6': true } },
    }
    const llm = async () =>
      JSON.stringify([
        {
          id: 's2-6',
          shotNo: 6,
          size: '全景',
          durationSec: 6,
          visual: '被改写的林薇（梦中）',
          action: '站',
          dialogue: '',
          camera: '固定',
          emotion: '平静',
          seedancePrompt: '被改写',
          location: '餐厅',
          timeOfDay: '白天',
          characters: ['林薇（梦中）'],
          realm: 'dream',
          cameraSide: 'master',
          lighting: locked.lighting,
          startState: locked.startState,
          endState: locked.endState,
        },
        {
          id: 's2-7',
          shotNo: 7,
          size: '全景',
          durationSec: 6,
          visual: DIRTY_VISUAL,
          action: DIRTY_ACTION,
          dialogue: DIALOGUE,
          camera: '固定',
          emotion: '难过',
          seedancePrompt: DIRTY_SEEDANCE,
          location: '餐厅',
          timeOfDay: '白天',
          characters: ['林薇（梦中）', '母亲'],
          voiceOnly: ['母亲'],
          voiceMode: 'offscreen',
          realm: 'dream',
          cameraSide: 'A',
          lighting: locked.lighting,
          screenPos: { '林薇（梦中）': 'left', 母亲: 'right' },
          startState: dirty().startState,
          endState: dirty().endState,
        },
      ])
    const result = await generateStoryboardChecked(llm, project, project.outline[0], '', { maxRepairs: 0 })
    const kept = result.shots.find((s) => s.id === 's2-6')!
    const next = result.shots.find((s) => s.id === 's2-7')!
    assert.equal(kept.visual, lockedVisual)
    assert.equal(kept.seedancePrompt, '锁定正文')
    assert.ok(!next.visual.includes('（梦中）'), next.visual)
    assert.ok(limitClause(next.seedancePrompt).includes(DECORATIVE_LIGHT_BAN), next.seedancePrompt)
    assert.ok(limitClause(next.seedancePrompt).includes(LIFE_MOTION_HARD_CONSTRAINT), next.seedancePrompt)
    assert.ok(limitClause(next.seedancePrompt).includes(TURN_STABILITY_CONSTRAINT), next.seedancePrompt)
    assert.equal(next.dialogue, DIALOGUE)
    assert.equal(project.characters[0].name, '林薇（梦中）')
    assert.ok(next.startState && '林薇（梦中）' in next.startState)
  })

  await t('compliance and repair prompts name the 限制 channel', () => {
    const block = complianceBlock({ secondsPerEp: 75, locations: ['餐厅'] })
    assert.ok(block.includes(DECORATIVE_LIGHT_BAN))
    assert.ok(block.includes(LIFE_MOTION_HARD_CONSTRAINT))
    assert.ok(block.includes('不要只写在 action'))
    assert.ok(block.includes('（梦中）'))
    const repair = repairPrompt([{ shot: 7, rule: 'sceneDecor', detail: 'x' }], { lockedShots: true })
    assert.ok(repair.includes('不要输出已锁定镜头'))
    assert.ok(repair.includes(DECORATIVE_LIGHT_BAN))
    assert.ok(repair.includes(TURN_STABILITY_CONSTRAINT))
  })

  console.log(`\n${pass} passed`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
