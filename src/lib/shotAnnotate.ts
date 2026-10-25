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
export interface WardrobeMeta {
  id: string
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

/** Set `framing` + `wardrobeState` on every shot (engine and all other fields untouched). */
export function annotateShots(exp: VideoPipelineExport): VideoPipelineExport {
  const ws = wardrobeStates(exp.shots, exp.characters as WardrobeMeta[])
  return { ...exp, shots: exp.shots.map((s, i) => ({ ...s, framing: framingOf(s), wardrobeState: ws[i] })) }
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
