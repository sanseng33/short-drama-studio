/**
 * Generator / re-export post-process for structured shot fields.
 * Synthesizes firstFrame / events when missing, drops pure-offscreen voiceOnly
 * characters from characterIds, and backfills empty wardrobeState from the
 * timeline or character-card base. Does not mark reviews or run-ready as passed.
 * Synthesized visibility is only unverified or offscreen (never full / verified).
 */
import type { Character, Shot } from '../../types'
import { mapNamesToIds, shotCharacterIds } from '../shotCast'
import { resolveWardrobeState, type WardrobeRefConstraint, parseExplicitWardrobeRefConstraints } from '../wardrobeConstraint'
import type { FirstFrameEntry, ShotEvent } from './types'

export type FillShotChars = Pick<Character, 'id' | 'name'> &
  Partial<Pick<Character, 'baseName' | 'wardrobeState' | 'refImage' | 'characterKey' | 'wardrobeRefs' | 'wardrobeTimeline'>>

function resolveStateKeys(state: unknown, chars: readonly FillShotChars[]): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const ids: string[] = []
  for (const key of Object.keys(state as object)) {
    const [id] = mapNamesToIds([key], chars as Character[])
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** In voiceOnly and not in startState: pure offscreen, including when startState is empty. */
export function offscreenOnlyIds(shot: Pick<Shot, 'startState' | 'voiceOnly' | 'characterIds'>, chars: readonly FillShotChars[]): string[] {
  const startIds = resolveStateKeys(shot.startState, chars)
  const voiceIds = mapNamesToIds(shot.voiceOnly, chars as Character[])
  return voiceIds.filter((id) => !startIds.includes(id))
}

export function dropOffscreenOnlyCharacterIds<T extends Pick<Shot, 'characterIds' | 'startState' | 'voiceOnly'>>(
  shot: T,
  chars: readonly FillShotChars[],
): T {
  const drop = new Set(offscreenOnlyIds(shot, chars))
  if (!drop.size || !Array.isArray(shot.characterIds)) return shot
  const next = shot.characterIds.filter((id) => !drop.has(id))
  if (next.length === shot.characterIds.length) return shot
  return { ...shot, characterIds: next }
}

function synthesizeFirstFrameAndEvents(
  shot: Shot,
  chars: readonly FillShotChars[],
): { firstFrame: NonNullable<Shot['firstFrame']>; events: NonNullable<Shot['events']> } {
  const charIds = shotCharacterIds(shot, chars as Character[])
  const startIds = resolveStateKeys(shot.startState, chars)
  const endIds = resolveStateKeys(shot.endState, chars)
  const voiceIds = mapNamesToIds(shot.voiceOnly, chars as Character[])
  const offOnly = new Set(voiceIds.filter((id) => !startIds.includes(id)))
  const involved = [...new Set([...charIds, ...startIds, ...endIds, ...voiceIds])]
  const firstFrame: FirstFrameEntry[] = []
  const seen = new Set<string>()
  const add = (id: string, kind: 'unverified' | 'offscreen') => {
    if (seen.has(id)) return
    seen.add(id)
    firstFrame.push({ id, kind })
  }
  if (startIds.length) {
    for (const id of involved) add(id, startIds.includes(id) ? 'unverified' : 'offscreen')
  } else {
    for (const id of charIds) {
      if (offOnly.has(id)) add(id, 'offscreen')
      else add(id, 'unverified')
    }
    for (const id of voiceIds) add(id, 'offscreen')
  }
  const events: ShotEvent[] = []
  if (startIds.length) {
    for (const id of involved) {
      const laterOnScreen = charIds.includes(id) || endIds.includes(id)
      if (!startIds.includes(id) && laterOnScreen && !offOnly.has(id)) {
        events.push({ id, kind: 'start_offscreen' })
        events.push({ id, kind: 'enter' })
      }
    }
  }
  return { firstFrame, events }
}

function hasFirstFrame(shot: Shot, chars: readonly FillShotChars[]): boolean {
  const raw = shot.firstFrame
  if (!Array.isArray(raw) || !raw.length) return false
  return raw.some((row) => row && typeof row === 'object' && mapNamesToIds([String(row.id ?? '')], chars as Character[]).length)
}

function backfillWardrobeForShot(
  shot: Shot,
  chars: readonly FillShotChars[],
  cur: Map<string, string>,
  constraints: readonly WardrobeRefConstraint[],
): Record<string, string> | undefined {
  const existing =
    shot.wardrobeState && typeof shot.wardrobeState === 'object' && !Array.isArray(shot.wardrobeState)
      ? { ...(shot.wardrobeState as Record<string, string>) }
      : {}
  const involved = [
    ...new Set([
      ...shotCharacterIds(shot, chars as Character[]),
      ...resolveStateKeys(shot.startState, chars),
      ...mapNamesToIds(shot.voiceOnly, chars as Character[]),
    ]),
  ]
  if (!involved.length && !Object.keys(existing).length) return Object.keys(existing).length ? existing : undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(existing)) {
    if (typeof v === 'string' && v.trim()) {
      const [id] = mapNamesToIds([k], chars as Character[])
      out[id || k] = v.trim()
    }
  }
  for (const id of involved) {
    if (out[id]?.trim()) {
      cur.set(id, out[id].trim())
      continue
    }
    const c = chars.find((x) => x.id === id) as Character | undefined
    const resolved = c
      ? resolveWardrobeState(c, { shotState: cur.get(id) || null, constraints })
      : { state: cur.get(id) || 'default', source: 'default' as const }
    // Prefer an already-carried timeline state, then card/constraint resolution.
    const state = (cur.get(id) || resolved.state || '').trim()
    if (!state) continue
    // Skip a bare default when the card has no refs / base signal (do not invent a look).
    const hasCard =
      Boolean(c?.wardrobeState?.trim()) ||
      Boolean(c?.refImage?.trim()) ||
      Boolean(c?.wardrobeRefs && Object.keys(c.wardrobeRefs).length)
    if (resolved.source === 'default' && state === 'default' && !hasCard && !cur.has(id)) continue
    out[id] = state
    cur.set(id, state)
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Pure: returns new shot objects. Existing firstFrame / events / non-empty wardrobe keys are kept.
 * review.status / claims are not touched (this is not a verification step).
 */
export function fillStructuredShotFields<T extends Shot>(
  shots: T[],
  chars: readonly FillShotChars[],
  opts: { facts?: readonly string[] | null } = {},
): T[] {
  const constraints = parseExplicitWardrobeRefConstraints(opts.facts, chars as Character[]).applied
  const cur = new Map<string, string>()
  for (const c of chars) {
    const base = resolveWardrobeState(c as Character, { constraints })
    if (base.state) cur.set(c.id, base.state)
  }
  return shots.map((shot0) => {
    let shot: T = { ...shot0 }
    const wardrobeState = backfillWardrobeForShot(shot, chars, cur, constraints)
    if (wardrobeState) shot = { ...shot, wardrobeState }
    shot = dropOffscreenOnlyCharacterIds(shot, chars)
    if (!hasFirstFrame(shot, chars)) {
      const syn = synthesizeFirstFrameAndEvents(shot, chars)
      shot = {
        ...shot,
        firstFrame: syn.firstFrame,
        events: Array.isArray(shot.events) && shot.events.length ? shot.events : syn.events,
      }
    } else if (!Array.isArray(shot.events)) {
      shot = { ...shot, events: [] }
    }
    return shot
  })
}
