/**
 * Research P0-1 / P0-2 / P0-3 (generic export rules; pack fields only — no show / shot-id data):
 *
 * P0-2 scene blocking (站位基准) per scene = `<sceneGroup>@<locationKey>` (the sceneKeyframe key; a cross-cut group
 *   has one blocking per place): who is left / right, facing, door / window side, who holds what (pack
 *   `sceneBlocking`). Every shot: `cameraSide` master | A | B and `eyeline` { [characterId]: { dir, target } }.
 *   A = the camera on the standard side of the 180° line (blocking left stays screen left), B = the mirrored side,
 *   master = a wide / all-cast frame that re-establishes the line. axisCross = an A↔B switch inside one scene
 *   without a master in between (gate warn | hold | fail, like the cross-cut budget).
 * P0-1 per-shot `startState` / `endState` { [characterId]: { pos, facing, pose, gaze, hands } } for the on-screen
 *   cast. With a carry the source's endState must equal the shot's startState (stateJump → fixed / warn / fail).
 *   Prompt: a 站位 line (positions first, then the timeline), and a carry SOURCE holds still for its last ~1 s.
 * P0-3 one lighting set per scene (`sceneLighting`: key direction, soft / hard, warm / cold, band): every shot of the
 *   scene gets the same 光线 line verbatim. Dialogue lines are onscreen / inner / offscreen (`voiceMode`); inner and
 *   offscreen lines keep every mouth closed (listenerMouth + speakerMouth closed, no lip-sync segment).
 * Generator hints (startState / endState / cameraSide / eyeline / voiceMode / blockingHint / lightingHint) win when
 * valid; anything missing is inferred deterministically from the shot text and the multi-cast fields.
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { inferGender, nounOf, POS_WORD } from './multiCast'
import { locationKeyOf } from './sceneGroup'
import { framingOf } from './shotAnnotate'

export type Side = 'left' | 'right' | 'center'
export type Facing = 'left' | 'right' | 'front' | 'away'
export type CameraSide = 'master' | 'A' | 'B'
export type AnchorSide = 'left' | 'right' | 'back'
export type VoiceMode = 'onscreen' | 'inner' | 'offscreen'
export interface CharState { pos: Side; facing: Facing; pose: string; gaze: string; hands: string; /** where the pose rests (床 / 椅子 …), prompt only, not compared */ at?: string }
export type ShotState = Record<string, CharState>
export interface Eyeline { dir: Facing; target: string | null }
export interface SceneBlocking {
  scene: string
  sceneGroup: string
  locationKey: string
  characters: string[]
  positions: Record<string, Side>
  facing: Record<string, Facing>
  door: AnchorSide | null
  window: AnchorSide | null
  holding: Record<string, string>
  source: 'generator' | 'inferred'
}
export interface SceneLighting { scene: string; key: string; soft: boolean; temp: '暖' | '冷' | '中性'; band: string; text: string; source: 'generator' | 'inferred' }
export interface AxisCross { scene: string; shotId: string; from: CameraSide; to: CameraSide; prevShotId: string }
export interface StateJump { shotId: string; from: string; characterId: string; fields: string[]; detail: string }
export type AxisGate = 'warn' | 'hold' | 'fail'
export type StateGate = 'fix' | 'warn' | 'fail'
export const AXIS_NOTE = '越轴：'
export const STATE_STAY = '收尾保持'
export const HOLD_TAIL_BODY = '姿态和位置不动，不加新动作'
export const INNER_CUE = '这句话只在音轨上，人物不出声，嘴唇闭合，只用眼神和呼吸表现'
export const OFFSCREEN_CUE = '画外有人说话，画面人物停住倾听，嘴唇闭合不说话'

type S = VideoPipelineShot & Record<string, any>
type Exp = VideoPipelineExport & { sceneBlocking?: Record<string, SceneBlocking>; sceneLighting?: Record<string, SceneLighting> }

// ---------------- normalisers (enum values are normalised so the checks can compare strictly) ----------------
export const normSide = (v: unknown): Side | null => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  if (/^(l|left)$|左/.test(t)) return 'left'
  if (/^(r|right)$|右/.test(t)) return 'right'
  if (/^(c|center|centre|middle)$|中/.test(t)) return 'center'
  return null
}
export const normFacing = (v: unknown): Facing | null => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  if (/^(back|away)$|背/.test(t)) return 'away'
  if (/^(l|left)$|左/.test(t)) return 'left'
  if (/^(r|right)$|右/.test(t)) return 'right'
  if (/^(f|front|camera|forward)$|镜头|正面|前方|正对/.test(t)) return 'front'
  return null
}
const POSES: [RegExp, string][] = [[/躺|卧/, '躺'], [/跪/, '跪'], [/蹲/, '蹲'], [/坐/, '坐'], [/靠|倚/, '靠'], [/站|立|走/, '站']]
export const normPose = (v: unknown): string | null => {
  const t = String(v ?? '').trim()
  if (!t) return null
  const en: Record<string, string> = { stand: '站', standing: '站', sit: '坐', sitting: '坐', lie: '躺', lying: '躺', kneel: '跪', kneeling: '跪', squat: '蹲', lean: '靠', leaning: '靠' }
  if (en[t.toLowerCase()]) return en[t.toLowerCase()]
  for (const [re, p] of POSES) if (re.test(t)) return p
  return t.slice(0, 6)
}
export const normHands = (v: unknown): string => {
  const t = String(v ?? '').trim()
  if (!t || /^(无|空|空手|none|null|empty|-)$/i.test(t) || /^空着?手?$/.test(t)) return '空手'
  return t.replace(/^(?:手里|手中|手上)?(?:拿着|握着|端着|捏着|攥着|抱着|举着|提着)/, '').slice(0, 10) || '空手'
}
export const normCameraSide = (v: unknown): CameraSide | null => {
  const t = String(v ?? '').trim()
  if (!t) return null
  if (/^(master|m|主|全景|主机位|定场)$/i.test(t)) return 'master'
  if (/^a$/i.test(t)) return 'A'
  if (/^b$/i.test(t)) return 'B'
  return null
}
export const normVoiceMode = (v: unknown): VoiceMode | null => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  if (/^(inner|os_inner|monologue)$|内心|心声|独白/.test(t)) return 'inner'
  if (/^(offscreen|off|vo|voiceover|os)$|画外|旁白/.test(t)) return 'offscreen'
  if (/^(onscreen|on|face|sync)$|当面|出镜/.test(t)) return 'onscreen'
  return null
}
const normAnchor = (v: unknown): AnchorSide | null => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t || /^(none|无|null)$/.test(t)) return null
  if (/^(back|behind|背景)$|后|背/.test(t)) return 'back'
  const s = normSide(t)
  return s === 'center' ? 'back' : s
}
/** generator id/name keyed record → id keyed (names map through `idOf`) */
const keyed = <T>(raw: unknown, idOf: (k: string) => string | null, f: (v: unknown) => T | null): Record<string, T> => {
  const out: Record<string, T> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = idOf(k)
    const x = f(v)
    if (id && x != null) out[id] = x
  }
  return out
}
export function normalizeState(raw: unknown, idOf: (k: string) => string | null): ShotState | null {
  const st = keyed(raw, idOf, (v) => {
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    const pos = normSide(o.pos)
    if (!pos) return null
    const gz = String(o.gaze ?? '').trim()
    return { pos, facing: normFacing(o.facing) || 'front', pose: normPose(o.pose) || '站', gaze: (gz && idOf(gz)) || gz || 'front', hands: normHands(o.hands) }
  })
  return Object.keys(st).length ? st : null
}
export const sameState = (a: CharState, b: CharState): (keyof CharState)[] => (['pos', 'facing', 'pose', 'gaze', 'hands'] as const).filter((k) => a[k] !== b[k])

// ---------------- text inference ----------------
const TRANSITIONS: [RegExp, string, string][] = [
  [/坐起|撑起身|撑坐起|从床上坐/, '躺', '坐'],
  [/站起|起身|站了起来|起立|腾地站/, '坐', '站'],
  [/坐下|坐到|落座|跌坐/, '站', '坐'],
  [/躺下|倒在床|躺回/, '坐', '躺'],
  [/跪下|跪倒/, '站', '跪'],
  [/蹲下/, '站', '蹲'],
]
const STATIC_POSE: [RegExp, string][] = [
  [/躺(?:在|着)|卧床|昏迷|病床上的/, '躺'],
  [/跪(?:在|着)/, '跪'],
  [/蹲(?:在|着)/, '蹲'],
  [/坐(?:在|着)|端坐|坐姿/, '坐'],
  [/靠(?:在|着)|倚(?:在|着)/, '靠'],
  [/站(?:在|着)|伫立|走到|走进|走向|站定/, '站'],
]
const HOLD_STATIC = /(?:握着?|拿着|端着|捏着?|攥着?|抱着|举着|提着)([^，。；、,;\s的]{1,6})/
const PHONE = /打电话|看手机|盯着手机|手机贴在耳边|举着手机/
const PHONE_PICK = /接电话|接起电话|拿起手机|掏出手机|接通电话/
const PLACES = /病床|床边|床上|床头|床|沙发|椅子|座椅|驾驶座|副驾|长椅|台阶|窗台|地上|地板|桌边|办公桌/
const HOLD_PICK = /(?:拿起|抓起|接过|掏出|捡起|举起)([^，。；、,;\s的]{1,6})/
const RELEASE = /放下|松开|扔下|扔掉|丢下|递给|递出|塞给/
const cleanObj = (o: string) => {
  const x = o.replace(/^(?:一|那|这)(?:个|只|把|张|本|部|台|支|块)?/, '').replace(/(?:的手|的指节)$/, '').replace(/(?:把|朝|对着?|向|贴|在|往|放|指).*$/, '') || o
  return x.replace(/^(手(?:机|表|电|链|包|套)).*$/, '$1')
}
export const placeOf = (text: string, pose: string): string | undefined => {
  if (!/[坐躺跪靠]/.test(pose)) return undefined
  const m = text.match(PLACES)
  return m ? m[0].replace(/^床(?:边|头|上)?$/, '床').replace(/^病床$/, '病床') : undefined
}
export function poseOf(text: string): { start: string | null; end: string | null } {
  for (const [re, a, b] of TRANSITIONS) if (re.test(text)) return { start: a, end: b }
  for (const [re, p] of STATIC_POSE) if (re.test(text)) return { start: p, end: p }
  return { start: null, end: null }
}
export function handsOf(text: string, before: string, isPerson: (o: string) => boolean = () => false): { start: string; end: string } {
  const prop = (m: RegExpMatchArray | null) => (m && !/^[得紧住成拳着了]/.test(m[1]) && !/[（(]/.test(m[1]) && !/画面|女子|男子|少女|少年|男人|女人|孩子|对方|自己/.test(m[1]) && !isPerson(m[1]) ? m : null)
  const st0 = prop(text.match(HOLD_STATIC))
  // 握手 / 握拳 / 攥紧拳头 are no props; 手机 / 手表 / 手电 are
  const st = st0 && (!/^[手拳紧住]/.test(st0[1]) || /^手(?:机|表|电|链|包|套)/.test(st0[1])) ? st0 : PHONE.test(text) ? (['', '手机'] as unknown as RegExpMatchArray) : null
  const pk = prop(text.match(HOLD_PICK))
  let start = before
  let end = before
  if (st && before === '空手') start = end = cleanObj(st[1])
  else if (st) end = before
  if (pk) end = cleanObj(pk[1])
  else if (PHONE_PICK.test(text) && !st) end = '手机'
  if (RELEASE.test(text) && !pk) end = '空手'
  return { start, end }
}
/** clauses of a shot's visual + action attributed to each character (by name / baseName; unnamed clauses → last named, or the only cast member) */
function clausesByChar(s: S, ids: string[], names: Map<string, string[]>): Map<string, string> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  let last: string | null = ids.length === 1 ? ids[0] : null
  for (const cl of `${s.visual || ''}。${s.action || ''}`.split(/[。；;！!？?\n]/)) {
    if (!cl.trim()) continue
    const hit = ids.filter((id) => (names.get(id) || []).some((n) => n && cl.includes(n)))
    const who = hit.length ? hit : last ? [last] : []
    for (const id of who) out.get(id)!.push(cl)
    if (hit.length) last = hit[hit.length - 1]
  }
  return new Map([...out].map(([k, v]) => [k, v.join('。')]))
}

// ---------------- scene key / carry helpers ----------------
export const sceneKeyOf = (s: S): string => `${s.sceneGroup || `ep${s.episode}`}@${locationKeyOf(s)}`
const onscreenIds = (s: S) => (s.characterIds || []).filter((id: string) => !(s.voiceOnly || []).includes(id))
export function carrySourceId(shots: S[], i: number): string | null {
  const s = shots[i]
  if (typeof s.carryFromShotId === 'string') return s.carryFromShotId
  if (s.carryFromShotId === null) return null
  const prev = i ? shots[i - 1] : null
  return s.carryFromPrev && prev && prev.episode === s.episode ? prev.id : null
}
const WIDE = /大全景|全景|远景/
const WINDOW_RE = /窗|纱帘|窗帘/
const DOOR_RE = /房门|门口|推门|门边|门外|大门|开门|关门|门框/
const TOWARD_ANCHOR = /(?:走|跑|冲|挪|移|奔)(?:向|到|去)?[^，。；]{0,4}(?:窗|门)/

export function parseAxisGate(s: string | undefined): AxisGate {
  if (!s) return 'warn'
  if (s === 'warn' || s === 'hold' || s === 'fail') return s
  throw new Error(`axis gate must be warn|hold|fail, got ${s}`)
}
export function parseStateGate(s: string | undefined): StateGate {
  if (!s) return 'fix'
  if (s === 'fix' || s === 'warn' || s === 'fail') return s
  throw new Error(`state gate must be fix|warn|fail, got ${s}`)
}

// ---------------- lighting ----------------
export function inferLighting(scene: string, texts: string[], band: string, windowSide: AnchorSide | null): Omit<SceneLighting, 'text'> {
  const t = texts.join('\n')
  const night = /night|夜|晚/.test(band)
  const dusk = /dusk|黄昏|傍晚/.test(band)
  let key: string
  if (/月光/.test(t) && night) key = '月光'
  else if (/台灯|床头灯|落地灯|烛/.test(t)) key = '画面左侧台灯光'
  else if (/路灯|霓虹/.test(t)) key = '路灯侧光'
  else if (/日光灯|白炽灯|顶灯|吊灯|灯管|监护仪|无影灯/.test(t)) key = '顶部灯光'
  else if (!night && WINDOW_RE.test(t)) key = windowSide === 'left' ? '画面左侧窗光' : windowSide === 'right' ? '画面右侧窗光' : '侧后方窗光'
  else if (!night && /阳光|日光|晨光|天光|夕阳|斜阳/.test(t)) key = '侧前方自然天光'
  else key = night ? '侧前方室内灯光' : '侧前方自然天光'
  const soft = !/强光|直射|刺眼|硬光|逆光|路灯/.test(t) && key !== '路灯侧光'
  const warm = (t.match(/暖|阳光|夕阳|黄昏|晨光|台灯|烛|壁炉/g) || []).length + (dusk ? 1 : 0)
  const cold = (t.match(/冷|月光|蓝光|日光灯|灯管|监护仪|医院|病房|警局|车库/g) || []).length
  const temp: SceneLighting['temp'] = warm > cold ? '暖' : cold > warm ? '冷' : night ? '冷' : '中性'
  return { scene, key, soft, temp, band, source: 'inferred' }
}
const BAND_WORD = (b: string) => (/night|夜/.test(b) ? '夜晚' : /dusk|黄昏/.test(b) ? '黄昏' : /dawn|清晨/.test(b) ? '清晨' : '白天')
export const lightingText = (l: Omit<SceneLighting, 'text'>): string =>
  `本场统一布光，主光为${l.key}，${l.soft ? '柔和散射光' : '硬光，阴影边缘清晰'}，${l.temp === '中性' ? '中性色温' : `${l.temp}色调`}，${BAND_WORD(l.band)}；本场所有镜头光线方向、软硬、冷暖保持一致`
export function normalizeLighting(raw: unknown, scene: string, band: string): Omit<SceneLighting, 'text'> | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const key = String(o.key ?? o.direction ?? '').trim()
  if (!key) return null
  const softRaw = o.soft
  const soft = typeof softRaw === 'boolean' ? softRaw : !/硬|hard/i.test(String(softRaw ?? ''))
  const tt = String(o.temp ?? '')
  const temp: SceneLighting['temp'] = /暖|warm/i.test(tt) ? '暖' : /冷|cool|cold/i.test(tt) ? '冷' : '中性'
  return { scene, key: key.slice(0, 16), soft, temp, band: String(o.band || band || ''), source: 'generator' }
}
const LIGHT_CONFLICT = (l: SceneLighting, body: string): string | null => {
  if (l.temp === '暖' && /冷光|冷色|冷蓝|蓝调/.test(body)) return '镜内写冷光，本场为暖色调'
  if (l.temp === '冷' && /暖光|暖色|暖黄|夕阳/.test(body)) return '镜内写暖光，本场为冷色调'
  if (!/night|夜/.test(l.band) && /夜景|夜色|月光/.test(body)) return '镜内写夜景，本场为日景'
  return null
}

// ---------------- pass A: blocking, camera side, eyeline, lighting, states, axis ----------------
export interface BlockingReport {
  scenes: number
  generatorBlocking: number
  axisGate: AxisGate
  axisCross: AxisCross[]
  eyelineFixes: { shotId: string; characterId: string; from: string; to: string }[]
  /** generator cameraSide B without mirrored positions (a shot / reverse shot) → A */
  cameraSideFixes: { shotId: string; from: CameraSide; to: CameraSide }[]
  lightingConflicts: { shotId: string; scene: string; detail: string }[]
  generatorStates: number
  inferredStates: number
}

export function applyBlocking(exp0: VideoPipelineExport, opts: { axisGate?: AxisGate } = {}): { exp: Exp; report: BlockingReport } {
  const axisGate = opts.axisGate ?? 'warn'
  const chars = exp0.characters
  const names = new Map(chars.map((c) => [c.id, [c.name, c.baseName].filter(Boolean) as string[]] as const))
  const idOf = (k: string): string | null => {
    const t = (k || '').trim()
    if (!t) return null
    return chars.find((c) => c.id === t)?.id || chars.find((c) => c.name === t)?.id || chars.find((c) => c.baseName === t)?.id || null
  }
  const shots: S[] = exp0.shots.map((s) => ({ ...s }) as S)
  const sceneOrder: string[] = []
  const byScene = new Map<string, S[]>()
  for (const s of shots) {
    const k = sceneKeyOf(s)
    if (!byScene.has(k)) (byScene.set(k, []), sceneOrder.push(k))
    byScene.get(k)!.push(s)
  }
  const rep: BlockingReport = { scenes: byScene.size, generatorBlocking: 0, axisGate, axisCross: [], eyelineFixes: [], cameraSideFixes: [], lightingConflicts: [], generatorStates: 0, inferredStates: 0 }
  const sceneBlocking: Record<string, SceneBlocking> = {}
  const sceneLighting: Record<string, SceneLighting> = {}
  for (const key of sceneOrder) {
    const list = byScene.get(key)!
    const first = list[0]
    const ids: string[] = []
    for (const s of list) for (const id of onscreenIds(s)) if (!ids.includes(id)) ids.push(id)
    // ---- positions: generator hint, else the locked multi-cast screenPos, else free sides
    const hint = list.map((s) => s.blockingHint).find((h) => h && typeof h === 'object') as Record<string, unknown> | undefined
    const hintPos = hint ? keyed(hint.positions, idOf, normSide) : {}
    const positions: Record<string, Side> = {}
    for (const s of list) for (const c of s.cast || []) if ((s.cast || []).length > 1 && !positions[c.id]) positions[c.id] = c.screenPos
    for (const [id, p] of Object.entries(hintPos)) if (!positions[id] && ids.includes(id)) positions[id] = p
    if (ids.length === 1) positions[ids[0]] = positions[ids[0]] && Object.keys(positions).length > 1 ? positions[ids[0]] : 'center'
    for (const id of ids) {
      if (positions[id]) continue
      const used = new Set(Object.values(positions))
      positions[id] = !used.has('left') ? 'left' : !used.has('right') ? 'right' : 'center'
    }
    const multi = ids.length >= 2
    const facing: Record<string, Facing> = {}
    const hintFacing = hint ? keyed(hint.facing, idOf, normFacing) : {}
    for (const id of ids) facing[id] = multi ? (positions[id] === 'left' ? 'right' : positions[id] === 'right' ? 'left' : hintFacing[id] || 'front') : hintFacing[id] || 'front'
    const text = list.map((s) => `${s.visual || ''} ${s.action || ''} ${s.camera || ''}`).join('\n')
    const free = (['right', 'left'] as const).filter((sd) => !Object.values(positions).includes(sd))
    const hw = hint ? normAnchor(hint.window) : null
    const hd = hint ? normAnchor(hint.door) : null
    const windowSide: AnchorSide | null = hw || (WINDOW_RE.test(text) ? free[0] || 'back' : null)
    const doorSide: AnchorSide | null = hd || (DOOR_RE.test(text) ? free.find((x) => x !== windowSide) || 'back' : null)
    if (hint) rep.generatorBlocking++
    sceneBlocking[key] = {
      scene: key, sceneGroup: first.sceneGroup || '', locationKey: locationKeyOf(first), characters: ids, positions, facing,
      door: doorSide, window: windowSide, holding: {}, source: hint ? 'generator' : 'inferred',
    }
    // ---- lighting: first valid generator hint of the scene, else inferred; the same text on every shot
    const band = first.timeBand || first.timeOfDay || ''
    const gl = list.map((s) => normalizeLighting(s.lightingHint, key, band)).find(Boolean)
    const lt0 = gl || inferLighting(key, list.map((s) => `${s.visual || ''} ${s.prompt.match(/光线[：:]([^\n]*)/)?.[1] || ''} ${s.location || ''}`), band, windowSide)
    const light: SceneLighting = { ...lt0, text: lightingText(lt0) }
    sceneLighting[key] = light
    for (const s of list) {
      const otherHint = normalizeLighting(s.lightingHint, key, band)
      if (gl && otherHint && (otherHint.key !== gl.key || otherHint.temp !== gl.temp || otherHint.soft !== gl.soft)) rep.lightingConflicts.push({ shotId: s.id, scene: key, detail: `生成器光线与本场设定不同（${otherHint.key}/${otherHint.temp}），已统一为 ${gl.key}/${gl.temp}` })
      const body = s.prompt.split('\n').filter((l: string) => !/^光线[：:]/.test(l)).join('\n')
      const c = LIGHT_CONFLICT(light, body)
      if (c) rep.lightingConflicts.push({ shotId: s.id, scene: key, detail: c })
    }
    // ---- per shot: camera side, eyeline, start / end states
    const cur = new Map<string, CharState>()
    const defaulted = new Map<string, CharState[]>()
    let lastSide: { side: CameraSide; id: string } | null = null
    for (const s of list) {
      const on = onscreenIds(s)
      let genSide = s.splitFrom ? null : normCameraSide(s.cameraSide)
      // B only when the generator's own start state mirrors the scene sides (a real line crossing); else it is a reverse shot → A
      if (genSide === 'B') {
        const gs = normalizeState(s.startState, idOf)
        const mirrored = multi && !!gs && on.some((id) => gs[id] && positions[id] !== 'center' && gs[id].pos !== 'center' && gs[id].pos !== positions[id])
        if (!mirrored) (rep.cameraSideFixes.push({ shotId: s.id, from: 'B', to: 'A' }), (genSide = 'A'))
      }
      const allCast = multi && ids.every((id) => on.includes(id))
      const side: CameraSide = genSide || (!on.length || WIDE.test(s.size || '') || allCast ? 'master' : 'A')
      s.cameraSide = side
      // eyeline: two-person scene → toward the partner's side (flipped on B); solo → generator hint or front
      const genEye = s.splitFrom ? {} : keyed(s.eyeline, idOf, (v) => (typeof v === 'object' && v ? normFacing((v as Record<string, unknown>).dir) : normFacing(v)))
      const eye: Record<string, Eyeline> = {}
      for (const id of on) {
        const partner = multi ? ids.find((x) => x !== id && on.includes(x)) || ids.find((x) => x !== id) || null : null
        let dir: Facing = facing[id]
        if (side === 'B' && (dir === 'left' || dir === 'right')) dir = dir === 'left' ? 'right' : 'left'
        if (!multi && genEye[id]) dir = genEye[id]
        if (multi && genEye[id] && genEye[id] !== dir) rep.eyelineFixes.push({ shotId: s.id, characterId: id, from: genEye[id], to: dir })
        eye[id] = { dir, target: partner }
      }
      s.eyeline = eye
      // axis: A↔B without a master in between (held shots are not rendered and do not count)
      if (multi && !s.hold) {
        if (lastSide && side !== 'master' && lastSide.side !== 'master' && lastSide.side !== side) rep.axisCross.push({ scene: key, shotId: s.id, from: lastSide.side, to: side, prevShotId: lastSide.id })
        lastSide = { side, id: s.id }
      }
      // states
      const genStart = s.splitFrom ? null : normalizeState(s.startState, idOf)
      const genEnd = s.splitFrom ? null : normalizeState(s.endState, idOf)
      const by = clausesByChar(s, on, names)
      const timeline = s.prompt.split('\n').filter((l: string) => /^\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒/.test(l)).join('\n')
      const start: ShotState = {}
      const end: ShotState = {}
      for (const id of on) {
        const t = by.get(id) || ''
        const prev = cur.get(id)
        const ps = poseOf(t)
        // a transition the final timeline does not show happened before the cut: the shot starts in the end pose
        if (ps.start !== ps.end && !poseOf(timeline).start) ps.start = ps.end
        // the first pose evidence of a character backfills the defaulted (evidence-less) states before it in the scene
        if (ps.start && defaulted.has(id)) {
          for (const st of defaulted.get(id)!) st.pose = ps.start
          defaulted.delete(id)
          if (prev) prev.pose = ps.start
        }
        const sPose = ps.start && (ps.start !== ps.end || !prev) ? ps.start : prev?.pose || ps.start || '站'
        const ePose = ps.start !== ps.end && ps.end ? ps.end : ps.end && !prev ? ps.end : ps.end && prev && ps.end !== prev.pose ? ps.end : sPose
        const hd0 = prev?.hands || '空手'
        const hh = handsOf(t, hd0, (o) => [...names.values()].flat().some((n) => n && (o.includes(n) || n.startsWith(o))))
        const partner = eye[id].target
        const base = { pos: positions[id], facing: facing[id], gaze: partner || 'front' }
        const at = placeOf(t, ePose) || (prev && prev.pose === sPose ? prev.at : undefined)
        start[id] = genStart?.[id] || { ...base, pose: sPose, hands: hh.start, ...(at && sPose === ePose ? { at } : prev?.at && prev.pose === sPose ? { at: prev.at } : {}) }
        end[id] = genEnd?.[id] || { ...base, pose: ePose, hands: hh.end, ...(at ? { at } : {}) }
        if (!ps.start && !prev && !genStart?.[id]) defaulted.set(id, [start[id], end[id]])
        else if (!ps.start && defaulted.has(id) && !genStart?.[id]) defaulted.get(id)!.push(start[id], end[id])
        // positions / facing stay locked to the scene blocking (a generator state may not move people across the line)
        for (const st of [start[id], end[id]]) {
          if (st.at && !/[坐躺跪靠]/.test(st.pose)) delete st.at
          st.pos = positions[id]
          if (multi) st.facing = facing[id]
        }
        if (genStart?.[id] || genEnd?.[id]) rep.generatorStates++
        else rep.inferredStates++
        cur.set(id, end[id])
        if (!(id in sceneBlocking[key].holding)) sceneBlocking[key].holding[id] = start[id].hands
      }
      s.startState = start
      s.endState = end
    }
  }
  // axis gate
  if (rep.axisCross.length && axisGate === 'hold') {
    const bad = new Set(rep.axisCross.map((x) => x.shotId))
    for (const s of shots) if (bad.has(s.id)) {
      const x = rep.axisCross.find((a) => a.shotId === s.id)!
      s.hold = { reason: [...(s.hold?.reason || []), `${AXIS_NOTE}${x.prevShotId} 机位${x.from} → ${s.id} 机位${x.to}，中间没有 master 镜`] }
    }
  }
  for (const s of shots) {
    const k = sceneKeyOf(s)
    s.blockingScene = k
    s.lighting = { scene: k, key: sceneLighting[k].key, soft: sceneLighting[k].soft, temp: sceneLighting[k].temp, band: sceneLighting[k].band }
    delete s.blockingHint
    delete s.lightingHint
  }
  return { exp: { ...exp0, shots: shots as VideoPipelineShot[], sceneBlocking, sceneLighting } as Exp, report: rep }
}

// ---------------- pass B (after renderSkip): carry continuity, voice modes, final prompt lines ----------------
export interface ContinuityReport {
  stateGate: StateGate
  carriesChecked: number
  stateJumps: StateJump[]
  stateFixed: number
  holdTailShots: string[]
  cameraAnchorTrims: { shotId: string; removed: string }[]
  voiceModes: Record<VoiceMode, number>
  innerFramingChanges: string[]
}
const POSE_WORD: Record<string, string> = { 站: '站着', 坐: '坐着', 躺: '躺着', 跪: '跪着', 蹲: '蹲着', 靠: '靠着' }
const FACING_WORD: Record<Facing, string> = { right: '身体朝向画面右侧', left: '身体朝向画面左侧', front: '身体正对镜头', away: '背对镜头' }
const SIDE_WORD: Record<Side, string> = { left: '左侧', right: '右侧', center: '中间' }
const ANCHOR_WORD = (a: AnchorSide) => (a === 'back' ? '背景里' : `画面${a === 'left' ? '左' : '右'}侧`)
const INNER_MARK = /^[（(](?:内心|心声|心想|心里|独白|内心独白)/

export function stanceLine(s: S, blocking: SceneBlocking | undefined, chars: VideoPipelineExport['characters']): string {
  const on = onscreenIds(s)
  if (!on.length || !s.startState) return ''
  const byId = new Map(chars.map((c) => [c.id, c]))
  const g = (id: string) => inferGender(byId.get(id) as never)
  const noun = (id: string) => nounOf(g(id), (byId.get(id) as { age?: string } | undefined)?.age)
  const n = on.length
  const refOf = (id: string, st: CharState) => (n >= 2 ? `${POS_WORD[st.pos]}的${noun(id)}` : g(id) === 'female' ? '她' : g(id) === 'male' ? '他' : '人物')
  const parts = on.map((id) => {
    const st: CharState = s.startState![id]
    const en: CharState | undefined = s.endState?.[id]
    if (!st) return ''
    const where = n >= 2 ? '' : blocking && blocking.characters.length >= 2 ? `在本场位于${SIDE_WORD[st.pos]}，画面中只有${refOf(id, st)}一人` : '位于画面中间'
    const eye: Eyeline | undefined = s.eyeline?.[id]
    const tgt: CharState | null = eye?.target && on.includes(eye.target) ? s.startState![eye.target] : null
    const gaze = tgt
      ? `看向${POS_WORD[tgt.pos]}的${noun(eye!.target!)}`
      : eye && (eye.dir === 'left' || eye.dir === 'right')
        ? `视线落在镜头${eye.dir === 'left' ? '左' : '右'}侧（对面的人所在方向）`
        : '视线看向前方'
    const hands = st.hands && st.hands !== '空手' ? `手里拿着${st.hands}` : ''
    const change = en && en.pose !== st.pose ? `，本镜结束时${POSE_WORD[en.pose] || en.pose}` : ''
    const pw = st.at && /[坐躺跪靠]/.test(st.pose) ? `${st.pose}在${st.at}${/^(?:地上|地板|台阶|窗台)$/.test(st.at) ? '' : '上'}` : POSE_WORD[st.pose] || st.pose
    return [`${refOf(id, st)}${pw}`, where, n >= 2 ? FACING_WORD[st.facing] : '', gaze, hands].filter(Boolean).join('，') + change
  })
  const anchors = blocking ? [blocking.window ? `窗户在${ANCHOR_WORD(blocking.window)}` : '', blocking.door ? `门在${ANCHOR_WORD(blocking.door)}` : ''].filter(Boolean) : []
  const moving = TOWARD_ANCHOR.test(`${s.visual || ''} ${s.action || ''}`)
  const lock = n >= 2 ? '两人左右位置全程不变，不交换位置' : `${refOf(on[0], s.startState![on[0]])}全程停在原位${n === 1 && !(blocking && blocking.characters.length >= 2) ? '、留在画面中间' : ''}`
  const anchorLock = anchors.length && !moving ? `，不走向${[blocking!.window ? '窗边' : '', blocking!.door ? '门口' : ''].filter(Boolean).join('或')}` : ''
  return `站位：${parts.filter(Boolean).join('；')}${anchors.length ? `；本场${anchors.join('、')}` : ''}；${lock}${anchorLock}，镜头运动时人物不离开原位。`
}

const CAMERA_ANCHOR = /[，,]\s*(?:带出|摇向|移向|转向|摇到|甩向|移到|摇至|甩至)[^，。,]*?(?:窗|门)[^，。,]*/g

export function applyStateContinuity(exp: Exp, opts: { stateGate?: StateGate } = {}): { exp: Exp; report: ContinuityReport; failed: StateJump[] } {
  const gate = opts.stateGate ?? 'fix'
  const shots: S[] = exp.shots.map((s) => ({ ...s }) as S)
  const rep: ContinuityReport = { stateGate: gate, carriesChecked: 0, stateJumps: [], stateFixed: 0, holdTailShots: [], cameraAnchorTrims: [], voiceModes: { onscreen: 0, inner: 0, offscreen: 0 }, innerFramingChanges: [] }
  const byId = new Map(shots.map((s) => [s.id, s] as const))
  const carriedFrom = new Set<string>()
  shots.forEach((s, i) => {
    if (s.render === false) return
    const src = carrySourceId(shots, i)
    if (!src) return
    const from = byId.get(src)
    if (!from || from.render === false) return
    carriedFrom.add(src)
    if (!s.startState || !from.endState) return
    rep.carriesChecked++
    for (const id of Object.keys(s.startState)) {
      const a: CharState | undefined = from.endState[id]
      const b: CharState = s.startState[id]
      if (!a) continue
      const diff = sameState(a, b)
      if (!diff.length) continue
      rep.stateJumps.push({ shotId: s.id, from: src, characterId: id, fields: diff, detail: diff.map((k) => `${k} ${a[k]}→${b[k]}`).join('，') })
      if (gate === 'fix') {
        // the shot starts where the source ended; its own end state (text evidence) stays — the change happens in the shot
        s.startState = { ...s.startState, [id]: { ...a } }
        if (s.endState?.[id]) s.endState = { ...s.endState, [id]: { ...s.endState[id], pos: a.pos, facing: a.facing } }
        rep.stateFixed++
        s.stateFixedFrom = src
      }
    }
  })
  const chars = exp.characters
  const out = shots.map((s) => {
    // ---- voice modes
    const on = onscreenIds(s)
    const gen = normVoiceMode(s.voiceMode)
    let lines = (s.dialogueLines || []).map((l: any) => {
      const mode: VoiceMode = gen === 'inner' && l.speaker && on.includes(l.speaker)
        ? 'inner'
        : INNER_MARK.test(l.text || '')
          ? 'inner'
          : l.voiceOnly || !l.speaker || !on.includes(l.speaker) || gen === 'offscreen'
            ? 'offscreen'
            : 'onscreen'
      rep.voiceModes[mode]++
      return { ...l, voiceMode: mode, ...(mode === 'inner' ? { voiceOnly: true } : {}) }
    })
    const castDialogue = (s.castDialogue || []).map((d: any, k: number) => {
      const mode: VoiceMode = lines[k]?.voiceMode || (d.onScreen ? 'onscreen' : 'offscreen')
      return { ...d, voiceMode: mode, ...(mode !== 'onscreen' ? { listenerMouth: 'closed', speakerMouth: 'closed' } : {}) }
    })
    let prompt: string = s.prompt
    let beatSegments = s.beatSegments ? s.beatSegments.map((x: any) => ({ ...x })) : s.beatSegments
    let framing = s.framing
    const inner = lines.filter((l: any) => l.voiceMode === 'inner')
    if (inner.length) {
      for (const l of inner) {
        for (const seg of beatSegments || []) if (seg.dialogue && seg.start < l.endSec - 1e-6 && seg.end > l.startSec + 1e-6) seg.lipSync = false
      }
      prompt = prompt.split('\n').map((ln) => (/^\d/.test(ln) ? ln.replace(/(?:[^，；。]*?)正脸朝镜头开口说一句短话，嘴部清晰可见、无遮挡/, INNER_CUE).replace(OFFSCREEN_CUE, INNER_CUE) : ln)).join('\n')
      const f2 = framingOf({ ...s, dialogueLines: lines } as never, chars as never)
      if (f2 !== framing) (rep.innerFramingChanges.push(`${s.id}: ${framing} → ${f2}`), (framing = f2))
    }
    // ---- prompt: 站位 first, scene lighting, camera anchors, hold tail
    const blocking = exp.sceneBlocking?.[s.blockingScene ?? ""]
    const light = exp.sceneLighting?.[s.blockingScene ?? ""]
    let L = prompt.split('\n').filter((l) => !/^站位[：:]/.test(l) && !/^结尾[：:]/.test(l))
    const stance = stanceLine(s, blocking, chars)
    if (stance) {
      const at = L.findIndex((l) => /^主体[：:]/.test(l))
      L.splice(at >= 0 ? at + 1 : Math.min(1, L.length), 0, stance)
    }
    if (light) {
      const li = L.findIndex((l) => /^光线[：:]/.test(l))
      const line = `光线：${light.text}。`
      if (li >= 0) L[li] = line
      else {
        const fi = L.findIndex((l) => /^风格[：:]/.test(l))
        L.splice(fi >= 0 ? fi : L.length, 0, line)
      }
    }
    if (on.length) {
      const ci = L.findIndex((l) => /^镜头[：:]/.test(l))
      if (ci >= 0) {
        const before = L[ci]
        L[ci] = before.replace(CAMERA_ANCHOR, (m) => (rep.cameraAnchorTrims.push({ shotId: s.id, removed: m.replace(/^[，,]\s*/, '') }), ''))
      }
    }
    if (carriedFrom.has(s.id) && s.render !== false) {
      const beatIdx = L.map((l, k) => (/^\d+(?:\.\d+)?–\d+(?:\.\d+)?秒，/.test(l) ? k : -1)).filter((k) => k >= 0)
      const lastK = beatIdx[beatIdx.length - 1]
      const total = Number(s.durationSec) || 0
      if (lastK != null && !L[lastK].includes(STATE_STAY)) {
        const m = L[lastK].match(/^(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)秒，(.*)$/)!
        const a = Number(m[1])
        const b = Number(m[2])
        const lastSeg = beatSegments?.find((x: any) => Math.abs(x.end - b) < 1e-6)
        if (b - a >= 2 - 1e-6 && !(lastSeg && lastSeg.dialogue)) {
          const cut = Math.round((b - 1) * 10) / 10
          L.splice(lastK, 1, `${m[1]}–${cut}秒，${m[3]}`, `${cut}–${m[2]}秒，${STATE_STAY}：${HOLD_TAIL_BODY}。`)
          if (lastSeg) {
            const idx = beatSegments!.indexOf(lastSeg)
            beatSegments!.splice(idx, 1, { ...lastSeg, end: cut }, { start: cut, end: b, speed: '恢复常速', dialogue: false, lipSync: false, hold: true })
          }
        } else L[lastK] = `${L[lastK].replace(/[。\s]*$/, '')}；最后约1秒${HOLD_TAIL_BODY}。`
      }
      const fixedCam = /固定/.test(s.camera || '')
      const ti = L.findIndex((l) => /^镜头[：:]/.test(l))
      const tail = `结尾：最后约1秒只保持站位和姿态，不加新动作${fixedCam ? '，结尾构图与开头一致' : ''}，便于下一镜衔接。`
      L.splice(ti >= 0 ? ti : L.length, 0, tail)
      rep.holdTailShots.push(s.id)
      void total
    }
    return { ...s, prompt: L.join('\n'), dialogueLines: lines, castDialogue, ...(beatSegments ? { beatSegments } : {}), framing }
  })
  const failed = gate === 'fail' ? rep.stateJumps : []
  return { exp: { ...exp, shots: out as VideoPipelineShot[] }, report: rep, failed }
}
