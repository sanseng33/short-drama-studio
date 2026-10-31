/**
 * Multi-character shot fields (generic, derived from pack data only — no per-show / per-shot input).
 * Follows the H3 multi-character digest (2026-10-30):
 *   cast[]                 one entry per on-screen character (characterIds order): subject index, speaker tag S<n>,
 *                          refImage, screenPos (left|right|center) locked per sceneGroup by first appearance
 *   castCountLock          number of on-screen characters (→ "Exactly N characters. No extra characters, clones, swapping.")
 *   castDialogue[]         (digest `dialogue[]`; the pack's `dialogue` stays the legacy string) one entry per dialogueLines line: speaker tag (null = off-screen / voice-only), t [start,end],
 *                          onScreen, listenerMouth 'closed' when a second on-screen character listens
 *   maxSpeakersPerSegment  1 (lines are bound to one speaker; segments with >1 on-screen speaker are reported)
 *   speakerFraming         'two_shot_single_speaker' when ≥2 on screen, else 'single'
 *   sceneKeyframe          shared establishing-frame key per sceneGroup (+ locationKey): `<sceneGroup>@<locationKey>`,
 *                          set on every shot of a multi-character group so all its shots share one establishing still
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { locationKeyOf } from './sceneGroup'

export type ScreenPos = 'left' | 'right' | 'center'
export interface CastEntry { id: string; name: string; subject: number; speaker: string; refImage: string | null; screenPos: ScreenPos }
export interface MultiDialogue { speaker: string | null; characterId: string | null; t: [number, number]; lang: 'Chinese'; text: string; onScreen: boolean; listenerMouth?: 'closed' }
export interface MultiCastReport {
  shots: number
  multiCharacterShots: number
  multiCharacterWithDialogue: number
  offscreenLines: number
  overSpeakerLimit: string[]
  sceneKeyframes: number
  maxCast: number
}

const POS: ScreenPos[] = ['left', 'right', 'center']

export function applyMultiCast(exp: VideoPipelineExport): { exp: VideoPipelineExport; report: MultiCastReport } {
  const names = new Map(exp.characters.map((c) => [c.id, c.name] as const))
  const refs = new Map(exp.characters.map((c) => [c.id, (c as { refImage?: string | null }).refImage ?? null] as const))
  // screenPos per group: first-appearance order among multi-character shots of the group
  const posBy = new Map<string, Map<string, ScreenPos>>()
  const groupKey = (s: VideoPipelineShot) => s.sceneGroup || `ep${s.episode}@${locationKeyOf(s)}`
  for (const s of exp.shots) {
    const g = groupKey(s)
    const m = posBy.get(g) || new Map<string, ScreenPos>()
    if (s.characterIds.length > 1) for (const id of s.characterIds) if (!m.has(id)) m.set(id, POS[Math.min(m.size, 2)])
    posBy.set(g, m)
  }
  const multiGroups = new Set(exp.shots.filter((s) => s.characterIds.length > 1).map(groupKey))
  const rep: MultiCastReport = { shots: exp.shots.length, multiCharacterShots: 0, multiCharacterWithDialogue: 0, offscreenLines: 0, overSpeakerLimit: [], sceneKeyframes: multiGroups.size, maxCast: 0 }
  const shots = exp.shots.map((s) => {
    const g = groupKey(s)
    const pos = posBy.get(g)!
    const ids = s.characterIds
    const used = new Set<ScreenPos>()
    const cast: CastEntry[] = ids.map((id, i) => {
      let p: ScreenPos = ids.length === 1 ? 'center' : pos.get(id) || 'center'
      if (ids.length > 1 && used.has(p)) p = POS.find((x) => !used.has(x)) || 'center'
      used.add(p)
      return { id, name: names.get(id) || id, subject: i + 1, speaker: `S${i + 1}`, refImage: refs.get(id) ?? null, screenPos: p }
    })
    const tag = new Map(cast.map((c) => [c.id, c.speaker] as const))
    const lines = (s.dialogueLines || []) as { speaker: string | null; text: string; startSec: number; endSec: number }[]
    const dialogue: MultiDialogue[] = lines.map((l) => {
      const on = Boolean(l.speaker && tag.has(l.speaker))
      if (!on) rep.offscreenLines++
      return {
        speaker: on ? tag.get(l.speaker!)! : null, characterId: l.speaker ?? null, t: [l.startSec, l.endSec], lang: 'Chinese', text: l.text, onScreen: on,
        ...(ids.length > 1 || !on ? { listenerMouth: 'closed' as const } : {}),
      }
    })
    const onSpk = new Set(dialogue.filter((d) => d.onScreen).map((d) => d.speaker))
    if (onSpk.size > 1) rep.overSpeakerLimit.push(s.id)
    if (ids.length > 1) {
      rep.multiCharacterShots++
      if (dialogue.length) rep.multiCharacterWithDialogue++
    }
    rep.maxCast = Math.max(rep.maxCast, ids.length)
    return {
      ...s, cast, castCountLock: ids.length, castDialogue: dialogue, maxSpeakersPerSegment: 1 as const,
      speakerFraming: ids.length > 1 ? ('two_shot_single_speaker' as const) : ('single' as const),
      sceneKeyframe: multiGroups.has(g) ? `${g}@${locationKeyOf(s)}` : null,
    }
  })
  return { exp: { ...exp, shots }, report: rep }
}
