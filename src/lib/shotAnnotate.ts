/**
 * Renderer-facing per-shot annotations (every shot of every pack carries both):
 *
 *   framing: 'closeup_dialogue' | 'medium' | 'full'
 *     derived from `size` (first shot-size word of `camera` when size is empty) + on-screen dialogue:
 *     近景/特写 (incl. 中近景, 近景特写) with a non-voiceOnly line spoken by an on-screen cast member → closeup_dialogue;
 *     全景/大全景/中全景/远景 → full; everything else → medium. Never keyed on shot ids.
 *
 *   wardrobeState: { [characterId]: state }
 *     per character in characterIds, carried forward in pack order:
 *       1. base = character.wardrobeState, else refImage minus the `${characterKey}_` prefix (bai_x_glowup → glowup),
 *          else 'default';
 *       2. character.wardrobeTimeline [{ state, fromShotId? | fromEpisode? }] switches the state from that shot /
 *          the first shot of that episode on (split / merged children of fromShotId count as that shot);
 *       3. character.wardrobeCues [{ state, keywords[] }]: a keyword in the shot's visual/action text switches
 *          the state from that shot on.
 *     All show data lives in the character JSON; this module has no show strings.
 *
 * An optional `engine` field on a shot is passed through untouched. Pure + idempotent.
 */
import { rewriteNote, visualizePrompt } from './emotionVisual'
import { speechSec, type SpeechRate } from './dialogueTiming'
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { sha1Hex } from './hash'
import { autoVoices, withCharacterVoices, withLineVoices, type VoiceSpec } from './voice'

export type Framing = 'closeup_dialogue' | 'medium' | 'full' | 'empty'
export const FRAMINGS: Framing[] = ['closeup_dialogue', 'medium', 'full', 'empty']

export interface WardrobeTimelineEntry {
  state: string
  /** human-readable source text / reason (data or auto proposal) */
  evidence?: string
  /** proposed by proposeWardrobeTimelines (no hand data) — needs human review */
  autoProposed?: boolean
  /** state starts at this shot id (or its split / merged children) */
  fromShotId?: string
  /** state starts at the first shot of this episode */
  fromEpisode?: number
}
export interface WardrobeCue {
  state: string
  /** literal substrings searched in the shot's visual + action text */
  keywords: string[]
}
/** state → character-pack reference set (lora_materials/datasets/<refSet>); refSet null = no reference yet */
export interface WardrobeRef {
  refSet: string | null
  /** outfit text for this state (prompt subject); default: the character's costumePrompt / costume for its base state */
  costume?: string
  /** face / hair text for this state when it differs from visualLock */
  look?: string
  /** reference images carry no logo / badge / embroidery / text */
  logoFree?: boolean
  /** existing set to use until a dedicated one exists */
  fallbackRefSet?: string
  note?: string
}
export interface WardrobeMeta {
  id: string
  name?: string
  baseName?: string
  costume?: string
  costumePrompt?: string | null
  visualLock?: string
  age?: string | number
  role?: string
  tags?: string[]
  wardrobeRefs?: Record<string, WardrobeRef>
  refImage?: string | null
  characterKey?: string | null
  wardrobeState?: string
  wardrobeTimeline?: WardrobeTimelineEntry[]
  wardrobeCues?: WardrobeCue[]
}

const SIZE_RE = /大全景|中全景|全景|远景|中近景|近景特写|近景|中景|特写/
const CLOSE_RE = /近景|特写/
const FULL_RE = /全景|远景/

type ShotLike = Pick<VideoPipelineShot, 'size' | 'camera' | 'characterIds' | 'dialogue' | 'speaker' | 'voiceOnly' | 'dialogueLines' | 'speakerOffscreen'>

/** at least one line spoken on screen by a cast member (not voiceOnly / off-screen / narration) */
export function hasOnscreenDialogue(s: ShotLike): boolean {
  const cast = s.characterIds || []
  const vo = new Set(s.voiceOnly || [])
  const lines = s.dialogueLines?.length
    ? s.dialogueLines
    : s.dialogue?.trim()
      ? [{ speaker: s.speaker, text: s.dialogue, voiceOnly: s.speakerOffscreen }]
      : []
  return lines.some((l) => Boolean(l.text?.trim()) && !l.voiceOnly && Boolean(l.speaker) && cast.includes(l.speaker!) && !vo.has(l.speaker!))
}

/**
 * Characters actually on screen: characterIds minus voice-only cast members. A cast member listed in voiceOnly
 * (inner voice / heard off-screen) still counts as on screen when the shot's visual text names them.
 */
export function onscreenCast(s: ShotLike & { visual?: string }, chars: { id: string; name?: string; baseName?: string }[] = []): string[] {
  const vo = new Set(s.voiceOnly || [])
  const byId = new Map(chars.map((c) => [c.id, c]))
  return (s.characterIds || []).filter((id) => {
    if (!vo.has(id)) return true
    const c = byId.get(id)
    return [c?.name, c?.baseName].some((n) => n && (s.visual || '').includes(n))
  })
}

/**
 * empty: nobody on screen; closeup_dialogue: exactly ONE on-screen character, 近景/特写 size and an on-screen line;
 * 2+ characters are only medium / full; 全景/远景 → full; else medium.
 */
export function framingOf(s: ShotLike & { visual?: string }, chars: { id: string; name?: string; baseName?: string }[] = []): Framing {
  const on = onscreenCast(s, chars)
  if (!on.length) return 'empty'
  const size = (s.size || '').match(SIZE_RE)?.[0] || (s.camera || '').match(SIZE_RE)?.[0] || ''
  if (on.length === 1 && CLOSE_RE.test(size) && hasOnscreenDialogue(s)) return 'closeup_dialogue'
  if (FULL_RE.test(size)) return 'full'
  return 'medium'
}

// ---------------- seed ----------------

export { sha1Hex } from './hash'

/** stable render seed: first 31 bits of sha1(`${projectId}:${shotId}`); the runner retries with seed + attempt */
export function shotSeed(projectId: string, shotId: string): number {
  return parseInt(sha1Hex(`${projectId}:${shotId}`).slice(0, 8), 16) >>> 1
}

// ---------------- per-shot dialogue timing ----------------

export interface TimedLine {
  speaker: string | null
  speakerName: string | null
  text: string
  startSec: number
  endSec: number
  voiceOnly?: boolean
  /** TTS voice resolved from the speaker (characterKey inheritance) or project.voices; null = unresolved (error) */
  voice?: VoiceSpec | null
}
const r2 = (x: number) => Math.round(x * 100) / 100
const speechLen = (t: string) => Math.max(1, t.replace(/[\s，。！？、…—,.!?「」“”『』（）()]/g, '').length)

/**
 * The shot's OWN lines (split children already carry only theirs) with times relative to the shot: lines go to the
 * beat segments marked dialogue in order (several lines in one segment share it by length); without beat segments
 * the lines share the whole shot by length. voiceOnly: off-list speaker, speakerOffscreen or a voiceOnly id not on screen.
 */
export function timedDialogueLines(s: VideoPipelineShot, chars: WardrobeMeta[] = [], rate: Partial<SpeechRate> = {}): TimedLine[] {
  const raw = s.dialogueLines?.length
    ? s.dialogueLines
    : s.dialogue?.trim()
      ? [{ speaker: s.speaker, speakerName: s.speakerName, text: s.dialogue, voiceOnly: s.speakerOffscreen }]
      : []
  const on = new Set(onscreenCast(s, chars))
  const lines = raw.filter((l) => l.text?.trim())
  if (!lines.length) return []
  const total = s.durationSec || 0
  const segs = (s.beatSegments || []).filter((g) => g.dialogue)
  const slots: { start: number; end: number; idx: number[] }[] = segs.length ? segs.map((g) => ({ start: g.start, end: g.end, idx: [] })) : [{ start: 0, end: total, idx: [] }]
  lines.forEach((_, i) => slots[Math.min(i, slots.length - 1)].idx.push(i))
  const out: TimedLine[] = []
  for (const sl of slots) {
    // several lines in one segment share it by estimated speech (same estimator as the beat sizing / overrun check)
    const w = sl.idx.map((i) => speechSec(lines[i].text, rate) || speechLen(lines[i].text))
    const sum = w.reduce((a, b) => a + b, 0) || 1
    let t0 = sl.start
    sl.idx.forEach((i, k) => {
      const l = lines[i]
      const t1 = k === sl.idx.length - 1 ? sl.end : t0 + ((sl.end - sl.start) * w[k]) / sum
      const vo = Boolean(l.voiceOnly) || !l.speaker || !on.has(l.speaker)
      out.push({ speaker: l.speaker ?? null, speakerName: l.speakerName ?? null, text: l.text.trim(), startSec: r2(t0), endSec: r2(t1), ...(vo ? { voiceOnly: true } : {}) })
      t0 = t1
    })
  }
  return out
}

// ---------------- final prompt rules (every shot) ----------------

/** fixed last line of every shot prompt */
export const NO_TEXT_CONSTRAINT = '画面中没有任何文字、字幕、标志、水印或标签。'
export const CLOSEUP_CAMERA = '近景（胸口以上），正脸或三分之二侧脸'
/** angle / composition words that pull a dialogue close-up into a side or half-body shot */
export const HALF_BODY_ANGLE_WORDS = ['侧打', '侧拍', '侧身', '侧面', '侧向', '侧脸', '半侧', '斜侧', '半身', '过肩', '越肩', '背面', '背影', '背对']
const FRAMING_WORDS: Record<Framing, string> = {
  closeup_dialogue: `${CLOSEUP_CAMERA}，单人`,
  medium: '中景',
  full: '全景',
  empty: '空镜，画面中没有人物',
}
const SPEED_TAG_WORDS: Record<string, string> = { 快: '动作利落快速', 慢: '节奏放慢', 恢复常速: '恢复正常节奏' }

/** remove the lines this module appends (idempotent re-annotation) */
export function stripRenderLines(prompt: string): string {
  return (prompt || '')
    .split('\n')
    .filter((l) => !l.startsWith('景别：') && l.trim() !== NO_TEXT_CONSTRAINT)
    .join('\n')
    .replace(new RegExp(NO_TEXT_CONSTRAINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
    .trimEnd()
}

const SIZE_G = () => new RegExp(`(?:[手眼脸面嘴唇腿脚背胸颈头腰局]部|大|长焦|越窗)?(?:${SIZE_RE.source})`, 'g')
const tidyCamera = (parts: string[]) =>
  parts
    .map((x) => x.replace(/^[的、\s]+|[的、\s]+$/g, '').trim())
    .filter((x) => x && !/^(?:随后|然后|再|镜头|拍摄|取景|拍|打|的)$/.test(x))
    .filter((x, i, a) => a.indexOf(x) === i)

/** camera wording for a dialogue close-up: fixed size + face angle, no half-body / side angle words */
export function closeupCamera(cam: string): string {
  let c = cam
    .split(CLOSEUP_CAMERA)
    .join('')
    .replace(/正脸或三分之二侧脸|正脸/g, '')
    // size words incl. a body-part / 大 qualifier (手部特写, 大特写) and framing notes in brackets (（眼部与半张脸）)
    .replace(SIZE_G(), '')
    .replace(/[（(][^（）()]*(?:胸口|脸|眼|部|身)[^（）()]*[）)]/g, '')
  for (const w of HALF_BODY_ANGLE_WORDS) c = c.split(w).join('')
  return [CLOSEUP_CAMERA, ...tidyCamera(c.split(/[，,·；;]/))].filter((x, i, a) => a.indexOf(x) === i).join('，')
}

/** size words a camera line may use for each framing (solo); 2+ on-screen medium additionally needs a two-shot marker */
const FRAMING_SIZES: Record<'medium' | 'full', RegExp> = { medium: /^(?:中景|中近景)$/, full: /^(?:大全景|中全景|全景|远景)$/ }
const GROUP_RE = /双人|两人|三人|多人/

/**
 * Camera size words consistent with the framing (minimal): closeup → closeupCamera; empty → untouched; medium / full:
 * when a size word disagrees (近景 / 特写 in a medium shot, 中景 in a full shot) or a medium shot with 2+ people lacks a
 * two-shot marker, the first size word becomes the canonical one (中景 / 双人中景 / 全景 / 双人全景) and later size
 * words are dropped; angle and movement words stay. No size word: only a 2+ medium shot gets the canonical prefix.
 */
export function normalizeCamera(cam: string, framing: Framing, onscreen: number): string {
  cam = cam.replace(/^[，,、\s]+/, '')
  if (framing === 'closeup_dialogue') return closeupCamera(cam)
  if (framing === 'empty') return cam
  const group = onscreen >= 3 ? '多人' : onscreen === 2 ? '双人' : ''
  const canon = `${group}${framing === 'medium' ? '中景' : '全景'}`
  const sizes = cam.match(SIZE_G()) || []
  const needGroup = framing === 'medium' && Boolean(group) && !GROUP_RE.test(cam)
  if (!sizes.length) {
    if (!(framing === 'medium' && group)) return cam
    return GROUP_RE.test(cam) ? cam.replace(GROUP_RE, canon) : `${canon}，${cam}`.replace(/，$/, '')
  }
  const ok = sizes.every((x) => FRAMING_SIZES[framing].test(x)) && !(framing === 'medium' && group && sizes.some((x) => x !== '中景'))
  if (ok && !needGroup) return cam
  let first = true
  const c = cam
    .replace(GROUP_RE, '')
    .replace(/（胸口以上）|\(胸口以上\)/g, '')
    .replace(SIZE_G(), () => {
      if (!first) return ''
      first = false
      return canon
    })
  return tidyCamera(c.split(/[，,·；;]/)).join('，')
}

// ---------------- subject / contradiction rules ----------------

const NO_PERSON_RE = /无人物|空镜|没有人物|无人入画|不见人影|画面中无人/
const PERSON_RE = /(?<!其)他|她|少年|少女|男生|女生|男人|女人|男孩|女孩|学生|有人|人物|神情|表情|眼神|嘴角|开口|说话/
const PROTECTED_LINE = /^(?:风格|限制|光线|景别)[：:]|^画面中没有任何文字/
const GARMENT_WORDS = /夹克|卫衣|校服|衬衫|西装|T恤|外套|连衣裙|毛衣|风衣|大衣|睡衣|背心|制服|围裙|运动服|裙|裤|鞋/
const LOGO_PART = /校徽|标志|logo|Logo|LOGO|刺绣|印字|字样|胸标/

function ageOf(c: WardrobeMeta): number | null {
  const n = Number(String(c.age ?? '').match(/\d+/)?.[0])
  return Number.isFinite(n) && n > 0 ? n : null
}
function personNoun(c: WardrobeMeta): string {
  const f = /(女|她|少女|姑娘|女孩|女生)/.test(`${c.visualLock || ''} ${c.role || ''} ${(c.tags || []).join(' ')}`)
  const a = ageOf(c)
  if (a != null && a <= 19) return f ? '少女' : '少年'
  if (a != null && a < 30) return f ? '年轻女人' : '年轻男人'
  return f ? '女人' : '男人'
}

/**
 * One character's subject text for a shot, from the character pack only: look (wardrobeRefs[state].look, else
 * visualLock) + outfit for the shot's wardrobe state (wardrobeRefs[state].costume, else costumePrompt / costume when
 * the state is the base state). Names, logo / badge parts are removed. `note` is set when the state has no outfit text.
 */
export function castDescription(c: WardrobeMeta, state: string, allChars: WardrobeMeta[] = []): { text: string; note?: string } {
  const names = allChars.flatMap((x) => [x.name, x.baseName, (x.name || '').replace(/[（(][^）)]*[）)]/g, '')]).filter((n): n is string => Boolean(n && n.trim()))
  const ref = c.wardrobeRefs?.[state]
  const lookSrc = (ref?.look || c.visualLock || '').replace(/^[^：:，,]{0,12}[：:]/, '')
  const noun = personNoun(c)
  const look = lookSrc
    .split(/[，,；;、]/)
    .map((x) => x.trim().replace(new RegExp(`^(?:东亚)?${noun}`), ''))
    .filter((x) => x && !names.some((n) => x.includes(n)))
    .slice(0, 3)
  let note: string | undefined
  let wear = ref?.costume || ''
  if (!wear) {
    wear = c.costumePrompt || c.costume || ''
    if (state !== baseWardrobeState(c)) note = `${c.id} 状态 ${state} 无 wardrobeRefs.costume，暂用基础服装`
  }
  const outfit = wear
    .replace(/[（(][^（）()]*[）)]/g, (m) => (LOGO_PART.test(m) ? '' : m))
    .split(/[，,；;]/)
    .map((x) => x.trim())
    .filter((x) => x && !LOGO_PART.test(x) && !/^整体/.test(x))
    .slice(0, 3)
  const age = ageOf(c)
  const parts = [`${age ? `${age}岁` : ''}东亚${noun}`, ...look]
  if (outfit.length) parts.push(`穿${outfit.join('，')}（无任何标志）`)
  return { text: parts.join('，'), ...(note ? { note } : {}) }
}

/** 2+ on-screen characters: one subject line, each character described from their own data (never a shared outfit) */
export function multiSubjectLine(ids: string[], ws: Record<string, string>, chars: WardrobeMeta[], oldSubject = ''): { line: string; notes: string[] } {
  const byId = new Map(chars.map((c) => [c.id, c]))
  const notes: string[] = []
  // a zip state in the old subject belongs to the character whose garments that ；-piece names (most garment words)
  const ZIP = /前襟拉链(?:拉开|拉上|半开|敞开)|拉链(?:拉开|拉上|半开|敞开)/
  const zipPiece = oldSubject.split(/[；;]/).find((x) => ZIP.test(x)) || ''
  const zip = zipPiece.match(ZIP)?.[0]
  const garmentScore = (id: string) => {
    const c = byId.get(id)
    const words = `${c?.costumePrompt || c?.costume || ''}`.match(new RegExp(GARMENT_WORDS.source, 'g')) || []
    return words.filter((w) => zipPiece.includes(w)).length
  }
  const zipOwner = zip ? [...ids].sort((a, b) => garmentScore(b) - garmentScore(a))[0] : null
  const descs = ids.map((id) => {
    const c = byId.get(id)
    if (!c) return ''
    const d = castDescription(c, ws[id] || baseWardrobeState(c), chars)
    if (d.note) notes.push(d.note)
    let text = d.text
    if (zip && id === zipOwner && !text.includes(zip)) {
      // the shot's zip state goes right after this character's zip garment
      text = text.replace(/(拉链[^，；（]*?(?:夹克|外套|卫衣|开衫|上衣))/, `$1（${zip}）`)
    }
    return text
  })
  if (new Set(descs).size < descs.length) notes.push(`同框人物描述相同：${ids.join(',')}，请补充 wardrobeRefs.look / costume`)
  const count = ids.length === 2 ? '两人' : ids.length === 3 ? '三人' : `${ids.length}人`
  const order = ['其一', '其二', '其三', '其四', '其五']
  return { line: `主体：${count}同框，外形与服装各不相同——${descs.map((d, i) => `${order[i] || `其${i + 1}`}：${d}`).join('；')}。`, notes }
}

/** note prefix for a 他/她 the source does not resolve (beatPrompt writes it to beatTodo; copied to renderReview) */
export const UNCLEAR_PRONOUN_NOTE = '多人同框，「他/她」指代不明：'
/** a person descriptor the beat prompt uses for one of several on-screen characters (穿夹克的少年) */
export const PERSON_DESCRIPTOR = /穿[^，。；、\s]{1,8}?的(?:少年|少女|男生|女生|男人|女人|男孩|女孩|青年|学生|同学|人)/
/**
 * Clauses of a multi-person shot's timeline whose bare 他/她 has no descriptor earlier in the same segment
 * (the pronoun cannot be resolved by the reader / the video model).
 */
export function unclearPronouns(prompt: string): string[] {
  const out: string[] = []
  for (const line of prompt.split('\n')) {
    if (!BEAT_SEG.test(line)) continue
    const body = line.replace(/^[^：]*：/, '').split('；')[0]
    let seen = false
    for (const c of body.split(/[，,。]/)) {
      const d = c.search(PERSON_DESCRIPTOR)
      const p = c.search(/(?<![其吉利])[他她](?![们人乡处日])/)
      if (p >= 0 && !seen && (d < 0 || p < d)) out.push(c)
      if (d >= 0) seen = true
    }
  }
  return out
}

/** drop clauses that contradict the on-screen count (无人物 with people on screen / person words in an empty shot) */
export function dropContradictions(prompt: string, onscreen: number): { prompt: string; notes: string[] } {
  const notes: string[] = []
  const bad = onscreen > 0 ? NO_PERSON_RE : PERSON_RE
  const out = prompt.split('\n').map((line, li) => {
    if (PROTECTED_LINE.test(line)) return line
    // the beat header names the shot type (…，空镜无人物。)
    if (li === 0 && /^竖屏9:16，[\d.]+秒单镜/.test(line)) return line
    // tokens keep their separator; labelled sections 风格/限制/光线 inside a one-line prompt stay untouched
    const toks = line.match(/[^，,；;。]+[，,；;。]?/g) || []
    let guarded = false
    let changed = false
    const kept: string[] = []
    for (const tok of toks) {
      const lab = tok.match(/^\s*([^：:，。]{1,8})[：:]/)?.[1]
      if (lab) guarded = /^(?:风格|限制|光线|景别)$/.test(lab)
      const body = lab ? tok.replace(/^\s*[^：:，。]{1,8}[：:]/, '') : tok
      const text = body.replace(/[，,；;。]$/, '').trim()
      if (guarded || !text || !bad.test(text) || (onscreen === 0 && /没有人物|无人物|不出现人物/.test(text))) {
        kept.push(tok)
        continue
      }
      notes.push(`${onscreen > 0 ? '有人物入画，删去' : '空镜，删去人物描述'}：${text}`)
      changed = true
      const sep = tok.slice(-1)
      if (lab) kept.push(tok.slice(0, tok.length - body.length))
      // a dropped sentence end moves to the previous kept clause
      if (/[。；;]/.test(sep) && kept.length && /[，,]$/.test(kept[kept.length - 1])) kept[kept.length - 1] = kept[kept.length - 1].slice(0, -1) + sep
      else if (/[。；;]/.test(sep) && kept.length && /[：:]$/.test(kept[kept.length - 1])) kept.push(sep)
    }
    if (!changed) return line
    let nl = kept.join('').replace(/[，,]([。；;])/g, '$1').replace(/([：:])[，,]/g, '$1')
    if (BEAT_SEG.test(nl) && /秒，[^：]*：[。；]?$/.test(nl)) nl = nl.replace(/：[。；]?$/, '：画面静止，只有细微的光影与物件动态。')
    nl = nl.replace(/([：:])([。；])/g, '$1画面静止，只有细微的光影与物件动态$2')
    return nl
  })
  return { prompt: out.join('\n'), notes }
}
const BEAT_SEG = /^\d+(?:\.\d+)?–\d+(?:\.\d+)?秒，/

export interface RenderContext {
  /** characters on screen in this shot (onscreenCast) */
  onscreen: string[]
  wardrobeState: Record<string, string>
  chars: WardrobeMeta[]
}

/**
 * Every prompt: no 【】 tags (speed tags → words); with a context also one data-built subject per character when 2+
 * are on screen and no 无人物 / person contradictions; camera size words consistent with the framing; framing in
 * words; fixed no-text line. Idempotent. `notes` = review notes for what was changed.
 */
export function renderPrompt(prompt: string, framing: Framing, ctx?: RenderContext): { prompt: string; notes: string[] } {
  const notes: string[] = []
  let p = stripRenderLines(prompt)
  p = p.replace(/【(快|慢|恢复常速)】/g, (_m, k: string) => `，${SPEED_TAG_WORDS[k]}`).replace(/秒，，/g, '秒，')
  p = p.replace(/[【】]/g, '')
  // abstract emotion words / inner monologue / quotes would be drawn as text: visible action instead
  const vz = visualizePrompt(p)
  p = vz.prompt
  notes.push(...vz.rewrites.map(rewriteNote))
  const n = ctx ? ctx.onscreen.length : framing === 'empty' ? 0 : 1
  if (ctx && n >= 2) {
    p = p.replace(/主体[：:][^。\n]*。?/, (old) => {
      const r = multiSubjectLine(ctx.onscreen, ctx.wardrobeState, ctx.chars, old)
      notes.push(...r.notes)
      return r.line
    })
  }
  if (ctx) {
    const r = dropContradictions(p, n)
    p = r.prompt
    notes.push(...r.notes)
  }
  if (ctx && n >= 2) notes.push(...unclearPronouns(p).map((c) => `${UNCLEAR_PRONOUN_NOTE}${c}`))
  p = p.replace(/镜头[：:]([^。\n]*)/, (_m, cam: string) => `镜头：${normalizeCamera(cam, framing, n)}`)
  return { prompt: `${p}\n景别：${framingWords(framing, n)}。\n${NO_TEXT_CONSTRAINT}`, notes }
}
function framingWords(f: Framing, n: number): string {
  if (f === 'medium' && n >= 2) return `${n === 2 ? '双人' : '多人'}中景，${n === 2 ? '两人' : '多人'}同框`
  if (f === 'full' && n >= 2) return `${n === 2 ? '双人' : '多人'}全景，${n === 2 ? '两人' : '多人'}同框`
  return FRAMING_WORDS[f]
}

/** renderPrompt without context (tags, camera, framing words, no-text line) */
export function finalizePrompt(prompt: string, framing: Framing): string {
  return renderPrompt(prompt, framing).prompt
}

export function baseWardrobeState(c: WardrobeMeta | undefined): string {
  if (!c) return 'default'
  if (c.wardrobeState?.trim()) return c.wardrobeState.trim()
  const ref = (c.refImage || '').trim()
  const key = (c.characterKey || '').trim()
  if (ref && key && ref.startsWith(`${key}_`) && ref.length > key.length + 1) return ref.slice(key.length + 1)
  return 'default'
}

const startsAt = (s: VideoPipelineShot, id: string) => s.id === id || s.splitFrom === id || Boolean(s.mergedFrom?.includes(id)) || s.segment?.parentId === id

/** wardrobeState for every shot (pack order, carried forward per character id). */
export function wardrobeStates(shots: VideoPipelineShot[], chars: WardrobeMeta[]): Record<string, string>[] {
  const byId = new Map(chars.map((c) => [c.id, c]))
  const cur = new Map<string, string>()
  const doneTimeline = new Map<string, Set<number>>()
  return shots.map((s) => {
    const text = `${s.visual || ''}\n${s.action || ''}`
    for (const c of chars) {
      if (!cur.has(c.id)) cur.set(c.id, baseWardrobeState(c))
      const done = doneTimeline.get(c.id) || new Set<number>()
      doneTimeline.set(c.id, done)
      ;(c.wardrobeTimeline || []).forEach((e, i) => {
        if (done.has(i) || !e?.state) return
        const hit = e.fromShotId ? startsAt(s, e.fromShotId) : e.fromEpisode != null ? s.episode >= e.fromEpisode : false
        if (hit) {
          done.add(i)
          cur.set(c.id, e.state)
        }
      })
      if ((s.characterIds || []).includes(c.id)) {
        for (const cue of c.wardrobeCues || []) if (cue?.state && (cue.keywords || []).some((k) => k && text.includes(k))) cur.set(c.id, cue.state)
      }
    }
    const out: Record<string, string> = {}
    for (const id of s.characterIds || []) out[id] = cur.get(id) ?? baseWardrobeState(byId.get(id))
    // a cast-corrected shot keeps the timeline state that implied the variant (this shot only)
    const cc = s.castCorrection
    if (cc && out[cc.to] != null && byId.get(cc.to)?.wardrobeRefs?.[cc.wardrobeState]) out[cc.to] = cc.wardrobeState
    return out
  })
}

// ---------------- auto-proposed wardrobe timeline (generic script cues) ----------------

/** garment / headwear nouns (generic vocabulary, longest first) */
const GARMENT = '白衬衫|衬衫|T恤|外套|夹克|卫衣|校服|睡衣|浴袍|浴巾|西装|连衣裙|裙子|毛衣|背心|假发|帽子|围巾|礼服|制服'
const GARMENT_RE = new RegExp(GARMENT, 'g')
/** change-of-clothes / transformation cues inside one clause */
const CHANGE_RES: RegExp[] = [
  new RegExp(`(?:新换的|刚换的|换上|换了|换成|穿上|套上|披上|戴上)[^，,。；;]{0,8}?(${GARMENT})`),
  new RegExp(`(?:脱下|脱掉|脱了)[^，,。；;]{0,6}?(${GARMENT})`),
  new RegExp(`(${GARMENT})[^。；;]{0,16}?(?:脱下|脱掉|搭在臂弯|扣在[^，,。；;]{0,3}头上|顶在头上)`),
  /(刚洗完澡|洗完澡|洗完头)/,
  /(变身|变回原样|换了一张脸|整个人变了样)/,
]
const CHANGE_VERB = /新换的|刚换的|换上|换成|穿上|套上|披上|戴上|脱下|脱掉|脱了|搭在臂弯|扣在[^，,。；;]{0,3}头上|顶在头上/
/** coarse time-of-day rank; a drop between consecutive shots = a new day (clothing changes reset) */
const DAY_RANK: [RegExp, number][] = [[/清晨|早|晨/, 0], [/上午/, 1], [/白天|中午|午间/, 2], [/下午/, 3], [/黄昏|傍晚/, 4], [/夜|晚/, 5]]
const dayRank = (tod?: string | null) => {
  for (const [re, r] of DAY_RANK) if (tod && re.test(tod)) return r
  return -1
}
const nameKeys = (c: WardrobeMeta) => [c.name, c.baseName].map((x) => (x || '').trim()).filter(Boolean)

export interface WardrobeProposal {
  characterId: string
  timeline: WardrobeTimelineEntry[]
}

/**
 * For every character WITHOUT wardrobeTimeline / wardrobeCues: propose a timeline from the script text.
 * A clause is about the character when it names them (name / baseName, and not only another cast member's full
 * name) or the shot is solo. Cue = change-of-clothes / transformation phrase → state `${base}:${garment|cue}`.
 * The proposed state resets to base on a new day (time-of-day drops between consecutive shots) or when a clause
 * about the character names a base-costume garment without a change cue. Every entry is autoProposed + evidence.
 */
export function proposeWardrobeTimelines(shots: VideoPipelineShot[], chars: WardrobeMeta[]): WardrobeProposal[] {
  const out: WardrobeProposal[] = []
  for (const c of chars) {
    if (c.wardrobeTimeline?.length || c.wardrobeCues?.length) continue
    const base = baseWardrobeState(c)
    const baseGarments = new Set((c.costume || '').match(GARMENT_RE) || [])
    const mine = nameKeys(c)
    const timeline: WardrobeTimelineEntry[] = []
    let cur = base
    let prevRank = -1
    for (const s of shots) {
      const r = dayRank(s.timeOfDay)
      const newDay = prevRank >= 0 && r >= 0 && r < prevRank
      if (r >= 0) prevRank = r
      if (newDay && cur !== base) {
        cur = base
        timeline.push({ state: base, fromShotId: s.id, autoProposed: true, evidence: `new day (timeOfDay → ${s.timeOfDay})` })
      }
      const cast = s.characterIds || []
      if (!cast.includes(c.id)) continue
      const others = chars.filter((o) => o.id !== c.id && cast.includes(o.id))
      const otherFull = others.map((o) => (o.name || '').trim()).filter((n) => n && !mine.includes(n))
      const otherBase = others.flatMap(nameKeys).filter((n) => !mine.includes(n))
      const solo = cast.length === 1
      const text = [s.visual, s.action, s.dialogue].filter(Boolean).join('。')
      for (const clause of text.split(/[；;。！？!?\n]/)) {
        const ownFull = Boolean(c.name && clause.includes(c.name))
        const namesMe = mine.some((n) => clause.includes(n)) && (ownFull || !otherFull.some((n) => clause.includes(n)))
        const namesOther = otherBase.some((n) => clause.includes(n))
        if (!(namesMe || (solo && !namesOther))) continue
        let cue = ''
        for (const re of CHANGE_RES) {
          const m = clause.match(re)
          if (m) {
            cue = m[1]
            break
          }
        }
        if (cue) {
          // a base-costume garment changed (taken off, carried…) → label by the change verb, not the garment
          const label = baseGarments.has(cue) ? clause.match(CHANGE_VERB)?.[0] || cue : cue
          const st = `${base}:${label}`
          if (st !== cur) {
            cur = st
            timeline.push({ state: st, fromShotId: s.id, autoProposed: true, evidence: clause.trim().slice(0, 60) })
          }
          break
        }
        if (cur !== base && [...baseGarments].some((g) => clause.includes(g))) {
          cur = base
          timeline.push({ state: base, fromShotId: s.id, autoProposed: true, evidence: clause.trim().slice(0, 60) })
          break
        }
      }
    }
    if (timeline.length) out.push({ characterId: c.id, timeline })
  }
  return out
}

/** characters with hand timelines untouched; others get their auto-proposed timeline (entries autoProposed: true) */
export function withProposedWardrobe(exp: VideoPipelineExport): { exp: VideoPipelineExport; proposals: WardrobeProposal[] } {
  const chars = exp.characters as WardrobeMeta[]
  const proposals = proposeWardrobeTimelines(exp.shots, chars)
  if (!proposals.length) return { exp, proposals }
  const byId = new Map(proposals.map((p) => [p.characterId, p.timeline]))
  return {
    exp: { ...exp, characters: exp.characters.map((c) => (byId.has(c.id) ? { ...c, wardrobeTimeline: byId.get(c.id) } : c)) },
    proposals,
  }
}

/**
 * Set `framing` + `wardrobeState` on every shot (engine and all other fields untouched).
 * Characters without hand wardrobe data first get an auto-proposed timeline (marked autoProposed).
 */
export function annotateShots(exp: VideoPipelineExport, opts: { speechRate?: Partial<SpeechRate> } = {}): VideoPipelineExport {
  const { exp: e0 } = withProposedWardrobe(exp)
  const e = { ...e0, characters: withCharacterVoices(e0.characters) }
  const chars = e.characters as WardrobeMeta[]
  const extraVoices = (e.project?.voices || {}) as Record<string, unknown>
  const auto = autoVoices(e.shots, e.characters, extraVoices, e.project?.id || e.project?.title || '')
  const ws = wardrobeStates(e.shots, chars)
  const pid = e.project?.id || e.project?.title || ''
  return {
    ...e,
    // auto voices of off-list speakers (review): lines carry voice + autoVoice: true
    ...(Object.keys(auto).length ? { autoVoices: auto } : {}),
    shots: e.shots.map((s, i) => {
      const framing = framingOf(s, chars)
      const onscreen = onscreenCast(s, chars)
      const r = renderPrompt(s.prompt, framing, { onscreen, wardrobeState: ws[i], chars })
      const cc = s.castCorrection
      if (cc) {
        // re-cast shot: the upstream subject text describes the replaced variant → solo subject from the pack data
        const c = chars.find((x) => x.id === cc.to)
        if (c && onscreen.length === 1 && onscreen[0] === cc.to) {
          const d = castDescription(c, ws[i][cc.to] || baseWardrobeState(c), chars)
          r.prompt = r.prompt.replace(/主体[：:][^。\n]*。/, `主体：${d.text}。`)
          if (d.note) r.notes.push(d.note)
        }
        r.notes.push(`选角按服装时间线由 ${cc.from} 改为 ${cc.to}（${cc.characterKey}，状态 ${cc.wardrobeState}）`)
      }
      // unresolved pronouns found by the beat prompt (source beat without a known actor), when still in the prompt
      const beatPron = (s.beatTodo || []).filter((x) => x.startsWith(UNCLEAR_PRONOUN_NOTE)).filter((x) => {
        const c = x.slice(UNCLEAR_PRONOUN_NOTE.length)
        const k = c.search(/[他她]/)
        return k >= 0 && r.prompt.includes(c.slice(k, k + 4))
      })
      const review = [...new Set([...r.notes, ...beatPron])]
      const out: VideoPipelineShot = {
        ...s,
        framing,
        wardrobeState: ws[i],
        seed: shotSeed(pid, s.id),
        dialogueLines: withLineVoices(timedDialogueLines(s, chars, opts.speechRate), e.characters, extraVoices, auto),
        audio: s.audio ?? null,
        prompt: r.prompt,
      }
      if (review.length) out.renderReview = review
      else delete out.renderReview
      return out
    }),
  }
}

/** per-character wardrobe review: base source, timeline source, states used, refs missing / not logo-free */
export function wardrobeReport(exp: VideoPipelineExport) {
  const used = new Map<string, Map<string, number>>()
  for (const s of exp.shots)
    for (const [id, st] of Object.entries(s.wardrobeState || {})) {
      const m = used.get(id) || new Map<string, number>()
      m.set(st, (m.get(st) || 0) + 1)
      used.set(id, m)
    }
  return Object.fromEntries(
    (exp.characters as WardrobeMeta[]).map((c) => {
      const tl = c.wardrobeTimeline || []
      const states = Object.fromEntries(used.get(c.id) || [])
      const refs = c.wardrobeRefs || {}
      return [
        c.id,
        {
          base: baseWardrobeState(c),
          baseSource: c.wardrobeState?.trim() ? 'data' : baseWardrobeState(c) === 'default' ? 'default' : 'refImage',
          timelineSource: !tl.length ? 'none' : tl.some((e) => e.autoProposed) ? 'auto-proposed (review)' : 'data',
          timeline: tl,
          states,
          missingRefs: Object.keys(states).filter((st) => !refs[st]?.refSet),
          notLogoFree: Object.keys(states).filter((st) => refs[st]?.refSet && refs[st].logoFree !== true),
        },
      ]
    }),
  )
}

/** Shot ids missing / with an invalid framing, wardrobeState, seed, dialogueLines or audio key (empty = ok). */
export function missingAnnotations(exp: VideoPipelineExport): string[] {
  const bad: string[] = []
  for (const s of exp.shots) {
    if (!s.framing || !FRAMINGS.includes(s.framing)) bad.push(`${s.id}: framing`)
    const w = s.wardrobeState
    if (!w || typeof w !== 'object' || (s.characterIds || []).some((id) => !w[id])) bad.push(`${s.id}: wardrobeState`)
    if (!Number.isInteger(s.seed) || s.seed! < 0 || s.seed! > 0x7fffffff) bad.push(`${s.id}: seed`)
    if (!Array.isArray(s.dialogueLines) || s.dialogueLines.some((l) => typeof (l as TimedLine).startSec !== 'number' || typeof (l as TimedLine).endSec !== 'number'))
      bad.push(`${s.id}: dialogueLines`)
    if (!('audio' in s) || (s.audio !== null && typeof s.audio !== 'string')) bad.push(`${s.id}: audio`)
    if (/[【】]/.test(s.prompt) || !s.prompt.endsWith(NO_TEXT_CONSTRAINT)) bad.push(`${s.id}: prompt`)
  }
  return bad
}

/** FreeVideo first frame takes ONE reference image: a 2+ person medium / full shot renders the others without a ref */
export const MULTI_REF_LIMITATION =
  'FreeVideo 首帧只接受一张参考图：多人镜当前只用第一个角色的定妆图，其余角色的一致性待角色 LoRA / 多参考图（后续）'

/** known limitations per shot: every medium / full shot with 2+ on-screen characters (generic, from framing + cast) */
export function knownLimitations(exp: VideoPipelineExport): { id: string; framing: Framing; onscreen: string[]; firstFrameRef: string; note: string }[] {
  const chars = exp.characters as WardrobeMeta[]
  return exp.shots
    .map((s) => ({ s, on: onscreenCast(s, chars) }))
    .filter(({ s, on }) => (s.framing === 'medium' || s.framing === 'full') && on.length >= 2)
    .map(({ s, on }) => ({ id: s.id, framing: s.framing!, onscreen: on, firstFrameRef: on[0], note: MULTI_REF_LIMITATION }))
}
