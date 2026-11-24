import { sha1Hex } from '../hash'
import type { Character, EpisodeScript, Shot } from '../../types'
import type { SourceFingerprint } from './types'

/** 分镜台词指纹：按 shotNo 升序（相同 shotNo 保持原相对顺序），将每镜 dialogue 以 \n 拼接后 sha1Hex。缺 dialogue 视为空串。 */
export function shotsHash(shots: Pick<Shot, 'shotNo' | 'dialogue'>[] | undefined | null): string {
  const list = Array.isArray(shots) ? shots.slice() : []
  list.sort((a, b) => (Number(a.shotNo) || 0) - (Number(b.shotNo) || 0))
  return sha1Hex(list.map((s) => (s && typeof s.dialogue === 'string' ? s.dialogue : '')).join('\n'))
}

export function scriptHash(fullText: string | undefined | null): string {
  return sha1Hex(typeof fullText === 'string' ? fullText : '')
}

export function factsHash(facts: string[] | undefined | null): string {
  return sha1Hex(JSON.stringify(Array.isArray(facts) ? facts : []))
}

export function locationsHash(locations: string[] | undefined | null): string {
  return sha1Hex(JSON.stringify(Array.isArray(locations) ? locations : []))
}

export function charactersLookHash(characters: Character[] | undefined | null): string {
  const list = Array.isArray(characters) ? characters : []
  const slim = list.map((c) => ({
    id: c?.id ?? '',
    name: c?.name ?? '',
    visualLock: c?.visualLock ?? '',
    costume: c?.costume ?? '',
    signatureProp: c?.signatureProp ?? '',
    refImage: c?.refImage ?? '',
    characterKey: c?.characterKey ?? '',
    locked: c?.locked ?? false,
    lookVariants: c?.lookVariants ?? [],
    wardrobeState: c?.wardrobeState ?? '',
  }))
  return sha1Hex(JSON.stringify(slim))
}

export function scriptHashByEpisode(scripts: Record<number, EpisodeScript> | undefined | null): Record<number, string> {
  const out: Record<number, string> = {}
  if (!scripts || typeof scripts !== 'object') return out
  for (const [k, script] of Object.entries(scripts)) {
    const ep = Number(k)
    if (!Number.isFinite(ep)) continue
    out[ep] = scriptHash(script?.fullText)
  }
  return out
}

export function buildFingerprints(input: {
  scripts?: Record<number, EpisodeScript>
  settingFacts?: string[]
  locations?: string[]
  characters?: Character[]
}): SourceFingerprint {
  return {
    scriptHashByEpisode: scriptHashByEpisode(input.scripts),
    factsHash: factsHash(input.settingFacts),
    locationsHash: locationsHash(input.locations),
    charactersLookHash: charactersLookHash(input.characters),
  }
}
