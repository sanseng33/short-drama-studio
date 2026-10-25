/**
 * Cast consistency for look variants (generic, data-driven).
 *
 * Variants = 2+ characters sharing one characterKey (e.g. a before / after transformation pair). For every shot that
 * casts exactly one variant v of a key, the wardrobe timeline at that point is checked:
 *   - v's active wardrobe state there (wardrobeStates: base → wardrobeTimeline → wardrobeCues) is a state whose
 *     wardrobeRefs entry points at ANOTHER variant's reference set (refSet / fallbackRefSet ∈ refs(w) \ refs(v)), or
 *   - whose name extends another variant's base state (`${base(w)}_…` / `${base(w)}:…`) and not v's own.
 * Exactly one other variant w implied (and no structured signal for a third) = unambiguous → the shot is re-cast to w
 * (characterIds / speaker / voiceOnly / dialogueLines speakers, variant full names in the text) and keeps the timeline
 * state as its wardrobe (`castCorrection.wardrobeState`; the state's wardrobeRefs entry is copied to w when missing).
 * Text naming v in a corrected shot is reported (`textConflict`): the structured timeline wins over stale text.
 * Ambiguous / text-only / continuity-only signals → no change, a `cast_consistency` warning.
 * Idempotent: a corrected shot casts w, whose timeline no longer contradicts.
 */
import type { VideoPipelineExport, VideoPipelineShot, VideoPipelineWarning } from './videoExport'
import { baseWardrobeState, wardrobeStates, type WardrobeMeta, type WardrobeRef } from './shotAnnotate'

export interface CastCorrection {
  shotId: string
  episode: number
  characterKey: string
  from: string
  to: string
  /** the timeline state that implied `to` (kept as the shot's wardrobe state for `to`) */
  wardrobeState: string
  evidence: string[]
  /** the shot text still names the replaced variant (stale text, rewritten) */
  textConflict?: string
}
export interface CastWarning {
  shotId: string
  episode: number
  characterKey: string
  cast: string
  implied: string[]
  reason: 'conflicting_timeline' | 'text_names_other_variant' | 'continuity_island'
  detail: string
}

const SEP = /^[_:\-]/
function refSets(c: WardrobeMeta): Set<string> {
  const out = new Set<string>()
  if (c.refImage) out.add(c.refImage)
  const b = c.wardrobeRefs?.[baseWardrobeState(c)]
  if (b?.refSet) out.add(b.refSet)
  return out
}
function groups(chars: WardrobeMeta[]): Map<string, WardrobeMeta[]> {
  const g = new Map<string, WardrobeMeta[]>()
  for (const c of chars) {
    const k = (c.characterKey || '').trim()
    if (!k) continue
    g.set(k, [...(g.get(k) || []), c])
  }
  for (const [k, v] of g) if (v.length < 2) g.delete(k)
  return g
}
/** other variants a state of v points at, with evidence */
function impliedBy(v: WardrobeMeta, state: string, variants: WardrobeMeta[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (id: string, ev: string) => out.set(id, [...(out.get(id) || []), ev])
  const ref = v.wardrobeRefs?.[state]
  const mine = refSets(v)
  const vBase = baseWardrobeState(v)
  for (const w of variants) {
    if (w.id === v.id) continue
    const theirs = refSets(w)
    for (const r of [ref?.refSet, ref?.fallbackRefSet]) if (r && theirs.has(r) && !mine.has(r)) add(w.id, `${v.id}.wardrobeRefs.${state} → ${r} (${w.id} reference set)`)
    const wBase = baseWardrobeState(w)
    const ext = (b: string) => b !== 'default' && state.startsWith(b) && SEP.test(state.slice(b.length))
    if (state !== vBase && (state === wBase || ext(wBase)) && !(state === vBase || ext(vBase))) add(w.id, `${v.id} state ${state} extends ${w.id} base state ${wBase}`)
  }
  return out
}
const textOf = (s: VideoPipelineShot) => `${s.visual || ''}\n${s.action || ''}`
const fullName = (c: WardrobeMeta) => (c.name || '').trim()
/** a variant full name distinct from its base name (白X（qualifier）) */
const distinctName = (c: WardrobeMeta) => {
  const n = fullName(c)
  return n && n !== (c.baseName || '').trim() ? n : ''
}

export function checkCastConsistency(exp: VideoPipelineExport): { corrections: CastCorrection[]; warnings: CastWarning[] } {
  const chars = exp.characters as WardrobeMeta[]
  const g = groups(chars)
  const corrections: CastCorrection[] = []
  const warnings: CastWarning[] = []
  if (!g.size) return { corrections, warnings }
  // timeline state of every character at every shot (not only the cast): cast every char for the computation
  const all = chars.map((c) => c.id)
  const ws = wardrobeStates(exp.shots.map((s) => ({ ...s, characterIds: all })), chars.map((c) => ({ ...c, wardrobeCues: undefined })))
  const cues = wardrobeStates(exp.shots, chars)
  for (const [key, variants] of g) {
    const ids = new Set(variants.map((v) => v.id))
    const castOf = (s: VideoPipelineShot) => [...new Set([...(s.characterIds || []), ...(s.voiceOnly || [])])].filter((id) => ids.has(id))
    const keyed = exp.shots.map((s, i) => ({ s, i, cast: castOf(s) })).filter((x) => x.cast.length)
    keyed.forEach((x, k) => {
      if (x.cast.length !== 1) return // both variants in one shot = the transformation itself
      const v = variants.find((c) => c.id === x.cast[0])!
      const state = cues[x.i][v.id] ?? ws[x.i][v.id]
      const imp = impliedBy(v, state, variants)
      const text = textOf(x.s)
      if (imp.size === 1) {
        const [to, evidence] = [...imp.entries()][0]
        const w = variants.find((c) => c.id === to)!
        const vName = distinctName(v)
        const wName = distinctName(w)
        const tc = vName && text.includes(vName) && !(wName && text.includes(wName)) ? `text names ${v.id} (${vName})` : undefined
        corrections.push({ shotId: x.s.id, episode: x.s.episode, characterKey: key, from: v.id, to, wardrobeState: state, evidence, ...(tc ? { textConflict: tc } : {}) })
        return
      }
      if (imp.size > 1) {
        warnings.push({ shotId: x.s.id, episode: x.s.episode, characterKey: key, cast: v.id, implied: [...imp.keys()], reason: 'conflicting_timeline', detail: [...imp.values()].flat().join('; ') })
        return
      }
      // no structured signal: text / continuity only → warn, never change
      const named = variants.filter((w) => w.id !== v.id && distinctName(w) && text.includes(distinctName(w)) && !(distinctName(v) && text.includes(distinctName(v))))
      if (named.length) {
        warnings.push({ shotId: x.s.id, episode: x.s.episode, characterKey: key, cast: v.id, implied: named.map((w) => w.id), reason: 'text_names_other_variant', detail: named.map((w) => distinctName(w)).join(', ') })
        return
      }
      // continuity island: the nearest keyed shots outside this run of v (same episode) both cast one other variant
      let a = k
      while (a > 0 && keyed[a - 1].cast.join() === v.id) a--
      let b = k
      while (b < keyed.length - 1 && keyed[b + 1].cast.join() === v.id) b++
      const prev = keyed[a - 1]
      const next = keyed[b + 1]
      if (prev && next && prev.cast.length === 1 && next.cast.length === 1 && prev.cast[0] === next.cast[0] && prev.cast[0] !== v.id && prev.s.episode === x.s.episode && next.s.episode === x.s.episode)
        warnings.push({ shotId: x.s.id, episode: x.s.episode, characterKey: key, cast: v.id, implied: [prev.cast[0]], reason: 'continuity_island', detail: `${prev.s.id} and ${next.s.id} cast ${prev.cast[0]}` })
    })
  }
  return { corrections, warnings }
}

const swap = (ids: string[] | undefined, from: string, to: string) => (ids ? [...new Set(ids.map((x) => (x === from ? to : x)))] : ids)

/** Apply the unambiguous corrections (shots carry `castCorrection`), add `cast_consistency` warnings for the rest. */
export function applyCastConsistency(exp: VideoPipelineExport): { exp: VideoPipelineExport; corrections: CastCorrection[]; warnings: CastWarning[] } {
  const { corrections, warnings } = checkCastConsistency(exp)
  if (!corrections.length && !warnings.length) return { exp, corrections, warnings }
  const byShot = new Map(corrections.map((c) => [c.shotId, c]))
  const byId = new Map(exp.characters.map((c) => [c.id, c as WardrobeMeta]))
  const shots = exp.shots.map((s) => {
    const c = byShot.get(s.id)
    if (!c) return s
    const vName = distinctName(byId.get(c.from)!)
    const wName = distinctName(byId.get(c.to)!) || (byId.get(c.to)!.baseName || '').trim()
    const re = (t: string | undefined) => (t && vName && wName ? t.split(vName).join(wName) : t)
    const out: VideoPipelineShot = {
      ...s,
      characterIds: swap(s.characterIds, c.from, c.to)!,
      voiceOnly: swap(s.voiceOnly, c.from, c.to)!,
      speaker: s.speaker === c.from ? c.to : s.speaker,
      visual: re(s.visual)!,
      action: re(s.action)!,
      prompt: re(s.prompt)!,
      ...(s.promptDefault ? { promptDefault: re(s.promptDefault) } : {}),
      ...(s.dialogueLines ? { dialogueLines: s.dialogueLines.map((l) => (l.speaker === c.from ? { ...l, speaker: c.to } : l)) } : {}),
      castCorrection: { from: c.from, to: c.to, characterKey: c.characterKey, wardrobeState: c.wardrobeState },
    }
    return out
  })
  // the target variant needs the state's refs (look / costume) for its subject: copy when missing
  const need = new Map<string, Map<string, WardrobeRef & { copiedFrom?: string }>>()
  for (const c of corrections) {
    const to = byId.get(c.to)!
    const r = byId.get(c.from)!.wardrobeRefs?.[c.wardrobeState]
    if (r && !to.wardrobeRefs?.[c.wardrobeState]) need.set(c.to, (need.get(c.to) || new Map()).set(c.wardrobeState, { ...r, copiedFrom: c.from }))
  }
  const characters = exp.characters.map((ch) => {
    const m = need.get(ch.id)
    return m ? { ...ch, wardrobeRefs: { ...((ch as WardrobeMeta).wardrobeRefs || {}), ...Object.fromEntries(m) } } : ch
  })
  const seen = new Set(exp.warnings.filter((w) => w.code === 'cast_consistency').map((w) => `${w.shotId}|${w.message}`))
  const newWarn: VideoPipelineWarning[] = warnings
    .map((w) => ({ episode: w.episode, shotId: w.shotId, characterId: w.cast, code: 'cast_consistency' as const, message: `${w.reason}: 镜头选角 ${w.cast}，时间线/文本指向 ${w.implied.join('/')}（${w.detail}），未自动改，请核对` }))
    .filter((w) => !seen.has(`${w.shotId}|${w.message}`))
  return { exp: { ...exp, characters, shots, warnings: [...exp.warnings, ...newWarn] }, corrections, warnings }
}
