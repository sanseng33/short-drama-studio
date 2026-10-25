/** 导出给视频流水线：pure builder for short-drama-studio/video-pipeline@1 (additive fields only). */
import type { Character, Project, Shot } from '../types'
import { mapNamesToIds, shotCharacterIds } from './shotCast'
import { cleanField, cleanPrompt } from './placeholder'
import { postProcessExport, type DialogueLineOut } from './segmentPost'
import { factsForShotPrompts, tierSettingFactsForPrompt, type SettingFactsByTier } from './settingFacts'

export const VIDEO_PIPELINE_SCHEMA = 'short-drama-studio/video-pipeline@1'
/** Dialogue pacing: Chinese chars (CJK + alnum) per second */
export const CHARS_PER_SEC = 4.5
export const MIN_SEG_SEC = 2
/** Allocation / borrow / split step (seconds); all segment durationSec are multiples of this (except episode remainder on last seg). */
export const DURATION_STEP = 0.5

export interface VideoPipelineShot {
  episode: number
  shotNo: number
  id: string
  /** onscreen characters only */
  characterIds: string[]
  prompt: string
  visual: string
  action: string
  durationSec: number
  /** '' when none; speaker prefix stripped */
  dialogue: string
  /** character id; null = narration / no dialogue */
  speaker: string | null
  /** display name for subtitles (baseName || name), null when speaker null */
  speakerName: string | null
  /** speakers heard offscreen, or 内心/心声/心想 (may overlap characterIds when onscreen) */
  voiceOnly: string[]
  sfx: string[]
  /** system UI / on-screen text — render in post, never by the video model */
  overlayText: string[]
  camera: string
  size: string
  emotion: string
  refImage: string | null
  /** scene time of day (from storyboard), when known */
  timeOfDay?: string
  /** present only when an original shot became several segments */
  segment?: { index: number; total: number; parentId: string }
  /** merged 5–9s segment: all dialogue lines in order (first = dialogue/speaker); present only when >1 line */
  dialogueLines?: DialogueLineOut[]
  /** primary speaker is an off-list bit part heard off-screen (never depicted) */
  speakerOffscreen?: boolean
  /** original shot/segment ids fused into this segment (mergeToSegments) */
  mergedFrom?: string[]
  /** stable place+time slug for FL2V chaining, e.g. villa_bedroom_night */
  sceneId?: string
  /** short Chinese label for humans, e.g. 江景别墅卧室·夜 */
  sceneLabel?: string
  /** true when this shot continues the previous shot (same episode + sceneId, not a hard cut) */
  carryFromPrev?: boolean
  /** optional storyboard location short tag (fed into scene classification when present) */
  location?: string
  /** 'speed' when the prompt was rewritten as per-second speed beats (opt-in beatMode) */
  beatMode?: 'speed'
  /** beat mode: the timeline segments of `prompt` (seconds, speed tag, dialogue/lip-sync flags) */
  beatSegments?: { start: number; end: number; speed: '快' | '慢' | '恢复常速'; dialogue: boolean; lipSync: boolean }[]
  /** beat mode: small hand-prop clauses dropped from the prompt (TODO: re-add in post if story-critical) */
  beatRemovedProps?: string[]
  /** beat mode: review notes where the beat split looked questionable */
  beatTodo?: string[]
  /** beats come from an explicit beatOverrides entry (hand-written), not the automatic split */
  beatOverride?: boolean
  /** main actions dropped by the beat action-density cap (快 ≤ 1, 慢/常速 ≤ 2, dialogue segment ≤ 1) */
  beatTrimmedActions?: string[]
  /** beat mode: the default (non-beat) prompt, kept for comparison / re-conversion */
  promptDefault?: string
  /** place slug of sceneId (sceneContinuity), e.g. villa_bedroom */
  placeKey?: string
  /** time band of sceneId (sceneContinuity), e.g. day */
  timeBand?: string
  /** opt-in splitCrossCut: id of the two-person cross-cut segment this solo child was split from */
  splitFrom?: string
  /**
   * opt-in splitCrossCut: camera-angle continuity key = `${sceneId}_${sorted characterIds joined '+' | 'empty'}`,
   * e.g. villa_bedroom_day_c2. Set on every shot of a split pack.
   */
  angleKey?: string
  /**
   * opt-in splitCrossCut: most recent earlier shot (output order) IN THE SAME EPISODE with the same angleKey;
   * null = first shot of that angleKey within its episode (chains never cross an episode boundary).
   * Runner rule (FL2V first frame):
   *  1. key present and a string → start from that shot's last frame (wins over carryFromPrev);
   *  2. key present and null → start from the character-pack ref image (ignore carryFromPrev);
   *  3. key absent (legacy pack) → carryFromPrev=true uses the previous shot's last frame, else the pack ref.
   * The carried frame is always the clean, silent, pre-LatentSync last frame of the source shot (never the lip-synced render).
   * carryFromPrev is kept unchanged on non-split shots for backward compat; on split children it is true only when
   * carryFromShotId is the immediately previous shot.
   */
  carryFromShotId?: string | null
  /** renderer framing (shotAnnotate.framingOf): closeup_dialogue = 近景/特写 + on-screen dialogue; set on every shot */
  framing?: 'closeup_dialogue' | 'medium' | 'full'
  /** characterId → wardrobe state (shotAnnotate.wardrobeStates, e.g. plain / glowup / default); set on every shot */
  wardrobeState?: Record<string, string>
  /** optional renderer engine hint; passed through untouched */
  engine?: string
}

export interface VideoPipelineWarning {
  episode: number
  shotId?: string
  characterId?: string
  code: 'dialogue_too_long' | 'segment_duration' | 'duration_remainder' | 'speaker_unresolved' | 'speaker_offlist' | 'multi_character_shot' | 'character_missing_costume' | 'character_missing_prop' | 'time_conflict' | 'style_mismatch' | 'setting_fact_gap' | 'stiff_camera_run' | 'acting_speech_only' | 'style_drift'
  message: string
}

export interface VideoPipelineOptions {
  /** max seconds per segment (default 10) */
  maxShotSec?: number
  /** merge consecutive short shots into 5–9s segments + dedupe (default true) */
  mergeToSegments?: boolean
  /** merged segment min seconds (default 5) */
  segmentMinSec?: number
  /** merged segment max seconds (default 9) */
  segmentMaxSec?: number
  /** 'speed' = opt-in per-second speed-beat prompts (时间轴（按秒变速）); default 'off' keeps the existing prompts */
  beatMode?: 'off' | 'speed'
  /** opt-in: split two-person facing-window / cross-cut segments into solo shots + set angleKey/carryFromShotId (default false) */
  splitCrossCut?: boolean
  /** with splitCrossCut: explicit { shotId: sceneId } place corrections */
  sceneOverrides?: Record<string, string>
}

export interface VideoPipelineExport {
  schema: typeof VIDEO_PIPELINE_SCHEMA
  project: {
    id: string
    title: string
    style: string
    platform: string
    secondsPerEp: number
    /** flat list kept for old consumers / UI */
    settingFacts: string[]
    /** tiered facts; drama CLI should consume world+ongoing only (never ending) for shot prompts.
     *  world/ongoing are quote-scrubbed (no quoted dialogue lines) — safe to inject into generation prompts. */
    settingFactsByTier?: SettingFactsByTier
    /** world+ongoing, quote-scrubbed: the ONLY facts a video/generation prompt may use */
    settingFactsForPrompt?: string[]
  }
  characters: {
    id: string
    name: string
    baseName?: string
    role: string
    tags: string[]
    visualLock: string
    costume: string
    signatureProp: string
    /** 定妆图文件名/前缀 (receiver resolves shot refs via characterIds); null when unset */
    refImage: string | null
    age?: string
    background?: string
    /** 定妆负向提示 */
    negative?: string | null
    characterKey?: string | null
    /** GPU folder name from pack images.dir */
    imagesDir?: string | null
    /** costume for prompts with logo/校徽/刺绣标 triggers removed (only when it differs from costume) */
    costumePrompt?: string
    /** wardrobe state of this character variant (default: refImage minus `${characterKey}_`, else 'default') */
    wardrobeState?: string
    /** wardrobe changes over the story: state starts at fromShotId / fromEpisode */
    wardrobeTimeline?: { state: string; fromShotId?: string; fromEpisode?: number; evidence?: string; autoProposed?: boolean }[]
    /** keyword cues in visual/action text that switch the wardrobe state from that shot on */
    wardrobeCues?: { state: string; keywords: string[] }[]
    /** wardrobe state → character-pack reference set (lora_materials/datasets/<refSet>), null = none yet */
    wardrobeRefs?: Record<string, { refSet: string | null; logoFree?: boolean; fallbackRefSet?: string; note?: string }>
  }[]
  shots: VideoPipelineShot[]
  warnings: VideoPipelineWarning[]
}

// ---------------- text helpers (exported for tests / reuse) ----------------

/** Count paced chars: CJK + latin alnum; punctuation / whitespace ignored. */
export function pacedChars(text: string): number {
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaffA-Za-z0-9]/g) || []).length
}
/** Seconds needed to speak text at CHARS_PER_SEC */
export function dialogueSec(text: string): number {
  return pacedChars(text) / CHARS_PER_SEC
}

const NONE_RE = /^[\s「」“”"']*(无台词|无对白|无|——|—|-|——无|none|n\/a)?[\s「」“”"'。.]*$/i
export function isNoDialogue(s: string | undefined | null): boolean {
  return !s || NONE_RE.test(s.trim())
}

/** Extract sfx markers; returns cleaned text + sfx list. */
export function extractSfx(text: string): { text: string; sfx: string[] } {
  const sfx: string[] = []
  const push = (v: string) => {
    const t = v.trim().replace(/^[：:\s]+|[，。；;、\s]+$/g, '')
    if (t && !sfx.includes(t)) sfx.push(t)
    return ''
  }
  let t = text || ''
  t = t.replace(/【\s*(?:音效|SFX)\s*[：:]\s*([^】]+)】/gi, (_m, v) => push(v))
  t = t.replace(/【\s*(?:音效|SFX)\s*】\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/[（(]\s*SFX\s*[）)]\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/(?:音效|SFX)\s*[：:]\s*([^，。；;\n【「\s：:]+)/gi, (_m, v) => push(v))
  t = t.replace(/[，、；;]{2,}/g, '，').replace(/^[，、；;\s]+|[，、；;\s]+$/g, '')
  return { text: t, sfx }
}

/** Explicit UI-window wording in prompts (a clause matching this is replaced by the indirect cue). */
const UI_RE = /(系统视窗|系统提示|系统面板|系统界面|系统弹窗|界面|转盘|弹窗|屏幕文字|提示框|悬浮窗|全息屏|光幕|面板文字)/
/** Keywords after which a quoted string is on-screen UI text. */
const UI_KEY = /(系统|视窗|提示|面板|界面|弹窗|屏幕|手机|短信|消息|通知|字样|写着|显示|浮现|弹出|跳出|标题|字幕|光幕|全息|悬浮窗|提示框|转盘|选项|余额|聊天|对话框)/
/** `标签：内容` labels whose content is UI text. */
const UI_LABEL = /(系统提示|系统消息|界面显示|弹窗|屏幕文字|屏幕显示|提示框|面板文字|字幕|手机屏幕|短信|通知)\s*[：:]\s*([^。；;\n]+)/g
/** Prompt field labels — `动作：…` etc. are never overlay text. */
const FIELD_LABEL = /^(主体|动作|镜头|风格|限制|画面|场景|景别|光线|时间轴|运镜|备注|要求|注意)\s*[：:]/
export const INDIRECT_UI_CUE = '蓝光映在角色脸上，神情专注'

/** Negative directive (限制：/不出现/禁止/避免/无字幕…) — stays in prompt, never overlay. */
export function isConstraintText(t: string): boolean {
  const x = (t || '').trim()
  return (
    /^(限制|禁止|避免|要求|注意)\s*[：:]/.test(x) ||
    /(不出现|不显示|不要|不得|不可出现|不能出现|不改变|不切换|不带|禁止|避免|无字幕|无水印|无文字|无界面|无任何|无台词|无可读|没有任何文字)/.test(x)
  )
}
/** Visual description (not literal text): e.g. 眼睛是两个转盘 / 手腕戴着腕表. */
export function isDescriptionText(t: string): boolean {
  const x = (t || '').trim()
  if (/[『「“"]/.test(x)) return false
  if (FIELD_LABEL.test(x)) return true
  return /(眼睛|双眼|眼中|眼里|眼睛里|手腕|戴着|戴一|腕表|小人|像素|身上|旋转|映在|画面|镜头|慢悠悠|特写|光团|蓝光|红光)/.test(x)
}
/** Keep only literal on-screen UI text. */
export function isOverlayText(t: string): boolean {
  const x = (t || '').trim()
  return Boolean(x) && !isConstraintText(x) && !isDescriptionText(x)
}
export function filterOverlay(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const x = (raw || '').trim()
    if (isOverlayText(x) && !out.includes(x)) out.push(x)
  }
  return out
}

/** Pull literal UI text out of a free-text field (visual / prompt / action). Descriptions and constraints are ignored. */
export function extractOverlay(text: string): string[] {
  const t = text || ''
  const out: string[] = []
  for (const m of t.matchAll(/『([^』]+)』/g)) out.push(m[1].trim())
  // 「」“” only when the clause before it names a UI surface
  for (const m of t.matchAll(/([^，。；;！!？?\n「“]{0,24})[「“]([^」”]+)[」”]/g)) if (UI_KEY.test(m[1])) out.push(m[2].trim())
  for (const m of t.matchAll(UI_LABEL)) {
    const v = m[2].trim().replace(/^[『「“"]|[』」”"]$/g, '')
    if (v) out.push(v)
  }
  return filterOverlay(out)
}

/**
 * Strip explicit UI rendering (『…』 quotes, 系统视窗/弹窗… clauses) from a prompt.
 * Constraint clauses (限制：不出现文字与界面…) are kept untouched. `removed` tells whether anything UI was taken out.
 */
export function stripUiFromPrompt(prompt: string): { text: string; removed: boolean } {
  let removed = false
  let quoted = false
  let p = (prompt || '').replace(/[，,]?\s*(?:显示|写着|浮现|出现)?\s*『[^』]*』/g, () => {
    quoted = true
    return ''
  })
  const parts = p.split(/([，。；;\n])/)
  const out: string[] = []
  let inConstraint = false
  for (let i = 0; i < parts.length; i += 2) {
    const clause = parts[i]
    const sep = parts[i + 1] ?? ''
    const c = clause.trim()
    if (/^(限制|风格)\s*[：:]/.test(c)) inConstraint = true
    else if (FIELD_LABEL.test(c)) inConstraint = false
    if (!inConstraint && UI_RE.test(clause) && !isConstraintText(clause) && !clause.includes(INDIRECT_UI_CUE.split('，')[0])) {
      const label = clause.match(/^\s*([^：:]{1,6}[：:])/)?.[1] ?? ''
      out.push(label + (removed ? '' : '\u0000') + (label || !removed ? sep : ''))
      removed = true
      continue
    }
    out.push(clause + sep)
    if (sep === '。' || sep === '\n') inConstraint = false
  }
  p = out.join('')
  return { text: p, removed: removed || quoted }
}

/** Insert the indirect cue once (at the first removed UI spot, else after the 主体 sentence / at the start). */
function insertCue(text: string, cue: string): string {
  if (text.includes('\u0000')) {
    let first = true
    return text.replace(/\u0000/g, () => (first ? ((first = false), cue) : ''))
  }
  const m = text.match(/^([\s\S]*?主体[：:][^。]*)(。)/)
  if (m) return `${m[1]}，${cue}${m[2]}${text.slice(m[0].length)}`
  // after the first subject sentence (never as a stock opener)
  const k = text.search(/[；;。]/)
  if (k > 0) return `${text.slice(0, k)}，${cue}${text.slice(k)}`
  return `${text}${text ? '，' : ''}${cue}`
}
function tidy(p: string): string {
  return p.replace(/\u0000/g, '').replace(/[，、]{2,}/g, '，').replace(/，。/g, '。').replace(/：，/g, '：').replace(/^[，\s]+/, '').trim()
}

/** Replace explicit UI rendering descriptions in a prompt with one indirect light/expression cue (helper; always adds cue when UI was found). */
export function indirectUiCue(prompt: string, cue = INDIRECT_UI_CUE): string {
  const { text, removed } = stripUiFromPrompt(prompt)
  return tidy(removed ? insertCue(text, cue) : text)
}

const ACTION_SPLIT = /\s*[，,。；;]?\s*(?:紧接着|随后|然后|接着|同时)\s*[，,]?\s*/
export function splitActions(action: string): string[] {
  const parts = (action || '').split(ACTION_SPLIT).map((s) => s.replace(/^[，,。；;\s]+|[，,；;\s]+$/g, '')).filter(Boolean)
  return parts.length ? parts : [action || '']
}

const VOICE_TAG = /^(OS|O\.S\.?|画外音|画外|V\.?O\.?|电话里|电话|内心|心声|心想|广播)$/i
/** Inner monologue: keep onscreen speakers in characterIds and also list in voiceOnly */
const INNER_TAG = /^(内心|心声|心想)$/
const NARRATOR = /^(旁白|画外音|解说|narrator)$/i
const SYSTEM = /^(系统|系统音|系统提示|系统声音)$/

export interface DialogueLine {
  name: string | null
  tag: string | null
  text: string
}
/** Split dialogue into lines and parse `名字：` / `名字（情绪）：` / `名字(OS)：` prefixes. */
export function parseDialogue(dialogue: string, chars: Character[] = []): DialogueLine[] {
  if (isNoDialogue(dialogue)) return []
  const PREFIX = '[^\\s：:（()）「」“”，。！？!?、]{1,12}(?:\\s*[（(][^）)]{0,12}[）)]){0,2}\\s*[：:]'
  const broken = dialogue.replace(new RegExp(`([」”。！？!?…~])\\s*(?=${PREFIX})`, 'g'), '$1\n')
  const lines: DialogueLine[] = []
  for (const raw of broken.split(/\n+/)) {
    const l = raw.trim()
    if (!l || isNoDialogue(l)) continue
    const m = l.match(/^([^\s：:（()）「」“”，。！？!?、]{1,12})\s*(?:[（(]([^）)]{0,12})[）)])?\s*(?:[（(]([^）)]{0,12})[）)])?\s*[：:]\s*([\s\S]*)$/)
    const unq = (s: string) => s.trim().replace(/^[「“"]([\s\S]*)[」”"]$/, '$1').trim()
    if (m) {
      const text = unq(m[4])
      let name = m[1]
      const p1 = m[2]?.trim() || ''
      const p2 = m[3]?.trim() || ''
      let tag: string | null = p1 || null
      // variant names contain parentheses: 白朴（变帅前）（小声）→ name 白朴（变帅前）, tag 小声
      const variant = p1 && chars.find((c) => c.name.replace(/\(/g, '（').replace(/\)/g, '）') === `${name}（${p1}）`)
      if (variant) {
        name = variant.name
        tag = p2 || null
      } else if (p2) tag = VOICE_TAG.test(p2) && !VOICE_TAG.test(p1) ? p2 : p1
      if (!isNoDialogue(text)) lines.push({ name, tag, text })
    } else lines.push({ name: null, tag: null, text: unq(l) })
  }
  return lines
}

/** Split long text at sentence punctuation into chunks of ≤2 sentences and ≤maxSec speech each. */
export function splitDialogueChunks(text: string, maxSec: number): string[] {
  const sentences = text.split(/(?<=[。！？!?；;…~])/).map((s) => s.trim()).filter(Boolean)
  const atoms: string[] = []
  for (const s of sentences) {
    if (dialogueSec(s) <= maxSec) {
      atoms.push(s)
      continue
    }
    let cur = ''
    for (const c of s.split(/(?<=[，,、])/)) {
      if (cur && dialogueSec(cur + c) > maxSec) {
        atoms.push(cur)
        cur = ''
      }
      cur += c
    }
    // hard cut if a comma-free run is still too long
    while (dialogueSec(cur) > maxSec) {
      const arr = Array.from(cur)
      let n = 0
      let k = 0
      while (k < arr.length && n < Math.floor(maxSec * CHARS_PER_SEC)) {
        if (pacedChars(arr[k])) n++
        k++
      }
      atoms.push(arr.slice(0, k).join(''))
      cur = arr.slice(k).join('')
    }
    if (cur) atoms.push(cur)
  }
  const chunks: string[] = []
  let cur: string[] = []
  for (const a of atoms) {
    if (cur.length && (cur.length >= 2 || dialogueSec(cur.join('') + a) > maxSec)) {
      chunks.push(cur.join(''))
      cur = []
    }
    cur.push(a)
  }
  if (cur.length) chunks.push(cur.join(''))
  return chunks.length ? chunks : [text]
}

// ---------------- speaker resolution ----------------

/** System character: name/role/tags mention 系统 or tag system. Their lines are overlay-only. */
export function isSystemCharacter(c: Character | undefined): boolean {
  if (!c) return false
  if ((c.tags || []).includes('protagonist')) return false
  // role must *be* the system (系统化身 / 系统界面 …), not merely mention it (主角·系统生效后的样子)
  return (
    /系统/.test(c.name) ||
    /系统/.test(c.baseName || '') ||
    /(^|[·・/\s])系统($|化身|本体|精灵|界面|声音|意识|[·・/\s])/.test(c.role || '') ||
    (c.tags || []).some((t) => /^(system|系统)$/i.test(t))
  )
}

function displayName(c: Character): string {
  return c.baseName?.trim() || c.name
}

/** Resolve a prefix name to a character id; matches name, `名字（变体）` and baseName (picks onscreen / current variant). */
export function resolveSpeaker(
  name: string,
  tag: string | null,
  chars: Character[],
  prefer: string[] = [],
  current: Map<string, string> = new Map(),
): string | undefined {
  const full = tag ? [`${name}（${tag}）`, `${name}(${tag})`] : []
  for (const f of full) {
    const hit = chars.find((c) => c.name === f)
    if (hit) return hit.id
  }
  const exact = chars.find((c) => c.name === name)
  if (exact) return exact.id
  const variants = chars.filter(
    (c) => c.baseName?.trim() === name || (c.name.startsWith(name) && /^[（(]/.test(c.name.slice(name.length))),
  )
  if (variants.length) {
    return (
      variants.find((v) => prefer.includes(v.id))?.id ||
      variants.find((v) => current.get(name) === v.id)?.id ||
      variants[0].id
    )
  }
  return chars.find((c) => c.name && (name.includes(c.name) || c.name.includes(name)))?.id
}

// ---------------- segment model ----------------

interface Seg {
  ep: number
  shot: Shot
  parentId: string
  action: string
  actionSplit: boolean
  dialogue: string
  speaker: string | null
  /** subtitle name for off-list bit-part speakers (speaker null) */
  offName: string | null
  narration: boolean
  onscreen: string[]
  voice: string[]
  sfx: string[]
  overlay: string[]
  /** DURATION_STEP (0.5s) units */
  u: number
  need: number
}

const uniq = <T,>(a: T[]) => [...new Set(a)]
const toUnits = (sec: number) => Math.round(sec / DURATION_STEP)
const toSec = (u: number) => u * DURATION_STEP
const MIN_UNITS = toUnits(MIN_SEG_SEC)
const needUnits = (s: Seg) => Math.ceil(dialogueSec(s.dialogue) / DURATION_STEP - 1e-9)
const lower = (s: Seg, max: number) => Math.max(MIN_UNITS, Math.min(s.need, max))

/** Move time inside an episode so every seg is within [lower, max]; prefers dialogue-free nearest donors. */
function allocate(segs: Seg[], max: number) {
  for (let i = 0; i < segs.length; i++) {
    let def = lower(segs[i], max) - segs[i].u
    if (def <= 0) continue
    const order = segs.map((_, j) => j).filter((j) => j !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))
    for (const pass of [0, 1]) {
      for (const j of order) {
        if (def <= 0) break
        const d = segs[j]
        if (pass === 0 && d.dialogue) continue
        const slack = d.u - lower(d, max)
        if (slack <= 0) continue
        const t = Math.min(slack, def)
        d.u -= t
        segs[i].u += t
        def -= t
      }
    }
  }
  for (let i = 0; i < segs.length; i++) {
    let sur = segs[i].u - max
    if (sur <= 0) continue
    const order = segs.map((_, j) => j).filter((j) => j !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))
    for (const j of order) {
      if (sur <= 0) break
      const room = max - segs[j].u
      if (room <= 0) continue
      const t = Math.min(room, sur)
      segs[j].u += t
      segs[i].u -= t
      sur -= t
    }
  }
}

/** Split units of one total into n parts proportional to weights (each ≥1). */
function splitUnits(total: number, weights: number[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0) || weights.length
  const out = weights.map((w) => Math.max(1, Math.floor((total * (w || 1)) / W)))
  let diff = total - out.reduce((a, b) => a + b, 0)
  for (let i = 0; diff !== 0; i = (i + 1) % out.length) {
    if (diff > 0) {
      out[i]++
      diff--
    } else if (out[i] > 1) {
      out[i]--
      diff++
    } else if (out.every((x) => x <= 1)) break
  }
  return out
}

function buildShotSegs(
  ep: number,
  s: Shot,
  chars: Character[],
  current: Map<string, string>,
): Seg[] {
  const onscreen0 = shotCharacterIds(s, chars)
  const shotVoice = mapNamesToIds(s.voiceOnly, chars)
  const actionX = extractSfx(cleanField(s.action))
  const actions = splitActions(actionX.text)
  const sysIds = new Set(chars.filter(isSystemCharacter).map((c) => c.id))
  const sysNames = chars.filter(isSystemCharacter).flatMap((c) => [c.name, c.baseName || ''].filter(Boolean))
  // explicit overlayText entries: strip `系统小转：` prefix, then keep literal UI text only
  const stripSys = (x: string) => {
    const m = x.match(/^([^：:]{1,12})\s*[：:]\s*([\s\S]+)$/)
    return m && (SYSTEM.test(m[1]) || sysNames.includes(m[1])) ? m[2].trim().replace(/^[「“"]([\s\S]*)[」”"]$/, '$1') : x
  }
  // overlay entries that are really a human character's line (「白朴（变帅后）（轻声）：……行。」) → dialogue
  const movedLines: string[] = []
  const overlayIn: string[] = []
  for (const raw of s.overlayText || []) {
    const x = stripSys(raw.trim())
    const pl = x === raw.trim() ? parseDialogue(x, chars) : []
    const sid = pl.length === 1 && pl[0].name ? resolveSpeaker(pl[0].name, pl[0].tag, chars, onscreen0, current) : undefined
    if (sid && !isSystemCharacter(chars.find((c) => c.id === sid))) movedLines.push(x)
    else overlayIn.push(x)
  }
  const overlay: string[] = filterOverlay(overlayIn)
  for (const o of [...extractOverlay(cleanField(s.visual)), ...extractOverlay(s.seedancePrompt || '')]) if (!overlay.includes(o)) overlay.push(o)
  const shotSfx = uniq([...(s.sfx || []).map((x) => x.trim()).filter(Boolean), ...actionX.sfx])

  // dialogue → groups of consecutive lines with the same speaker
  type Group = { speaker: string | null; offName: string | null; narration: boolean; voice: boolean; inner: boolean; lines: string[]; sfx: string[] }
  const groups: Group[] = []
  const dx = extractSfx([isNoDialogue(s.dialogue) ? '' : s.dialogue || '', ...movedLines].filter(Boolean).join('\n').replace(/\r/g, ''))
  const dsfx = dx.sfx
  for (const line of parseDialogue(dx.text, chars)) {
    const lx = extractSfx(line.text)
    dsfx.push(...lx.sfx)
    if (!lx.text) continue
    const sysHit =
      line.name &&
      (SYSTEM.test(line.name) || isSystemCharacter(chars.find((c) => c.id === resolveSpeaker(line.name!, line.tag, chars, onscreen0, current))))
    if (sysHit || (!line.name && onscreen0.length === 1 && sysIds.has(onscreen0[0]))) {
      if (isOverlayText(lx.text) && !overlay.includes(lx.text)) overlay.push(lx.text)
      continue
    }
    for (const o of extractOverlay(lx.text)) if (!overlay.includes(o) && /『/.test(lx.text)) overlay.push(o)
    let speaker: string | null = null
    let offName: string | null = null
    let narration = false
    let voice = false
    let inner = false
    if (line.name && NARRATOR.test(line.name) && !line.tag) narration = true
    else if (line.name) {
      speaker = resolveSpeaker(line.name, line.tag, chars, [...onscreen0, ...shotVoice], current) ?? null
      if (!speaker) offName = line.name
      voice = Boolean(line.tag && VOICE_TAG.test(line.tag))
      inner = Boolean(line.tag && INNER_TAG.test(line.tag))
      if (speaker) current.set(displayName(chars.find((c) => c.id === speaker)!), speaker)
    } else {
      const cands = uniq([...onscreen0, ...shotVoice]).filter((id) => !sysIds.has(id))
      if (cands.length === 1) speaker = cands[0]
    }
    const last = groups[groups.length - 1]
    if (last && last.speaker === speaker && last.offName === offName && last.narration === narration && last.voice === voice && last.inner === inner) last.lines.push(lx.text)
    else groups.push({ speaker, offName, narration, voice, inner, lines: [lx.text], sfx: [] })
    groups[groups.length - 1].sfx.push(...lx.sfx)
  }

  const voiceIds = uniq([
    ...shotVoice.filter((id) => !sysIds.has(id)),
    ...groups.filter((g) => g.speaker && (g.voice || !onscreen0.includes(g.speaker))).map((g) => g.speaker!),
  ])
  // OS/画外/V.O./电话/广播 → remove from characterIds; 内心/心声/心想 keep onscreen if originally present
  const onscreen = onscreen0.filter(
    (id) => !shotVoice.includes(id) && !groups.some((g) => g.speaker === id && g.voice && !g.inner),
  )
  const innerOnscreen = new Set(
    groups.filter((g) => g.speaker && g.inner && onscreen0.includes(g.speaker)).map((g) => g.speaker!),
  )
  const voice = voiceIds.filter((id) => !onscreen.includes(id) || innerOnscreen.has(id))

  const n = Math.max(actions.length, groups.length, 1)
  const segs: Seg[] = []
  for (let i = 0; i < n; i++) {
    const g = groups[i]
    segs.push({
      ep,
      shot: s,
      parentId: s.id,
      action: actions[Math.min(i, actions.length - 1)],
      actionSplit: actions.length > 1,
      dialogue: g ? g.lines.join('\n') : '',
      speaker: g ? g.speaker : null,
      offName: g ? g.offName : null,
      narration: g ? g.narration : false,
      onscreen,
      voice,
      sfx: i === 0 ? uniq([...shotSfx, ...dsfx.filter((x) => !g || !g.sfx.includes(x)), ...(g?.sfx || [])]) : uniq(g?.sfx || []),
      overlay: i === 0 ? uniq(overlay) : [],
      u: 0,
      need: 0,
    })
  }
  for (const sg of segs) sg.need = needUnits(sg)
  const total = toUnits(Number(s.durationSec) || 0)
  // long shot with too few segments: time-split continuation segments (no dialogue)
  const k = Math.max(segs.length, Math.ceil(total / toUnits(10)))
  while (segs.length < k) {
    const last = segs[segs.length - 1]
    segs.push({ ...last, dialogue: '', speaker: null, offName: null, narration: false, sfx: [], overlay: [], need: 0 })
  }
  const us = splitUnits(Math.max(total, 1), segs.map((x) => Math.max(x.need, MIN_UNITS)))
  segs.forEach((x, i) => (x.u = total ? us[i] : 0))
  return segs
}

/** Remove any stock indirect cue already present (LLMs copy it from examples). */
export function stripCue(p: string): string {
  return (p || '')
    .replace(/[，,；;]?\s*蓝光映在(?:角色|他|她)?脸上[，,]\s*神情专注\s*([，,；;。]?)/g, (_m, sep) => sep || '')
    .replace(/^[，,；;\s]+/, '')
}
/** Prompt / visual mentions a screen, phone, panel or its light (constraint clauses ignored). */
const UI_CONTEXT = /(系统|屏幕|手机|面板|转盘|蓝光|幽蓝|全息|弹窗|界面|消息|通知|短信|余额|光幕|提示|电脑|平板|腕表|手表)/
export function hasUiContext(...texts: string[]): boolean {
  return texts.some((t) => (t || '').split(/[，。；;\n]/).some((c) => !isConstraintText(c) && UI_CONTEXT.test(c)))
}

/**
 * Overlay / nearby copy looks like system · roulette · balance · panel UI (reuse UI_KEY family).
 * Excludes bare 售货机/扫码 phone-pay scenes that lack a system surface.
 */
const SYSTEM_UI_SURFACE = /(系统|转盘|面板|弹窗|界面|视窗|光幕|全息|悬浮窗|提示框|选项)/
const SYSTEM_UI_OVERLAY = /(系统|转盘|余额|选项|面板|弹窗|界面|视窗|宿主|颜值|愿望|已抽取|第\d+枚)/
function ctxHasSystemSurface(...texts: string[]): boolean {
  return texts.some((t) =>
    (t || '')
      .split(/[，。；;\n]/)
      .some((c) => !isConstraintText(c) && SYSTEM_UI_SURFACE.test(c)),
  )
}
export function looksLikeSystemUiOverlay(overlay: string[], ...ctx: string[]): boolean {
  if (!overlay.length) return false
  const o = overlay.join(' ')
  const blob = [o, ...ctx].join(' ')
  // ignore 限制/不出现… clauses so 「无界面」constraints do not count as system UI
  if (ctxHasSystemSurface(o, ...ctx)) return true
  // 余额/颜值-style overlay counts unless this is a vending/scan beat without system chrome
  if (SYSTEM_UI_OVERLAY.test(o) || overlay.some((x) => UI_KEY.test(x))) {
    if (/(售货机|扫码口|扫码)/.test(blob) && !ctxHasSystemSurface(...ctx)) return false
    return SYSTEM_UI_OVERLAY.test(o)
  }
  return false
}

const CAM_MOVE = /(推|拉|摇|移|跟|手持|过肩|侧打|升|降|甩|微移)/
/** Camera is essentially 固定机位 with little else (no push/pull/follow…). */
export function isStiffFixedCamera(camera: string): boolean {
  const c = (camera || '').trim()
  return /固定/.test(c) && !CAM_MOVE.test(c)
}

const SPEECH_ACT = /(说话|喊话|回答|自语|开口)/
const MICRO_ACT = /(视线|眨眼|吞咽|手指|呼吸|嘴角|重心|耸肩|握|喉结|闪避|点头|皱眉|抿|停顿|一边|余韵|准备)/
/** Dialogue present and action is essentially just talking, with no micro-performance words. */
export function isActingSpeechOnly(action: string, dialogue: string): boolean {
  if (!(dialogue || '').trim()) return false
  const a = (action || '').trim()
  if (!SPEECH_ACT.test(a) || MICRO_ACT.test(a)) return false
  return pacedChars(a) <= 28
}

function partPrompt(base: string, origAction: string, sg: Seg, changedTime: boolean): string {
  let p = stripCue(extractSfx(base).text)
  if (sg.actionSplit) {
    if (origAction && p.includes(origAction)) p = p.split(origAction).join(sg.action)
    else if (/动作[：:][^。]*。/.test(p)) p = p.replace(/动作[：:][^。]*。/, `动作：${sg.action}（单主动作）。`)
    else p = `${p}${p && !/[。.]$/.test(p) ? '。' : ''}动作：${sg.action}。`
  }
  if (changedTime) p = p.replace(/时间轴[：:][^。]*。/g, '')
  const { text, removed } = stripUiFromPrompt(p)
  const visual = cleanField(sg.shot.visual)
  // cue only for system/转盘/余额-class UI overlays (not arbitrary 售货机 overlays + bare 手机)
  const systemUi = looksLikeSystemUiOverlay(sg.overlay, text, visual)
  const cue = sg.overlay.length > 0 && sg.onscreen.length > 0 && systemUi && (removed || hasUiContext(text, visual) || ctxHasSystemSurface(...sg.overlay, text, visual))
  // prompt already has its own screen-light cue → don't stack the stock one
  const own = /(蓝光|幽蓝|屏幕光|冷光|荧光)[^，。；;]{0,8}映/.test(text)
  return tidy(cue && !own ? insertCue(text, INDIRECT_UI_CUE) : text)
}

const DAY_MARK = /(清晨|早上|早晨|上午|中午|白天|日间|[六七八九]点|[6-9]点|[6-9]:\d\d)/
const NIGHT_MARK = /(晚上|深夜|夜里|半夜|今晚|夜晚|夜$|^夜)/
const NIGHT_PROMPT = /(夜戏|夜景|深夜|夜色|夜空)/

export function buildVideoPipelineExport(project: Project, opts: VideoPipelineOptions = {}): VideoPipelineExport {
  const maxSec = Math.max(MIN_SEG_SEC, opts.maxShotSec ?? 10)
  const max = toUnits(maxSec)
  const chars = project.characters
  const warnings: VideoPipelineWarning[] = []
  const eps = Object.keys(project.storyboards || {})
    .map(Number)
    .filter((n) => project.storyboards[n]?.length)
    .sort((a, b) => a - b)
  const shots: VideoPipelineShot[] = []
  const SETTING_FACT_KEYS = ['对窗', '邻居', '别墅', '贫困', '旧楼'] as const
  const SETTING_SHOT_KEYS = ['对窗', '邻居', '别墅', '贫困', '旧楼', '对面楼', '对面窗', '窗对窗', '老楼', '城中村', '贫寒']
  for (const ep of eps) {
    const list = [...project.storyboards[ep]].sort((a, b) => a.shotNo - b.shotNo)
    // soft: settingFacts space relations missing from this episode's visuals/prompts
    const factBlob = (project.settingFacts || []).join(' ')
    const factHits = SETTING_FACT_KEYS.filter((k) => factBlob.includes(k))
    if (factHits.length) {
      const shotBlob = list.map((s) => `${s.visual || ''} ${s.seedancePrompt || ''} ${s.action || ''}`).join(' ')
      if (!SETTING_SHOT_KEYS.some((k) => shotBlob.includes(k))) {
        warnings.push({
          episode: ep,
          code: 'setting_fact_gap',
          message: `设定空间关系（${factHits.join('/')}）未出现在本集画面描述`,
        })
      }
    }
    // soft: ≥3 consecutive shots whose camera is only 固定机位 (+ little else)
    let fixedRun = 0
    for (const s of list) {
      if (isStiffFixedCamera(s.camera || '')) {
        fixedRun++
        if (fixedRun === 3) {
          warnings.push({
            episode: ep,
            shotId: s.id,
            code: 'stiff_camera_run',
            message: '连续 ≥3 镜运镜几乎只有固定机位',
          })
        }
      } else fixedRun = 0
    }
    const current = new Map<string, string>()
    let segs: Seg[] = list.flatMap((s) => buildShotSegs(ep, s, chars, current))
    const rawTotal = list.reduce((a, s) => a + (Number(s.durationSec) || 0), 0)
    const targetUnits = Math.floor(rawTotal / DURATION_STEP + 1e-9)
    const remainderSec = Math.round((rawTotal - targetUnits * DURATION_STEP) * 1000) / 1000
    let T = segs.reduce((a, b) => a + b.u, 0)
    if (segs.length && T !== targetUnits) {
      segs[segs.length - 1].u += targetUnits - T
      if (segs[segs.length - 1].u < 0) segs[segs.length - 1].u = 0
      T = segs.reduce((a, b) => a + b.u, 0)
    }
    allocate(segs, max)
    // still too long and > max: split dialogue at sentence punctuation into new segments
    segs = segs.flatMap((sg) => {
      if (sg.need <= sg.u || sg.need <= max) return [sg]
      const chunks = splitDialogueChunks(sg.dialogue, maxSec)
      if (chunks.length < 2) return [sg]
      const us = splitUnits(sg.u, chunks.map((c) => Math.max(1, dialogueSec(c))))
      return chunks.map((c, i) => {
        const x: Seg = { ...sg, dialogue: c, u: us[i], sfx: i ? [] : sg.sfx, overlay: i ? [] : sg.overlay }
        x.need = needUnits(x)
        return x
      })
    })
    // too many segments for min 2s: merge dialogue-free neighbours of the same parent, then any dialogue-free pair
    const sumL = () => segs.reduce((a, s) => a + lower(s, max), 0)
    while (sumL() > T && segs.length > 1) {
      let best = -1
      for (const sameParent of [true, false]) {
        for (let i = 0; i + 1 < segs.length && best < 0; i++) {
          const a = segs[i]
          const b = segs[i + 1]
          if (sameParent && a.parentId !== b.parentId) continue
          if (a.dialogue && b.dialogue) continue
          best = i
        }
        if (best >= 0) break
      }
      if (best < 0) break
      const a = segs[best]
      const b = segs[best + 1]
      const keep = a.dialogue ? a : b.dialogue ? b : a
      const m: Seg = {
        ...keep,
        action: a.parentId === b.parentId && a.action === b.action ? a.action : uniq([a.action, b.action]).filter(Boolean).join('，'),
        actionSplit: a.actionSplit || b.actionSplit || a.parentId !== b.parentId,
        onscreen: uniq([...a.onscreen, ...b.onscreen]),
        voice: uniq([...a.voice, ...b.voice]),
        sfx: uniq([...a.sfx, ...b.sfx]),
        overlay: uniq([...a.overlay, ...b.overlay]),
        u: a.u + b.u,
      }
      segs.splice(best, 2, m)
    }
    allocate(segs, max)

    // number + emit
    if (remainderSec > 1e-9) {
      warnings.push({
        episode: ep,
        code: 'duration_remainder',
        message: `本集总时长 ${rawTotal}s 不是 ${DURATION_STEP}s 的倍数，余数 ${remainderSec}s 加在最后一段`,
      })
    }
    let dayState: string | null = null
    const byParent = new Map<string, Seg[]>()
    for (const sg of segs) byParent.set(sg.parentId, [...(byParent.get(sg.parentId) || []), sg])
    for (let si = 0; si < segs.length; si++) {
      const sg = segs[si]
      const s = sg.shot
      const group = byParent.get(sg.parentId)!
      const idx = group.indexOf(sg)
      const multi = group.length > 1
      const basePrompt =
        cleanPrompt(s.seedancePrompt?.trim() || '') || [cleanField(s.visual), cleanField(s.action)].filter(Boolean).join('，')
      let durationSec = toSec(sg.u)
      if (si === segs.length - 1 && remainderSec > 1e-9) durationSec = Math.round((durationSec + remainderSec) * 1000) / 1000
      const sp = sg.speaker ? chars.find((c) => c.id === sg.speaker) : undefined
      const id = multi ? `${s.id}-${String.fromCharCode(97 + idx)}` : s.id
      shots.push({
        episode: ep,
        shotNo: s.shotNo,
        id,
        characterIds: [...sg.onscreen],
        prompt: partPrompt(basePrompt, extractSfx(cleanField(s.action)).text, sg, durationSec !== Number(s.durationSec)),
        visual: cleanField(s.visual),
        action: sg.action,
        durationSec,
        dialogue: sg.dialogue,
        speaker: sg.dialogue ? sg.speaker : null,
        speakerName: sg.dialogue ? (sp ? displayName(sp) : sg.offName) : null,
        voiceOnly: [...sg.voice],
        sfx: [...sg.sfx],
        overlayText: [...sg.overlay],
        camera: s.camera,
        size: s.size,
        emotion: s.emotion || '',
        refImage: s.refImage || null,
        ...(s.timeOfDay ? { timeOfDay: s.timeOfDay } : {}),
        ...(s.location?.trim() ? { location: s.location.trim() } : {}),
        ...(multi ? { segment: { index: idx, total: group.length, parentId: s.id } } : {}),
      })
      if (sg.dialogue && sg.need > sg.u)
        warnings.push({
          episode: ep,
          shotId: id,
          code: 'dialogue_too_long',
          message: `台词需 ${toSec(sg.need).toFixed(1)}s（${pacedChars(sg.dialogue)}字 @${CHARS_PER_SEC}字/秒），仅分配到 ${durationSec}s，无法在本集内借到时长`,
        })
      // time-of-day consistency: day markers carry forward until a night marker
      const tx = [s.timeOfDay || '', sg.dialogue, ...sg.overlay].join(' ')
      if (NIGHT_MARK.test(tx)) dayState = null
      else if (DAY_MARK.test(tx)) dayState = DAY_MARK.exec(tx)![0]
      const ptxt = shots[shots.length - 1].prompt
      if (dayState && NIGHT_PROMPT.test(ptxt))
        warnings.push({ episode: ep, shotId: id, code: 'time_conflict', message: `剧情时间为「${dayState}」，提示词却写了夜景/夜戏` })
      if (sg.u < MIN_UNITS || sg.u > max)
        warnings.push({ episode: ep, shotId: id, code: 'segment_duration', message: `段时长 ${durationSec}s 超出 ${MIN_SEG_SEC}–${maxSec}s` })
      if (sg.onscreen.length >= 2)
        warnings.push({ episode: ep, shotId: id, code: 'multi_character_shot', message: `同框 ${sg.onscreen.length} 个角色（建议单人镜头 / 过肩 / 正反打）` })
      if (sg.dialogue && !sg.speaker && sg.offName)
        warnings.push({ episode: ep, shotId: id, code: 'speaker_offlist', message: `说话人「${sg.offName}」不在角色表（仅字幕名）` })
      else if (sg.dialogue && !sg.speaker && !sg.narration)
        warnings.push({ episode: ep, shotId: id, code: 'speaker_unresolved', message: `台词无法确定说话人：${sg.dialogue.slice(0, 20)}` })
      if (isActingSpeechOnly(sg.action, sg.dialogue))
        warnings.push({
          episode: ep,
          shotId: id,
          code: 'acting_speech_only',
          message: 'action 几乎只有说话/喊话，缺微表演',
        })
    }
  }
  for (const c of chars) {
    if (!cleanField(c.costume))
      warnings.push({ episode: 0, characterId: c.id, code: 'character_missing_costume', message: `角色「${c.name}」缺少服装 costume` })
    if (!cleanField(c.signatureProp))
      warnings.push({ episode: 0, characterId: c.id, code: 'character_missing_prop', message: `角色「${c.name}」缺少标志道具 signatureProp` })
  }
  if (chars.some((c) => c.refImage?.trim()) && !/真人/.test(project.style || '')) {
    warnings.unshift({ episode: 0, code: 'style_mismatch', message: `画风为「${project.style}」，但角色定妆是真人参考图；请改为真人都市后重新生成分镜` })
  }
  const base: VideoPipelineExport = {
    schema: VIDEO_PIPELINE_SCHEMA,
    project: {
      id: project.id,
      title: project.title,
      style: project.style,
      platform: project.platform,
      secondsPerEp: project.secondsPerEp,
      settingFacts: (project.settingFacts || []).map((f) => f.trim()).filter(Boolean),
      // drama CLI should consume settingFactsByTier.world + .ongoing only (never .ending) for shot prompts
      settingFactsByTier: tierSettingFactsForPrompt(project.settingFacts),
      settingFactsForPrompt: factsForShotPrompts(project.settingFacts),
    },
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.baseName?.trim() ? { baseName: c.baseName.trim() } : {}),
      role: c.role,
      tags: c.tags || [],
      visualLock: cleanField(c.visualLock),
      costume: cleanField(c.costume),
      signatureProp: cleanField(c.signatureProp),
      refImage: c.refImage?.trim() || null,
      ...(c.age?.trim() ? { age: c.age.trim() } : {}),
      ...(c.background?.trim() ? { background: c.background.trim() } : {}),
      ...(c.negative?.trim() ? { negative: c.negative.trim() } : {}),
      ...(c.characterKey?.trim() ? { characterKey: c.characterKey.trim() } : {}),
      ...(c.imagesDir?.trim() ? { imagesDir: c.imagesDir.trim() } : {}),
      ...(c.wardrobeState?.trim() ? { wardrobeState: c.wardrobeState.trim() } : {}),
      ...(c.wardrobeTimeline?.length ? { wardrobeTimeline: c.wardrobeTimeline } : {}),
      ...(c.wardrobeCues?.length ? { wardrobeCues: c.wardrobeCues } : {}),
      ...(c.wardrobeRefs ? { wardrobeRefs: c.wardrobeRefs } : {}),
    })),
    shots,
    warnings,
  }
  return postProcessExport(base, {
    mergeToSegments: opts.mergeToSegments,
    segmentMinSec: opts.segmentMinSec,
    segmentMaxSec: opts.segmentMaxSec,
    genre: project.genre,
    beatMode: opts.beatMode,
    splitCrossCut: opts.splitCrossCut,
    sceneOverrides: opts.sceneOverrides,
  })
}

export function videoPipelineFilename(project: Project): string {
  return `${project.title || 'project'}-video-pipeline.json`
}
