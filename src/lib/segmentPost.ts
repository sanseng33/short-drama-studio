/**
 * Deterministic post-processing of a video-pipeline@1 export (also re-applicable to an already exported pack):
 *  - lock project art style in prompts (真人都市: strip 2D/日漫/赛璐璐… and put the styleTag sentence exactly once) → `style_drift`
 *  - rewrite night light words to match a daytime timeOfDay (time_conflict kept only when unresolved)
 *  - off-list bit-part speakers → off-screen voice (speakerOffscreen / dialogueLines[].voiceOnly), not depicted
 *  - strip logo / 校徽 / 刺绣标 / 字样 phrases from prompts (+ no-badge constraint)
 *  - dedupe near-identical consecutive shots and merge short shots into 5–9 s segments (mergeToSegments, default on)
 *  - sceneId / sceneLabel / carryFromPrev for FL2V chaining (src/lib/sceneContinuity.ts)
 *  - carry shots: append CARRY_WARDROBE_CONSTRAINT (no pack costume re-inject into prompt)
 */
import type { ArtStyle } from '../types'
import { styleTag, styleToneForGenre } from './templates/styleTag'
import { tierSettingFacts } from './settingFacts'
import type { VideoPipelineExport, VideoPipelineShot, VideoPipelineWarning } from './videoExport'
import { applySceneContinuity, CARRY_WARDROBE_CONSTRAINT, sceneFieldsForMerge } from './sceneContinuity'

export interface PostProcessOptions {
  /** merge consecutive short shots into segments (default true) */
  mergeToSegments?: boolean
  /** merged segment min seconds (default 5) */
  segmentMinSec?: number
  /** merged segment max seconds (default 9) */
  segmentMaxSec?: number
  /** genre (for styleTag tone) */
  genre?: string
}

export const SEGMENT_MIN_SEC = 5
export const SEGMENT_MAX_SEC = 9
export const NO_BADGE_CONSTRAINT = '服装无任何标志、校徽、刺绣字样'
export const OFFSCREEN_VOICE_CONSTRAINT = '画外人声的说话人不出镜，画面只出现指定角色'

// ---------------- clause helpers ----------------

const NEG = /(不出现|不显示|不要|不得|不可|不能|禁止|避免|无字幕|无水印|无文字|无界面|无任何|无夜|无logo|没有任何|^无)/i
/** Clause is a negative constraint (限制：… / 不出现… / 无夜景). */
export function isNegClause(c: string): boolean {
  const x = (c || '').trim()
  return /^(限制|禁止|避免|要求|注意)\s*[：:]/.test(x) || NEG.test(x)
}
/** Apply fn to every non-constraint clause; the 限制： sentence is left untouched. */
function mapClauses(text: string, fn: (clause: string) => string): string {
  const parts = (text || '').split(/([，,。；;\n、])/)
  let inLimit = false
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const c = parts[i]
    const sep = parts[i + 1] ?? ''
    if (/^\s*限制\s*[：:]/.test(c)) inLimit = true
    out.push((inLimit || isNegClause(c) ? c : fn(c)) + sep)
    if (sep === '。' || sep === '\n') inLimit = false
  }
  return out.join('')
}
export function tidyPrompt(p: string): string {
  let s = p || ''
  for (let k = 0; k < 3; k++)
    s = s
      .replace(/[（(]\s*[）)]/g, '')
      .replace(/[，、,]\s*([。；;])/g, '$1')
      .replace(/([。；;：:])\s*[，、,]+/g, '$1')
      .replace(/[，、,]{2,}/g, '，')
      .replace(/。{2,}/g, '。')
      .replace(/[；;]{2,}/g, '；')
      .replace(/(^|[。\n])\s*[，、,；;]+/g, '$1')
      .replace(/(^|[。\n])[^。\n：:]{0,6}[：:]\s*。/g, '$1') // empty 「标签：。」
  return s.trim()
}
/** Append a constraint into the 限制： sentence (creating one at the end), skipping duplicates. */
export function addConstraint(prompt: string, c: string): string {
  if ((prompt || '').includes(c)) return prompt
  const m = prompt.match(/限制\s*[：:][^。\n]*/)
  if (m && m.index != null) {
    const end = m.index + m[0].length
    return `${prompt.slice(0, end).replace(/[，、,]+$/, '')}，${c}${prompt.slice(end)}`
  }
  return `${prompt}${prompt && !/[。.]$/.test(prompt) ? '。' : ''}限制：${c}。`
}


/**
 * Ensure at most one `prefix…` sentence (e.g. 「风格：」「光线：」).
 * If the prompt already has that prefix, do not append a second copy — extras are stripped;
 * the first is kept unless `opts.replace` and a non-empty `clause` replace it.
 * If missing and `clause` is non-empty, insert once (before 限制：, else at end).
 */
export function ensureSinglePrefixedClause(
  prompt: string,
  prefix: string,
  clause: string,
  opts: { replace?: boolean } = {},
): string {
  const raw = (prefix || '').trim()
  if (!raw) return prompt || ''
  const esc = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${esc}[^。\\n]*[。\\n]?`, 'g')
  const found = [...(prompt || '').matchAll(re)].map((m) => m[0])
  let s = tidyPrompt((prompt || '').replace(re, ''))
  let body = (clause || '').trim().replace(/[。\s]+$/u, '')
  // allow callers to pass either "风格：xxx" or "xxx"
  if (body.startsWith(raw)) body = body.slice(raw.length).replace(/^[：:\s]+/, '').trim().replace(/[。\s]+$/u, '')
  let keep = ''
  if (found.length) {
    if (opts.replace && body) keep = `${raw}${body}。`
    else {
      const first = found[0].replace(/[。\s]+$/u, '')
      keep = first.endsWith('。') ? first : `${first}。`
      if (!keep.startsWith(raw)) keep = `${raw}${keep}`
    }
  } else if (body) {
    keep = `${raw}${body}。`
  } else {
    return s
  }
  const k = s.search(/限制\s*[：:]/)
  s = k >= 0 ? `${s.slice(0, k)}${keep}${s.slice(k)}` : `${s}${s && !/[。.]$/.test(s) ? '。' : ''}${keep}`
  return tidyPrompt(s)
}

// ---------------- style lock ----------------

/** Style phrases that contradict 真人都市 (longest first). */
const LIVE_ACTION_BAN: RegExp[] = [
  /(?:2D|２Ｄ|二维)\s*(?:日漫|国漫|国风|动漫|动画|漫画)?(?:都市|古风|仙侠)?(?:动画|风格|画风|风|质感)?/gi,
  /日漫(?:风格|画风|风|质感|式|感)?/g,
  /国漫(?:风格|画风|风)?/g,
  /赛璐璐(?:上色|风格|质感|平涂)?/g,
  /二次元(?:风格|画风|风|质感)?/g,
  /动漫(?:风格|画风|风|质感|感)?/g,
  /漫画(?:风格|画风|风|质感|感|脸)/g,
  /卡通(?:风格|画风|风|渲染)/g,
  /动画(?:风格|画风|质感|渲染)/g,
  /(?:干净|细腻|清爽|利落)?(?:细线条|线条干净|干净线条|描边|线稿)/g,
  /cel[- ]?shad(?:ed|ing)|anime(?: style)?/gi,
]
const DRIFT_TEST = /(2D|２Ｄ|日漫|国漫|动漫|二次元|赛璐璐|漫画风|线稿|细线条|干净线条|cel[- ]?shad|anime)/i

export function styleLine(style: ArtStyle | string, genre = ''): string {
  return styleTag(style as ArtStyle, styleToneForGenre(genre))
}

/** True when text contains style words contradicting the project style (style sentence itself ignored). */
export function hasStyleDrift(text: string, style: ArtStyle | string, genre = ''): boolean {
  if (style !== '真人都市') return false
  return DRIFT_TEST.test((text || '').split(styleLine(style, genre)).join(''))
}

/** Remove contradicting style phrases (no style sentence insertion). */
export function stripStyleDrift(text: string, style: ArtStyle | string, genre = ''): string {
  if (style !== '真人都市') return text || ''
  const tag = styleLine(style, genre)
  const keep = '\u0001'
  let s = (text || '').split(tag).join(keep)
  for (const re of LIVE_ACTION_BAN) s = s.replace(re, '')
  return tidyPrompt(s.split(keep).join(tag))
}

/**
 * Lock the prompt to the project style: drop any 「风格：…」 sentence and contradicting phrases,
 * then put `风格：<styleTag>` exactly once (before 限制：, else at the end). Non-真人 styles: unchanged.
 */
export function lockPromptStyle(prompt: string, style: ArtStyle | string, genre = ''): { text: string; drifted: boolean } {
  if (style !== '真人都市') return { text: prompt || '', drifted: false }
  const tag = styleLine(style, genre)
  const drifted = hasStyleDrift(prompt, style, genre)
  let s = (prompt || '').split(tag).join('')
  s = s.replace(/风格\s*[：:][^。\n]*[。\n]?/g, '')
  for (const re of LIVE_ACTION_BAN) s = s.replace(re, '')
  s = tidyPrompt(s)
  // exactly one 「风格：」 styleTag sentence
  s = ensureSinglePrefixedClause(s, '风格：', `风格：${tag}。`, { replace: true })
  return { text: tidyPrompt(s), drifted }
}

// ---------------- time of day ----------------

const DAY_TOD = /^(清晨|早上|早晨|上午|中午|白天|日间|下午|午后|[0-9一二三四五六七八九十]+点)/
const NIGHT_WORD = /(冷蓝夜色|夜戏|夜景|夜色|夜空|夜光|夜风|月光|深夜|半夜|夜晚|夜里|夜间|晚上|(?<![昨前今一熬整通守])夜(?![宵市]))/g
export const NIGHT_PROMPT_RE = /(夜戏|夜景|深夜|夜色|夜空)/
/** Normalised daytime word for a timeOfDay label; null when the label is not daytime. */
export function dayWord(timeOfDay: string | undefined | null): string | null {
  const t = (timeOfDay || '').trim()
  if (!t || /(夜|晚|黄昏|傍晚)/.test(t) || !DAY_TOD.test(t)) return null
  if (/^清晨/.test(t)) return '清晨'
  if (/^(早上|早晨|[0-9一二三四五六七八九十]+点)/.test(t)) return '早晨'
  if (/^上午/.test(t)) return '上午'
  return '白天'
}
/** Rewrite night light/time words in non-constraint clauses to the daytime word. */
export function fixTimeWords(text: string, word: string): string {
  const morning = word === '清晨' || word === '早晨'
  const map: Record<string, string> = {
    冷蓝夜色: morning ? '清冷晨光' : '明亮天光',
    夜戏: `${word}戏`,
    夜景: morning ? '晨景' : '日景',
    夜色: morning ? '晨光' : '天光',
    夜空: '天空',
    夜光: morning ? '晨光' : '天光',
    夜风: morning ? '晨风' : '微风',
    月光: morning ? '晨光' : '日光',
  }
  return mapClauses(text, (c) => c.replace(NIGHT_WORD, (m) => map[m] ?? word))
}
/** Night words remain in a non-constraint clause. */
export function hasNightConflict(text: string): boolean {
  let hit = false
  mapClauses(text, (c) => {
    if (NIGHT_PROMPT_RE.test(c)) hit = true
    return c
  })
  return hit
}

// ---------------- logo / badge text triggers ----------------

const LOGO_WORD = /(刺绣标|刺绣logo|刺绣字|小刺绣|胸口标|胸标|校徽|徽章|徽标|logo|LOGO|Logo|商标|字样|印字|字母印花)/
/** Strip logo/校徽/刺绣标/字样 phrases (parenthesised notes and list items). */
export function stripLogoText(text: string): string {
  let s = text || ''
  s = s.replace(/[（(][^（）()]*[）)]/g, (m) => (LOGO_WORD.test(m) ? '' : m))
  // list items / clauses: split by 、，；
  const parts = s.split(/([，,、；;。\n])/)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const c = parts[i]
    const sep = parts[i + 1] ?? ''
    if (LOGO_WORD.test(c) && !/^\s*限制\s*[：:]/.test(c) && !c.includes(NO_BADGE_CONSTRAINT.slice(0, 6))) {
      // keep a field label like 「服装：」 and inline nouns (左胸校徽 inside a longer clause → drop the logo bit)
      const label = c.match(/^\s*[^：:]{1,8}[：:]/)?.[0] ?? ''
      const rest = c.slice(label.length)
      const cut = rest
        .replace(/(?:左胸|右胸|胸口|胸前|袖口|领口|背后)?(?:的)?(?:小)?(?:刺绣标|刺绣logo|刺绣字|小刺绣|胸口标|胸标|校徽|徽章|徽标|logo|LOGO|Logo|商标|字样|印字|字母印花)/g, '')
        .replace(/(无|没有|不带)(?=[^\u4e00-\u9fff]|$|的)/g, '')
        .replace(/[与和及配带有、]+$/, '')
        .trim()
      if (label + cut) out.push(label + cut + sep)
      else if (out.length) {
        // dropped item: take over its separator (「…双白条、左胸校徽；」→「…双白条；」)
        out[out.length - 1] = out[out.length - 1].replace(/[，,、；;]$/, '') + (i === 0 ? '' : sep)
      }
      continue
    }
    out.push(c + sep)
  }
  return tidyPrompt(out.join(''))
}

// ---------------- merge to 5–9 s segments ----------------

export interface DialogueLineOut {
  speaker: string | null
  speakerName: string | null
  text: string
  /** heard off-screen (bit part / OS) */
  voiceOnly?: boolean
}

const PLACES = [
  '别墅', '旧楼', '老楼', '对窗', '巷', '卧室', '客厅', '厨房', '浴室', '卫生间', '洗手间', '书房', '阳台', '天台', '楼顶', '楼道', '楼梯',
  '教室', '走廊', '操场', '球场', '体育馆', '食堂', '小卖部', '奶茶店', '便利店', '超市', '校门', '校园', '图书馆', '办公室', '宿舍', '讲台',
  '公交', '地铁', '车内', '车里', '街', '马路', '商场', '医院', '公园', '江边', '咖啡', '餐厅', '电梯', '大堂', '门口',
]
const PLACE_ALIAS: Record<string, string> = { 老楼: '旧楼', 楼顶: '天台', 洗手间: '卫生间', 车里: '车内' }
/** Place tokens of a shot: scene header of the prompt (before 主体); first visual clause only when the header names no place. */
export function placeKeys(s: Pick<VideoPipelineShot, 'prompt' | 'visual'>): string[] {
  const pick = (blob: string) => [...new Set(PLACES.filter((k) => blob.includes(k)).map((k) => PLACE_ALIAS[k] || k))]
  const p = (s.prompt || '').replace(/竖屏9:16[，,。]?/g, '')
  const k = p.search(/主体\s*[：:]/)
  const head = k >= 0 && k <= 40 ? p.slice(0, k) : p.split(/[。\n]/)[0].slice(0, 40)
  const h = pick(head)
  return h.length ? h : pick((s.visual || '').split(/[：:。；，]/)[0])
}
function bigrams(t: string): Set<string> {
  const a = Array.from((t || '').replace(/[\s，。；：、,.;:!?！？「」『』“”（）()]/g, ''))
  const out = new Set<string>()
  for (let i = 0; i + 1 < a.length; i++) out.add(a[i] + a[i + 1])
  return out
}
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (!A.size && !B.size) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter || 1)
}

type Unit = { shots: VideoPipelineShot[]; dur: number }

const baseId = (s: VideoPipelineShot) => s.segment?.parentId ?? s.id
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
/** Effective scene places (shots without a place header inherit the last named place of the same time-of-day run). */
const scenePlaces = new WeakMap<VideoPipelineShot, string[]>()
export function assignScenePlaces(list: VideoPipelineShot[]): void {
  let last: string[] = []
  let tod: string | undefined
  for (const s of list) {
    if ((s.timeOfDay || '') !== (tod || '')) last = []
    tod = s.timeOfDay
    const k = placeKeys(s)
    if (k.length) last = k
    scenePlaces.set(s, k.length ? k : last)
  }
}
/** Two places in view of each other (对窗 / 隔窄巷 / 越窗 / 对街): a cross-cut may be fused into one two-window segment. */
const BRIDGE_RE = /(对窗|窗对窗|对面的?窗|对面楼|对街|隔着?窄巷|越窄巷|越窗|两窗|双窗)/
const bridgeText = (s: VideoPipelineShot) => `${s.visual || ''} ${s.camera || ''} ${(s.prompt || '').split(/限制\s*[：:]/)[0]}`
/** 'same' = same place (or insert shot), 'bridge' = facing places (对窗 cross-cut), false = different places. */
export function placeRelation(
  a: VideoPipelineShot,
  b: VideoPipelineShot,
  keysOf: (s: VideoPipelineShot) => string[] = (s) => scenePlaces.get(s) ?? placeKeys(s),
): 'same' | 'bridge' | false {
  if (baseId(a) === baseId(b)) return 'same'
  const A = keysOf(a)
  const B = keysOf(b)
  const ca = a.characterIds
  const cb = b.characterIds
  if (A.length && B.length ? A.some((k) => B.includes(k)) : !ca.length || !cb.length || ca.some((x) => cb.includes(x))) return 'same'
  return BRIDGE_RE.test(bridgeText(a)) || BRIDGE_RE.test(bridgeText(b)) ? 'bridge' : false
}
function shotsCompatible(a: VideoPipelineShot, b: VideoPipelineShot): boolean {
  if ((a.timeOfDay || '') !== (b.timeOfDay || '')) return false
  return placeRelation(a, b) === 'same'
}
function shotsBridgeable(a: VideoPipelineShot, b: VideoPipelineShot): boolean {
  return (a.timeOfDay || '') === (b.timeOfDay || '') && placeRelation(a, b) !== false
}
/** Near-identical consecutive shots (same parent split, or same visual & cast). */
export function isNearDuplicate(a: VideoPipelineShot, b: VideoPipelineShot): boolean {
  if (!shotsCompatible(a, b) || !sameSet(a.characterIds, b.characterIds)) return false
  if (a.dialogue && b.dialogue) return false
  const v = textSimilarity(a.visual, b.visual)
  return v >= 0.9 || (baseId(a) === baseId(b) && v >= 0.6)
}

/** DP penalty when fusing different solo characters into a 2-shot (prefer single-character segments) */
const CAST_MIX_COST = 1
const snap = (x: number) => Math.round(x * 2) / 2
const castOf = (shots: VideoPipelineShot[]) => [...new Set(shots.flatMap((s) => s.characterIds))]

/** Labelled sentence content (主体/表演/环境/光线/限制…) from a prompt. */
function clause(prompt: string, label: RegExp): string {
  const m = (prompt || '').match(new RegExp(`(?:^|[。\\n])\\s*(?:${label.source})\\s*[：:]([^。\\n]*)`))
  return m ? m[1].trim() : ''
}
const uniqJoin = (xs: string[], sep: string) => [...new Set(xs.map((x) => (x || '').trim()).filter(Boolean))].join(sep)
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

/** Beat-sequence prompt for a merged segment. */
function mergedPrompt(shots: VideoPipelineShot[], durs: number[], total: number, nameOf: (id: string) => string): string {
  const first = shots[0]
  const bridged = shots.some((s, i) => i > 0 && placeRelation(shots[i - 1], s) === 'bridge')
  const scene = (first.prompt || '').split(/主体\s*[：:]/)[0].replace(/竖屏9:16[，。]?/g, '').replace(/[，。\s]+$/, '').trim()
  // one subject description per cast (first wins)
  const subjSeen = new Set<string>()
  const subj = uniqJoin(
    shots.map((s) => {
      const k = [...s.characterIds].sort().join(',')
      if (subjSeen.has(k)) return ''
      subjSeen.add(k)
      return clause(s.prompt, /主体/)
    }),
    '；',
  )
  const scale = total / (durs.reduce((a, b) => a + b, 0) || 1)
  let t = 0
  const beats = shots.map((s, i) => {
    const a = t
    t = i === shots.length - 1 ? total : snap(t + durs[i] * scale)
    const act = (s.action || clause(s.prompt, /动作/) || s.visual || '').replace(/[。；;\s]+$/, '')
    const who = s.dialogue ? (s.speaker ? nameOf(s.speaker) : '') : ''
    const talk = s.dialogue ? (who && s.characterIds.includes(s.speaker || '') ? `（${who}开口说台词）` : '（画外人声）') : ''
    const perf = clause(s.prompt, /表演/)
    return `${fmt(a)}–${fmt(t)}s${i ? '随后' : ''}${act}${talk}${perf ? `，表演：${perf.replace(/[。；;]+$/, '')}` : ''}`
  })
  const cams = uniqJoin(shots.map((s) => s.camera), '，随后')
  const env = uniqJoin(shots.flatMap((s) => clause(s.prompt, /环境陈设|环境|场景/).split(/[、；;]/)), '、')
    .split('、')
    .slice(0, 10)
    .join('、')
  const light = shots.map((s) => clause(s.prompt, /光线/)).find(Boolean) || ''
  const cast = castOf(shots).length
  const limits = uniqJoin(
    shots
      .flatMap((s) => clause(s.prompt, /限制/).split(/[，,；;]/))
      .filter((x) => !/主动作只有|只有一句台词|单主动作|无台词/.test(x))
      .filter((x) => cast < 2 || !/单人/.test(x))
      .filter((x) => !cast || !/无人物/.test(x))
      .filter((x, i, arr) => !arr.some((y, j) => j !== i && y.trim() !== x.trim() && y.includes(x.trim()) && x.trim().length >= 3)),
    '，',
  )
  const raw = tidyPrompt(
    [
      '竖屏9:16。',
      scene ? `${scene}。` : '',
      bridged ? '构图：两处隔窄巷相望的对窗空间，越窗长焦在两窗之间切换视角（同一时空的对切），两人始终各在自己窗内。' : '',
      subj ? `主体：${subj}。` : '',
      `时间轴（一镜${fmt(total)}秒，小节拍）：${beats.join('；')}。`,
      `镜头：${cams || first.camera}。`,
      env ? `环境陈设：${env}。` : '',
      light ? `光线：${light}。` : '',
      limits ? `限制：${limits}。` : '',
    ].join(''),
  )
  // at most one 光线： (and style is re-locked after merge)
  return ensureSinglePrefixedClause(raw, '光线：', light ? `光线：${light}` : '')
}

function mergeUnit(shots: VideoPipelineShot[], minSec: number, maxSec: number, nameOf: (id: string) => string, usedIds: Set<string>): VideoPipelineShot {
  if (shots.length === 1) {
    const s = shots[0]
    const d = s.durationSec < minSec ? minSec : s.durationSec
    // leave sceneId unset — applySceneContinuity assigns with episode place fall-forward
    return d === s.durationSec ? s : { ...s, durationSec: d, prompt: s.prompt.replace(/时间轴[：:][^。]*。/g, '') }
  }
  const first = shots[0]
  const durs = shots.map((s) => s.durationSec)
  const total = Math.min(maxSec, Math.max(minSec, snap(durs.reduce((a, b) => a + b, 0))))
  let id = baseId(first)
  for (let k = 1; usedIds.has(id); k++) id = `${baseId(first)}-m${k}`
  const lines: DialogueLineOut[] = []
  for (const s of shots) {
    const ls = (s as VideoPipelineShot & { dialogueLines?: DialogueLineOut[] }).dialogueLines
    if (ls?.length) lines.push(...ls)
    else if (s.dialogue)
      lines.push({ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue, ...(s.speakerOffscreen ? { voiceOnly: true } : {}) })
  }
  const p0 = lines[0]
  const out: VideoPipelineShot = {
    ...first,
    id,
    characterIds: castOf(shots),
    prompt: mergedPrompt(shots, durs, total, nameOf),
    visual: uniqJoin(shots.map((s) => (s.visual || '').replace(/[。；;\s]+$/, '')), '；'),
    action: uniqJoin(shots.map((s) => (s.action || '').replace(/[。；;\s]+$/, '')), '；随后'),
    durationSec: total,
    dialogue: p0 ? p0.text : '',
    speaker: p0 ? p0.speaker : null,
    speakerName: p0 ? p0.speakerName : null,
    voiceOnly: [...new Set(shots.flatMap((s) => s.voiceOnly))],
    sfx: [...new Set(shots.flatMap((s) => s.sfx))],
    overlayText: [...new Set(shots.flatMap((s) => s.overlayText))],
    camera: uniqJoin(shots.map((s) => s.camera), '，随后'),
    emotion: uniqJoin(shots.map((s) => s.emotion), '→'),
    refImage: shots.find((s) => s.refImage)?.refImage ?? null,
    mergedFrom: shots.flatMap((s) => s.mergedFrom ?? [s.id]),
  }
  delete out.segment
  delete out.speakerOffscreen
  delete out.dialogueLines
  if (p0?.voiceOnly) out.speakerOffscreen = true
  if (lines.length > 1) out.dialogueLines = lines
  // scene continuity: majority / first (skip unknown — let episode fall-forward fill);
  // crossed merges break carry later
  const sc = sceneFieldsForMerge(shots)
  if (sc.placeKey !== 'unknown') {
    out.sceneId = sc.sceneId
    out.sceneLabel = sc.sceneLabel
  }
  if (sc.crossed) (out as VideoPipelineShot & { _scenesCrossed?: boolean })._scenesCrossed = true
  return out
}

/**
 * Partition one episode into 5–9 s segments (DP): consecutive, same timeOfDay + compatible place, ≤2 cast, sum ≤ max.
 * Near-duplicates are fused first. Groups that stay < min are extended to min.
 */
export function mergeEpisodeShots(
  list: VideoPipelineShot[],
  opts: { minSec?: number; maxSec?: number; nameOf?: (id: string) => string } = {},
): VideoPipelineShot[] {
  const minSec = opts.minSec ?? SEGMENT_MIN_SEC
  const maxSec = opts.maxSec ?? SEGMENT_MAX_SEC
  const nameOf = opts.nameOf ?? ((id: string) => id)
  assignScenePlaces(list)
  // 1) dedupe
  const units: Unit[] = []
  for (const s of list) {
    const last = units[units.length - 1]
    if (last && last.dur + s.durationSec <= maxSec + 1e-9 && isNearDuplicate(last.shots[last.shots.length - 1], s)) {
      last.shots.push(s)
      last.dur += s.durationSec
    } else units.push({ shots: [s], dur: s.durationSec })
  }
  // 2) DP partition
  const n = units.length
  const best = new Array<number>(n + 1).fill(Infinity)
  const prev = new Array<number>(n + 1).fill(-1)
  best[0] = 0
  const target = (minSec + maxSec) / 2 - 0.5
  for (let j = 1; j <= n; j++) {
    let bridges = 0
    for (let i = j - 1; i >= 0; i--) {
      const grp = units.slice(i, j)
      const dur = grp.reduce((a, u) => a + u.dur, 0)
      if (j - i > 1) {
        if (dur > maxSec + 1e-9) break
        const x = units[i].shots[units[i].shots.length - 1]
        const y = units[i + 1].shots[0]
        if (!shotsBridgeable(x, y)) break
        if (!shotsCompatible(x, y)) bridges++
        if (castOf(grp.flatMap((u) => u.shots)).length > 2) break
        const speakers = new Set(grp.flatMap((u) => u.shots).filter((s) => s.dialogue).map((s) => s.speaker ?? s.speakerName))
        if (speakers.size > 2) break
      }
      let cost = (dur < minSec - 1e-9 ? 10 + (minSec - dur) * 2 : Math.abs(dur - target) * 0.3) + bridges * 2.5 + (castOf(grp.flatMap((u) => u.shots)).length > Math.max(...grp.map((u) => castOf(u.shots).length)) ? CAST_MIX_COST : 0)
      // prefer action/line → following reaction (no dialogue) staying together
      const nx = units[j]
      if (nx && !nx.shots[0].dialogue && j - i >= 1 && nx.dur < minSec && grp[grp.length - 1].shots.some((s) => s.dialogue || s.action)) cost += 0.6
      if (best[i] + cost < best[j]) {
        best[j] = best[i] + cost
        prev[j] = i
      }
    }
  }
  const groups: VideoPipelineShot[][] = []
  for (let j = n; j > 0; j = prev[j]) groups.unshift(units.slice(prev[j], j).flatMap((u) => u.shots))
  const used = new Set<string>()
  return groups.map((g) => {
    const m = mergeUnit(g, minSec, maxSec, nameOf, used)
    used.add(m.id)
    return m
  })
}

// ---------------- whole-export pass ----------------

export interface PostProcessStats {
  styleDrift: number
  timeFixed: number
  logoStripped: number
  offscreen: number
  mergedGroups: number
  extendedToMin: number
}

/** Re-apply all deterministic post-processing to an export (pure; returns a new export). */
export function postProcessExport(exp: VideoPipelineExport, opts: PostProcessOptions = {}): VideoPipelineExport {
  return postProcessExportWithStats(exp, opts).exp
}
export function postProcessExportWithStats(
  exp: VideoPipelineExport,
  opts: PostProcessOptions = {},
): { exp: VideoPipelineExport; stats: PostProcessStats } {
  const style = exp.project.style
  const genre = opts.genre ?? ''
  const minSec = opts.segmentMinSec ?? SEGMENT_MIN_SEC
  const maxSec = opts.segmentMaxSec ?? SEGMENT_MAX_SEC
  const stats: PostProcessStats = { styleDrift: 0, timeFixed: 0, logoStripped: 0, offscreen: 0, mergedGroups: 0, extendedToMin: 0 }
  const chars = exp.characters
  const nameOf = (id: string) => {
    const c = chars.find((x) => x.id === id)
    return c ? c.baseName || c.name : id
  }
  const offNames = new Set<string>()
  // inferred daytime from old time_conflict warnings (dayState carry-forward when shot has no timeOfDay)
  const warnDay = new Map<string, string>()
  for (const w of exp.warnings) if (w.code === 'time_conflict' && w.shotId) warnDay.set(w.shotId, w.message.match(/「([^」]+)」/)?.[1] || '白天')
  const driftEp = new Map<number, string[]>()

  // 1) per-shot sanitize
  let shots: VideoPipelineShot[] = exp.shots.map((s0) => {
    const s: VideoPipelineShot = { ...s0 }
    // off-list bit-part speaker → off-screen voice, not depicted
    const offlist = Boolean(s.dialogue && !s.speaker && s.speakerName)
    let prompt = s.prompt || ''
    if (s.dialogueLines?.length) s.dialogueLines = s.dialogueLines.map((l) => (!l.speaker && l.speakerName ? { ...l, voiceOnly: true } : l))
    const extras = [...(offlist ? [s.speakerName!] : []), ...(s.dialogueLines || []).filter((l) => !l.speaker && l.speakerName).map((l) => l.speakerName!)]
    if (extras.length) {
      if (offlist) s.speakerOffscreen = true
      for (const nm of extras) offNames.add(nm)
      prompt = mapClauses(prompt, (c) => (extras.some((nm) => c.includes(nm)) ? '' : c))
      prompt = addConstraint(tidyPrompt(prompt), OFFSCREEN_VOICE_CONSTRAINT)
      stats.offscreen++
    }
    // logo / badge text triggers
    const pl = stripLogoText(prompt)
    const vl = stripLogoText(s.visual)
    if (pl !== tidyPrompt(prompt) || vl !== tidyPrompt(s.visual)) stats.logoStripped++
    prompt = pl
    s.visual = vl
    s.action = stripLogoText(s.action)
    if (s.characterIds.length) prompt = addConstraint(prompt, NO_BADGE_CONSTRAINT)
    // time of day
    const w = dayWord(s.timeOfDay) ?? dayWord(warnDay.get(s.id))
    if (w) {
      const fixed = fixTimeWords(prompt, w)
      const fv = fixTimeWords(s.visual, w)
      if (fixed !== prompt || fv !== s.visual) stats.timeFixed++
      prompt = fixed
      s.visual = fv
    }
    // style lock (exactly one 风格：) + at most one 光线：
    const st = lockPromptStyle(prompt, style, genre)
    s.visual = stripStyleDrift(s.visual, style, genre)
    s.action = stripStyleDrift(s.action, style, genre)
    if (st.drifted) {
      stats.styleDrift++
      driftEp.set(s.episode, [...(driftEp.get(s.episode) || []), s.id])
    }
    s.prompt = ensureSinglePrefixedClause(st.text, '光线：', '')
    return s
  })

  // 2) merge
  const idMap = new Map<string, string>()
  if (opts.mergeToSegments !== false) {
    const eps = [...new Set(shots.map((s) => s.episode))]
    const merged: VideoPipelineShot[] = []
    for (const ep of eps) {
      const list = shots.filter((s) => s.episode === ep)
      const out = mergeEpisodeShots(list, { minSec, maxSec, nameOf })
      for (const m of out) {
        for (const id of m.mergedFrom ?? [m.id]) idMap.set(id, m.id)
        if (m.mergedFrom && m.mergedFrom.length > 1) stats.mergedGroups++
        const rawSum = (m.mergedFrom ?? [m.id]).reduce((a, id) => a + (list.find((x) => x.id === id)?.durationSec || 0), 0)
        if (m.durationSec > rawSum + 1e-9) stats.extendedToMin++
        // merged prompt: re-lock style + constraints (exactly one style sentence)
        let p = m.prompt
        if (m.mergedFrom && m.mergedFrom.length > 1) {
          if (m.characterIds.length) p = addConstraint(p, NO_BADGE_CONSTRAINT)
          if (m.speakerOffscreen || m.dialogueLines?.some((l) => l.voiceOnly)) p = addConstraint(p, OFFSCREEN_VOICE_CONSTRAINT)
          p = lockPromptStyle(p, style, genre).text
          p = ensureSinglePrefixedClause(p, '光线：', '')
        }
        merged.push({ ...m, prompt: p })
      }
    }
    shots = merged
  }

  // 3) warnings: remap ids, recompute time_conflict / multi_character_shot / segment_duration, add style_drift
  const byId = new Map(shots.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const warnings: VideoPipelineWarning[] = []
  const push = (w: VideoPipelineWarning) => {
    const k = `${w.code}|${w.episode}|${w.shotId ?? ''}|${w.characterId ?? ''}|${w.code === 'speaker_offlist' || w.code === 'dialogue_too_long' ? w.message : ''}`
    if (seen.has(k)) return
    seen.add(k)
    warnings.push(w)
  }
  for (const w of exp.warnings) {
    if (['time_conflict', 'multi_character_shot', 'segment_duration', 'style_drift'].includes(w.code)) continue
    const shotId = w.shotId ? idMap.get(w.shotId) ?? w.shotId : undefined
    if (w.code === 'dialogue_too_long' && shotId) {
      const s = byId.get(shotId)
      const sec = s ? [s.dialogue, ...(s.dialogueLines || []).slice(1).map((l) => l.text)].join('') : ''
      if (s && pacedLen(sec) / 4.5 <= s.durationSec + 1e-9) continue
    }
    if (w.code === 'speaker_offlist') {
      push({ ...w, shotId, message: w.message.replace(/（仅字幕名）$/, '（已标为画外音 speakerOffscreen，不出镜）') })
      continue
    }
    push({ ...w, ...(shotId ? { shotId } : {}) })
  }
  for (const [ep, ids] of driftEp) {
    const n = exp.shots.filter((s) => s.episode === ep).length
    push({
      episode: ep,
      code: 'style_drift',
      message: `画风为「${style}」，但 ${ids.length}/${n} 镜原提示词写了 2D/日漫/赛璐璐 等画风；已替换为「${styleLine(style, genre)}」（重新生成分镜可根治）`,
    })
  }
  for (const s of shots) {
    const w = dayWord(s.timeOfDay) ?? (s.mergedFrom ?? [s.id]).map((id) => dayWord(warnDay.get(id))).find(Boolean)
    if (w && hasNightConflict(s.prompt))
      push({ episode: s.episode, shotId: s.id, code: 'time_conflict', message: `剧情时间为「${s.timeOfDay || w}」，提示词却写了夜景/夜戏（自动改写未能消除）` })
    if (s.characterIds.length >= 2)
      push({ episode: s.episode, shotId: s.id, code: 'multi_character_shot', message: `同框 ${s.characterIds.length} 个角色（建议单人镜头 / 过肩 / 正反打）` })
    const lo = opts.mergeToSegments === false ? 2 : minSec
    const hi = opts.mergeToSegments === false ? 10 : Math.max(maxSec, 10)
    if (s.durationSec < lo - 1e-9 || s.durationSec > hi + 1e-9)
      push({ episode: s.episode, shotId: s.id, code: 'segment_duration', message: `段时长 ${s.durationSec}s 超出 ${lo}–${hi}s` })
  }
  // order: episode then original order
  const order = new Map(shots.map((s, i) => [s.id, i]))
  warnings.sort((a, b) => a.episode - b.episode || (order.get(a.shotId ?? '') ?? -1) - (order.get(b.shotId ?? '') ?? -1))

  // export-only costume prompt without logo/badge triggers (character data untouched)
  const characters = exp.characters.map((c) => {
    const cp = stripLogoText(c.costume)
    return cp !== c.costume ? { ...c, costumePrompt: cp } : c
  })
  const settingFacts = exp.project.settingFacts || []
  const settingFactsByTier = exp.project.settingFactsByTier ?? tierSettingFacts(settingFacts)
  // scene continuity (sceneId / sceneLabel / carryFromPrev) — after merge so ids are final
  const withScene = applySceneContinuity(shots).map((s) => {
    if (!s.carryFromPrev) return s
    // Keep character.costume in the cast list; only stop re-locking pack wardrobe in the shot prompt.
    return { ...s, prompt: addConstraint(s.prompt || '', CARRY_WARDROBE_CONSTRAINT) }
  })
  return {
    exp: {
      ...exp,
      project: { ...exp.project, settingFacts, settingFactsByTier },
      characters,
      shots: withScene,
      warnings,
    },
    stats,
  }
}

function pacedLen(t: string): number {
  return (t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
}

