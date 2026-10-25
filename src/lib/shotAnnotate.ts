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

export type Framing = 'closeup_dialogue' | 'medium' | 'full'
export const FRAMINGS: Framing[] = ['closeup_dialogue', 'medium', 'full']

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

export function framingOf(s: ShotLike): Framing {
  const size = (s.size || '').match(SIZE_RE)?.[0] || (s.camera || '').match(SIZE_RE)?.[0] || ''
  if (CLOSE_RE.test(size) && hasOnscreenDialogue(s)) return 'closeup_dialogue'
  if (FULL_RE.test(size)) return 'full'
  return 'medium'
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
  const ws = wardrobeStates(e.shots, e.characters as WardrobeMeta[])
  return { ...e, shots: e.shots.map((s, i) => ({ ...s, framing: framingOf(s), wardrobeState: ws[i] })) }
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

/** Shot ids missing / with an invalid framing or wardrobeState (empty = ok). */
export function missingAnnotations(exp: VideoPipelineExport): string[] {
  const bad: string[] = []
  for (const s of exp.shots) {
    if (!s.framing || !FRAMINGS.includes(s.framing)) bad.push(`${s.id}: framing`)
    const w = s.wardrobeState
    if (!w || typeof w !== 'object' || (s.characterIds || []).some((id) => !w[id])) bad.push(`${s.id}: wardrobeState`)
  }
  return bad
}
