/**
 * s1 generic studio fixes (2026-11-26): scene place rules, blocking trim,
 * firstFrame/wardrobe backfill, dialogue constraint-line skip.
 * Uses in-memory copies of the real s1 13-shot / s2 12-shot projects; does not write official packs.
 * Run: npx tsc -b && npx --yes tsx scripts/test-s1-studio-fixes.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locationNamer } from '../src/lib/locationNorm'
import { autoFixContinuity, type RawShotLike } from '../src/lib/generatorRules'
import { presentKeysForBlocking, trimBlockingToPresent } from '../src/lib/blocking'
import { applySceneContinuity, classifyPlace, classifyShotScene, CARRY_WARDROBE_CONSTRAINT } from '../src/lib/sceneContinuity'
import { parseScriptDialogue, parseScriptLine } from '../src/lib/scriptDialogue'
import { fillStructuredShotFields } from '../src/lib/shotState/fillShot'
import { shotStateFromShot } from '../src/lib/shotState/fromShot'
import { STORYBOARD_SYSTEM } from '../src/lib/llm'
import { buildVideoPipelineExport } from '../src/lib/videoExport'
import type { Character, Project, Shot } from '../src/types'

let pass = 0
const t = (name: string, fn: () => void) => {
  fn()
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

const lin = C('c1', '林薇（梦中）', {
  baseName: '林薇',
  characterKey: 'linwei',
  refImage: 'linwei_formal_nologo',
  costume: '米白开衫配浅蓝连衣裙',
  wardrobeRefs: {
    formal: { refSet: 'linwei_formal_nologo', costume: '白色正装', look: 'formal look' },
    pajama: { refSet: 'linwei_pajama_box', costume: '粉色千鸟格长袖睡衣套装', look: 'pajama look' },
  },
})
const dad = C('c5', '林天成', {
  characterKey: 'lintiancheng',
  refImage: 'lintiancheng_nologo',
  wardrobeRefs: { default: { refSet: 'lintiancheng_nologo', costume: '藏青西装' } },
})
const mom = C('c8', '母亲', {
  baseName: '母亲',
  wardrobeState: 'hidden_face',
  wardrobeRefs: { hidden_face: { refSet: 'mother_temp_back', costume: '围裙家居装' } },
})
type Cont = {
  id: string
  episode: number
  location?: string
  timeOfDay?: string
  visual?: string
  action?: string
  prompt?: string
  characterIds?: string[]
  overlayText?: string[]
}

const S1_SCENES: Cont[] = [
  { id: 's1-1', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '清晨的林家别墅玄关，挑高空间，米白色大理石地面反着光，左侧整面定制玄关柜上摆着白瓷托盘与长条花艺，右侧立着落地穿衣镜', action: '招呼家人看镜头', characterIds: ['c1'] },
  { id: 's1-2', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '玄关右侧通往入户门的过道，深胡桃木门套与黄铜门把，地面大理石拼花。林天成穿藏青色休闲西装外套', action: '说话', characterIds: ['c5'] },
  { id: 's1-3', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '玄关右侧近景，林天成的西装内侧口袋与左手车钥匙清晰可见，背景是虚化的玄关柜花艺与暖色晨光。', action: '接电话', characterIds: ['c5'] },
  { id: 's1-4', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '玄关右侧近景，林天成持手机贴耳，背景是暖光里的玄关柜与落地穿衣镜', action: '听电话', characterIds: ['c5'] },
  { id: 's1-5', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '侧后方中景，林天成背对玄关柜方向，肩线绷着，手里手机贴着耳朵', action: '应答', characterIds: ['c5'] },
  { id: 's1-6', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '近景，林天成的侧脸与手机贴耳的手，背景暖晨光虚化，玄关柜花艺的白色花瓣在光里发亮。', action: '听', characterIds: ['c5'] },
  { id: 's1-7', episode: 1, location: '林家别墅玄关', timeOfDay: '清晨', visual: '玄关中景，林天成站在胡桃木门套旁，身后是入户门与大理石拼花地面', action: '招呼出发', characterIds: ['c5'] },
  { id: 's1-8', episode: 1, location: '盘山公路车内', timeOfDay: '夜', visual: '夜，盘山公路车内的后排低角度全景：画面左侧林天成坐驾驶位双手握方向盘，画面右侧林薇（梦中）坐副驾双手捧手机。', action: '开车', characterIds: ['c1', 'c5'] },
  { id: 's1-9', episode: 1, location: '盘山公路车内', timeOfDay: '夜', visual: '夜，从右侧车窗方向拍林天成的侧脸近景，挡风玻璃外的路面被车灯切出一道白光，仪表盘冷光打在他下颌上。', action: '看路', characterIds: ['c5'] },
  { id: 's1-10', episode: 1, location: '盘山公路车内', timeOfDay: '夜', visual: '夜，林薇（梦中）坐副驾的近景，右侧车窗玻璃映着后方一串模糊车灯光点', action: '看手机', characterIds: ['c1'] },
  { id: 's1-11', episode: 1, location: '盘山公路车内', timeOfDay: '夜', visual: '夜，林薇（梦中）半跪在副驾座椅上的近景，右手拍着椅背，右侧车窗外的车灯白光迅速变大', action: '回头', characterIds: ['c1'] },
  { id: 's1-12', episode: 1, location: '盘山公路车内', timeOfDay: '夜', visual: '夜，从挡风玻璃侧前方拍林天成的近景，后视镜里一团白光炸开，方向盘在他手里，窗外护栏的水泥面飞快掠过。', action: '握方向盘', characterIds: ['c5'] },
  { id: 's1-13', episode: 1, location: '盘山公路弯道', timeOfDay: '夜', visual: '夜，高位俯拍盘山公路急弯：沥青路面湿冷反光，外侧水泥护栏一段接一段，护栏外是漆黑山谷。弯道入口车灯。', action: '空镜', characterIds: [] },
]

const S2_SCENES: Cont[] = [
  { id: 's2-1', episode: 2, location: '林薇卧室', timeOfDay: '早上', visual: '别墅卧室，居中双人床，林薇（梦中）仰躺在床中央，黑色长直发铺在枕头上', action: '醒来', characterIds: ['c1'] },
  { id: 's2-2', episode: 2, location: '林薇卧室', timeOfDay: '早上', visual: '床头柜一侧取景，林薇（梦中）坐在床沿，粉色千鸟格睡衣的白色滚边与白色纽扣占满画面中层；床头柜木面上立着全家合影相框', action: '坐起', characterIds: ['c1'] },
  { id: 's2-3', episode: 2, location: '二楼走廊', timeOfDay: '早上', visual: '二楼走廊，米色地毯、护墙板与无字装饰画，画面右侧是木质楼梯扶手与转角壁灯', action: '推门', characterIds: ['c1'] },
  { id: 's2-4', episode: 2, location: '二楼走廊', timeOfDay: '早上', visual: '二楼走廊靠卧室门一侧，林薇（梦中）站在门框旁，背景是米色地毯与护墙板', action: '听', characterIds: ['c1'] },
  { id: 's2-5', episode: 2, location: '二楼走廊', timeOfDay: '早上', visual: '二楼楼梯口，画面左侧林薇（梦中）站在木质栏杆旁；画面右侧楼梯转角处，林天成背对镜头', action: '对视', characterIds: ['c1', 'c5'] },
  { id: 's2-6', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '别墅餐厅，大理石长餐桌、头顶水晶吊灯、左侧整面落地窗与白纱帘、餐边柜上一瓶鲜花', action: '走进', characterIds: ['c1'] },
  { id: 's2-7', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '餐厅长桌旁，画面右侧是母亲，只拍到肩背与低髻', action: '拥抱', characterIds: ['c1', 'c8'] },
  { id: 's2-8', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '画面中央偏左是林薇（梦中）；画面右侧边缘是母亲肩背，大理石长餐桌', action: '说话', characterIds: ['c1', 'c8'] },
  { id: 's2-9', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '画面右侧林天成坐在大理石长餐桌旁', action: '看女儿', characterIds: ['c1', 'c5'] },
  { id: 's2-10', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '林薇（梦中）站在长餐桌左侧，桌面与餐边柜', action: '站着', characterIds: ['c1'] },
  { id: 's2-11', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '林天成坐在餐厅餐椅上，画面中央', action: '说话', characterIds: ['c5'] },
  { id: 's2-12', episode: 2, location: '餐厅', timeOfDay: '早上', visual: '林薇（梦中）站在餐椅旁，餐厅近景', action: '应答', characterIds: ['c1'] },
]

t('A classifyPlace: 玄关 / 车内 / 弯道 are distinct; bus 车厢 is not stolen', () => {
  assert.equal(classifyPlace('林家别墅玄关')?.key, 'villa_foyer')
  assert.equal(classifyPlace('别墅')?.key, 'villa')
  assert.equal(classifyPlace('盘山公路车内')?.key, 'car_interior')
  assert.equal(classifyPlace('驾驶座双手握方向盘，挡风玻璃外')?.key, 'car_interior')
  assert.equal(classifyPlace('盘山公路弯道')?.key, 'mountain_road_curve')
  assert.equal(classifyPlace('高位俯拍盘山公路急弯，外侧水泥护栏，车灯')?.key, 'mountain_road_curve')
  assert.equal(classifyPlace('公交车厢')?.key, 'bus')
  assert.equal(classifyPlace('地铁车厢内的扶手')?.key, 'bus')
  assert.notEqual(classifyPlace('地铁车厢内的扶手')?.key, 'car_interior')
})

t('A s1 13-shot in-memory copy: foyer / car / curve sceneIds and carry breaks at s1-13', () => {
  const shots = applySceneContinuity(S1_SCENES.map((s) => ({ ...s, prompt: s.visual || '', overlayText: [] })))
  for (const s of shots.slice(0, 7)) {
    assert.equal(s.sceneId, 'villa_foyer_day', `${s.id} ${s.sceneId}`)
    assert.equal(s.placeKey, 'villa_foyer')
    assert.ok(s.sceneLabel.startsWith('林家别墅玄关'), s.sceneLabel)
    assert.ok(!s.sceneId.startsWith('villa_bedroom'), s.id)
  }
  for (const s of shots.slice(7, 12)) {
    assert.equal(s.sceneId, 'car_interior_night', `${s.id} ${s.sceneId}`)
    assert.equal(s.placeKey, 'car_interior')
    assert.ok(s.sceneLabel.startsWith('盘山公路车内'), s.sceneLabel)
  }
  assert.equal(shots[12].sceneId, 'mountain_road_curve_night')
  assert.equal(shots[12].placeKey, 'mountain_road_curve')
  assert.ok(shots[12].sceneLabel.startsWith('盘山公路弯道'), shots[12].sceneLabel)
  assert.equal(shots[0].carryFromPrev, false)
  for (let i = 1; i <= 6; i++) assert.equal(shots[i].carryFromPrev, true, `s1-${i + 1} carry`)
  assert.equal(shots[7].carryFromPrev, false)
  for (let i = 8; i <= 11; i++) assert.equal(shots[i].carryFromPrev, true, `s1-${i + 1} carry`)
  assert.equal(shots[12].carryFromPrev, false, 's1-13 must not carry from the car interior')
})

t('A s2 12-shot in-memory copy: bedroom / pinned corridor / dining still pass', () => {
  const shots = applySceneContinuity(S2_SCENES.map((s) => ({ ...s, prompt: s.visual || '', overlayText: [] })))
  for (const s of shots.slice(0, 2)) {
    assert.equal(s.sceneId, 'villa_bedroom_day', `${s.id} ${s.sceneId}`)
    assert.ok(s.sceneLabel.startsWith('林薇卧室'), s.sceneLabel)
  }
  for (const s of shots.slice(2, 5)) {
    assert.equal(s.sceneId, 'school_corridor_day', `${s.id} ${s.sceneId} (corridor pinned, do not retarget)`)
    assert.ok(s.sceneLabel.startsWith('二楼走廊'), s.sceneLabel)
  }
  for (const s of shots.slice(5)) {
    assert.equal(s.sceneId, 'dining_room_day', `${s.id} ${s.sceneId}`)
    assert.ok(s.sceneLabel.startsWith('餐厅'), s.sceneLabel)
  }
  assert.equal(shots[0].carryFromPrev, false)
  assert.equal(shots[1].carryFromPrev, true)
  assert.equal(shots[2].carryFromPrev, false)
  assert.equal(shots[3].carryFromPrev, true)
  assert.equal(shots[4].carryFromPrev, true)
  assert.equal(shots[5].carryFromPrev, false)
  for (let i = 6; i < 12; i++) assert.equal(shots[i].carryFromPrev, true, `${shots[i].id} dining carry`)
})

t('A CARRY_WARDROBE_CONSTRAINT sentence is unchanged', () => {
  assert.equal(
    CARRY_WARDROBE_CONSTRAINT,
    '服装/道具/站位：保持与上一镜末帧一致，禁止换装、禁止换回定妆静帧服装、禁止引入定妆包道具除非上一镜已有',
  )
})

t('B trimBlockingToPresent keeps door/window and drops off-shot characters', () => {
  const blocking = {
    positions: { '林薇（梦中）': 'left', 林天成: 'right' },
    facing: { '林薇（梦中）': 'front', 林天成: 'left' },
    door: 'back',
    window: 'left',
    holding: { '林薇（梦中）': '手机', 林天成: '车钥匙' },
  }
  const present = presentKeysForBlocking({
    characterIds: ['c1'],
    startState: { '林薇（梦中）': { pos: 'left' } },
    voiceOnly: [],
  })
  const trimmed = trimBlockingToPresent(blocking, present)!
  assert.deepEqual(trimmed.positions, { '林薇（梦中）': 'left' })
  assert.deepEqual(trimmed.facing, { '林薇（梦中）': 'front' })
  assert.deepEqual(trimmed.holding, { '林薇（梦中）': '手机' })
  assert.equal(trimmed.door, 'back')
  assert.equal(trimmed.window, 'left')

  const vo = presentKeysForBlocking({
    characterIds: ['c5'],
    startState: { 林天成: { pos: 'right' } },
    voiceOnly: ['龙哥'],
  })
  const voTrim = trimBlockingToPresent(blocking, vo)!
  assert.deepEqual(voTrim.positions, { 林天成: 'right' })
  assert.equal(voTrim.door, 'back')

  const onScreenVo = presentKeysForBlocking({
    characterIds: ['c1', 'c8'],
    startState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
    voiceOnly: ['母亲'],
  })
  assert.ok(onScreenVo.includes('母亲') || onScreenVo.includes('c8'))
  assert.ok(onScreenVo.includes('林薇（梦中）') || onScreenVo.includes('c1'))
})

t('B autoFixContinuity writes a trimmed copy; scene plan still seeds later shots', () => {
  const plan = {
    positions: { '林薇（梦中）': 'left', 林天成: 'right' },
    facing: { '林薇（梦中）': 'front', 林天成: 'left' },
    door: 'back',
    window: 'left',
    holding: { '林薇（梦中）': '手机', 林天成: '车钥匙' },
  }
  const raw: RawShotLike[] = [
    {
      location: '林家别墅玄关',
      timeOfDay: '清晨',
      characters: ['林薇（梦中）'],
      startState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '手机' } },
      endState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '手机' } },
      blocking: plan,
      lighting: { key: '左侧晨光', soft: true, temp: '暖' },
    },
    {
      location: '林家别墅玄关',
      timeOfDay: '清晨',
      characters: ['林天成'],
      startState: { 林天成: { pos: 'right', facing: 'left', pose: '站', gaze: 'front', hands: '车钥匙' } },
      endState: { 林天成: { pos: 'right', facing: 'left', pose: '站', gaze: 'front', hands: '车钥匙' } },
    },
  ]
  const out = autoFixContinuity(raw, locationNamer([{ name: '林薇（梦中）', baseName: '林薇' }, { name: '林天成' }]))
  const b0 = out[0].blocking as { positions: Record<string, string>; door: string; window: string; holding: Record<string, string> }
  const b1 = out[1].blocking as { positions: Record<string, string>; door: string; window: string; holding: Record<string, string> }
  assert.deepEqual(b0.positions, { '林薇（梦中）': 'left' })
  assert.equal(b0.door, 'back')
  assert.equal(b0.window, 'left')
  assert.ok(!('林天成' in (b0.holding || {})))
  assert.deepEqual(b1.positions, { 林天成: 'right' })
  assert.equal(b1.door, 'back')
  assert.equal(b1.window, 'left')
  assert.ok(!('林薇（梦中）' in (b1.positions || {})))
})

t('B generatorHints re-trims leftover blocking on re-export of an old project', () => {
  const shot: Shot = {
    id: 's1-2',
    shotNo: 2,
    size: '中景',
    durationSec: 5,
    visual: '玄关右侧，林天成一人',
    action: '说话',
    dialogue: '林天成：拍完就出发。',
    camera: '固定',
    emotion: '',
    seedancePrompt: '竖屏9:16。林家别墅玄关。主体：林天成。',
    characterIds: ['c5'],
    startState: { 林天成: { pos: 'right', facing: 'left', pose: '站', gaze: 'front', hands: '车钥匙' } },
    endState: { 林天成: { pos: 'right', facing: 'left', pose: '站', gaze: 'front', hands: '车钥匙' } },
    location: '林家别墅玄关',
    timeOfDay: '清晨',
    blocking: {
      positions: { '林薇（梦中）': 'left', 林天成: 'right' },
      facing: { '林薇（梦中）': 'front', 林天成: 'left' },
      door: 'back',
      window: 'left',
      holding: { '林薇（梦中）': '手机', 林天成: '车钥匙' },
    },
  }
  const project: Project = {
    id: 'p_s1_trim',
    title: 'trim',
    genre: '都市',
    platform: '红果',
    episodeCount: 1,
    secondsPerEp: 60,
    style: '真人都市',
    logline: '',
    characters: [lin, dad],
    outline: [{ episode: 1, title: '一', hook: '', summary: '', cliffhanger: '' }],
    scripts: { 1: { episode: 1, title: '一', beats: [], fullText: '' } },
    storyboards: { 1: [shot] },
    selectedEpisode: 1,
    updatedAt: '',
  }
  const exp = buildVideoPipelineExport(project, { mergeToSegments: false })
  const row = exp.shots.find((s) => s.id === 's1-2' || s.id.startsWith('s1-2'))!
  const hint = (row as { blockingHint?: { positions?: Record<string, string>; door?: string; window?: string } }).blockingHint
  assert.ok(hint, 'blockingHint present')
  assert.deepEqual(hint!.positions, { c5: 'right' })
  assert.equal(hint!.door, 'back')
  assert.equal(hint!.window, 'left')
  assert.ok(!hint!.positions || !('c1' in hint!.positions))
})

t('C STORYBOARD_SYSTEM requires firstFrame/events/wardrobeState; visibility not full/verified', () => {
  assert.ok(STORYBOARD_SYSTEM.includes('firstFrame'))
  assert.ok(STORYBOARD_SYSTEM.includes('events'))
  assert.ok(STORYBOARD_SYSTEM.includes('wardrobeState'))
  assert.ok(/unverified/.test(STORYBOARD_SYSTEM) && /offscreen/.test(STORYBOARD_SYSTEM))
  assert.ok(/禁止[^\n]*full/.test(STORYBOARD_SYSTEM) || STORYBOARD_SYSTEM.includes('禁止 full'))
  assert.ok(STORYBOARD_SYSTEM.includes('verified'))
})

t('C post-process synthesizes firstFrame/events from startState; review stays unknown', () => {
  const shot: Shot = {
    id: 's1-1',
    shotNo: 1,
    size: '中景',
    durationSec: 6,
    visual: '林家别墅玄关，林薇（梦中）一人',
    action: '举手拍照',
    dialogue: '林薇：爸，看镜头！',
    camera: '固定',
    emotion: '',
    seedancePrompt: '',
    characterIds: ['c1'],
    startState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '手机' } },
    endState: { '林薇（梦中）': { pos: 'left', facing: 'front', pose: '站', gaze: 'front', hands: '手机' } },
    location: '林家别墅玄关',
    timeOfDay: '清晨',
  }
  const filled = fillStructuredShotFields([shot], [lin, dad])
  assert.ok(filled[0].firstFrame?.length)
  assert.equal(filled[0].firstFrame!.find((e) => e.id === 'c1')?.kind, 'unverified')
  assert.ok(!filled[0].firstFrame!.some((e) => e.kind === 'full' || e.kind === 'verified'))
  assert.deepEqual(filled[0].events, [])
  const doc = shotStateFromShot(filled[0], [lin, dad])
  assert.deepEqual(doc.reviews, [])
  assert.ok(!doc.source.firstFrame.some((e) => e.kind === 'full' || e.kind === 'verified'))
})

t('D s1-13 empty startState: offscreen-only dropped from characterIds, firstFrame offscreen, wardrobe formal not pajama', () => {
  const raw: Shot = {
    id: 's1-13',
    shotNo: 13,
    size: '远景',
    durationSec: 5,
    visual: '夜，高位俯拍盘山公路急弯，外侧水泥护栏，弯道入口车灯，人物不入画。',
    action: '空镜',
    dialogue: '林薇（梦中）：爸——！',
    camera: '固定',
    emotion: '',
    seedancePrompt: '夜，高位俯拍盘山公路弯道。',
    characterIds: ['c1'],
    voiceOnly: ['林薇（梦中）'],
    voiceMode: 'offscreen',
    startState: {},
    endState: {},
    wardrobeState: {},
    location: '盘山公路弯道',
    timeOfDay: '夜',
  }
  const doc = shotStateFromShot(raw, [lin, dad])
  assert.equal(doc.migration?.origin, 'legacy_migration')
  const kinds = Object.fromEntries(doc.source.firstFrame.map((e) => [e.id, e.kind]))
  assert.equal(kinds.c1, 'offscreen')
  assert.ok(!doc.source.firstFrame.some((e) => e.id === 'c1' && e.kind === 'unverified'))
  const costume = Object.fromEntries((doc.source.costume || []).map((e) => [e.id, e.state]))
  assert.equal(costume.c1, 'formal')
  assert.notEqual(costume.c1, 'pajama')
  assert.ok(!Object.values(costume).includes('cand03'))

  const filled = fillStructuredShotFields([raw], [lin, dad], { facts: [] })
  assert.ok(!filled[0].characterIds?.includes('c1'), `characterIds=${filled[0].characterIds}`)
  assert.equal(filled[0].firstFrame?.find((e) => e.id === 'c1')?.kind, 'offscreen')
  assert.equal(filled[0].wardrobeState?.c1, 'formal')
  assert.notEqual(filled[0].wardrobeState?.c1, 'pajama')
  const filledDoc = shotStateFromShot(filled[0], [lin, dad])
  assert.equal(filledDoc.source.firstFrame.find((e) => e.id === 'c1')?.kind, 'offscreen')
  assert.equal(filledDoc.source.costume?.find((e) => e.id === 'c1')?.state, 'formal')
  assert.deepEqual(filledDoc.reviews, [])
})

t('D on-screen VO keeps characterIds; delayed entry events still synthesized', () => {
  const hug: Shot = {
    id: 's2-7',
    shotNo: 7,
    size: '中景',
    durationSec: 6,
    visual: '两人站姿拥抱，母亲只露肩背',
    action: '保持拥抱',
    dialogue: '母亲（画外）：做噩梦了？',
    camera: '固定',
    emotion: '',
    seedancePrompt: '',
    characterIds: ['c1', 'c8'],
    voiceOnly: ['母亲'],
    voiceMode: 'offscreen',
    startState: { '林薇（梦中）': { pose: '站', pos: 'left' }, 母亲: { pose: '站', pos: 'right' } },
    endState: { '林薇（梦中）': { pose: '站', pos: 'left' }, 母亲: { pose: '站', pos: 'right' } },
    location: '餐厅',
    timeOfDay: '早上',
  }
  const filled = fillStructuredShotFields([hug], [lin, dad, mom])
  assert.ok(filled[0].characterIds?.includes('c1') && filled[0].characterIds?.includes('c8'))
  const ff = Object.fromEntries((filled[0].firstFrame || []).map((e) => [e.id, e.kind]))
  assert.equal(ff.c1, 'unverified')
  assert.equal(ff.c8, 'unverified')

  const entry: Shot = {
    id: 's-entry',
    shotNo: 6,
    size: '中景',
    durationSec: 6,
    visual: '首帧只有林薇（梦中）',
    action: '随后母亲进入',
    dialogue: '',
    camera: '固定',
    emotion: '',
    seedancePrompt: '',
    characterIds: ['c1', 'c8'],
    startState: { '林薇（梦中）': { pos: 'left', pose: '站' } },
    endState: { '林薇（梦中）': { pose: '站' }, 母亲: { pose: '站' } },
  }
  const eFilled = fillStructuredShotFields([entry], [lin, mom])
  const kinds = Object.fromEntries((eFilled[0].firstFrame || []).map((e) => [e.id, e.kind]))
  assert.equal(kinds.c1, 'unverified')
  assert.equal(kinds.c8, 'offscreen')
  assert.deepEqual(
    (eFilled[0].events || []).map((e) => `${e.id}:${e.kind}`),
    ['c8:start_offscreen', 'c8:enter'],
  )
})

const S1_SCRIPT = `# 第1集剧本（生成输入）

来源说明：本剧本由官方视频流水线合同 short-drama-studio/video-pipeline@1 装配。不得伪称原始剧本。

合同记录的分镜时长仅供节奏参考（合计 75 秒）。

第1集生成约束（由官方合同本集 wardrobeState / characterIds / voiceOnly 归纳，不是第2集用户约束）：
- 本集林薇穿角色卡默认 costume / wardrobeRefs.formal：米白色针织开衫。不得套用第2集早晨睡衣，也不得套用第2集母亲 cand03 背影或拥抱规则。
- 龙哥两句对白为电话 voiceOnly，本人不出镜。
- 车内一场合同记录有时间字幕参考「21:47」，时段为夜。

装配说明：以下对白来自合同缺口装配，不是生成器新写的约束行。

---

场1 林家别墅玄关 · 清晨

林薇：爸，看镜头！妈往左一点——小宇别抢我帽子！

林天成：拍完就出发，再磨蹭，到景区就是大中午的太阳。

龙哥（voiceOnly，电话，不出镜）：林老板，昨天那块地，你一句“按规矩来”，让我很没面子。

场3 盘山公路弯道 · 夜

林薇：爸——！
`

t('G parseScriptDialogue skips headings, list items, and 来源说明/生成约束/装配说明; keeps real lines', () => {
  assert.equal(parseScriptLine('# 第1集剧本（生成输入）').kind, 'skip')
  assert.equal(parseScriptLine('- 本集林薇穿角色卡默认 costume / wardrobeRefs.formal：不得套用睡衣或 cand03。').kind, 'skip')
  assert.equal(parseScriptLine('来源说明：本剧本由官方合同装配。').kind, 'skip')
  assert.equal(parseScriptLine('第1集生成约束（由官方合同归纳）：').kind, 'skip')
  assert.equal(parseScriptLine('装配说明：对白来自合同。').kind, 'skip')
  const keep = parseScriptLine('林薇：爸，看镜头！妈往左一点——小宇别抢我帽子！')
  assert.equal(keep.kind, 'line')
  assert.equal(keep.lines?.[0].speaker, '林薇')
  assert.ok(keep.lines?.[0].text.includes('看镜头'))

  const parsed = parseScriptDialogue(S1_SCRIPT)
  const speakers = parsed.lines.map((l) => l.speakerNorm || l.speaker)
  assert.ok(speakers.includes('林薇'), `speakers=${speakers}`)
  assert.ok(speakers.includes('林天成'))
  assert.ok(speakers.includes('龙哥'))
  assert.ok(parsed.lines.some((l) => l.text.includes('爸——') || l.text.includes('爸——！') || l.key.includes('爸')))
  assert.equal(
    parsed.unparseable.length,
    0,
    `unparseable=${JSON.stringify(parsed.unparseable, null, 2)}`,
  )
  assert.ok(!parsed.lines.some((l) => /来源说明|生成约束|装配说明|wardrobeRefs|cand03/.test(l.raw)))
})

t('implementation source does not rewrite CARRY_WARDROBE_CONSTRAINT or official pack files', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, '../src/lib/sceneContinuity.ts'), 'utf8')
  const matches = [...src.matchAll(/export const CARRY_WARDROBE_CONSTRAINT\s*=\s*'([^']+)'/g)]
  assert.equal(matches.length, 1)
  assert.equal(
    matches[0][1],
    '服装/道具/站位：保持与上一镜末帧一致，禁止换装、禁止换回定妆静帧服装、禁止引入定妆包道具除非上一镜已有',
  )
})

console.log(`\n${pass} tests passed`)
