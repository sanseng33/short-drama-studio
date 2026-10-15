/** Shot ↔ character mapping helpers (pure). */
import type { Character, Shot } from '../types'

/** Fallback: detect characters whose name appears in visual / action / dialogue text. */
export function detectCharacterIds(
  shot: Pick<Shot, 'visual' | 'action' | 'dialogue'> & { seedancePrompt?: string },
  chars: Character[],
): string[] {
  const text = [shot.visual, shot.action, shot.dialogue].filter(Boolean).join('\n')
  return chars.filter((c) => c.name && text.includes(c.name)).map((c) => c.id)
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
    return { ...s, characterIds: ids }
  })
}
