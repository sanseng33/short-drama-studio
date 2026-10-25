/**
 * Opt-in "speed beat" prompt mode for video-pipeline@1 shots (beatMode: 'speed').
 *
 * Rewrites each shot's visual `prompt` into a per-second, speed-tagged timeline:
 *   竖屏9:16，N秒单镜。<time/place>，单人。主体：<appearance/wardrobe only, no names>。
 *   时间轴（按秒变速）：
 *   a–b秒【快】：…猛地…，动作利落不拖。
 *   b–c秒【慢】：动作放慢，…；正脸朝镜头开口说一句短话，嘴部清晰可见、无遮挡。
 *   c–N秒【恢复常速】：…
 *   镜头：…，不切镜。 光线：… 风格：…自然哑光肤质，有毛孔细节，不打蜡不磨皮，真实运动速度，非慢动作… 限制：…
 *
 * Rules (inject_character_meta=false): no character names, no background/bio, never dialogue text.
 * The segment carrying on-screen speech is always 【慢】 with an unobstructed, camera-facing mouth (LatentSync).
 * Small hand props that compete with face/hands (转鸡蛋…) are dropped and listed in `beatRemovedProps`.
 * Pure; default export behaviour is untouched unless beatMode === 'speed'.
 */
import { PERSON_DESCRIPTOR, stripRenderLines, UNCLEAR_PRONOUN_NOTE } from './shotAnnotate'
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { CARRY_WARDROBE_CONSTRAINT } from './sceneContinuity'
import { actionCap, actionWeight, clauseCap, countActions, expandCompounds, isVisibleAction, limitActions, visibleCap } from './actionDensity'
import { emotionWords, splitVoice, stripVoiceAdverbs, visibleForEmotion } from './emotionVisual'
/** beatTrimmedActions prefix of the performance rule (emotion → visible acting / skipped) */
export const PERFORMANCE_NOTE = '表演规则：'
import { clearMouthClause, MOUTH_BLOCK_RE } from './mouthOcclusion'
import { DEFAULT_DIALOGUE_PAD, dialogueNeedSec, dialogueSegmentNeeds, SHOT_TARGET_SEC, type DialoguePad, type SpeechRate } from './dialogueTiming'

export type BeatMode = 'off' | 'speed'
export type BeatSpeed = '快' | '慢' | '恢复常速'

export interface BeatSegmentMeta {
  start: number
  end: number
  speed: BeatSpeed
  /** segment carries a dialogue line (on-screen speech or off-screen voice) */
  dialogue: boolean
  /** on-screen speech: mouth must be visible for lip-sync */
  lipSync: boolean
}

export interface BeatPromptResult {
  prompt: string
  segments: BeatSegmentMeta[]
  /** clauses dropped because a small hand prop competes with face/hands */
  removedProps: string[]
  /** human review notes (beat split looked questionable) */
  todo: string[]
  /** main actions dropped by the action-density cap (`0–2秒【快】：clause`) */
  trimmedActions: string[]
  /** voice / delivery descriptions removed from the visual prompt (TTS delivery hint for the line) */
  delivery: string[]
}

export interface BeatModeOptions {
  /** project art style (真人都市 adds the full skin-texture realism line) */
  style?: string
  /** keep the pre-beat prompt in `promptDefault` (default true) */
  keepDefaultPrompt?: boolean
  /** explicit per-shot beats (shot id → segments) that replace the automatic beat split; validated */
  beatOverrides?: BeatOverrides
  /** speech estimator (dialogueTiming) sizing the 【慢】 dialogue segment */
  speechRate?: Partial<SpeechRate>
  /** silence before / after the line inside the dialogue segment (default 0.3 / 0.4 s) */
  dialoguePad?: Partial<DialoguePad>
  /** lengthen a shot whose dialogue segment cannot hold the line (default true), up to maxShotSec (default 9) */
  fitDialogue?: boolean
  maxShotSec?: number
}

/** One hand-written beat: `text` is the visual action only (no names, no dialogue text, one subject). */
export interface BeatOverrideSegment {
  start: number
  end: number
  speed: BeatSpeed
  text: string
  /** this segment carries the shot's dialogue (exactly one when the shot has dialogue; must be 【慢】) */
  dialogue?: boolean
}
export type BeatOverrides = Record<string, BeatOverrideSegment[]>

type Char = VideoPipelineExport['characters'][number]

export const BEAT_HEADER = '时间轴（按秒变速）'
export const BEAT_REALISM = '自然哑光肤质，有毛孔细节，不打蜡不磨皮，真实运动速度，非慢动作'
export const BEAT_LIMIT = '无任何文字、字幕、汉字、字母、数字、Logo；服装无标志、校徽、刺绣字样'
/** a head move whose purpose is a look (抬头看向 / 回头看了一眼): for picking a segment's main action it weighs as gaze */
const LOOK_MOVE = /(抬头|抬起头|回头|回过头|扭头|转头|侧头|仰头)[^，]{0,3}(看|望|瞥|盯)/
export const BEAT_MOUTH_LINE = '正脸朝镜头开口说一句短话'
export const BEAT_MOUTH_CLEAR = '嘴部清晰可见、无遮挡'
export const BEAT_MOUTH_CUE = `${BEAT_MOUTH_LINE}，${BEAT_MOUTH_CLEAR}`
/** limit added to solo children of a split cross-cut segment */
export const SOLO_SPLIT_LIMIT = '画面只出现一个人物，对面窗里的人不入画'
export const BEAT_FAST_TAIL = '动作利落不拖'

/** natural-language pacing for a timeline segment (no bracket tags — H3 paints 【…】 labels as subtitles) */
export function pacePhrase(speed: BeatSpeed, index: number, prev?: BeatSpeed): string {
  if (speed === '快') return index === 0 ? '动作利落快速' : '接着加快，动作利落快速'
  if (speed === '慢') return index === 0 ? '节奏放慢' : '接着放慢'
  return index === 0 ? '正常节奏' : prev === '恢复常速' ? '保持正常节奏' : '随后恢复正常节奏'
}
/** a timeline segment line: `a–b秒，<pace>：<body>。` (the pace replaces 动作放慢 / 动作利落不拖 in the body) */
export function segmentLine(start: number, end: number, speed: BeatSpeed, index: number, body: string, prev?: BeatSpeed): string {
  const b = body
    .replace(/^动作放慢[，,]?/, '')
    .replace(new RegExp(`[，,]?${BEAT_FAST_TAIL}`, 'g'), '')
    .replace(/[，；。\s]+$/, '')
    // a body whose actions were all dropped keeps only its speech cue
    .replace(/^[，；\s]+/, '')
  return `${fmt(start)}–${fmt(end)}秒，${pacePhrase(speed, index, prev)}：${b || '保持姿态，呼吸与眼神有细微变化'}。`
}
/** matches a timeline segment line of a beat prompt */
export const BEAT_LINE_RE = /^\d+(?:\.\d+)?–\d+(?:\.\d+)?秒，/
/** explicit garment state for zip jackets (render test: an unspecified zip drifts open / closed between shots) */
export const ZIP_OPEN = '前襟拉链拉开'
/** framing for on-screen dialogue in a 近景 shot */
export const CLOSE_DIALOGUE_FRAMING = '近景（胸口以上）'

/** Add the explicit zip state after the first zip jacket in a wardrobe / subject text (once). */
export function withZipState(text: string): string {
  if (!text || /拉链(?:已|全|半)?(?:拉开|拉上|拉到|敞开|拉好)/.test(text)) return text
  return text.replace(/(拉链(?:短|长|运动|连帽)?(?:夹克|外套|卫衣|开衫|上衣))(.?)/, (_m, g: string, nx: string) =>
    !nx || /[（(。；;]/.test(nx) ? `${g}，${ZIP_OPEN}${nx}` : `${g}（${ZIP_OPEN}）${nx}`,
  )
}

/** On-screen dialogue + 近景 / 中近景 → 近景（胸口以上） (the first shot-size word of the camera line decides; else `size`). */
export function dialogueFraming(camLine: string, size: string | undefined): string {
  const m = camLine.match(/大全景|中全景|全景|中近景|近景特写|近景|中景|特写/)
  if (m) return m[0] === '近景' || m[0] === '中近景' ? camLine.slice(0, m.index) + CLOSE_DIALOGUE_FRAMING + camLine.slice(m.index! + m[0].length) : camLine
  return /^(?:中)?近景$/.test((size || '').trim()) ? `${CLOSE_DIALOGUE_FRAMING}，${camLine}` : camLine
}
/** two characters in facing windows / cross-cut inside one segment (split candidates) */
export const CROSSCUT_RE = /两窗|对窗|越窗|隔窄巷|对切/

// ---------------- small helpers ----------------

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 100) / 100))
const snap = (x: number) => Math.round(x * 2) / 2
const paced = (t: string) => (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function bigrams(t: string): Set<string> {
  const a = Array.from((t || '').replace(/[\s，。；：、,.;:!?！？「」『』“”（）()]/g, ''))
  const out = new Set<string>()
  for (let i = 0; i + 1 < a.length; i++) out.add(a[i] + a[i + 1])
  return out
}
function sim(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const x of A) if (B.has(x)) n++
  return n / Math.min(A.size, B.size)
}

/** Labelled sentence content (主体/光线/限制…) from a prompt. */
export function clause(prompt: string, label: RegExp): string {
  const m = (prompt || '').match(new RegExp(`(?:^|[。\\n；;])\\s*(?:${label.source})\\s*[：:]([^。\\n]*)`))
  return m ? m[1].trim() : ''
}

/** Split text into clauses (，；。 and 随后/然后/接着/再 boundaries). */
export function splitClauses(text: string): string[] {
  return (text || '')
    .split(/[，,；;。\n]|(?:随后|然后|接着|紧接着)/)
    .map((x) => x.trim().replace(/^(?:随后|然后|接着|再|并)\s*/, ''))
    .filter((x) => paced(x) > 0)
}

/** clause core without filler adverbs/particles (还/又/也/仍/都/就/再/了/着), for near-duplicate checks */
const fillerless = (t: string) => t.replace(/[还又也仍都就再了着]/g, '')

/** held-still states on the same body part (肩膀纹丝不动 / 肩膀没动) say the same thing */
const STILL = /(纹丝不动|一动不动|没动|不动)/
/** Are two clauses the same beat (exact, contained, bigram-similar, or the same held-still body part)? */
/** short clauses made of the same content characters in another order (眯起眼 / 眼睛眯起) are one beat */
function sameShortBeat(x: string, y: string): boolean {
  const chars = (s: string) => [...s.replace(/^(?:他|她|它)/, '').replace(/[的了着地得一下\s，,。]/g, '')]
  const a = chars(x)
  const b = chars(y)
  const [lo, hi] = a.length <= b.length ? [a, b] : [b, a]
  if (lo.length < 3 || hi.length > 6) return false
  const hs = new Set(hi)
  return lo.every((c) => hs.has(c))
}

/**
 * Same beat said twice in different words (说完嘴角没忍住翘起来 / 说完嘴角压不住地翘): content characters (pronoun,
 * particles and filler adverbs removed) overlap ≥ 75 % of the shorter clause, ≥ 5 shared characters, and both clauses
 * open with the same two characters (guards 抬起头看向窗外 / 低下头看向窗外 and other same-frame, different-verb pairs).
 */
/** person references (穿夹克的少年, resolved-pronoun markers) are who, not what: they never make two clauses alike */
const unperson = (s: string) => s.replace(/穿[^，。；、\s]{1,8}?的(?:少年|少女|男生|女生|男人|女人|男孩|女孩|青年|学生|同学|人)/g, '').replace(/[\ue100-\ue1ff]/g, '').trim()
export const CHAR_OVERLAP_MIN = 0.75
export function charOverlapDup(x: string, y: string): boolean {
  const core = (s: string) => unperson(s).replace(/^(?:他|她|它)/, '').replace(/一下|[的了着地得还又也仍都就再\s，,。；;、]/g, '')
  const a = core(x)
  const b = core(y)
  if (a.length < 5 || b.length < 5 || a.slice(0, 2) !== b.slice(0, 2)) return false
  const A = new Set(a)
  const B = new Set(b)
  let n = 0
  for (const c of A) if (B.has(c)) n++
  return n >= 5 && n / Math.min(A.size, B.size) >= CHAR_OVERLAP_MIN
}

/**
 * Shared-run repeat: two clauses of one segment that repeat the same 4+ char action under a different lead-in
 * (开口前肩膀先往前一顶 / 他喊话时肩膀往前一顶, 喊完偏头避开对面视线 / 说完偏头避开视线).
 * Lead-ins (开口前 / 说完 / …时 / …后), trailing time words (的同一刻 / 瞬间) and 眼神|视线|目光 are normalised first.
 * Guards against "same object, different action": the text before the shared run must be empty or contained in the
 * other's (抬起头看向窗外 / 低下头看向窗外 stays), and the run must end a clause or the tails must contain one another
 * (转身走向门口 / 转身走向窗边 stays, 手指在桌面敲了两下 / 手指在桌面上划了一下 stays).
 */
export const SHARED_RUN_MIN = 4
export const SHORT_RUN_RATIO = 0.75
export function sharedRunDup(x: string, y: string): boolean {
  const norm = (s: string) =>
    unperson(s)
      .replace(/^(?:他|她|它)/, '')
      .replace(/^(?:开口前|出手前|说完|喊完|话音落下?|随后|然后|接着|[^，]{1,3}[时后](?=.{4}))/, '')
      .replace(/眼神|视线|目光/g, '眼')
      // near-synonyms: 抖/颤, 悬/悬停, hand parts; degree adverb 微微; 时 inside a clause (收回来时还在抖)
      .replace(/发颤|发抖|颤抖|颤/g, '抖')
      .replace(/悬停|悬着/g, '悬')
      .replace(/指尖|手指|指节/g, '手')
      .replace(/微微/g, '')
      .replace(/一下|[的了着地得还又也仍都就再先\s，,。；;、]/g, '')
      .replace(/(?:同一刻|那一刻|一刻|瞬间|时候)$/, '')
      .replace(/时/g, '')
  const a = norm(x)
  const b = norm(y)
  // longest common run
  let best = 0
  let ia = 0
  let ib = 0
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      let k = 0
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++
      if (k > best) [best, ia, ib] = [k, i, j]
    }
  // a 3-char run counts only when it is nearly the whole shorter clause (手先悬停半拍 inside 手停在半空悬了半拍…)
  const ratio = best / Math.min(a.length, b.length)
  if (best < SHARED_RUN_MIN - 1 || ratio < 0.4 || (best < SHARED_RUN_MIN && ratio < SHORT_RUN_RATIO)) return false
  const [pa, pb] = [a.slice(0, ia), b.slice(0, ib)]
  const [ta, tb] = [a.slice(ia + best), b.slice(ib + best)]
  const within = (u: string, v: string) => !u || !v || u.includes(v) || v.includes(u)
  // a shared run that is only a place phrase (在鸭子上 / 向窗外) is not a shared action unless the lead-in is the same
  if (/^[在向往朝到从于对]/.test(a.slice(ia)) && pa !== pb) return false
  return within(pa, pb) && (!ta || !tb || within(ta, tb))
}

export function isNearDup(x: string, y: string): boolean {
  x = x.trim()
  y = y.trim()
  if (!x || !y) return false
  if (y === x) return true
  if (STILL.test(x) && STILL.test(y) && x.slice(0, 2) === y.slice(0, 2)) return true
  if (sameShortBeat(x, y)) return true
  if (charOverlapDup(x, y)) return true
  if (sharedRunDup(x, y)) return true
  if (paced(x) < 4) return false
  const cx = fillerless(x)
  const cy = fillerless(y)
  return y.includes(x) || sim(x, y) >= 0.75 || (Math.min(paced(cx), paced(cy)) >= 4 && (cy.includes(cx) || cx.includes(cy)))
}

/**
 * 、 between actions (先屏住呼吸、说话时声音压得很轻) splits into clauses; 、 inside a noun list
 * (靠窗帘、纸张、水面的细微动态…) stays — an item of ≤3 chars on either side marks a list.
 */
export function listToClauses(s: string): string {
  return s.replace(/([^，,。；;、：:]*)、(?=([^，,。；;、：:]*))/g, (m, prev: string, next: string) =>
    paced(prev) <= 3 || paced(next) <= 3 ? `${prev}、` : `${prev}，`,
  )
}

/** Drop repeated / near-duplicate clauses (merged beats repeat 表演 notes). */
export function dedupeClauses(cs: string[]): string[] {
  const out: string[] = []
  for (const c of cs) {
    const x = c.trim()
    if (!x) continue
    const cx = fillerless(x)
    const dup = out.findIndex((y) => isNearDup(x, y))
    if (dup >= 0) {
      // keep the more informative wording (e.g. 手还搭在窗框上 + 手搭在窗框上没放下 → the latter)
      if (paced(x) > paced(out[dup]) && (x.includes(out[dup]) || cx.includes(fillerless(out[dup])))) out[dup] = x
      continue
    }
    out.push(x)
  }
  return out
}

/** Split on separators outside （）/() only. */
export function splitTop(text: string, seps: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text || '') {
    if (ch === '（' || ch === '(') depth++
    else if ((ch === '）' || ch === ')') && depth > 0) depth--
    if (!depth && seps.includes(ch)) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

// ---------------- speed heuristics ----------------

/** Speech beat markers produced by mergedPrompt / storyboards. */
const SPEECH_RE = /(开口说台词|开口|说道|说完?|喊|问道?|回答|嘀咕|低声道|念叨|吼|台词|说话)/
export const MARK_RE = /[（(]([^（）()]{0,16}?)开口说台词[）)]|[（(]画外人声[）)]/g
const STRONG_FAST = /(猛|冲|跑|扑|扔|砸|甩|跳|撞|一把|拽|踢|摔|窜|急|飞快|迅速|快步|扭头|转身|弹起|站起|跃|抢|躲|闪身|夺|拍桌|捶|蹬|掀|拉上|拉开|推开|踹|抓起|抄起)/
const WEAK_FAST = /(抬手|指向|指了指|点了点|点一下|缩回|转回|回头|起身|伸手|抓住|拍了|推了|拉了|丢|抛|挥|按住|戳|掏出)/
/** verbs 猛地/迅速 may be put in front of (whole words only — never inside 冲击 / 一点点) */
const INSERT_BEFORE = /(扭头|转身|冲向|冲进|冲出|冲过去|扑向|扑过去|扔出?|砸向|甩开?|拽|抓起|抄起|站起|弹起|拉上|拉开|推开|掀开?|踹|踢|抬手|回头|伸手|缩回)/
/** hesitation beats contradict 动作利落不拖 */
const HESITATE = /(停一下|顿住|顿了|迟疑|犹豫|不确定|慢慢|缓缓)/
const SPEED_ADVERB = /(猛地|迅速|飞快|一把|干脆|利落|急忙|赶紧|立刻|骤然|倏地)/
/** clause that would block the mouth during lip-sync */
const MOUTH_BLOCK = MOUTH_BLOCK_RE
/** small hand props that compete with face/hands */
export const SMALL_PROP_RE = /(生鸡蛋|鸡蛋|硬币|打火机|钥匙|棒棒糖|糖果|橡皮|骰子|扑克牌|纸牌|筷子|勺子|香烟|烟头|瓶盖|魔方|指尖陀螺|圆珠笔|铅笔|钢笔|签字笔|(?<![记])笔(?![直记挺画触])|戒指|发圈|皮筋|回形针|U盘|小石子)/
/** clause about people other than the one on-screen character (generic extras / crowd vocabulary) */
const OTHER_PERSON = new RegExp(
  '^(?:(?:前排|后排|身后|周围|旁边|远处|两侧|门口|对面|人群里|走廊里)的?)?(?:(?:一|两|三|几|好几|十几)(?:个|名|位)?)?(?:学生|同学|路人|老师|众人|旁人|别人|有人|人群|大家|观众|围观者|群众)' +
    '|^(?:一|两|几|好几|十几)双手|集体|全班',
)

/** an event hitting the subject's space (石子打在玻璃上) — a 【快】 cue even without a body move */
const IMPACT = /(击中|打中|砸中|打在|砸在|撞在|弹进|弹到|飞进|啪地|砰地)/
/** micro performance: face / gaze / breath / posture nuance */
const MICRO_RE = /(眉|眼|视线|目光|嘴角|嘴唇|唇|鼻|喉结|下巴|下颌|呼吸|口气|叹|愣|笑|皱|眯|眨|抿|咬|肩|神情|表情)/
/** clauses that happen after the line was spoken */
const POST_SPEECH = /^(?:他|她)?(说完|喊完|念完|问完|答完|讲完)/
/** clauses that lead into the line (the mouth starts moving) */
const PRE_SPEECH = /(开口前|开口之前|喊之前|说之前|才出声|再出声|才开口|再开口|出声前|才说话|再说话)/
/** shots at least this long must carry a performance beat in every segment */
export const LONG_SHOT_SEC = 6
const HANDLING_RE = /(指间|指尖|手里|手中|掌心|把玩|转了|转着|转动|捏|拨弄|抛|夹着|攥|搓|晃了?晃|在手上|颠了颠|翻来覆去)/

export function isActionHeavy(text: string): boolean {
  // negated motion (不闪躲 / 没躲 / 不动) is not action
  const t = (text || '').replace(/[不没未别](?:闪躲|躲闪|躲|闪|动|跑|冲)/g, '')
  if (STRONG_FAST.test(t)) return true
  const weak = t.match(new RegExp(WEAK_FAST.source, 'g')) || []
  return weak.length >= 2
}

/** Is a clause a small-prop fiddle (转鸡蛋 / 指间转笔 …)? Returns the prop when so. */
export function smallPropIn(cl: string): string | null {
  const m = (cl || '').match(SMALL_PROP_RE)
  if (!m) return null
  return HANDLING_RE.test(cl) ? m[0] : null
}

/** Add 猛地 before the first strong verb (when no speed adverb) and close with 动作利落不拖. */
export function fastify(text: string): string {
  let t = (text || '').replace(/[，。；\s]+$/, '')
  if (!SPEED_ADVERB.test(t)) {
    const m = t.match(INSERT_BEFORE)
    if (m && m.index != null && !/[猛一]$/.test(t.slice(0, m.index))) t = `${t.slice(0, m.index)}猛地${t.slice(m.index)}`
  }
  t = t.replace(/(?:再)?转回来/, '迅速转回正面')
  if (!t.includes(BEAT_FAST_TAIL)) t = `${t}，${BEAT_FAST_TAIL}`
  return t
}

// ---------------- names ----------------

function isFemale(c: Char | undefined): boolean {
  return Boolean(c && /(女|她|少女|姑娘|女孩|女生)/.test(`${c.visualLock || ''} ${c.role || ''} ${(c.tags || []).join(' ')}`))
}
function ageNum(c: Char | undefined): number | null {
  const n = Number(String(c?.age ?? '').match(/\d+/)?.[0])
  return Number.isFinite(n) && n > 0 ? n : null
}
function nounFor(c: Char | undefined): string {
  const f = isFemale(c)
  const a = ageNum(c)
  if (a != null && a <= 19) return f ? '少女' : '少年'
  if (a != null && a < 30) return f ? '年轻女人' : '年轻男人'
  return f ? '女人' : '男人'
}
const GARMENT = /(夹克|卫衣|校服|衬衫|西装|T恤|外套|连衣裙|毛衣|风衣|大衣|睡衣|背心|制服|围裙|运动服|裙)/

/** All spellings a character / bit-part name may take in prompt text (longest first). */
export function nameVariants(chars: Char[], extra: string[] = []): { text: string; id: string | null; ids: string[] }[] {
  const out: { text: string; id: string | null; ids: string[] }[] = []
  const add = (t: string | undefined, id: string | null) => {
    const x = (t || '').trim()
    if (!x) return
    const o = out.find((v) => v.text === x)
    if (!o) out.push({ text: x, id, ids: id ? [id] : [] })
    else if (id && !o.ids.includes(id)) o.ids.push(id)
  }
  for (const c of chars) {
    add(c.name, c.id)
    add(c.name.replace(/（/g, '(').replace(/）/g, ')'), c.id)
    add(c.name.replace(/[（(][^）)]*[）)]/g, ''), c.id)
    add(c.baseName, c.id)
  }
  for (const e of extra) add(e, null)
  return out.filter((o) => paced(o.text) >= 1).sort((a, b) => b.text.length - a.text.length)
}

/** private-use marker chars for resolved pronouns (one per cast index; not counted by paced) */
const PRON_MARK0 = 0xe100
/** 他/她 as a person pronoun (not 其他 / 他们 / 他人 / 他乡 …) */
const BARE_PRONOUN = /(?<![其吉利])[他她](?![们人乡处日])/
const BARE_PRONOUN_ONLY = /^[他她]$/
/** text before a pronoun that puts it in subject position (clause start or after a short lead-in) */
const SUBJECT_SLOT = /(?:^|[，,。；;：:、]|^\s*)(?:(?:随后|然后|接着|同时|这时|此时|最后|说完|喊完|开口前|话音落下?|[^，。；]{0,4}[时后]|又|也|才|便|就)\s*)?$/

const DESC_BEFORE = /(少年|少女|男生|女生|男人|女人|男孩|女孩|青年|学生|同学|人)\s*$/

/**
 * Replace names with a pronoun (single cast) / a wardrobe descriptor (multi cast).
 * When a name directly follows a descriptor noun (「17岁东亚少年甲」) it is simply removed.
 */
export function stripNames(
  text: string,
  variants: { text: string; id: string | null; ids?: string[] }[],
  refOf: (id: string | null, ids?: string[]) => string,
): string {
  let t = text || ''
  if (!variants.length) return t
  const re = new RegExp(variants.map((v) => esc(v.text)).join('|'), 'g')
  let last = ''
  let lastEnd = 0
  t = t.replace(re, (m, off: number, all: string) => {
    const v = variants.find((x) => x.text === m)!
    // optional variant parenthetical right after the bare name (甲（之后）)
    if (DESC_BEFORE.test(all.slice(Math.max(0, off - 4), off))) return ''
    const r = refOf(v.id, v.ids)
    // a repeated descriptor shortens to 他 only inside one clause; across clauses it is repeated, so a dropped
    // clause can never leave an orphan pronoun and an object mention in between cannot capture it
    const sameClause = !/[，,。；;]/.test(all.slice(lastEnd, off))
    const out = r === last && r.length > 1 ? (r.startsWith('穿') ? (sameClause ? '他' : r) : r) : r
    last = r
    lastEnd = off + m.length
    return out
  })
  // leftover variant notes 「（之后）」 etc.
  t = t.replace(/[（(](?:[^（）()]{0,6}前|[^（）()]{0,6}后)[）)]/g, '')
  return t.replace(/他的?他/g, '他').replace(/她的?她/g, '她')
}

// ---------------- timeline source ----------------

interface RawBeat {
  text: string
  start: number
  end: number
  /** on-screen speech in this beat */
  speech: boolean
  /** off-screen voice heard in this beat */
  voice: boolean
  /** speaker display names from （X开口说台词） markers */
  speakers: string[]
}

/** Parse a mergedPrompt `时间轴（一镜N秒，小节拍）：0–2s…；2–4.5s随后…` clause. */
export function parseMergedTimeline(prompt: string): RawBeat[] | null {
  const m = (prompt || '').match(/时间轴（[^）]*）[：:]([\s\S]*?)。(?=镜头[：:]|环境陈设[：:]|环境[：:]|光线[：:]|风格[：:]|限制[：:]|$)/)
  if (!m) return null
  const parts = m[1].split(/[；;](?=\s*\d+(?:\.\d+)?\s*[–\-~～]\s*\d+(?:\.\d+)?\s*s)/)
  const beats: RawBeat[] = []
  for (const p of parts) {
    const b = p.trim().match(/^(\d+(?:\.\d+)?)\s*[–\-~～]\s*(\d+(?:\.\d+)?)\s*s\s*(?:随后)?([\s\S]*)$/)
    if (!b) return null
    const raw = b[3]
    const speakers: string[] = []
    let speech = false
    let voice = false
    for (const mm of raw.matchAll(MARK_RE)) {
      if (/画外人声/.test(mm[0])) voice = true
      else {
        speech = true
        if (mm[1]) speakers.push(mm[1])
      }
    }
    beats.push({ text: raw, start: Number(b[1]), end: Number(b[2]), speech, voice, speakers })
  }
  return beats.length ? beats : null
}

// ---------------- partition ----------------

interface Group {
  beats: RawBeat[]
  start: number
  end: number
}

/** Best contiguous partition of beats into k∈{2,3} groups (one dialogue group, balanced durations). */
export function partitionBeats(beats: RawBeat[], total: number): Group[] {
  const n = beats.length
  const ks = [2, 3].filter((k) => k <= n && (k < 3 || total >= 4.5))
  if (!ks.length) return [{ beats, start: 0, end: total }]
  let best: { cost: number; cuts: number[] } | null = null
  const dlg = (g: RawBeat[]) => g.some((b) => b.speech || b.voice)
  const anyDlg = beats.some((b) => b.speech || b.voice)
  const tryCuts = (cuts: number[]) => {
    const k = cuts.length + 1
    const idx = [0, ...cuts, n]
    const groups = idx.slice(0, -1).map((a, i) => beats.slice(a, idx[i + 1]))
    const durs = groups.map((g) => g[g.length - 1].end - g[0].start)
    const nd = groups.filter(dlg).length
    let cost = 0
    if (anyDlg) cost += 10 * Math.max(0, nd - 1)
    if (nd === k && k > 1) cost += 20
    for (const d of durs) {
      cost += Math.abs(d - total / k) * 0.5
      if (d < 1 - 1e-9) cost += 8
    }
    if (k === 3) cost -= 1.2
    if (!best || cost < best.cost - 1e-9) best = { cost, cuts }
  }
  for (const k of ks) {
    if (k === 2) for (let a = 1; a < n; a++) tryCuts([a])
    else for (let a = 1; a < n; a++) for (let b = a + 1; b < n; b++) tryCuts([a, b])
  }
  const cuts = best!.cuts
  const idx = [0, ...cuts, n]
  return idx.slice(0, -1).map((a, i) => {
    const g = beats.slice(a, idx[i + 1])
    return { beats: g, start: g[0].start, end: g[g.length - 1].end }
  })
}

/** seconds of slack on top of line length / 4.5 for the 【慢】 dialogue segment */
export const DIALOGUE_PAD_SEC = 0.5

/** Single-beat source (unmerged shot): clauses → pseudo-beats with proportional (unsnapped) times. */
function clauseBeats(text: string, total: number, hasDialogue: boolean, onscreenSpeech: boolean): RawBeat[] {
  const cls = dedupeClauses(splitClauses(text))
  if (!cls.length) cls.push('保持姿态，呼吸与眼神有细微变化')
  const W = cls.reduce((a, c) => a + Math.max(2, paced(c)), 0)
  let t = 0
  const beats: RawBeat[] = cls.map((c) => {
    const a = t
    t += (total * Math.max(2, paced(c))) / W
    const sp = hasDialogue && SPEECH_RE.test(c)
    return { text: c, start: a, end: t, speech: sp && onscreenSpeech, voice: sp && !onscreenSpeech, speakers: [] }
  })
  if (beats.length === 1) {
    // a single action: add a hold / talk beat so the timeline has 2 segments
    const b = beats[0]
    const cut = total * (hasDialogue ? 0.45 : 0.55)
    b.end = cut
    beats.push({
      text: hasDialogue && !b.speech && !b.voice ? (onscreenSpeech ? '神情收住' : '停住听画外的声音') : '保持姿态，呼吸与眼神有细微变化',
      start: cut,
      end: total,
      speech: hasDialogue && !b.speech && !b.voice && onscreenSpeech,
      voice: hasDialogue && !b.speech && !b.voice && !onscreenSpeech,
      speakers: [],
    })
  }
  beats[beats.length - 1].end = total
  return beats
}

/** Snap group boundaries to 0.5 s (exact total), keep ≥1 s each, give the dialogue group its speaking time. */
function snapGroups(groups: Group[], total: number, needDialogueSec: number, needPerGroup?: number[]): void {
  const k = groups.length
  const cuts = groups.slice(0, -1).map((g) => snap(g.end))
  const minSeg = total >= k ? 1 : total / k
  for (let i = 0; i < cuts.length; i++) {
    const lo = (i ? cuts[i - 1] : 0) + minSeg
    const hi = total - minSeg * (k - 1 - i)
    cuts[i] = Math.min(Math.max(cuts[i], lo), hi)
  }
  // several dialogue segments: each gets its own lines' need; 0.5 s steps from the segment with the most slack
  // (lengths above their own minimum), so a satisfied dialogue segment is never cut below its need
  if (needPerGroup && needPerGroup.filter((x) => x > 0).length >= 2) {
    const L = groups.map((_, i) => (i < k - 1 ? cuts[i] : total) - (i ? cuts[i - 1] : 0))
    const min = needPerGroup.map((n) => Math.max(minSeg, Math.ceil(n * 2 - 1e-9) / 2))
    for (let guard = 0; guard < 80; guard++) {
      const j = L.findIndex((x, i) => x < min[i] - 1e-9)
      if (j < 0) break
      const donor = L.map((x, i) => ({ i, slack: i === j ? -1 : x - min[i] })).sort((a, b) => b.slack - a.slack || Math.abs(a.i - j) - Math.abs(b.i - j))[0]
      if (!donor || donor.slack < 0.5 - 1e-9) break
      L[donor.i] -= 0.5
      L[j] += 0.5
    }
    let acc = 0
    groups.forEach((g, i) => {
      g.start = acc
      acc = i < k - 1 ? acc + L[i] : total
      g.end = acc
    })
    return
  }
  const di = groups.findIndex((g) => g.beats.some((b) => b.speech || b.voice))
  if (di >= 0 && needDialogueSec > 0) {
    const need = Math.min(Math.ceil(needDialogueSec * 2) / 2, total - minSeg * (k - 1))
    for (let guard = 0; guard < 40; guard++) {
      const a = di ? cuts[di - 1] : 0
      const b = di < k - 1 ? cuts[di] : total
      if (b - a >= need - 1e-9) break
      // grow toward the side with more slack; cascade so a non-adjacent segment can donate too
      const leftSlack = di ? cuts[di - 1] - minSeg * di : 0
      const rightSlack = di < k - 1 ? total - cuts[di] - minSeg * (k - 1 - di) : 0
      if (rightSlack >= 0.5 - 1e-9 && rightSlack >= leftSlack) {
        cuts[di] += 0.5
        for (let j = di + 1; j < k - 1; j++) if (cuts[j] - cuts[j - 1] < minSeg - 1e-9) cuts[j] += 0.5
      } else if (leftSlack >= 0.5 - 1e-9) {
        cuts[di - 1] -= 0.5
        for (let j = di - 2; j >= 0; j--) if (cuts[j + 1] - cuts[j] < minSeg - 1e-9) cuts[j] -= 0.5
      } else break
    }
  }
  groups.forEach((g, i) => {
    g.start = i ? cuts[i - 1] : 0
    g.end = i < k - 1 ? cuts[i] : total
  })
}

// ---------------- prompt pieces ----------------

function sceneHeader(s: VideoPipelineShot): string {
  const p = (s.promptDefault ?? s.prompt ?? '').replace(/竖屏9:16[，,。；;]?/g, '')
  const k = p.search(/(主体|构图)\s*[：:]/)
  let head = (k >= 0 ? p.slice(0, k) : '').split(/[。\n]/).map((x) => x.trim()).filter(Boolean)[0] || ''
  head = head.replace(/[，,；;。\s]+$/, '')
  const labelPlace = (s.sceneLabel || '').split('·')[0].trim()
  if (!head || paced(head) > 30) {
    head = [s.timeOfDay?.trim(), labelPlace].filter(Boolean).join('，')
  } else if (labelPlace && !head.includes(labelPlace) && !head.includes(labelPlace.slice(-2))) {
    // 「早上，别墅落地窗前」+ 别墅卧室 → 「早上，别墅卧室落地窗前」
    let bestSub = ''
    for (let i = 0; i < labelPlace.length; i++)
      for (let j = i + 2; j <= labelPlace.length; j++) {
        const sub = labelPlace.slice(i, j)
        if (sub.length > bestSub.length && head.includes(sub)) bestSub = sub
      }
    if (bestSub) head = head.replace(bestSub, labelPlace)
  }
  if (s.timeOfDay && !head.includes(s.timeOfDay.trim()) && !/(早|晨|午|夜|晚|白天|黄昏|傍晚)/.test(head)) head = `${s.timeOfDay.trim()}，${head}`
  return head.replace(/^[，\s]+|[，\s]+$/g, '')
}

const APPEARANCE_RE = /(岁|少年|少女|男生|女生|男人|女人|发|脸|五官|眉|身形|高瘦|校服|夹克|卫衣|衬衫|T恤|外套|裙|裤|毛衣|西装|制服)/
const APPEAR_VERB = /(把|压|看|望|盯|抬|转|站|坐|走|跑|扔|抓|拿|握|举|推|拉|靠|趴|躺|蹲|冲|低头|回头|扭头|说|喊|笑|哭|伸|指|点)/

/** Appearance/wardrobe subject for one character (from the shot's 主体 piece, else character meta without bio). */
function subjectFor(id: string, piece: string, c: Char | undefined, carry: boolean, variants: { text: string; id: string | null; ids?: string[] }[]): string {
  let t = piece
  if (t) {
    t = stripNames(t, variants, () => '')
    // stop at the first clause that is an action (主体 sometimes carries the action)
    const cls = splitTop(t, '，,')
    const keep: string[] = []
    for (const x of cls) {
      if (keep.length && APPEAR_VERB.test(x.replace(/[（(][^）)]*[）)]/g, '').replace(/(上梳|遮眉|压眉|下垂|向后梳|拉链|翻领|点缀)/g, ''))) break
      keep.push(x)
    }
    t = keep.join('，')
    // a piece that is really an action / staging note (「肩上还挂着书包」「的背影与…」) is not a subject
    if (!APPEARANCE_RE.test(t) || /^[的与和]/.test(t)) t = ''
  }
  if (!t && c) {
    const age = ageNum(c)
    const look = (c.visualLock || '').replace(/^[^：:]{0,12}[：:]/, '').split(/[，,；;]/).slice(0, 3).join('，')
    const wear = carry ? '' : (c.costumePrompt || c.costume || '').split(/[，,；;]/)[0]
    t = [`${age ? `${age}岁` : ''}东亚${nounFor(c)}`, look, wear].filter(Boolean).join('，')
    t = stripNames(t, variants, () => '')
  }
  t = dedupeClauses(splitTop(t.replace(/[（(]\s*[）)]/g, ''), '，,')).join('，').replace(/[，,\s]+$/, '')
  if (t && c && !/(岁|少年|少女|男生|女生|男人|女人|男孩|女孩|青年)/.test(t)) {
    const age = ageNum(c)
    t = `${age ? `${age}岁` : ''}东亚${nounFor(c)}，${t}`
  }
  if (t && GARMENT.test(t) && !/无任何标志/.test(t)) {
    // tag the garment clause (sample: 米白翻领拉链短夹克（无任何标志）)
    const parts = t.split('，')
    const gi = parts.findIndex((x) => GARMENT.test(x))
    parts[gi] = `${parts[gi]}（无任何标志）`
    t = parts.join('，')
  }
  void id
  return t
}

function cameraLine(camera: string): string {
  const parts = (camera || '')
    .split(/[，,]?\s*随后\s*/)
    .map((x) => x.replace(/\s*·\s*/g, '，').replace(/正反打|对切|切换视角|切到|切回/g, '').replace(/[，,\s]+$/, '').trim())
    .filter(Boolean)
  if (!parts.length) return '固定机位，不切镜'
  let first = parts[0]
  const MOVE = /((?:缓慢|轻微|微微|快速|轻|缓)?(?:微推|轻推|缓推|推近|推进|推|拉远|缓拉|拉|上摇|下摇|摇|跟移|横移|上移|下压|跟拍))/
  if (parts.length > 1) {
    const last = parts[parts.length - 1]
    const mv = last.split(/[，,]/).map((x) => x.trim()).find((x) => MOVE.test(x))
    if (mv && !first.includes(mv)) first = `${first}，最后一秒${mv}`
  }
  return `${first.replace(/[，,]\s*$/, '')}，不切镜`
}

function styleLineFor(prompt: string, style?: string): string {
  const live = !style || style === '真人都市'
  let st = clause(prompt, /风格/)
  if (!st) st = live ? '真人实拍都市短剧质感，禁止二次元漫画脸' : ''
  st = st.replace(/自然肤质[，,]?/g, '').replace(/电影级布光[，,]?/g, '').replace(/[，,]\s*$/, '')
  const add = live ? BEAT_REALISM : '真实运动速度，非慢动作'
  if (!st.includes(add)) {
    const parts = st.split('，').filter(Boolean)
    // insert after the first (质感) phrase, keep 禁止… last
    parts.splice(Math.min(1, parts.length), 0, add)
    st = parts.join('，')
  }
  return st
}

// ---------------- main builder ----------------

const SPEEDS: BeatSpeed[] = ['快', '慢', '恢复常速']

/**
 * Validate hand-written beats for one shot: 2–4 segments on a 0.5 s grid, each ≥ 1 s, contiguous from 0 to exactly
 * durationSec; speed contrast (not all one speed); text non-empty without character names or dialogue text; when the
 * shot has dialogue exactly one `dialogue: true` segment, 【慢】, ≥ line length / 4.5 + DIALOGUE_PAD_SEC, nothing
 * covering the mouth; without dialogue no dialogue segment. Returns error strings (empty = valid).
 */
export function validateBeatOverride(s: VideoPipelineShot, segs: BeatOverrideSegment[], chars: Char[]): string[] {
  const e: string[] = []
  const total = Number(s.durationSec) || 0
  if (!Array.isArray(segs) || segs.length < 2 || segs.length > 4) return [`需要 2–4 段，实际 ${Array.isArray(segs) ? segs.length : '非数组'}`]
  const on = (x: number) => Math.abs(x * 2 - Math.round(x * 2)) < 1e-9
  if (Math.abs(segs[0].start) > 1e-9) e.push(`第 1 段应从 0 开始（${segs[0].start}）`)
  segs.forEach((g, i) => {
    const n = `第 ${i + 1} 段 ${g.start}–${g.end}s`
    if (typeof g.start !== 'number' || typeof g.end !== 'number' || !on(g.start) || !on(g.end)) e.push(`${n}：起止须为 0.5s 网格上的数字`)
    if (g.end - g.start < 1 - 1e-9) e.push(`${n}：不足 1 秒`)
    if (i > 0 && Math.abs(g.start - segs[i - 1].end) > 1e-9) e.push(`${n}：与上一段不连续（上一段止于 ${segs[i - 1].end}s）`)
    if (!SPEEDS.includes(g.speed)) e.push(`${n}：speed 须为 快/慢/恢复常速`)
    if (!g.text || !paced(g.text)) e.push(`${n}：text 为空`)
  })
  if (Math.abs(segs[segs.length - 1].end - total) > 1e-9) e.push(`末段止于 ${segs[segs.length - 1].end}s ≠ 镜头时长 ${total}s`)
  if (new Set(segs.map((g) => g.speed)).size < 2) e.push('所有分段同一速度，无变速对比')
  // names / dialogue text never in the visual prompt
  const lines = s.dialogueLines?.length ? s.dialogueLines : s.dialogue ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue, voiceOnly: s.speakerOffscreen }] : []
  const names = [...new Set([...nameVariants(chars).map((v) => v.text), ...chars.flatMap((c) => [c.name, c.baseName || '']), ...lines.map((l) => l.speakerName || '')])].filter((x) => x && x.length >= 2)
  const frags = lines.flatMap((l) => {
    const core = (l.text || '').replace(/[^\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9，。！？、；…,.!?;~～\s]/g, '')
    const parts = core.split(/[，。！？、；…,.!?;~～\s]+/).filter((x) => paced(x) >= 3)
    const whole = core.replace(/[，。！？、；…,.!?;~～\s]+/g, '')
    return whole.length >= 2 ? [whole, ...parts] : parts
  })
  segs.forEach((g, i) => {
    for (const nm of names) if ((g.text || '').includes(nm)) e.push(`第 ${i + 1} 段含人名「${nm}」`)
    const flat = (g.text || '').replace(/[，。！？、；…,.!?;~～\s]+/g, '')
    for (const f of frags) if (flat.includes(f.replace(/[，。！？、；…,.!?;~～\s]+/g, ''))) e.push(`第 ${i + 1} 段含台词原文「${f}」`)
    if (/另一人|两人|双人|同框/.test(g.text || '')) e.push(`第 ${i + 1} 段出现第二个人物`)
    const n = countActions(splitClauses((g.text || '').replace(/、/g, '，')))
    const cap = actionCap(g.speed, Boolean(g.dialogue))
    if (n > cap) e.push(`第 ${i + 1} 段【${g.speed}】${g.dialogue ? '（台词段）' : ''}含 ${n} 个主动作，上限 ${cap}`)
  })
  const dl = segs.filter((g) => g.dialogue)
  if (lines.length) {
    const dlgSec = lines.reduce((a, l) => a + paced(l.text || '') / 4.5, 0)
    if (dl.length !== 1) e.push(`有台词的镜头须恰好 1 段 dialogue:true（实际 ${dl.length}）`)
    for (const g of dl) {
      if (g.speed !== '慢') e.push(`台词段 ${g.start}–${g.end}s 必须是【慢】`)
      if (g.end - g.start < dlgSec + DIALOGUE_PAD_SEC - 1e-9) e.push(`台词段 ${g.start}–${g.end}s 不足 ${(dlgSec + DIALOGUE_PAD_SEC).toFixed(2)}s（台词字数/4.5 + ${DIALOGUE_PAD_SEC}）`)
      if (MOUTH_BLOCK.test(g.text || '')) e.push(`台词段含遮挡嘴部的动作：${g.text}`)
    }
  } else if (dl.length) e.push('镜头无台词，不能有 dialogue:true 段')
  return e
}

export function buildBeatPrompt(s: VideoPipelineShot, chars: Char[], opts: BeatModeOptions = {}): BeatPromptResult {
  const src = s.promptDefault ?? s.prompt ?? ''
  const voiceDropped: string[] = []
  const total = Number(s.durationSec) || 0
  const todo: string[] = []
  const removedProps: string[] = []
  const cast = s.characterIds || []
  const byId = new Map(chars.map((c) => [c.id, c]))
  const lines = [
    ...(s.dialogueLines?.length ? s.dialogueLines : s.dialogue ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue, voiceOnly: s.speakerOffscreen }] : []),
  ]
  const offNames = lines.filter((l) => !l.speaker && l.speakerName).map((l) => l.speakerName!) as string[]
  const variants = nameVariants(chars, offNames)
  const hasDialogue = lines.length > 0
  const onscreenSpeech = lines.some((l) => l.speaker && cast.includes(l.speaker) && !l.voiceOnly)
  const single = cast.length === 1
  const pron = single ? (isFemale(byId.get(cast[0])) ? '她' : '他') : '他'

  // ---- subject pieces per cast member
  const subjRaw = clause(src, /主体/)
  const pieces = splitTop(subjRaw, '；;')
  // a piece belongs to the cast member whose name matches it most specifically (名字（之后） beats the shared
  // base name 名字), so one character's piece is never reused for another
  const owner = (p: string): string | null => {
    const v = variants.find((x) => x.ids.length === 1 && cast.includes(x.ids[0]) && p.includes(x.text))
    return v ? v.ids[0] : null
  }
  const pieceFor = (id: string): string => {
    const c = byId.get(id)
    const hit = pieces.find((p) => owner(p) === id)
    if (hit) return hit
    if (cast.length === 1 && pieces.length === 1) return pieces[0]
    void c
    return ''
  }
  // split children (crosscutSplit) carry from carryFromShotId instead of the previous shot
  const carry = Boolean(s.carryFromPrev) || Boolean(s.splitFrom && s.carryFromShotId)
  const subjects = cast.map((id) => subjectFor(id, pieceFor(id), byId.get(id), carry, variants)).filter(Boolean)

  // reference words for names in beat text
  const garmentOf = new Map<string, string>()
  for (const id of cast) {
    const sub = subjectFor(id, pieceFor(id), byId.get(id), false, variants)
    const g = sub.match(GARMENT)?.[0] || (byId.get(id)?.costumePrompt || byId.get(id)?.costume || '').match(GARMENT)?.[0] || ''
    garmentOf.set(id, g)
  }
  const distinct = new Set([...garmentOf.values()].filter(Boolean)).size === cast.length
  if (cast.length >= 2 && !distinct) todo.push('多人同框且服装关键词无法区分，人名已统一替换为「他」，请人工核对指代')
  // a shared baseName (甲 → 甲（之前）/甲（之后）) resolves to the variant that is on screen
  // …and when several variants are on screen, to the one that speaks in this shot
  const resolveId = (id0: string | null, ids?: string[]): string | null => {
    const on = (ids || []).filter((x) => cast.includes(x))
    return (on.length > 1 ? on.find((x) => lines.some((l) => l.speaker === x)) : undefined) ?? on[0] ?? id0
  }
  const refOf = (id0: string | null, ids?: string[]): string => {
    const id = resolveId(id0, ids)
    if (!id) return '有人'
    if (!cast.includes(id)) return '有人'
    if (single) return pron
    const g = garmentOf.get(id)
    return distinct && g ? `穿${g}的${nounFor(byId.get(id))}` : isFemale(byId.get(id)) ? '她' : '他'
  }

  // ---- bare 他/她 in a multi-person shot → the actor's descriptor (resolved from the source beat).
  // Subject position (clause start / after a lead-in): the person last named earlier in this beat, else the beat's
  // single speaker (（甲开口说台词）), else — two on screen and the beat names only one later (他…看向甲) — the other.
  // Object position (看着他 / 冲他): with exactly two on screen, the other one of the beat's actor. No guess from
  // earlier beats: unresolved pronouns stay and shotAnnotate adds a renderReview note.
  const marks = !single && distinct && cast.length >= 2
  const markOf = (id: string) => String.fromCharCode(PRON_MARK0 + cast.indexOf(id))
  const markPronouns = (text: string, speakers: string[]): string => {
    if (!marks) return text
    const spk = [...new Set(speakers.map((n) => variants.find((v) => v.text === n)).map((v) => (v ? resolveId(v.id, v.ids) : null)).filter((x): x is string => Boolean(x) && cast.includes(x!)))]
    let local: string | null = null
    const re = new RegExp(`${variants.map((v) => esc(v.text)).join('|')}${variants.length ? '|' : ''}${BARE_PRONOUN.source}`, 'g')
    return text.replace(re, (m: string, ...rest: unknown[]) => {
      const off = rest[rest.length - 2] as number
      const all = rest[rest.length - 1] as string
      if (!BARE_PRONOUN_ONLY.test(m)) {
        const v = variants.find((x) => x.text === m)
        const id = v ? resolveId(v.id, v.ids) : null
        if (id && cast.includes(id)) local = id
        return m
      }
      const before = all.slice(0, off)
      if (SUBJECT_SLOT.test(before)) {
        // 「他…，视线落在甲脸上」: with two on screen, a pronoun before the only other name in the beat is the other one
        const ahead = [...new Set(
          variants
            .filter((v) => all.slice(off + 1).replace(MARK_RE, '').includes(v.text))
            .map((v) => resolveId(v.id, v.ids))
            .filter((x): x is string => Boolean(x) && cast.includes(x!)),
        )]
        const other = cast.length === 2 && ahead.length === 1 && !spk.includes(ahead[0]) ? cast.find((x) => x !== ahead[0])! : null
        // …else the beat names exactly one on-screen character's garment (校服袖口滑下) → that character
        const rest = all.slice(off + 1)
        const worn = cast.filter((x) => garmentOf.get(x) && rest.includes(garmentOf.get(x)!))
        const id = local ?? (spk.length === 1 ? spk[0] : null) ?? other ?? (worn.length === 1 ? worn[0] : null)
        if (!id) {
          todo.push(`${UNCLEAR_PRONOUN_NOTE}${all.slice(off).split(/[，,。；;]/)[0]}`)
          return m
        }
        local = id
        return markOf(id)
      }
      const actor = local
      if (cast.length === 2 && actor) return markOf(cast.find((x) => x !== actor)!)
      todo.push(`${UNCLEAR_PRONOUN_NOTE}${all.slice(0, off).split(/[，,。；;]/).pop()}${all.slice(off).split(/[，,。；;]/)[0]}`)
      return m
    })
  }
  // final pass per segment: a marker right after the same person's reference reads 他/她, otherwise the descriptor
  const unmark = (body: string): string => {
    if (!marks) return body
    const refs = cast.map((id) => refOf(id))
    let prev = ''
    let prevEnd = 0
    const re = new RegExp(`${refs.map(esc).join('|')}|[${cast.map(markOf).join('')}]`, 'g')
    return body.replace(re, (m, off: number) => {
      const same = !/[，,。；;]/.test(body.slice(prevEnd, off))
      prevEnd = off + m.length
      if (refs.includes(m)) {
        prev = m
        return m
      }
      const id = cast[m.charCodeAt(0) - PRON_MARK0]
      const r = refOf(id)
      const out = r === prev && same ? (isFemale(byId.get(id)) ? '她' : '他') : r
      prev = r
      return out
    })
  }

  // ---- explicit beats (beatOverrides) replace the automatic split
  const ov = opts.beatOverrides?.[s.id]
  if (ov) {
    const errs = validateBeatOverride(s, ov, chars)
    if (errs.length) throw new Error(`beatOverrides ${s.id}: ${errs.join('；')}`)
    const voiceOnly = hasDialogue && !onscreenSpeech
    const meta: BeatSegmentMeta[] = ov.map((g) => ({ start: g.start, end: g.end, speed: g.speed, dialogue: Boolean(g.dialogue), lipSync: Boolean(g.dialogue) && !voiceOnly }))
    const segLinesOv = ov.map((g) => {
      let body = g.text.replace(/[，；。\s]+$/, '')
      if (g.speed === '快' && !body.includes(BEAT_FAST_TAIL)) body = `${body}，${BEAT_FAST_TAIL}`
      if (g.dialogue) body = `动作放慢，${body}；${voiceOnly ? '画外有人说话，画面人物停住倾听，嘴唇闭合不说话' : BEAT_MOUTH_CUE}`
      return { g, body }
    }).map(({ g, body }, i, arr) => segmentLine(g.start, g.end, g.speed, i, body, i ? arr[i - 1].g.speed : undefined))
    return finish(segLinesOv, meta)
  }

  // ---- raw beats
  let beats = parseMergedTimeline(src)
  const merged = Boolean(beats && beats.length >= 2)
  if (!beats || beats.length < 2) {
    const perf = clause(src, /表演/)
    const base = beats?.[0]?.text || s.action || clause(src, /动作/) || (s.visual || '')
    beats = clauseBeats([base, perf].filter(Boolean).join('，'), total, hasDialogue, onscreenSpeech || (hasDialogue && !lines.some((l) => l.voiceOnly || (l.speaker && !cast.includes(l.speaker)))))
  } else {
    // a shot lengthened for its dialogue: source beat times scale with the new length
    const from = s.durationAdjustment?.fromSec
    if (from && from > 0 && Math.abs(from - total) > 1e-9) for (const b of beats) {
      b.start = (b.start * total) / from
      b.end = (b.end * total) / from
    }
    beats[beats.length - 1].end = total
  }
  if (merged && beats.length > 3) todo.push(`原 ${beats.length} 个小节拍压缩为 2–3 段，请核对动作是否丢失`)

  // ---- partition into 2–3 segments
  let groups: Group[] = beats.length <= 3 && !(beats.length === 3 && total < 4.5) ? beats.map((b) => ({ beats: [b], start: b.start, end: b.end })) : partitionBeats(beats, total)
  if (groups.length === 1) groups = partitionBeats(beats, total)
  // shot has dialogue but no beat was marked: put it on the calmest (prefer middle / last) group
  if (hasDialogue && !groups.some((g) => g.beats.some((b) => b.speech || b.voice))) {
    const order = groups.map((_, i) => i).sort((a, b) => {
      const fa = isActionHeavy(groups[a].beats.map((x) => x.text).join('，')) ? 1 : 0
      const fb = isActionHeavy(groups[b].beats.map((x) => x.text).join('，')) ? 1 : 0
      const mid = (i: number) => (groups.length === 3 ? Math.abs(i - 1) : groups.length - 1 - i)
      return fa - fb || mid(a) - mid(b)
    })
    const g = groups[order[0]]
    g.beats[g.beats.length - 1].speech = onscreenSpeech
    g.beats[g.beats.length - 1].voice = !onscreenSpeech
  }
  // the 【慢】 dialogue segment needs the estimated speech + head / tail pad (dialogueTiming, same estimator as the
  // dialogueOverrun check); with 3 segments that may not fit (≥1 s for each of the others) → fold the smaller
  // neighbour into the dialogue segment
  const dlgNeed = dialogueNeedSec(lines.map((l) => l.text || ''), opts.speechRate, opts.dialoguePad)
  const isDlg = (g: Group) => g.beats.some((b) => b.speech || b.voice)
  const needSlow = dlgNeed > 0 ? Math.ceil(dlgNeed * 2) / 2 : 0
  if (groups.length === 3 && groups.filter(isDlg).length === 1 && needSlow > total - 2) {
    const di = groups.findIndex(isDlg)
    const ni = di === 0 ? 1 : di === 2 ? 1 : groups[0].end - groups[0].start <= groups[2].end - groups[2].start ? 0 : 2
    const [a, b] = ni < di ? [ni, di] : [di, ni]
    const merged: Group = { beats: [...groups[a].beats, ...groups[b].beats], start: groups[a].start, end: groups[b].end }
    groups.splice(a, 2, merged)
  }
  const dlgGroups = groups.filter(isDlg).length
  const segNeeds = dialogueSegmentNeeds(lines.map((l) => l.text || ''), dlgGroups, opts.speechRate, opts.dialoguePad)
  let dk = 0
  snapGroups(groups, total, dlgGroups === 1 ? dlgNeed : 0, groups.map((g) => (isDlg(g) ? segNeeds[dk++] : 0)))

  // ---- render segments
  const segMeta: BeatSegmentMeta[] = []
  const dlgFrags = lines
    .flatMap((l) => {
      const core = (l.text || '').replace(/^[「」“”"'‘’『』\s]+|[「」“”"'‘’『』\s]+$/g, '')
      return [l.text, core, ...core.split(/[，。！？、；…,.!?;~～\s]+/)]
    })
    .map((x) => (x || '').trim())
    .filter((x) => [...x].length >= 4)
    .sort((a, b) => b.length - a.length)
  const trimmed: string[] = []
  const segTexts = groups.map((g) => {
    const speech = g.beats.some((b) => b.speech)
    const voice = g.beats.some((b) => b.voice)
    const speakers = [...new Set(g.beats.flatMap((b) => b.speakers))]
    let raw = g.beats.map((b) => markPronouns(b.text, b.speakers)).join('，')
    raw = raw
      .replace(MARK_RE, '')
      .replace(/表演[：:]/g, '')
      .replace(/说话时|说这句话时|说这句时|说着/g, '')
      .replace(/[「“『][^」”』]*[」”』]/g, '')
    for (const f of dlgFrags) raw = raw.split(f).join('')
    raw = stripNames(raw, variants, refOf)
    let cls = dedupeClauses(splitClauses(listToClauses(raw)))
    // small hand props competing with face / hands
    if (cast.length) {
      cls = cls.filter((c) => {
        const p = smallPropIn(c)
        if (!p) return true
        removedProps.push(`${p}：${c}`)
        return false
      })
    }
    // a solo shot shows only its one character: clauses whose subject is someone else (extras, crowd) are dropped
    if (single) {
      cls = cls.filter((c) => {
        if (!OTHER_PERSON.test(c)) return true
        todo.push(`单人镜删去其他人物：${c}`)
        return false
      })
    }
    // audio / delivery descriptions (语气… / 几乎自语 / 低声说) are never drawn; they become the line's TTS delivery hint
    cls = cls
      .map((c) => {
        const v = splitVoice(stripVoiceAdverbs(c))
        if (v.voice) voiceDropped.push(v.voice)
        return v.keep
      })
      .filter(Boolean)
    const dlg = speech || voice
    if (speech) {
      // occluding the mouth while speaking: a visible equivalent (手拢在嘴边喊 → 仰头张嘴喊), else dropped
      cls = cls.flatMap((c) => {
        const r = clearMouthClause(c)
        if (!r.changed) return [c]
        todo.push(`台词段${r.clause ? '改写' : '删去'}遮挡嘴部的动作：${c}${r.clause ? ` → ${r.clause}` : ''}`)
        return r.clause ? [r.clause] : []
      })
      cls = cls.filter((c) => !/^(开口|张嘴|说话|说台词)$/.test(c))
    }
    return { g, cls, speech, voice, dlg, speakers }
  })
  // speech lead-ins (开口前… / …才出声) describe the line itself: they belong in the dialogue (lip-sync) segment, never
  // in a silent one; inside the dialogue segment lead-ins go first and 说完… afterthoughts last
  const di = segTexts.findIndex((x) => x.speech)
  if (di >= 0) {
    const d = segTexts[di]
    segTexts.forEach((x, i) => {
      if (i === di || x.dlg) return
      const pre = x.cls.filter((c) => PRE_SPEECH.test(c))
      if (!pre.length) return
      x.cls = x.cls.filter((c) => !pre.includes(c))
      d.cls = [...pre, ...d.cls]
    })
    const pre = d.cls.filter((c) => PRE_SPEECH.test(c))
    const post = d.cls.filter((c) => !PRE_SPEECH.test(c) && POST_SPEECH.test(c))
    const bare = pre.map((c) => c.replace(PRE_SPEECH, '').replace(/^[，\s]+/, ''))
    // a mid clause that only restates a lead-in (开口前眉头先皱 / 眉头先皱后松) is the same beat
    const mid = d.cls.filter((c) => !pre.includes(c) && !post.includes(c) && !bare.some((b) => paced(b) >= 3 && (c.includes(b) || isNearDup(c, b))))
    // two lead-ins on the same feature (嘴角动了一下才出声 / 嘴角先动再出声) are one beat
    const preU = pre.filter((c, k) => !pre.slice(0, k).some((y) => y.slice(0, 2) === c.slice(0, 2) || isNearDup(c, y)))
    // the line starts with the shot (no earlier segment): there is no time before speech — lead-ins are dropped
    const lead = di === 0 && d.g.start <= 1e-9 ? [] : preU
    for (const c of preU.filter((c) => !lead.includes(c))) trimmed.push(`${fmt(d.g.start)}–${fmt(d.g.end)}秒（台词从0秒开始，无开口前时间）：${unmark(c)}`)
    d.cls = [...lead, ...mid, ...post]
  }
  // post-speech actions (说完/喊完… + a main action) belong to the next, non-dialogue segment, not the 【慢】 lip-sync one
  segTexts.forEach((x, i) => {
    const nx = segTexts[i + 1]
    if (!x.dlg || !nx || nx.dlg) return
    const after = x.cls.filter((c) => POST_SPEECH.test(c) && actionWeight(c) > 0)
    if (!after.length) return
    x.cls = x.cls.filter((c) => !after.includes(c))
    nx.cls = [...after, ...nx.cls.filter((c) => !/安静听/.test(c))]
  })
  // speed tags
  const speeds: BeatSpeed[] = segTexts.map((x, i) => {
    if (x.dlg) return '慢'
    // split cross-cut listener (crosscutSplit): never 快
    if (/安静听/.test(x.cls.join('，'))) return '恢复常速'
    if (isActionHeavy(x.cls.join('，'))) return '快'
    void i
    return '恢复常速'
  })
  if (!speeds.includes('快') && !speeds.includes('慢')) {
    // give the timeline some contrast: most active non-dialogue segment becomes 快 when it has any verb
    const i = segTexts.findIndex((x) => WEAK_FAST.test(x.cls.join('，')))
    if (i >= 0) speeds[i] = '快'
  }
  // generic contrast rule: a timeline must never run at one speed. All 【恢复常速】 → the segment with the strongest
  // action or an impact event becomes 【快】; with none, the most expressive (micro-performance) segment becomes 【慢】.
  if (segTexts.length >= 2 && !speeds.some((x) => x !== '恢复常速')) {
    const score = (x: (typeof segTexts)[number]) => x.cls.reduce((a, c) => a + actionWeight(c), 0) + (x.cls.some((c) => IMPACT.test(c)) ? 2 : 0)
    const cand = segTexts.map((x, i) => ({ i, sc: x.dlg || /安静听/.test(x.cls.join('，')) ? -1 : score(x) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || a.i - b.i)[0]
    if (cand) speeds[cand.i] = '快'
    else {
      const micro = segTexts.map((x, i) => ({ i, n: x.cls.filter((c) => MICRO_RE.test(c)).length })).filter((x) => x.n > 0)
      const pick = micro.length ? micro.sort((a, b) => b.n - a.n || b.i - a.i)[0].i : segTexts.length - 1
      speeds[pick] = '慢'
    }
  }
  // all 【快】 → the calmest segment (least action, latest on ties) settles to 【恢复常速】
  if (segTexts.length >= 2 && !speeds.some((x) => x !== '快')) {
    const w = segTexts.map((x, i) => ({ i, sc: x.cls.reduce((a, c) => a + actionWeight(c), 0) })).sort((a, b) => a.sc - b.sc || b.i - a.i)
    speeds[w[0].i] = '恢复常速'
  }
  segTexts.forEach((x, i) => {
    if (speeds[i] !== '快') return
    // a sudden stop (顿住) is a fast reaction: keep it as 骤然顿住; real hesitation (犹豫/慢慢…) is dropped
    const cls = x.cls.map((c) => (/顿住|顿了/.test(c) && !/(迟疑|犹豫|不确定|慢慢|缓缓)/.test(c) && !SPEED_ADVERB.test(c) ? c.replace(/顿(住|了)/, '骤然顿$1') : c))
    const kept = cls.filter((c) => !HESITATE.test(c.replace(/骤然顿(住|了)/, '')))
    if (kept.length) x.cls = kept
  })
  // action density (H3 executes one distinct action per 【快】 segment): 快 ≤ 1, 慢/常速 ≤ 2, dialogue ≤ 1 besides speech
  // multi-person dialogue segment: the main action tied to the on-screen line (the last beat that carries a line) is
  // kept over a trailing action of someone else; solo shots keep the latest action (closest to speech)
  const nameTexts = variants.map((v) => v.text).sort((a, b) => b.length - a.length)
  // a clause opening with a person marker (multi-person shots): that marker is its subject
  const leadRef = new RegExp(`^(?:[\\ue100-\\ue1ff]|${PERSON_DESCRIPTOR.source})`)
  const leadMark = (c: string): string | null => c.match(leadRef)?.[0] ?? null
  const leadOf = (x: (typeof segTexts)[number]): string | undefined => {
    const b = [...x.g.beats].reverse().find((y) => y.speech && y.speakers.length)
    if (!b) return undefined
    let bt = b.text.replace(MARK_RE, '')
    for (const n of nameTexts) bt = bt.split(n).join('')
    bt = bt.replace(/[他她]/g, '')
    // the strongest action of that beat (a head move that only serves a look — 抬头看向… — counts as a small one);
    // ties → the later one, closest to speech; a compound (摊手又收回来摸了摸后颈) offers its later half
    const own = x.cls.filter((y) => {
      const core = unperson(y).replace(/^的/, '').replace(/[他她]/g, '')
      return countActions([y]) > 0 && core.length >= 2 && bt.includes(core.slice(0, Math.min(4, core.length)))
    })
    const cand = own.map((y) => expandCompounds([y]).filter((z) => actionWeight(z) > 0).pop()!)
    const score = (y: string) => (LOOK_MOVE.test(y) ? 1 : actionWeight(y))
    return cand.reduce<string | undefined>((best, y) => (!best || score(y) >= score(best) ? y : best), undefined)
  }
  segTexts.forEach((x, i) => {
    const r = limitActions(x.cls, actionCap(speeds[i], x.dlg), { preferLater: x.dlg, lead: x.dlg && !single ? leadOf(x) : undefined, subject: single ? undefined : leadMark })
    if (!r.dropped.length) return
    x.cls = r.kept
    for (const d of r.dropped) trimmed.push(`${fmt(x.g.start)}–${fmt(x.g.end)}秒（${speeds[i]}）：${unmark(d)}`)
  })
  // re-enforced after every merge / move: visible actions (head / gaze moves included) ≤ visibleCap and all drawn
  // clauses ≤ clauseCap. The main action (tied to the line in a dialogue segment), lead-ins and the 说完… beat stay;
  // extras move to a neighbouring silent segment with room (later first; 说完… never earlier), else are dropped (logged)
  // a clause that speaks (…才说话 / 喊话) never moves into a silent segment; a beat the target already shows is dropped
  const SPEAKS = /说话|开口|出声|喊|说一句|问话|念出/
  const PERSONAL = /[他她]|眉|眼|嘴|唇|脸|肩|手|指|头|下巴|下颌|脚|腿|身|背|喉|鼻|呼吸|视线|目光|胸|牙|额|耳|脖|膝|腰|拳|笑|叹|哈欠|神情|表情|无奈|慵懒/
  const fits = (y: (typeof segTexts)[number], k: number, c: string) =>
    !y.dlg && !SPEAKS.test(c) && !y.cls.some((z) => isNearDup(c, z) || isNearDup(z, c)) && y.cls.length + 1 <= clauseCap(speeds[k]) && (!isVisibleAction(c) || y.cls.filter(isVisibleAction).length + 1 <= visibleCap(speeds[k])) && (speeds[k] !== '快' || actionWeight(c) === 0)
  segTexts.forEach((x, i) => {
    // the clause cap binds the lip-sync segment (merged beats pile up there); visible actions are capped everywhere
    const over = () => (x.dlg && x.cls.length > clauseCap(speeds[i])) || x.cls.filter(isVisibleAction).length > visibleCap(speeds[i])
    if (!over()) return
    // the main action: tied to the line in a multi-person dialogue segment, else the strongest person clause (ties →
    // the most concrete, i.e. longest); scenery clauses (纱帘被风顶起) never outrank the actor
    const person = (c: string) => PERSONAL.test(c) || leadRef.test(c)
    const byWeight = [...x.cls].filter(person).sort((a, b) => actionWeight(b) - actionWeight(a) || paced(b) - paced(a))
    const main = (x.dlg && !single ? leadOf(x) : undefined) ?? byWeight[0]
    const fixed = (c: string) => c === main || (x.dlg && (PRE_SPEECH.test(c) || POST_SPEECH.test(c)))
    // removal order: scenery first, then (too many visible actions) an extra visible one, else an expression first;
    // the latest first
    const movable = () => {
      const free = x.cls.filter((c) => !fixed(c))
      const scenery = free.filter((c) => !person(c)).reverse()
      const actor = free.filter(person)
      const needVis = x.cls.filter(isVisibleAction).length > visibleCap(speeds[i])
      if (needVis) return actor.filter(isVisibleAction).reverse().concat(scenery.filter(isVisibleAction))
      return [...scenery, ...actor.filter((c) => !isVisibleAction(c)).reverse(), ...actor.filter(isVisibleAction).reverse()]
    }
    while (over()) {
      const c = movable()[0] ?? [...x.cls].reverse().find((y) => y !== main)
      if (!c) break
      x.cls = x.cls.filter((y) => y !== c)
      const to = (person(c) ? [i + 1, ...(POST_SPEECH.test(c) ? [] : [i - 1])] : [i - 1]).find((k) => k >= 0 && k < segTexts.length && fits(segTexts[k], k, c))
      if (to !== undefined) {
        const y = segTexts[to]
        y.cls = to > i ? [c, ...y.cls] : [...y.cls, c]
        trimmed.push(`${fmt(x.g.start)}–${fmt(x.g.end)}秒（${speeds[i]}，超出动作密度）移到 ${fmt(y.g.start)}–${fmt(y.g.end)}秒：${unmark(c)}`)
      } else trimmed.push(`${fmt(x.g.start)}–${fmt(x.g.end)}秒（${speeds[i]}，超出动作密度）：${unmark(c)}`)
    }
  })
  // the same beat never repeats in a later segment (merged 动作 + 表演 notes describe one moment twice)
  segTexts.forEach((x, i) => {
    if (!i) return
    const earlier = segTexts.slice(0, i).flatMap((y) => y.cls)
    x.cls = x.cls.filter((c) => !earlier.some((y) => isNearDup(c, y)))
  })
  // performance rule: a segment with no performance (no action, no micro-expression — empty, a hold or only listening)
  // gets one drawn from the shot's own emotion text; on long shots (≥ LONG_SHOT_SEC) every segment needs one.
  // An empty shot (no cast) has nobody to perform it: no 神情 clause (it would surface as face acting).
  const emo = cast.length === 0 ? [] : (s.emotion || '').split(/→|->/).map((x) => stripNames(x.trim(), variants, refOf)).filter((x) => paced(x) >= 2)
  segTexts.forEach((x, i) => {
    const perf = x.cls.some((c) => !/安静听/.test(c) && (actionWeight(c) > 0 || MICRO_RE.test(c)))
    const idle = !x.cls.length || x.cls.every((c) => /安静听|保持姿态/.test(c))
    if (perf || !emo.length || (!idle && total < LONG_SHOT_SEC)) return
    // the emotion is written as visible acting from the emotion table (never 神情透出<abstract phrase>, which the model
    // draws as an abstract face / text); acting another segment already shows is not repeated; a phrase with no table
    // word is skipped (logged) and the next emotion is tried
    const shown = segTexts.flatMap((y) => y.cls).join('，')
    // an emotion another segment already shows (the phrase or its table word, visualized later) is not repeated
    const used = (em: string) => shown.includes(em.replace(/^[的地得]/, '')) || emotionWords(em).some((w) => shown.includes(w))
    const k = Math.min(emo.length - 1, Math.floor((i * emo.length) / segTexts.length))
    for (const em of [...emo.slice(k), ...emo.slice(0, k)]) {
      if (used(em)) continue
      const v = visibleForEmotion(em, shown)
      if (!v) {
        trimmed.push(`${PERFORMANCE_NOTE}${fmt(x.g.start)}–${fmt(x.g.end)}秒 无可见动作对照，略去：${em}`)
        continue
      }
      trimmed.push(`${PERFORMANCE_NOTE}${fmt(x.g.start)}–${fmt(x.g.end)}秒 ${em} → ${v}`)
      x.cls = [...x.cls, v]
      return
    }
  })
  if (speeds.filter((x) => x === '慢').length > 1) todo.push('多段含台词，均标为【慢】，请核对节奏')
  if (speeds.every((x) => x === '慢')) todo.push('所有分段都是【慢】，与「非慢动作」冲突，建议拆镜')
  else if (speeds.every((x) => x === speeds[0])) todo.push(`所有分段都是【${speeds[0]}】，无变速对比`)

  const segLines = segTexts.map((x, i) => {
    const sp = speeds[i]
    // last pass: the performance rule can re-add a beat the action already said in other words
    const all = dedupeClauses(x.cls)
    // dialogue segment order: lead-ins / main → the speaking cue → 说完… afterthoughts
    const post = x.speech ? all.filter((c) => POST_SPEECH.test(c)) : []
    let body = unmark(all.filter((c) => !post.includes(c)).join('，'))
    if (sp === '快') body = fastify(body || '迅速完成动作')
    if (sp === '慢') {
      // every on-screen speaker of the segment is named by descriptor (two lines in one segment: one after the other)
      const refs = single ? [] : [...new Set(x.speakers.map((n) => stripNames(n, variants, refOf)).filter((r) => r && !BARE_PRONOUN_ONLY.test(r)))]
      if (!single && x.speech && x.speakers.length && !refs.length) todo.push(`台词段说话人无法用造型区分：${x.speakers.join('、')}`)
      const cue = !x.speech
        ? '画外有人说话，画面人物停住倾听，嘴唇闭合不说话'
        : refs.length >= 2
          ? `${refs.map((r, k) => `${k ? '随后' : ''}${r}${k ? '' : '先'}${BEAT_MOUTH_LINE}`).join('，')}，${BEAT_MOUTH_CLEAR}`
          : `${refs[0] || ''}${BEAT_MOUTH_CUE}`
      body = `动作放慢${body ? `，${body}` : ''}；${cue}${post.length ? `；${unmark(post.join('，'))}` : ''}`
    }
    if (!body) body = '保持姿态，呼吸与眼神有细微变化'
    segMeta.push({ start: x.g.start, end: x.g.end, speed: sp, dialogue: x.dlg, lipSync: x.speech })
    return segmentLine(x.g.start, x.g.end, sp, i, body, i ? speeds[i - 1] : undefined)
  })
  for (const m of segMeta) if (m.end - m.start < 1 - 1e-9) todo.push(`分段 ${fmt(m.start)}–${fmt(m.end)}秒 不足 1 秒`)
  const slowSec = segMeta.filter((m) => m.speed === '慢').reduce((a, m) => a + m.end - m.start, 0)
  if (hasDialogue && dlgNeed > slowSec + 1e-9) todo.push(`台词约需 ${dlgNeed.toFixed(1)}秒（含前后留白），【慢】段仅 ${fmt(slowSec)}秒`)
  if (cast.length >= 2 && CROSSCUT_RE.test(src)) todo.push('原段为对窗/对切双空间，单镜不切镜难以同时拍到两人，建议拆为单人镜')
  return finish(segLines, segMeta, trimmed)

  // ---- header / footer
  function finish(segLines: string[], segMeta: BeatSegmentMeta[], trimmedActions: string[] = []): BeatPromptResult {
    const head = sceneHeader(s)
    const who = cast.length === 0 ? '空镜无人物' : single ? '单人' : cast.length === 2 ? '双人' : `${cast.length}人`
    const subj = withZipState(subjects.join('；另一人：'))
    const solo = single ? `全程只有${pron}一人，不出现第二个人物。` : ''
    let light = clause(src, /光线/)
    if (!light) {
      const LIGHT = /(晨光|天光|日光|灯光|光从|光线|逆光|侧光|柔光|暖光|冷光|阳光|月光|斜射|光照)/
      const sent = src.split(/[。；\n]/).find((x) => LIGHT.test(x) && !/^\s*(限制|风格)[：:]/.test(x)) || ''
      light = splitTop(sent.replace(/^[^：:]{0,6}[：:]/, ''), '，,')
        .filter((x) => LIGHT.test(x))
        .join('，')
    }
    if (!light) light = s.timeOfDay ? `${s.timeOfDay}自然光` : '自然光'
    light = stripNames(light, variants, refOf)
    const limits = [BEAT_LIMIT]
    if (src.includes(CARRY_WARDROBE_CONSTRAINT) || carry) limits.push(CARRY_WARDROBE_CONSTRAINT)
    if (s.splitFrom && src.includes(SOLO_SPLIT_LIMIT)) limits.push(SOLO_SPLIT_LIMIT)
    if (s.speakerOffscreen || lines.some((l) => l.voiceOnly)) limits.push('画外人声的来源不出镜，画面只出现指定角色')
    const prompt = [
      `竖屏9:16，${fmt(total)}秒单镜。${head ? `${head}，` : ''}${who}。`,
      subj ? `主体：${subj}。${solo}` : solo,
      `${BEAT_HEADER}：`,
      ...segLines,
      `镜头：${(() => {
        const cam = stripNames(cameraLine(s.camera), variants, refOf)
        // close dialogue framing is for exactly one on-screen character; 2+ people stay medium / full
        return single && segMeta.some((m) => m.lipSync) ? dialogueFraming(cam, s.size) : cam
      })()}。`,
      `光线：${light.replace(/[。\s]+$/, '')}。`,
      `风格：${styleLineFor(src, opts.style)}。`,
      `限制：${limits.join('；')}。`,
    ]
      .filter(Boolean)
      .join('\n')
    // final guards: no names, no dialogue text
    const leftover = variants.filter((v) => v.text.length >= 2 && prompt.includes(v.text)).map((v) => v.text)
    if (leftover.length) todo.push(`提示词仍含人名：${leftover.join('、')}`)
    return { prompt, segments: segMeta, removedProps, todo, trimmedActions, delivery: [...new Set(voiceDropped)] }
  }
}

/** Is a prompt already in beat (speed) format? */
export function isBeatPrompt(p: string): boolean {
  return (p || '').includes(BEAT_HEADER)
}

/**
 * Dialogue fit: when the dialogue segment cannot hold the estimated speech + head / tail pad, lengthen the shot by
 * the shortfall (0.5 s grid, ≤ maxShotSec, never shorter than the source) and rebuild — the segments (and the lines
 * timed onto them) follow the new length. Idempotent: always starts from the source length (durationAdjustment.fromSec).
 * Hand beats (beatOverrides) and shots with more than one dialogue segment are left as they are (overrun warning).
 */
function fitDialogueDuration(
  s: VideoPipelineShot,
  build: (x: VideoPipelineShot) => BeatPromptResult,
  opts: BeatModeOptions,
  hand: boolean,
): { shot: VideoPipelineShot; r: BeatPromptResult } {
  const from = s.durationAdjustment?.fromSec ?? s.durationSec
  const { durationAdjustment: _old, ...base0 } = s
  void _old
  const base: VideoPipelineShot = { ...base0, durationSec: from }
  let r = build(base)
  const texts = (s.dialogueLines?.length ? s.dialogueLines.map((l) => l.text) : s.dialogue ? [s.dialogue] : []).filter((x) => x?.trim())
  if (hand || opts.fitDialogue === false || !texts.length) return { shot: base, r }
  const max = opts.maxShotSec ?? SHOT_TARGET_SEC.max
  // shortfall over the dialogue segments (each holds its own lines' speech + pad)
  const short = (x: BeatPromptResult) => {
    const d = x.segments.filter((g) => g.dialogue)
    if (!d.length) return { need: 0, have: 0, missing: 0 }
    const needs = dialogueSegmentNeeds(texts, d.length, opts.speechRate, opts.dialoguePad)
    const have = d.reduce((a, g) => a + g.end - g.start, 0)
    return { need: needs.reduce((a, b) => a + b, 0), have, missing: d.reduce((a, g, i) => a + Math.max(0, needs[i] - (g.end - g.start)), 0) }
  }
  const s0 = short(r)
  if (s0.missing < 1e-9) return { shot: base, r }
  const pad = { ...DEFAULT_DIALOGUE_PAD, ...opts.dialoguePad }
  const reason = `台词约需 ${s0.need.toFixed(2)} 秒（语速估算 + 每段前 ${pad.headSec}s / 后 ${pad.tailSec}s 留白），原 ${from} 秒镜头的台词段共 ${s0.have} 秒`
  let shot = base
  for (let guard = 0; guard < 8; guard++) {
    const m = short(r).missing
    if (m < 1e-9) break
    const next = Math.min(max, Math.ceil((shot.durationSec + m) * 2 - 1e-9) / 2)
    if (next <= shot.durationSec + 1e-9) break
    shot = { ...base, durationSec: next, durationAdjustment: { fromSec: from, toSec: next, reason } }
    r = build(shot)
  }
  return { shot, r }
}

/** Apply speed-beat prompts to every shot of an export (pure). */
export function applyBeatMode(exp: VideoPipelineExport, opts: BeatModeOptions = {}): VideoPipelineExport {
  const style = opts.style ?? exp.project.style
  const keep = opts.keepDefaultPrompt !== false
  const ov = opts.beatOverrides || {}
  const unknown = Object.keys(ov).filter((id) => !exp.shots.some((s) => s.id === id))
  if (unknown.length) throw new Error(`beatOverrides: unknown shot id ${unknown.join(', ')}`)
  const shots = exp.shots.map((s) => {
    // idempotent: rebuild from the stored default prompt when this shot was beat-converted before
    const src = s.promptDefault && isBeatPrompt(s.prompt) ? s.promptDefault : s.prompt
    // the appended render lines (景别 / no-text) are not scene text: parse without them, keep the original as promptDefault
    const build = (x: VideoPipelineShot) =>
      buildBeatPrompt({ ...x, prompt: isBeatPrompt(x.prompt) ? x.prompt : stripRenderLines(src), promptDefault: stripRenderLines(src) }, exp.characters, { ...opts, style })
    const fit = fitDialogueDuration(s, build, opts, Boolean(ov[s.id]))
    const r = fit.r
    const out: VideoPipelineShot = {
      ...fit.shot,
      prompt: r.prompt,
      beatMode: 'speed',
      beatSegments: r.segments,
      ...(keep ? { promptDefault: src } : {}),
    }
    if (ov[s.id]) out.beatOverride = true
    else delete out.beatOverride
    if (!keep) delete out.promptDefault
    if (r.removedProps.length) out.beatRemovedProps = r.removedProps
    else delete out.beatRemovedProps
    if (r.todo.length) out.beatTodo = r.todo
    else delete out.beatTodo
    if (r.trimmedActions.length) out.beatTrimmedActions = r.trimmedActions
    else delete out.beatTrimmedActions
    if (r.delivery.length) out.beatDelivery = r.delivery
    else delete out.beatDelivery
    return out
  })
  return { ...exp, shots }
}
