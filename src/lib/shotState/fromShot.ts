/**
 * Build a ShotStateDoc from a Shot without inventing verified reviews.
 *
 * Precedence:
 *  1. Explicit firstFrame / events on the Shot (structured fields from the generator or a fixture).
 *  2. Structured startState / endState already on the Shot (keys resolve to character ids).
 *  3. Legacy characterIds + voiceOnly migration, with pure offscreen VO marked offscreen
 *     (not dumped into firstFrame as an unverified on-screen presence).
 *
 * Visual / action prose is never parsed to decide visibility or to mark a field verified.
 */
import type { Shot } from '../../types'
import { mapNamesToIds, shotCharacterIds } from '../shotCast'
import { hashText } from './hashing'
import { normalizeSource } from './hashing'
import {
  FIRST_FRAME_KINDS,
  SHOT_EVENT_KINDS,
  SHOT_STATE_SPEC,
  type CostumeEntry,
  type FirstFrameEntry,
  type FirstFrameKind,
  type MigrationInfo,
  type ShotEvent,
  type ShotEventKind,
  type ShotStateDoc,
  type SpeechEntry,
  type StateText,
} from './types'
import { migrateLegacyShot, type CharLike } from './migrate'
import { baseWardrobeStateFromCard } from '../wardrobeConstraint'
import type { Character } from '../../types'

export type ShotStateBuildOrigin = MigrationInfo['origin']

const isKind = (v: unknown): v is FirstFrameKind =>
  typeof v === 'string' && (FIRST_FRAME_KINDS as readonly string[]).includes(v)
const isEventKind = (v: unknown): v is ShotEventKind =>
  typeof v === 'string' && (SHOT_EVENT_KINDS as readonly string[]).includes(v)

function userText(field: string, text: string): StateText {
  return {
    field,
    text,
    provenance: { field, source: 'user', textHash: hashText(text), invalidated: false, reviewRequired: false },
  }
}

function textsOf(shot: Shot): StateText[] {
  const texts: StateText[] = []
  if (typeof shot.action === 'string' && shot.action.trim()) texts.push(userText('action', shot.action))
  if (typeof shot.seedancePrompt === 'string' && shot.seedancePrompt.trim()) texts.push(userText('seedancePrompt', shot.seedancePrompt))
  return texts
}

function resolveStateKeys(state: unknown, chars: readonly CharLike[]): string[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const ids: string[] = []
  for (const key of Object.keys(state as object)) {
    const [id] = mapNamesToIds([key], chars as never)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function parseFirstFrame(raw: unknown, chars: readonly CharLike[]): FirstFrameEntry[] | null {
  if (!Array.isArray(raw) || !raw.length) return null
  const out: FirstFrameEntry[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const rec = row as { id?: unknown; kind?: unknown; parts?: unknown }
    const [id] = mapNamesToIds([String(rec.id ?? '')], chars as never)
    if (!id || !isKind(rec.kind)) return null
    const entry: FirstFrameEntry = { id, kind: rec.kind }
    if (Array.isArray(rec.parts)) {
      const parts = rec.parts.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      if (parts.length) entry.parts = parts
    }
    out.push(entry)
  }
  return out
}

function parseEvents(raw: unknown, chars: readonly CharLike[]): ShotEvent[] | null {
  if (!Array.isArray(raw)) return null
  const out: ShotEvent[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') return null
    const rec = row as { id?: unknown; kind?: unknown; atSec?: unknown }
    const [id] = mapNamesToIds([String(rec.id ?? '')], chars as never)
    if (!id || !isEventKind(rec.kind)) return null
    const ev: ShotEvent = { id, kind: rec.kind }
    if (typeof rec.atSec === 'number' && Number.isFinite(rec.atSec)) ev.atSec = rec.atSec
    out.push(ev)
  }
  return out
}

function costumeFromShot(shot: Shot, chars: readonly CharLike[]): CostumeEntry[] | undefined {
  const raw = (shot as Shot & { wardrobeState?: unknown }).wardrobeState
  const out: CostumeEntry[] = []
  const seen = new Set<string>()
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v !== 'string' || !v.trim()) continue
      const [id] = mapNamesToIds([k], chars as never)
      if (!id) continue
      out.push({ id, state: v.trim() })
      seen.add(id)
    }
  }
  // Empty wardrobeState: backfill from the character-card base (refSet / wardrobeState / refs).
  // Do not invent pajama (or any other look) unless that is the card base.
  if (!out.length) {
    const startIds = resolveStateKeys(shot.startState, chars)
    const voiceIds = mapNamesToIds(shot.voiceOnly, chars as never)
    const charIds = shotCharacterIds(shot, chars as never)
    const involved = [...new Set([...charIds, ...startIds, ...voiceIds])]
    for (const id of involved) {
      if (seen.has(id)) continue
      const c = chars.find((x) => x.id === id) as (CharLike & Partial<Character>) | undefined
      const base = baseWardrobeStateFromCard(c)
      const hasCard =
        Boolean(c && ((c as Partial<Character>).wardrobeState?.trim() || (c as Partial<Character>).refImage?.trim() || ((c as Partial<Character>).wardrobeRefs && Object.keys((c as Partial<Character>).wardrobeRefs || {}).length)))
      if (base.source === 'default' && base.state === 'default' && !hasCard) continue
      if (!base.state) continue
      out.push({ id, state: base.state })
      seen.add(id)
    }
  }
  return out.length ? out : undefined
}

function speechOf(voiceIds: string[]): SpeechEntry[] {
  return [...new Set(voiceIds)].map((id) => ({ id, mode: 'voice_only' as const }))
}

function docOf(
  shot: Shot,
  origin: ShotStateBuildOrigin,
  source: Parameters<typeof normalizeSource>[0],
  migration: MigrationInfo,
): ShotStateDoc {
  return {
    spec: SHOT_STATE_SPEC,
    shotId: shot.id || `shot-${shot.shotNo ?? 0}`,
    source: normalizeSource(source),
    texts: textsOf(shot),
    reviews: [],
    fields: [],
    migration,
  }
}

/** True when the shot carries a well-formed firstFrame list (and optional events). */
export function hasExplicitShotState(shot: Shot, chars: readonly CharLike[] = []): boolean {
  return parseFirstFrame((shot as Shot & { firstFrame?: unknown }).firstFrame, chars) != null
}

/**
 * Prefer explicit structured fields; otherwise startState / endState; otherwise legacy + VO offscreen.
 * Reviews stay empty (unknown). This is not a verification step.
 */
export function shotStateFromShot(shot: Shot, chars: readonly CharLike[] = []): ShotStateDoc {
  const charIds = shotCharacterIds(shot, chars as never)
  const fromVoiceOnly = Array.isArray(shot.voiceOnly) ? shot.voiceOnly.filter((x): x is string => typeof x === 'string') : []
  const voiceIds = mapNamesToIds(shot.voiceOnly, chars as never)
  const unresolvedVoiceOnly = fromVoiceOnly.filter((v) => !mapNamesToIds([v], chars as never).length)
  const voiceOrRaw = [...voiceIds, ...unresolvedVoiceOnly]
  const costume = costumeFromShot(shot, chars)
  const explicitFf = parseFirstFrame((shot as Shot & { firstFrame?: unknown }).firstFrame, chars)
  const explicitEv = parseEvents((shot as Shot & { events?: unknown }).events, chars)

  if (explicitFf) {
    const ev = explicitEv ?? []
    const order = [...new Set([...explicitFf.map((e) => e.id), ...charIds, ...voiceOrRaw, ...ev.map((e) => e.id)])]
    return docOf(
      shot,
      'shot_fields',
      {
        cast: order,
        displayOrder: order,
        firstFrame: explicitFf,
        speech: speechOf(voiceOrRaw),
        events: ev,
        ...(costume ? { costume } : {}),
      },
      { origin: 'shot_fields', fromCharacterIds: charIds, fromVoiceOnly, unresolvedVoiceOnly },
    )
  }

  const startIds = resolveStateKeys(shot.startState, chars)
  const endIds = resolveStateKeys(shot.endState, chars)
  if (startIds.length) {
    const involved = [...new Set([...charIds, ...voiceOrRaw, ...startIds, ...endIds])]
    const present = new Set(startIds)
    const firstFrame: FirstFrameEntry[] = involved.map((id) => ({
      id,
      kind: present.has(id) ? ('unverified' as const) : ('offscreen' as const),
    }))
    const events: ShotEvent[] = []
    for (const id of involved) {
      const laterOnScreen = charIds.includes(id) || endIds.includes(id)
      const inStart = present.has(id)
      if (!inStart && laterOnScreen) {
        events.push({ id, kind: 'start_offscreen' })
        events.push({ id, kind: 'enter' })
      }
    }
    return docOf(
      shot,
      'start_state',
      {
        cast: involved,
        displayOrder: involved,
        firstFrame,
        speech: speechOf(voiceOrRaw),
        events,
        ...(costume ? { costume } : {}),
      },
      { origin: 'start_state', fromCharacterIds: charIds, fromVoiceOnly, unresolvedVoiceOnly },
    )
  }

  // Legacy fallback: keep migrate for shots with no structured presence, but mark
  // pure offscreen VO as offscreen rather than unverified-on-frame.
  // A character in voiceOnly and not in startState (including empty startState)
  // must not be marked visible; they are offscreen-only even if listed in characterIds.
  const legacy = migrateLegacyShot(shot, chars)
  const offOnly = new Set(voiceIds.filter((id) => !startIds.includes(id)))
  const firstFrame: FirstFrameEntry[] = []
  const seen = new Set<string>()
  for (const id of charIds) {
    if (offOnly.has(id)) continue
    firstFrame.push({ id, kind: 'unverified' })
    seen.add(id)
  }
  for (const id of voiceOrRaw) {
    if (seen.has(id)) continue
    firstFrame.push({ id, kind: 'offscreen' })
    seen.add(id)
  }
  const order = [...new Set([...charIds, ...voiceOrRaw])]
  return {
    ...legacy,
    source: normalizeSource({
      cast: order,
      displayOrder: order,
      firstFrame,
      speech: speechOf(voiceOrRaw),
      events: [],
      ...(costume ? { costume } : {}),
    }),
  }
}
