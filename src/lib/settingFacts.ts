/** Tier settingFacts so ending spoilers never reach the video model / shot prompts. */

export type SettingFactTier = 'world' | 'ongoing' | 'ending'

export interface SettingFactsByTier {
  world: string[]
  ongoing: string[]
  ending: string[]
}

/** Ending / spoiler cues (checked first). */
const ENDING_RE =
  /最后|结局|从对头变成|变成死党|全剧收尾|最终|真相是|发现白朴一直|还债/

/** Stable world / identity / place cues (avoid 忍不住／不是／但是 false hits). */
const WORLD_RE = /(?<![不只但还正])是(?!的)|家住|住在|同住|租住|同班|邻居|富三代|家里穷|世界观|设定/

/** Classify one fact: ending > world > ongoing (deterministic Chinese heuristics). */
export function classifySettingFact(fact: string): SettingFactTier {
  const f = (fact || '').trim()
  if (!f) return 'ongoing'
  if (ENDING_RE.test(f)) return 'ending'
  if (WORLD_RE.test(f)) return 'world'
  return 'ongoing'
}

/** Partition settingFacts into world / ongoing / ending (order preserved within each tier). */
export function tierSettingFacts(facts: string[] | undefined | null): SettingFactsByTier {
  const out: SettingFactsByTier = { world: [], ongoing: [], ending: [] }
  for (const raw of facts || []) {
    const f = (raw || '').trim()
    if (!f) continue
    out[classifySettingFact(f)].push(f)
  }
  return out
}

/**
 * Facts safe for storyboard / shot prompts / video pipeline consumption.
 * drama CLI should consume world+ongoing only (never ending).
 */
export function factsForShotPrompts(facts: string[] | undefined | null): string[] {
  const t = tierSettingFacts(facts)
  return [...t.world, ...t.ongoing]
}
