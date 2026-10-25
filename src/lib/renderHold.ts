/**
 * Render hold: after every automatic rule a shot that still carries a blocking issue is held (shot.hold.reason[]),
 * the rest get hold: null. Derived from the final pack only — never a hand list — so a fixed issue never holds.
 * The GPU runner defers held shots (--defer-flag).
 *
 * Blocking issues:
 *  - dialogueOverrun: estimated speech still longer than its slot (at the 9 s cap: split shot or shorten line)
 *  - pronoun: a bare 他/她 in a 2+ person segment with nobody named before it
 *  - density: a timeline segment above the action cap (main actions) or the visible-action cap
 *  - empty segment / drawable text (quote, emotion, inner monologue, voice) left in the prompt
 *  - cast_consistency warning on the shot
 *  - mouth: a mouth / face occluder left inside the line's time range (lip-sync fails)
 *  - speaker: a dialogue segment whose speaker cannot be told apart by look
 */
import { actionCap, countActions, isVisibleAction, visibleCap } from './actionDensity'
import { dialogueOverruns, type SpeechRate } from './dialogueTiming'
import { EMOTION_VISIBLE } from './emotionVocab'
import { promptTextRisks } from './emotionVisual'
import { onscreenCast, unclearPronouns } from './shotAnnotate'
import { mouthOcclusionRisks, MOUTH_CLEAR_MARK } from './mouthOcclusion'
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'

export interface RenderHoldEntry {
  shotId: string
  episode: number
  reasons: string[]
}

const SEG_LINE = /^(\d+(?:\.\d+)?)[–-](\d+(?:\.\d+)?)秒[^：:]*[：:](.*)$/
// visible parts written by the emotion table are expression-level (weight 0): not counted as extra visible actions
const VOCAB_PARTS = new Set(Object.values(EMOTION_VISIBLE).flatMap((v) => v.split('、')))
const SPEAKER_TODO = '台词段说话人无法用造型区分'

/** density problems of the final timeline (segment by segment, against beatSegments speed / dialogue flags) */
export function densityIssues(s: VideoPipelineShot): string[] {
  const segs = s.beatSegments || []
  if (!segs.length) return []
  const lines = s.prompt.split('\n').filter((l) => SEG_LINE.test(l))
  const out: string[] = []
  lines.forEach((l, i) => {
    const m = segs[i]
    if (!m) return
    const body = l.match(SEG_LINE)![3].split('；')[0].replace(/^动作放慢[，,]?/, '')
    const cls = body.split(/[，,。]/).map((x) => x.trim()).filter(Boolean)
    const main = countActions(cls)
    const vis = cls.flatMap((c) => c.split('、')).filter((c) => !VOCAB_PARTS.has(c) && isVisibleAction(c)).length
    const cap = actionCap(m.speed, m.dialogue)
    if (main > cap) out.push(`density ${m.start}–${m.end}s (${m.speed}${m.dialogue ? ', dialogue' : ''}): ${main} main actions > ${cap}`)
    else if (vis > visibleCap(m.speed)) out.push(`density ${m.start}–${m.end}s (${m.speed}): ${vis} visible actions > ${visibleCap(m.speed)}`)
  })
  return out
}

/** mouth occluders left while the line is spoken (lip-sync segments; a timeline-less dialogue close-up: whole prompt) */
export function shotMouthRisks(s: VideoPipelineShot): string[] {
  return mouthOcclusionRisks(s.prompt, s.framing === 'closeup_dialogue' && !s.prompt.includes(MOUTH_CLEAR_MARK))
}

export function renderHoldReasons(exp: VideoPipelineExport, opts: { speechRate?: Partial<SpeechRate> } = {}): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (id: string, r: string) => out.set(id, [...new Set([...(out.get(id) || []), r])])
  for (const o of dialogueOverruns(exp.shots, opts.speechRate)) add(o.id, `dialogueOverrun +${o.overrunSec}s at ${o.durationSec}s: ${o.remedy}`)
  for (const w of exp.warnings || []) if (w.code === 'cast_consistency' && w.shotId) add(w.shotId, `cast_consistency: ${w.message}`)
  for (const s of exp.shots) {
    const n = onscreenCast(s, exp.characters).length
    if (n >= 2) for (const c of unclearPronouns(s.prompt)) add(s.id, `pronoun: unresolved 他/她 with ${n} on screen: ${c}`)
    for (const d of densityIssues(s)) add(s.id, d)
    for (const r of promptTextRisks(s.prompt)) add(s.id, `text: ${r}`)
    for (const c of shotMouthRisks(s)) add(s.id, `mouth: occluded while speaking: ${c}`)
    for (const t of s.beatTodo || []) if (t.startsWith(SPEAKER_TODO)) add(s.id, `speaker: ${t}`)
  }
  return out
}

/** set shot.hold on every shot ({ reason } or null) and return the held list (pack order) */
export function applyRenderHold(exp: VideoPipelineExport, opts: { speechRate?: Partial<SpeechRate> } = {}): { exp: VideoPipelineExport; renderHold: RenderHoldEntry[] } {
  const reasons = renderHoldReasons(exp, opts)
  const shots = exp.shots.map((s) => ({ ...s, hold: reasons.has(s.id) ? { reason: reasons.get(s.id)! } : null }))
  return {
    exp: { ...exp, shots },
    renderHold: shots.filter((s) => s.hold).map((s) => ({ shotId: s.id, episode: s.episode, reasons: s.hold!.reason })),
  }
}
