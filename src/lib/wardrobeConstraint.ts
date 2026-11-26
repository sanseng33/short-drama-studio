/**
 * Explicit wardrobeRefs constraints and state resolution (generic, no show-specific hardcoding).
 *
 * A setting fact that literally names `wardrobeRefs.<key>` is a structured constraint, not a
 * prose guess (we do not infer a look from garment words in visual/action text).
 * Resolution never invents a refSet key, never aliases a derived key onto a different refs key,
 * and never marks reviews / run-ready as passed.
 */
import type { Character } from '../types'

export type WardrobeResolveSource = 'shot' | 'constraint' | 'character' | 'refSet' | 'refImage-key' | 'default'

export interface WardrobeRefConstraint {
  characterId: string
  state: string
  factIndex: number
}

export interface RejectedWardrobeRefConstraint {
  state: string
  factIndex: number
  reason: 'unknown_key' | 'unresolved_character' | 'character_lacks_key'
  characterId?: string
}

export interface WardrobeConstraintParse {
  applied: WardrobeRefConstraint[]
  rejected: RejectedWardrobeRefConstraint[]
}

const REF_RE = /wardrobeRefs\.([A-Za-z][A-Za-z0-9_-]*)/g

export function wardrobeRefKeys(c: Pick<Character, 'wardrobeRefs'> | undefined | null): string[] {
  return Object.keys(c?.wardrobeRefs || {}).filter((k) => k.trim() !== '')
}

function mentionsCharacter(fact: string, c: Character): boolean {
  const hay = fact || ''
  if (c.name && hay.includes(c.name)) return true
  if (c.baseName && c.baseName !== c.name && hay.includes(c.baseName)) return true
  if (c.id && new RegExp(`(?:^|[^A-Za-z0-9_])${c.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z0-9_]|$)`).test(hay)) return true
  return false
}

export function parseExplicitWardrobeRefConstraints(
  facts: readonly string[] | undefined | null,
  chars: readonly Character[],
): WardrobeConstraintParse {
  const applied: WardrobeRefConstraint[] = []
  const rejected: RejectedWardrobeRefConstraint[] = []
  const seen = new Set<string>()
  ;(facts || []).forEach((raw, factIndex) => {
    const fact = (raw || '').trim()
    if (!fact) return
    const keys = [...fact.matchAll(REF_RE)].map((m) => m[1])
    if (!keys.length) return
    for (const state of keys) {
      const named = chars.filter((c) => mentionsCharacter(fact, c))
      const owners = chars.filter((c) => Boolean(c.wardrobeRefs?.[state]?.refSet || c.wardrobeRefs?.[state]))
      let targets: Character[] = []
      if (named.length) {
        const ok = named.filter((c) => owners.some((o) => o.id === c.id))
        const missing = named.filter((c) => !owners.some((o) => o.id === c.id))
        for (const c of missing) rejected.push({ state, factIndex, reason: 'character_lacks_key', characterId: c.id })
        targets = ok
        if (!ok.length && !missing.length) rejected.push({ state, factIndex, reason: 'unresolved_character' })
      } else if (owners.length === 1) {
        targets = owners
      } else if (owners.length === 0) {
        rejected.push({ state, factIndex, reason: 'unknown_key' })
      } else {
        rejected.push({ state, factIndex, reason: 'unresolved_character' })
      }
      for (const c of targets) {
        const sig = `${c.id}:${state}`
        if (seen.has(sig)) continue
        seen.add(sig)
        applied.push({ characterId: c.id, state, factIndex })
      }
    }
  })
  return { applied, rejected }
}

/**
 * Default / fallback state for a character card.
 * Prefer an exact wardrobeRefs refSet match for `refImage` over slicing `${characterKey}_` into a
 * key that does not exist on wardrobeRefs (that path is fail-closed at asset lookup).
 */
export function baseWardrobeStateFromCard(
  c: { wardrobeState?: string | null; refImage?: string | null; characterKey?: string | null; wardrobeRefs?: Character['wardrobeRefs'] | null; id?: string } | undefined,
): { state: string; source: Exclude<WardrobeResolveSource, 'shot' | 'constraint'> } {
  if (!c) return { state: 'default', source: 'default' }
  if (c.wardrobeState?.trim()) return { state: c.wardrobeState.trim(), source: 'character' }
  const ref = (c.refImage || '').trim()
  const refs = c.wardrobeRefs || {}
  if (ref) {
    const bySet = Object.entries(refs).find(([, r]) => r?.refSet && r.refSet === ref)
    if (bySet) return { state: bySet[0], source: 'refSet' }
  }
  const key = (c.characterKey || '').trim()
  if (ref && key && ref.startsWith(`${key}_`) && ref.length > key.length + 1) {
    const sliced = ref.slice(key.length + 1)
    if (refs[sliced]) return { state: sliced, source: 'refImage-key' }
    if (!Object.keys(refs).length) return { state: sliced, source: 'refImage-key' }
    // refs exist but sliced key is not among them — do not invent an alias
    return { state: 'default', source: 'default' }
  }
  return { state: 'default', source: 'default' }
}

export function resolveWardrobeState(
  c: Character,
  opts: { shotState?: string | null; constraints?: readonly WardrobeRefConstraint[] } = {},
): { state: string; source: WardrobeResolveSource; unresolvedKey?: string } {
  const shot = opts.shotState?.trim()
  if (shot) {
    if (c.wardrobeRefs && Object.keys(c.wardrobeRefs).length && !c.wardrobeRefs[shot]) {
      return { state: shot, source: 'shot', unresolvedKey: shot }
    }
    return { state: shot, source: 'shot' }
  }
  const hit = (opts.constraints || []).find((x) => x.characterId === c.id)
  if (hit) {
    if (c.wardrobeRefs && !c.wardrobeRefs[hit.state]) {
      return { ...baseWardrobeStateFromCard(c), unresolvedKey: hit.state }
    }
    return { state: hit.state, source: 'constraint' }
  }
  return baseWardrobeStateFromCard(c)
}

/** Exact key lookup only. Never alias `formal_nologo` → `formal`. */
export function lookupWardrobeRef(c: Pick<Character, 'wardrobeRefs'> | undefined, state: string) {
  const key = (state || '').trim()
  if (!key) return { key, ref: undefined, unresolved: true as const }
  const ref = c?.wardrobeRefs?.[key]
  return { key, ref, unresolved: !ref }
}
