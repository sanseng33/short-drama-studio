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
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'

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

/** SHA-1 hex of a UTF-8 string (pure, sync; browser + node) */
export function sha1Hex(str: string): string {
  const bytes = Array.from(new TextEncoder().encode(str))
  const ml = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (ml >>> (i * 8)) & 0xff)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Array<number>(80)
  const rol = (x: number, n: number) => (x << n) | (x >>> (32 - n))
  for (let o = 0; o < bytes.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3]
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6]
      const tmp = (rol(a, 5) + f + e + k + w[i]) | 0
      e = d
      d = c
      c = rol(b, 30)
      b = a
      a = tmp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

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
}
const r2 = (x: number) => Math.round(x * 100) / 100
const speechLen = (t: string) => Math.max(1, t.replace(/[\s，。！？、…—,.!?「」“”『』（）()]/g, '').length)

/**
 * The shot's OWN lines (split children already carry only theirs) with times relative to the shot: lines go to the
 * beat segments marked dialogue in order (several lines in one segment share it by length); without beat segments
 * the lines share the whole shot by length. voiceOnly: off-list speaker, speakerOffscreen or a voiceOnly id not on screen.
 */
export function timedDialogueLines(s: VideoPipelineShot, chars: WardrobeMeta[] = []): TimedLine[] {
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
    const w = sl.idx.map((i) => speechLen(lines[i].text))
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

/** camera wording for a dialogue close-up: fixed size + face angle, no half-body / side angle words */
export function closeupCamera(cam: string): string {
  let c = cam
    .split(CLOSEUP_CAMERA)
    .join('')
    .replace(/正脸或三分之二侧脸|正脸/g, '')
    // size words incl. a body-part / 大 qualifier (手部特写, 大特写) and framing notes in brackets (（眼部与半张脸）)
    .replace(new RegExp(`(?:[手眼脸面嘴唇腿脚背胸颈头腰局]部|大|长焦|越窗)?(?:${SIZE_RE.source})`, 'g'), '')
    .replace(/[（(][^（）()]*(?:胸口|脸|眼|部|身)[^（）()]*[）)]/g, '')
  for (const w of HALF_BODY_ANGLE_WORDS) c = c.split(w).join('')
  const rest = c
    .split(/[，,·；;]/)
    .map((x) => x.replace(/^[的、\s]+|[的、\s]+$/g, '').trim())
    .filter((x) => x && !/^(?:随后|然后|再|镜头|拍摄|取景|拍|打|的)$/.test(x))
  return [CLOSEUP_CAMERA, ...rest].filter((x, i, a) => a.indexOf(x) === i).join('，')
}

/** every prompt: no 【】 tags (speed tags → words), close-up camera wording, framing in words, fixed no-text line */
export function finalizePrompt(prompt: string, framing: Framing): string {
  let p = stripRenderLines(prompt)
  p = p.replace(/【(快|慢|恢复常速)】/g, (_m, k: string) => `，${SPEED_TAG_WORDS[k]}`).replace(/秒，，/g, '秒，')
  p = p.replace(/[【】]/g, '')
  if (framing === 'closeup_dialogue') p = p.replace(/镜头[：:]([^。\n]*)/, (_m, cam: string) => `镜头：${closeupCamera(cam)}`)
  return `${p}\n景别：${FRAMING_WORDS[framing]}。\n${NO_TEXT_CONSTRAINT}`
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
export function annotateShots(exp: VideoPipelineExport): VideoPipelineExport {
  const { exp: e } = withProposedWardrobe(exp)
  const chars = e.characters as WardrobeMeta[]
  const ws = wardrobeStates(e.shots, chars)
  const pid = e.project?.id || e.project?.title || ''
  return {
    ...e,
    shots: e.shots.map((s, i) => {
      const framing = framingOf(s, chars)
      return {
        ...s,
        framing,
        wardrobeState: ws[i],
        seed: shotSeed(pid, s.id),
        dialogueLines: timedDialogueLines(s, chars),
        audio: s.audio ?? null,
        prompt: finalizePrompt(s.prompt, framing),
      }
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
