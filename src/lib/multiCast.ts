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
import { FEMALE_RE } from './renderHygiene'

/** characters[].gender (optional): female / male (also 女 / 男) */
export type Gender = 'female' | 'male'
export const genderOf = (c?: { gender?: string }): Gender | null =>
  !c?.gender ? null : /^(f|female|女)/i.test(c.gender) ? 'female' : /^(m|male|男)/i.test(c.gender) ? 'male' : null
/**
 * gender for pronoun mapping: explicit characters[].gender, else the beat builder's rule on the character data
 * (FEMALE_RE on visualLock / role / tags → female; a male word there → male), else null (ambiguous)
 */
export const inferGender = (c?: { gender?: string; visualLock?: string; role?: string; tags?: string[] }): Gender | null => {
  const g = genderOf(c)
  if (g || !c) return g
  const text = `${c.visualLock || ''} ${c.role || ''} ${(c.tags || []).join(' ')}`
  return FEMALE_RE.test(text) ? 'female' : /(男|少年|先生|哥|他)/.test(text) ? 'male' : null
}
const nounOf = (g: Gender | null, age?: string): string => {
  if (!g) return '人'
  const n = Number((age || '').match(/\d+/)?.[0] ?? NaN)
  return n < 20 ? (g === 'female' ? '少女' : '少年') : g === 'female' ? '女人' : '男人'
}
const POS_WORD: Record<ScreenPos, string> = { left: '画面左侧', right: '画面右侧', center: '画面中间' }
/** person 他/她 (not 其他 / 他们 / 他人 / 他乡 …), same as shotAnnotate.unclearPronouns */
const PRONOUN = /(?<![其吉利])[他她](?![们人乡处日])/g
const BEAT_LINE = /^(\d+(?:\.\d+)?[–-]\d+(?:\.\d+)?秒[，,：:])(.*)$/

/**
 * 2+ on-screen characters: every bare 他/她 in a timeline line becomes a screen-position descriptor (画面左侧的少女 …).
 * Who: explicit characters[].gender when it separates the cast (她 → the only female); otherwise (absent / same gender)
 * the clause's first pronoun is the segment actor (the on-screen speaker of a dialogue segment, else the first cast
 * member, kept across clauses) and a later pronoun in the same clause is the other person.
 */
export function resolvePronouns(prompt: string, cast: CastEntry[], genders: Map<string, Gender | null>, nouns: Map<string, string>, speakerAt: (start: number) => string | null): { prompt: string; count: number } {
  if (cast.length < 2) return { prompt, count: 0 }
  let count = 0
  const desc = (c: CastEntry) => `${POS_WORD[c.screenPos]}的${nouns.get(c.id) || '人'}`
  const byGender = (g: Gender) => cast.filter((c) => genders.get(c.id) === g)
  const lines = prompt.split('\n').map((line) => {
    const m = line.match(BEAT_LINE)
    if (!m) return line
    const start = Number(line.match(/^(\d+(?:\.\d+)?)/)![1])
    const spk = speakerAt(start)
    let actor = cast.find((c) => c.id === spk) || cast[0]
    const body = m[2].split(/([，,。；;])/).map((clause, ci) => {
      if (ci % 2) return clause
      let first = true
      return clause.replace(PRONOUN, (p) => {
        const g: Gender = p === '她' ? 'female' : 'male'
        const exact = byGender(g)
        // nobody of that gender given: everyone not of the other gender (unknown) is a candidate
        const pool = exact.length ? exact : cast.filter((c) => genders.get(c.id) !== (g === 'female' ? 'male' : 'female'))
        let who: CastEntry
        if (pool.length === 1) who = pool[0]
        else if (first) who = actor
        else who = cast.find((c) => c.id !== actor.id) || actor
        if (first) actor = who
        first = false
        count++
        return desc(who)
      })
    })
    return m[1] + body.join('')
  })
  return { prompt: lines.join('\n'), count }
}

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
  pronounsResolved: number
  pronounShots: string[]
}

const POS: ScreenPos[] = ['left', 'right', 'center']

export function applyMultiCast(exp: VideoPipelineExport): { exp: VideoPipelineExport; report: MultiCastReport } {
  const names = new Map(exp.characters.map((c) => [c.id, c.name] as const))
  const genders = new Map(exp.characters.map((c) => [c.id, inferGender(c as never)] as const))
  const nouns = new Map(exp.characters.map((c) => [c.id, nounOf(inferGender(c as never), (c as { age?: string }).age)] as const))
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
  const rep: MultiCastReport = { shots: exp.shots.length, multiCharacterShots: 0, multiCharacterWithDialogue: 0, offscreenLines: 0, overSpeakerLimit: [], sceneKeyframes: multiGroups.size, maxCast: 0, pronounsResolved: 0, pronounShots: [] }
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
    const on = cast.filter((c) => !(s.voiceOnly || []).includes(c.id))
    const pr = resolvePronouns(s.prompt, on, genders, nouns, (st) => {
      const l = lines.find((x) => st >= x.startSec - 0.01 && st < x.endSec)
      return l?.speaker ?? null
    })
    if (pr.count) {
      rep.pronounsResolved += pr.count
      rep.pronounShots.push(s.id)
    }
    return {
      ...s,
      prompt: pr.prompt, cast, castCountLock: ids.length, castDialogue: dialogue, maxSpeakersPerSegment: 1 as const,
      speakerFraming: ids.length > 1 ? ('two_shot_single_speaker' as const) : ('single' as const),
      sceneKeyframe: s.sceneKeyframe ?? (multiGroups.has(g) ? `${g}@${locationKeyOf(s)}` : null),
    }
  })
  return { exp: { ...exp, shots }, report: rep }
}
