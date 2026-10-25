/**
 * Voice (TTS) assignment for dialogue lines — data-driven, no show data in code.
 *
 * Character data carries `voice`: a voice-library name (string) or { description?, id? }.
 * Look variants of one person share a characterKey; a variant without its own voice inherits the voice of the
 * first variant with the same characterKey that has one (explicit voice always wins).
 * Off-list bit parts (no character id) resolve via the pack-level `project.voices` map { speakerName: voice }.
 * A dialogue line whose voice cannot be resolved is an export error (missingVoices).
 */
export type VoiceSpec = string | { description?: string; id?: string }

export interface VoiceChar {
  id: string
  name?: string
  baseName?: string
  characterKey?: string | null
  voice?: VoiceSpec | null
}

/** a usable voice: non-empty string, or an object with a non-empty id or description (trimmed copy) */
export function normalizeVoice(v: unknown): VoiceSpec | null {
  if (typeof v === 'string') return v.trim() || null
  if (v && typeof v === 'object') {
    const o = v as { description?: unknown; id?: unknown }
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const description = typeof o.description === 'string' ? o.description.trim() : ''
    if (!id && !description) return null
    return { ...(description ? { description } : {}), ...(id ? { id } : {}) }
  }
  return null
}

/** character id → resolved voice (own, else inherited from a same-characterKey variant), null when none */
export function characterVoices(chars: VoiceChar[]): Map<string, VoiceSpec | null> {
  const byKey = new Map<string, VoiceSpec>()
  for (const c of chars) {
    const k = c.characterKey?.trim()
    const v = normalizeVoice(c.voice)
    if (k && v && !byKey.has(k)) byKey.set(k, v)
  }
  return new Map(chars.map((c) => [c.id, normalizeVoice(c.voice) ?? (c.characterKey?.trim() ? byKey.get(c.characterKey.trim()) ?? null : null)]))
}

/** characters with the resolved (inherited) voice filled in; characters without any voice are left as they are */
export function withCharacterVoices<T extends VoiceChar>(chars: T[]): T[] {
  const m = characterVoices(chars)
  return chars.map((c) => {
    const v = m.get(c.id)
    return v ? { ...c, voice: v } : c
  })
}

interface LineLike {
  speaker?: string | null
  speakerName?: string | null
  text: string
}

/** voice of one line: speaker id → character voice; else speakerName = a character name / baseName; else project.voices */
export function lineVoice(l: LineLike, chars: VoiceChar[], extra: Record<string, unknown> = {}): VoiceSpec | null {
  const m = characterVoices(chars)
  if (l.speaker && m.get(l.speaker)) return m.get(l.speaker)!
  const n = l.speakerName?.trim()
  if (!n) return null
  const c = chars.find((x) => x.name === n || x.baseName === n)
  if (c && m.get(c.id)) return m.get(c.id)!
  return normalizeVoice(extra[n])
}

/** every line gets `voice` (null when unresolved) */
export function withLineVoices<L extends LineLike>(lines: L[], chars: VoiceChar[], extra: Record<string, unknown> = {}): (L & { voice: VoiceSpec | null })[] {
  return lines.map((l) => ({ ...l, voice: lineVoice(l, chars, extra) }))
}

/** dialogue lines without a resolvable voice: "<shotId>: <speakerName|speaker>「text」" (empty = ok) */
export function missingVoices(shots: { id: string; dialogueLines?: (LineLike & { voice?: VoiceSpec | null })[] }[]): string[] {
  const out: string[] = []
  for (const s of shots)
    for (const l of s.dialogueLines || []) if (!normalizeVoice(l.voice)) out.push(`${s.id}: ${l.speakerName || l.speaker || '?'}「${l.text}」`)
  return out
}
