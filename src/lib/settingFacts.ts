/** Tier settingFacts so ending spoilers never reach the video model / shot prompts. */

export type SettingFactTier = 'world' | 'ongoing' | 'ending'

export interface SettingFactsByTier {
  world: string[]
  ongoing: string[]
  ending: string[]
}

/** Ending / spoiler cues (checked first). */
const ENDING_RE =
  /最后|结局|从对头变成|变成死党|全剧收尾|最终|真相是|发现[^，。]{1,6}一直|还债/

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

// ---------------- quote scrub (prompt-facing facts) ----------------

/** Quote pairs whose content is dialogue/plot lines; the video model paints them as on-screen text. */
const QUOTE_PAIRS: [string, string][] = [['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’'], ['"', '"']]
const SENT_PUNCT = /[，。！？、；…,.!?;~～]/
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Any quote mark that must not survive in a prompt-facing fact. */
export const QUOTE_MARK_RE = /[“”「」『』‘’"]/

/**
 * Remove quoted dialogue/plot lines from a fact (prompt-facing copy only).
 * Short keyword quotes (≤6 chars, no sentence punctuation) are unquoted; longer spans are dropped
 * together with the colon that introduced them.
 * 「忍不住许愿：“……”」→「忍不住许愿。」; 「只能选“A”」→「只能选A」.
 * Same rule as fixed/ref2va/convert_shot_to_ref2va.py scrub_quoted.
 */
export function scrubQuotedFact(fact: string): string {
  const orig = (fact || '').trim()
  let s = orig
  for (const [l, r] of QUOTE_PAIRS) {
    const re = new RegExp(`${esc(l)}([^${esc(l + r)}]*)${esc(r)}`, 'g')
    s = s.replace(re, (_m, inner: string) => {
      const x = inner.trim()
      return x && x.length <= 6 && !SENT_PUNCT.test(x) ? x : '\u0000'
    })
  }
  s = s
    .replace(/[：:]\s*\u0000/g, '\u0000')
    .replace(/\u0000+(?=[^\s。，；,;！？!?\u0000])/g, '，')
    .replace(/\u0000/g, '')
    .replace(/(?:说道|喊道|问道|说|道)?\s*[：:]\s*(?=[。，；,;！？!?]|$)/g, '')
    .replace(/[，,、]\s*([。；;])/g, '$1')
    .replace(/[，,]{2,}/g, '，')
    .replace(/(^|[。；;\n])\s*[，,、]+/g, '$1')
    .replace(/。{2,}/g, '。')
    .trim()
  if (s && s !== orig && /[。！？!?”」』’]\s*$/.test(orig) && !/[。！？!?；;]$/.test(s)) s += '。'
  return s
}

/** Tiers for prompt consumers: world/ongoing quote-scrubbed (classification on the original text); ending untouched. */
export function tierSettingFactsForPrompt(facts: string[] | undefined | null): SettingFactsByTier {
  return scrubTiers(tierSettingFacts(facts))
}
/** Scrub world/ongoing of an existing tier object (re-applicable to already exported packs). */
export function scrubTiers(t: SettingFactsByTier): SettingFactsByTier {
  const clean = (xs: string[] | undefined) => (xs || []).map(scrubQuotedFact).filter(Boolean)
  return { world: clean(t.world), ongoing: clean(t.ongoing), ending: [...(t.ending || [])] }
}

/**
 * Facts safe for storyboard / shot prompts / video pipeline consumption.
 * drama CLI should consume world+ongoing only (never ending); quoted lines are scrubbed.
 */
export function factsForShotPrompts(facts: string[] | undefined | null): string[] {
  const t = tierSettingFactsForPrompt(facts)
  return [...t.world, ...t.ongoing]
}
