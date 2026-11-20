/**
 * Shot scale vs what the picture text asks the camera to show.
 *
 * A 近景/特写 can show a face, the chest, a hand and whatever that hand holds (松手, a glance that lands).
 * It cannot also ask for a full-body step, a gaze that travels a table or a room, or two places in one frame
 * (餐厅与楼梯口相连). Those sentences are what pull a close shot out to a full-body wide and a different room.
 * Wide / establishing shots keep them. No show-specific ids.
 */
export type ShotScale = 'close' | 'medium' | 'wide' | 'unknown'
export type ScaleMode = 'close' | 'medium' | 'off'

/** longest size word first so 中近景 is not read as 近景 and 中全景 is not read as 全景 */
export const SIZE_WORD_RE = /大远景|大全景|中全景|全景|远景|中近景|近景特写|大特写|近景|中景|特写/

const BODY_MOVE = /退半步|退一步|向后退|往后退|后退|退后|迈步|跨步|走过去|走过来|向前走|往前走|走开|走近|走向|走到|冲出去|冲出|冲向|跑向|跑开|站起来|站起身|站起|起身/
/** a look that travels a surface or a room — the camera follows and the frame opens up */
const GAZE_SWEEP = /(?:视线|目光|眼神)[^，。；\n、]{0,6}扫过(?:桌面|桌子|桌沿|房间|室内|餐厅|客厅|四周|全屋|地面|楼梯|门口|窗口|窗台|墙面|整面墙)/
/** two places that have to be in frame together */
const SPACE_LINK = /与[^，。；\n、]{1,16}(?:相连|连通|连在一起|连着)|(?:通向|通往)[^，。；\n、]{1,12}/
const PROTECTED_LINE = /^(?:风格|限制|景别|光线|镜头)[：:]/
const WIDEN_WORDS = ['拉成全身', '拉远', '半身', '过肩', '越肩', '全身']

export function sizeWord(text?: string): string | null {
  return (text || '').match(SIZE_WORD_RE)?.[0] ?? null
}

export function scaleOfWord(word: string | null): ShotScale {
  if (!word) return 'unknown'
  if (/近景|特写/.test(word)) return 'close'
  if (/全景|远景/.test(word)) return 'wide'
  return 'medium'
}

/** declared size wins; the camera line is the fallback when size is empty */
export function scaleOf(size?: string, camera?: string): ShotScale {
  return scaleOfWord(sizeWord(size) || sizeWord(camera))
}

/** 特写 stays a 特写; 中近景/近景 stay a chest-up 近景 */
export function closeWord(size?: string, camera?: string): '近景' | '特写' {
  const w = sizeWord(size) || sizeWord(camera) || ''
  return /特写/.test(w) ? '特写' : '近景'
}

/**
 * How hard the picture text must stay inside the frame.
 * full / unknown / wide: leave the text. solo close (one person, not an empty frame): drop body and gaze travel too.
 * every other non-wide shot: drop two-place layout only (a step is still visible in a 中景).
 */
export function promptScaleMode(framing: string, onscreen: number, size?: string, camera?: string): ScaleMode {
  if (framing === 'closeup' || framing === 'extreme_closeup' || framing === 'closeup_dialogue') return 'close'
  if (framing === 'medium_closeup') return 'medium'
  if (framing === 'full' || framing === 'empty') return 'off'
  const scale = scaleOf(size, camera)
  if (scale === 'wide' || scale === 'unknown') return 'off'
  // a pack that still says framing=medium on a one-person 近景/特写: treat the picture as close
  if (framing === 'medium' && scale === 'close' && onscreen === 1) return 'close'
  return 'medium'
}

/** Replace the shot-size word, leaving angle and movement. No size word: prefix `word`. */
export function lockSizeWord(cam: string, word: string): string {
  let c = cam || ''
  const re = new RegExp(SIZE_WORD_RE.source, 'g')
  if (!re.test(c)) c = `${word}，${c}`
  else {
    re.lastIndex = 0
    let first = true
    c = c.replace(re, () => {
      if (!first) return ''
      first = false
      return word
    })
  }
  return c.replace(/[，,]{2,}/g, '，').replace(/^[，,\s]+|[，,\s]+$/g, '')
}

export interface ScaleHit {
  kind: 'space' | 'gaze' | 'body'
  text: string
}

export interface ScaleTrim {
  text: string
  hits: ScaleHit[]
  /** clause kept because removing the move would leave no action (the generator must rewrite it) */
  kept: string[]
}

const negated = (clause: string, index: number) => /(?:没有|没|不|未)$/.test(clause.slice(Math.max(0, index - 3), index))

/** anything left that is still a visible action, not just a pronoun and an adverb */
function meaningful(s: string): boolean {
  const core = s.replace(/[0-9０-９\s，,。；;：:、（）()【】—\-–~～秒正常节奏动作放慢利落快速接着随后恢复他她它你我的了着过地得猛地一下一下子迅速慢慢轻轻并又再]/g, '')
  return core.length >= 1
}
/** a remaining in-frame action, so a trailing step / sweep can be lifted off without leaving a broken clause */
const STILL_ACTS = /松|握|抓|推|拉|按|摸|指|点|拿|放|抬|低|看|望|盯|眨|皱|笑|抿|说|张|挥|转头|侧头|点头|摇头|呼吸/

function stripPattern(clause: string, re: RegExp): { next: string; hits: string[] } | null {
  let next = clause
  const hits: string[] = []
  for (let i = 0; i < 4; i++) {
    const m = next.match(re)
    if (!m || m.index === undefined || negated(next, m.index)) break
    hits.push(m[0])
    next = next.slice(0, m.index) + next.slice(m.index + m[0].length)
  }
  if (!hits.length || !meaningful(next)) return null
  return { next, hits }
}

function tidyClause(s: string): string {
  return s.replace(/[、]{2,}/g, '、').replace(/^[、\s]+|[、\s]+$/g, '').replace(/(?:并且|然后|再|又|并)+$/g, '').replace(/^(?:并且|然后|再|又|并)+/g, '')
}

interface Piece {
  text: string
  sep: string
  /** a body-move clause with no other action; dropped when the line still has an action, otherwise kept whole */
  onlyMove?: string
}

function trimLine(line: string, mode: ScaleMode): { line: string; hits: ScaleHit[]; kept: string[] } {
  if (PROTECTED_LINE.test(line.trim())) return { line, hits: [], kept: [] }
  const ended = /。\s*$/.test(line)
  const bits = line.split(/([，,；;])/)
  const pieces: Piece[] = []
  const hits: ScaleHit[] = []
  for (let i = 0; i < bits.length; i += 2) {
    const clause = bits[i]
    const sep = bits[i + 1] ?? ''
    const raw = clause.trim().replace(/[。\s]+$/g, '')
    if (!raw) {
      pieces.push({ text: clause, sep })
      continue
    }
    const space = raw.match(SPACE_LINK)
    if (space && !negated(raw, space.index ?? 0)) {
      hits.push({ kind: 'space', text: raw })
      continue
    }
    if (mode === 'close') {
      let cur = clause
      let touched = false
      const g = cur.match(GAZE_SWEEP)
      if (g && g.index !== undefined && !negated(cur, g.index)) {
        const gaze = stripPattern(cur, GAZE_SWEEP)
        touched = true
        if (gaze && STILL_ACTS.test(gaze.next)) {
          hits.push(...gaze.hits.map((text) => ({ kind: 'gaze' as const, text })))
          cur = gaze.next
        } else {
          hits.push({ kind: 'gaze', text: g[0] })
          continue
        }
      }
      const b = cur.match(BODY_MOVE)
      if (b && b.index !== undefined && !negated(cur, b.index)) {
        const body = stripPattern(cur, BODY_MOVE)
        touched = true
        if (body && STILL_ACTS.test(body.next)) {
          hits.push(...body.hits.map((text) => ({ kind: 'body' as const, text })))
          cur = body.next
        } else {
          pieces.push({ text: tidyClause(cur), sep, onlyMove: raw })
          continue
        }
      }
      cur = tidyClause(cur)
      if (touched && !meaningful(cur)) continue
      pieces.push({ text: cur, sep })
      continue
    }
    pieces.push({ text: clause, sep })
  }
  const anchored = pieces.some((p) => !p.onlyMove && STILL_ACTS.test(p.text))
  const kept: string[] = []
  const keptParts: string[] = []
  for (const p of pieces) {
    if (p.onlyMove && anchored) {
      hits.push({ kind: 'body', text: p.onlyMove })
      continue
    }
    if (p.onlyMove) kept.push(p.onlyMove)
    if (p.text) keptParts.push(p.text + p.sep)
  }
  let out = keptParts.join('').replace(/[，,；;]{2,}/g, '，').replace(/^[，,；;\s]+/, '').replace(/[，,；;\s]+$/g, '')
  if (ended && out && !/[。！？]$/.test(out)) out += '。'
  const afterColon = out.split(/[：:]/).pop() || ''
  if ((hits.length || kept.length) && /秒/.test(line) && /[：:]/.test(line) && !meaningful(afterColon) && !STILL_ACTS.test(afterColon)) {
    return { line, hits: [], kept: [...hits.map((h) => h.text), ...kept] }
  }
  return { line: out, hits, kept }
}

/** Drop picture text the declared scale cannot show. Idempotent. `off` returns the text unchanged. */
export function trimOutOfScale(text: string, mode: ScaleMode): ScaleTrim {
  if (mode === 'off' || !text) return { text: text || '', hits: [], kept: [] }
  const hits: ScaleHit[] = []
  const kept: string[] = []
  const lines = text.split('\n').map((line) => {
    const r = trimLine(line, mode)
    hits.push(...r.hits)
    kept.push(...r.kept)
    return r.line
  })
  return { text: lines.filter((l) => l.trim()).join('\n'), hits, kept }
}

export function scaleTrimNotes(r: ScaleTrim): string[] {
  const notes: string[] = []
  for (const h of r.hits) {
    if (h.kind === 'space') notes.push(`景别外的空间关系不进画面：${h.text}`)
    else if (h.kind === 'gaze') notes.push(`景别外的扫视不进画面：${h.text}`)
    else notes.push(`景别外的身体位移不进画面：${h.text}`)
  }
  for (const k of r.kept) notes.push(`景别与动作冲突仍留在提示词：${k}`)
  return [...new Set(notes)]
}

/**
 * Apply a trim to one exported field. A field that would become empty is cleared only when it was layout / a sweep,
 * not when it was the shot's only body action (that action stays, and the note says so).
 */
export function applyScaleText(text: string, mode: ScaleMode): { text: string; notes: string[] } {
  if (mode === 'off' || !text) return { text: text || '', notes: [] }
  const r = trimOutOfScale(text, mode)
  const notes = scaleTrimNotes(r)
  if (!r.text.trim()) {
    if (r.kept.length || r.hits.some((h) => h.kind === 'body')) return { text, notes }
    return { text: '', notes }
  }
  return { text: r.text, notes }
}

const pictureText = (parts: (string | undefined)[]) =>
  parts
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter((l) => !PROTECTED_LINE.test(l.trim()))
    .join('\n')

/** Generator self-check: one detail string per conflict. Empty when the shot's scale and picture agree. */
export function scaleConflicts(s: {
  size?: string
  camera?: string
  visual?: string
  action?: string
  seedancePrompt?: string
  establishing?: boolean
}): string[] {
  const details: string[] = []
  const sw = sizeWord(s.size)
  const cw = sizeWord(s.camera)
  if (sw && cw && scaleOfWord(sw) !== scaleOfWord(cw)) details.push(`size「${sw}」与运镜「${cw}」不是同一景别档`)
  if (s.establishing && sw && scaleOfWord(sw) !== 'wide') details.push(`建立镜头 size「${sw}」应为远景或全景`)
  const scale = scaleOf(s.size, s.camera)
  if (scale === 'close' || scale === 'medium') {
    const r = trimOutOfScale(pictureText([s.visual, s.action, s.seedancePrompt]), scale)
    for (const h of r.hits) {
      details.push(
        h.kind === 'space'
          ? `非远景/全景写了两处空间「${h.text}」，只应写在建立镜头`
          : h.kind === 'gaze'
            ? `近景/特写放不下「${h.text}」，改成视线落点`
            : `近景/特写放不下身体位移「${h.text}」，改成画面内动作或改景别`,
      )
    }
    for (const k of r.kept) details.push(`近景/特写的动作「${k}」是全身位移，改成画面内动作或改景别`)
  }
  return [...new Set(details)]
}

function tidyCamera(cam: string): string {
  return cam
    .replace(/[，,]{2,}/g, '，')
    .replace(/^[，,\s]+|[，,\s]+$/g, '')
    .replace(/，+/g, '，')
}

/** Solo close shot: the camera line keeps the declared close word and drops moves that open the frame. */
export function lockCloseCamera(cam: string, size?: string, camera?: string): string {
  const word = closeWord(size, camera)
  let c = cam || ''
  for (const w of WIDEN_WORDS) c = c.split(w).join('')
  const re = new RegExp(SIZE_WORD_RE.source, 'g')
  if (!re.test(c)) c = `${word}，${c}`
  else {
    re.lastIndex = 0
    let first = true
    c = c.replace(re, () => {
      if (!first) return ''
      first = false
      return word
    })
  }
  return tidyCamera(c)
}

/** 景别 line for a solo close shot that is not a dialogue close-up (those keep their own chest-up guard). */
export function closeFramingWords(size?: string, camera?: string): string {
  const word = closeWord(size, camera)
  const lock = '保持这个景别，人物不出画，不把镜头外的另一处空间拍进来'
  return word === '特写' ? `特写，${lock}` : `近景（胸口以上），${lock}`
}
