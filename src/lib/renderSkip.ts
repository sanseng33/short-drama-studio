/**
 * Render flag + carry rewiring (generic export rule).
 *
 * Every shot gets `render: boolean` and `renderSkip: { reason } | null` so runner and exporter agree on which
 * shots are NOT rendered:
 *   - 'hold'          shot.hold is set (render hold / cross-cut gate)
 *   - 'offscreen_only' every dialogue line is off-screen (voiceOnly / castDialogue onScreen false) and no line is
 *                      spoken on screen (e.g. a phone voice over a listener)
 *   - 'explicit'      the input already had render === false / renderSkip set
 * A non-rendered shot is never a carry source: carryFromShotId / carryFromPrev pointing at one are rewired to the
 * nearest previous RENDERED shot in the same episode + sceneGroup (else locationKey) + time band (same angleKey
 * preferred); if none exists the carry is dropped and the shot becomes establishing.
 */
import type { VideoPipelineExport } from './videoExport'

type S = VideoPipelineExport['shots'][number] & Record<string, any>
export interface CarryRewire { id: string; from: string; to: string | null; reason: string }

export function renderSkipReason(s: S): string | null {
  if (s.render === false || (s.renderSkip && s.renderSkip.reason && !['hold', 'offscreen_only'].includes(s.renderSkip.reason))) return 'explicit'
  if (s.hold) return 'hold'
  const lines: any[] = s.castDialogue?.length ? s.castDialogue : (s.dialogueLines || [])
  if (lines.length) {
    const on = lines.some((l) => (l.onScreen !== undefined ? l.onScreen : !l.voiceOnly))
    if (!on) return 'offscreen_only'
  }
  return null
}

const band = (s: S) => s.timeBand || s.timeOfDay || ''

export function applyRenderSkip(exp: VideoPipelineExport): { exp: VideoPipelineExport; skipped: { id: string; reason: string }[]; rewired: CarryRewire[] } {
  const shots: S[] = exp.shots.map((s0) => {
    const reason = renderSkipReason(s0 as S)
    return { ...s0, render: !reason, renderSkip: reason ? { reason } : null } as S
  })
  const rewired: CarryRewire[] = []
  const pick = (i: number, s: S, angle: boolean): S | null => {
    for (const same of [true, false]) {
      for (let j = i - 1; j >= 0; j--) {
        const t = shots[j]
        if (t.episode !== s.episode) break
        if (!t.render) continue
        if (band(t) !== band(s)) continue
        const sameScene = same ? (s.sceneGroup ? t.sceneGroup === s.sceneGroup : false) : (t.locationKey || t.location) === (s.locationKey || s.location)
        if (!sameScene) continue
        if (angle && t.angleKey !== s.angleKey) continue
        return t
      }
    }
    return null
  }
  shots.forEach((s, i) => {
    const prev = i ? shots[i - 1] : null
    const srcId: string | null = typeof s.carryFromShotId === 'string' ? s.carryFromShotId : s.carryFromPrev && prev && prev.episode === s.episode ? prev.id : null
    if (!srcId) return
    const src = shots.find((t) => t.id === srcId)
    if (!src || src.render) return
    const to = pick(i, s, true) || pick(i, s, false)
    rewired.push({ id: s.id, from: srcId, to: to ? to.id : null, reason: `carry source ${srcId} not rendered (${src.renderSkip?.reason})` })
    if (to) {
      s.carryFromShotId = to.id
      s.carryRewiredFrom = srcId
      s.carryFromPrev = Boolean(prev && prev.id === to.id)
    } else {
      if ('carryFromShotId' in s) s.carryFromShotId = null
      s.carryFromPrev = false
      s.establishing = true
      s.carryRewiredFrom = srcId
    }
  })
  return { exp: { ...exp, shots: shots as VideoPipelineExport['shots'] }, skipped: shots.filter((s) => !s.render).map((s) => ({ id: s.id, reason: s.renderSkip!.reason })), rewired }
}
