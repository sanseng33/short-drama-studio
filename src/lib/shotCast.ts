/** Shot ↔ character mapping helpers (pure). */
import type { Character, Shot } from '../types'
import { stripRealmLabels } from './pictureRules'

/** Fallback: detect characters whose name appears in visual / action / dialogue text. */
export function detectCharacterIds(
  shot: Pick<Shot, 'visual' | 'action' | 'dialogue'> & { seedancePrompt?: string },
  chars: Character[],
): string[] {
  const text = [shot.visual, shot.action, shot.dialogue].filter(Boolean).join('\n')
  return chars
    .filter((c) => {
      const names = [c.name, c.baseName, stripRealmLabels(c.name || '')].map((n) => (n || '').trim()).filter((n) => n.length >= 1)
      return names.some((n) => text.includes(n))
    })
    .map((c) => c.id)
}

/** Map LLM-provided names or ids to project character ids (order-preserving, deduped). */
export function mapNamesToIds(list: unknown, chars: Character[]): string[] {
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const v of list) {
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) continue
    const hit =
      chars.find((c) => c.id === t) ||
      chars.find((c) => c.name === t) ||
      chars.find((c) => c.baseName === t) ||
      chars.find((c) => c.name && (t.includes(c.name) || c.name.includes(t)))
    if (hit && !out.includes(hit.id)) out.push(hit.id)
  }
  return out
}

/** Resolve characterIds for a shot: stored → name detection. Filters stale ids. */
export function shotCharacterIds(shot: Shot, chars: Character[]): string[] {
  if (Array.isArray(shot.characterIds)) {
    const valid = new Set(chars.map((c) => c.id))
    return shot.characterIds.filter((id) => valid.has(id))
  }
  return detectCharacterIds(shot, chars)
}

/** Derive speaker id from dialogue like「名字：…」/「名字（情绪）：…」. */
export function speakerId(dialogue: string, chars: Character[]): string | undefined {
  const m = dialogue?.trim().match(/^([^：:（(「]{1,12})\s*(?:[（(][^）)]*[）)])?\s*[：:]/)
  if (!m) return undefined
  const name = m[1].trim()
  return (chars.find((c) => c.name === name) || chars.find((c) => c.name && name.includes(c.name)))?.id
}

type RawShot = Partial<Shot> & { characters?: unknown; characterNames?: unknown }
const strArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : typeof v === 'string' && v.trim() ? v.split(/[，,、]/).map((x) => x.trim()).filter(Boolean) : undefined


function mapWardrobeState(raw: unknown, chars: Character[]): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string' || !v.trim()) continue
    const ids = mapNamesToIds([k], chars)
    if (ids.length) out[ids[0]] = v.trim()
  }
  return Object.keys(out).length ? out : undefined
}

function mapFirstFrame(raw: unknown, chars: Character[]): Shot['firstFrame'] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: NonNullable<Shot['firstFrame']> = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { id?: unknown; kind?: unknown; parts?: unknown }
    const ids = mapNamesToIds([String(rec.id ?? '')], chars)
    if (!ids.length || typeof rec.kind !== 'string' || !rec.kind.trim()) continue
    const entry: NonNullable<Shot['firstFrame']>[number] = { id: ids[0], kind: rec.kind.trim() }
    if (Array.isArray(rec.parts)) {
      const parts = rec.parts.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      if (parts.length) entry.parts = parts
    }
    out.push(entry)
  }
  return out.length ? out : undefined
}

function mapShotEvents(raw: unknown, chars: Character[]): Shot['events'] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const out: NonNullable<Shot['events']> = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const rec = row as { id?: unknown; kind?: unknown; atSec?: unknown }
    const ids = mapNamesToIds([String(rec.id ?? '')], chars)
    if (!ids.length || typeof rec.kind !== 'string' || !rec.kind.trim()) continue
    const ev: NonNullable<Shot['events']>[number] = { id: ids[0], kind: rec.kind.trim() }
    if (typeof rec.atSec === 'number' && Number.isFinite(rec.atSec)) ev.atSec = rec.atSec
    out.push(ev)
  }
  return out.length ? out : undefined
}

/** Normalize LLM shot JSON: ids/shotNo + characterIds from names/ids, fallback detection. */
export function normalizeLlmShots(raw: RawShot[], ep: number, chars: Character[]): Shot[] {
  return raw.map((x, k) => {
    const { characters, characterNames, ...rest } = x
    const s = {
      ...rest,
      id: x.id || `s${ep}-${k + 1}`,
      shotNo: x.shotNo || k + 1,
    } as Shot
    let ids = mapNamesToIds(x.characterIds, chars)
    if (!ids.length) ids = mapNamesToIds(characters, chars)
    if (!ids.length) ids = mapNamesToIds(characterNames, chars)
    if (!ids.length) ids = detectCharacterIds(s, chars)
    const sfx = strArr(x.sfx)
    const overlayText = strArr(x.overlayText)
    const voiceOnly = strArr(x.voiceOnly)
    const wardrobeState = mapWardrobeState(x.wardrobeState, chars)
    const firstFrame = mapFirstFrame(x.firstFrame, chars)
    const events = mapShotEvents(x.events, chars)
    return {
      ...s,
      characterIds: ids,
      ...(sfx ? { sfx } : {}),
      ...(overlayText ? { overlayText } : {}),
      ...(voiceOnly ? { voiceOnly } : {}),
      ...(wardrobeState ? { wardrobeState } : {}),
      ...(firstFrame ? { firstFrame } : {}),
      ...(events ? { events } : {}),
    }
  })
}
