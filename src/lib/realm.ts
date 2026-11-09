/**
 * Scene realm (generic): every shot gets `realm` reality | dream | memory, one value per scene.
 *   - explicit: the generator's per-shot `realm` (or legacy `sceneMode`) — the scene takes its first valid value, and
 *     a different explicit value starts a new scene even at the same place;
 *   - else inferred per scene run (same episode + location + time band): the location text names a dream / memory
 *     (梦境 / 回忆 / 闪回 …), or more of the run's shots vote dream / memory than reality (visual / action text, or a
 *     cast look variant whose qualifier says 梦 / 回忆 / 现实; shots with no signal do not vote); else reality.
 * Characters get `realm` from their own qualifier (name minus baseName, wardrobeState): 梦 → dream, 回忆 / 闪回 /
 * 过去 → memory, 现实 → reality; untagged characters belong to every realm.
 * Look variants (one characterKey) may switch at a realm boundary: the cast-consistency island check skips it,
 * carries break there (sceneGroup.breakCarries) and state continuity never crosses it.
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { locationKeyOf } from './sceneGroup'

export type Realm = 'reality' | 'dream' | 'memory'
const DREAM_RE = /梦境|梦中|梦里|梦见|做梦|噩梦|美梦|梦醒前|dream/i
const MEMORY_RE = /回忆|闪回|回想|记忆中|记忆里|往昔|多年前|小时候|童年|flashback|memory/i
const REALITY_RE = /现实|reality/i

export const normRealm = (v: unknown): Realm | null => {
  const t = String(v ?? '').trim().toLowerCase()
  if (!t) return null
  if (/^(dream)$|梦/.test(t)) return 'dream'
  if (/^(memory|flashback)$|回忆|闪回|记忆/.test(t)) return 'memory'
  if (/^(reality|real)$|现实/.test(t)) return 'reality'
  return null
}
/** realm words in a text (dream wins over memory when both appear; 惊醒 / 醒来 after 梦 = waking up in reality, not a dream) */
export function realmOfText(t: string): Realm | null {
  const x = (t || '').replace(/从?(?:噩梦|梦境|梦中|梦里|梦)中?(?:惊醒|醒来|醒过来)/g, '')
  if (DREAM_RE.test(x)) return 'dream'
  if (MEMORY_RE.test(x)) return 'memory'
  return null
}
type C = VideoPipelineExport['characters'][number] & { realm?: Realm; wardrobeState?: string }
/** a character variant's realm tag from its qualifier (full name minus base name, wardrobe state) */
export function characterRealm(c: C): Realm | null {
  const name = (c.name || '').trim()
  const base = (c.baseName || '').trim()
  const q = `${base && name.startsWith(base) ? name.slice(base.length) : (name.match(/[（(]([^）)]*)[）)]/)?.[1] ?? '')} ${c.wardrobeState || ''}`
  return realmOfText(q) || (REALITY_RE.test(q) ? 'reality' : null)
}

type S = VideoPipelineShot & Record<string, any>
export interface RealmReport {
  scenes: { episode: number; location: string; shots: string[]; realm: Realm; source: 'generator' | 'location' | 'text' | 'default' }[]
  characters: Record<string, Realm>
  /** realm → look variant: a shot casts a variant tagged for another realm while exactly one sibling variant is tagged for this one */
  variantMismatches: { shotId: string; realm: Realm; cast: string; expected: string }[]
}

export function assignRealms(exp: VideoPipelineExport): { exp: VideoPipelineExport; report: RealmReport } {
  const chars = exp.characters.map((c) => ({ ...c })) as C[]
  const crealm: Record<string, Realm> = {}
  for (const c of chars) {
    const r = normRealm(c.realm) || characterRealm(c)
    if (r) (c.realm = r), (crealm[c.id] = r)
  }
  const shots: S[] = exp.shots.map((s) => ({ ...s }) as S)
  // idempotent: a realm this pass inferred earlier (realmSource ≠ generator) is re-inferred, not taken as explicit
  const explicit = (s: S) => (s.realmSource && s.realmSource !== 'generator' ? null : normRealm(s.realm ?? s.sceneMode))
  const runs: S[][] = []
  const runKey = (s: S) => `${s.episode}|${locationKeyOf(s)}|${s.timeBand || s.timeOfDay || ''}`
  for (const s of shots) {
    const last = runs[runs.length - 1]
    // an explicit realm change starts a new scene even at the same place (e.g. a dream of the same room)
    const ex = explicit(s)
    const lastEx = last && last.map(explicit).filter(Boolean).pop()
    if (last && runKey(last[0]) === runKey(s) && !(ex && lastEx && ex !== lastEx)) last.push(s)
    else runs.push([s])
  }
  const rep: RealmReport = { scenes: [], characters: crealm, variantMismatches: [] }
  for (const run of runs) {
    const gen = run.map(explicit).find(Boolean)
    let realm: Realm = 'reality'
    let source: RealmReport['scenes'][number]['source'] = 'default'
    const locR = realmOfText(`${run[0].location || ''} ${run[0].sceneLabel || ''}`)
    if (gen) (realm = gen), (source = 'generator')
    else if (locR) (realm = locR), (source = 'location')
    else {
      // per shot: dream / memory words or a cast variant tagged dream / memory; else reality words or a reality-tagged
      // variant; shots with neither (empty establishing shots, untagged cast) do not vote
      const votes = run.map((s) => {
        const tags = [...(s.characterIds || []), ...(s.voiceOnly || [])].map((id: string) => crealm[id]).filter(Boolean) as Realm[]
        return realmOfText(`${s.visual || ''} ${s.action || ''}`) || tags.find((r) => r !== 'reality') || (REALITY_RE.test(`${s.visual || ''} ${s.action || ''}`) || tags.includes('reality') ? 'reality' : null)
      })
      const n = (r: Realm) => votes.filter((v) => v === r).length
      const best = (['dream', 'memory'] as const).filter((r) => n(r) > 0 && n(r) > n('reality')).sort((a, b) => n(b) - n(a))[0]
      if (best) (realm = best), (source = 'text')
    }
    for (const s of run) (s.realm = realm), (s.realmSource = source)
    rep.scenes.push({ episode: run[0].episode, location: locationKeyOf(run[0]), shots: run.map((s) => s.id), realm, source })
  }
  const keyOf = variantKeys(chars)
  for (const s of shots)
    for (const id of s.characterIds || []) {
      const k = keyOf.get(id)
      const r = crealm[id]
      if (!k || !r || r === s.realm) continue
      const sib = chars.filter((c) => c.characterKey === k && crealm[c.id] === s.realm)
      if (sib.length === 1) rep.variantMismatches.push({ shotId: s.id, realm: s.realm as Realm, cast: id, expected: sib[0].id })
    }
  return { exp: { ...exp, characters: chars as never, shots: shots as never }, report: rep }
}

/** the look variant (same characterKey) a shot switches to relative to another shot: `${key}: from → to`, else null */
export function lookSwitch(a: VideoPipelineShot, b: VideoPipelineShot, keyOf: Map<string, string>): string | null {
  const keys = (s: VideoPipelineShot) => {
    const m = new Map<string, string>()
    for (const id of [...(s.characterIds || []), ...(s.voiceOnly || [])]) {
      const k = keyOf.get(id)
      if (k) m.set(k, m.has(k) && m.get(k) !== id ? '*' : id)
    }
    return m
  }
  const ka = keys(a)
  for (const [k, id] of keys(b)) {
    const from = ka.get(k)
    if (from && from !== '*' && id !== '*' && from !== id) return `${from} → ${id}`
  }
  return null
}
/** characterKey per character id, only for keys shared by 2+ look variants */
export function variantKeys(chars: VideoPipelineExport['characters']): Map<string, string> {
  const n = new Map<string, number>()
  for (const c of chars) if (c.characterKey) n.set(c.characterKey, (n.get(c.characterKey) || 0) + 1)
  return new Map(chars.filter((c) => c.characterKey && n.get(c.characterKey)! > 1).map((c) => [c.id, c.characterKey!] as const))
}
