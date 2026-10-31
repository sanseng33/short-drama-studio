/**
 * Scene grouping + cross-cut budget (video-pipeline@1, runs with the opt-in cross-cut split).
 *
 * Generic, pack-field driven (no show / shot data):
 *   locationKey = placeKey (fallback sceneId) — where the camera is.
 *   sceneGroup  = `ep<N>_g<k>`: a maximal run of consecutive shots of one episode with the same timeBand whose
 *                 places are linked by a cross-cut / facing-window exchange (any two places a split segment joined)
 *                 or are simply the same place. A group boundary (time-band change, a new unrelated place) is a
 *                 real scene change and is NOT counted against the budget.
 *
 * Regroup rule (only reorders shots that came out of ONE split segment, never dialogue lines):
 *   a split child with no dialogue line (a listener / reaction insert) that sits between two shots of another
 *   location (X → Y → X ping-pong) moves inside its own sibling block toward the edge that touches a shot at its
 *   own location (or the block edge), so the cut plays a run of one side, then the other. A move never creates a
 *   new pair of consecutive shots both shorter than rhythm (a)'s pairMinSec. Sibling children with
 *   lines keep their relative order, so every line keeps its order in the episode.
 *
 * Budget (report + gate): per sceneGroup at most `maxSwitchesPer` location switches per `perShots` shots
 * (ceil), and no alternation run (X Y X Y …) longer than `maxAlternation` shots. Switches are classified
 *   splitInternal (between children of one split segment), splitBoundary (child ↔ neighbour) or source
 *   (two unsplit shots, i.e. script order), and turnDriven when both sides of the switch carry a dialogue line of
 *   a different speaker (a genuine exchange — only a two-shot / off-screen voice could remove it).
 */
import type { VideoPipelineExport, VideoPipelineShot } from './videoExport'
import { locationNamer, normalizeLocation } from './locationNorm'

type Shot = VideoPipelineShot

export interface CrosscutBudget {
  /** allowed location switches per `perShots` shots inside one sceneGroup */
  maxSwitchesPer: number
  perShots: number
  /** longest allowed strict alternation run X Y X Y … (shots) */
  maxAlternation: number
  /** warn = report only; hold = mark the group's shots hold (runner defers); fail = repack exit 7 */
  gate: 'warn' | 'hold' | 'fail'
}
export const DEFAULT_CROSSCUT_BUDGET: CrosscutBudget = { maxSwitchesPer: 1, perShots: 3, maxAlternation: 4, gate: 'warn' }
export const CROSSCUT_BUDGET_NOTE = '交叉剪辑超出预算：'

export function parseCrosscutBudget(s: string | undefined): CrosscutBudget {
  const b = { ...DEFAULT_CROSSCUT_BUDGET }
  if (!s) return b
  for (const kv of s.split(',')) {
    const [k, v] = kv.split('=').map((x) => x.trim())
    if (k === 'gate') {
      if (v !== 'warn' && v !== 'hold' && v !== 'fail') throw new Error(`crosscut budget gate must be warn|hold|fail, got ${v}`)
      b.gate = v
    } else if (k === 'maxSwitchesPer' || k === 'perShots' || k === 'maxAlternation') {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 1) throw new Error(`crosscut budget ${k} must be a number ≥ 1`)
      b[k] = n
    } else throw new Error(`unknown crosscut budget key ${k}`)
  }
  return b
}

/**
 * locationKey (round 16): normalized location text (locationNorm.ts) — the script's own words for where the camera is;
 * placeKey is a coarse classifier bucket and only the fallback (missing / 'unknown' → sceneId). Packs without location
 * text keep the legacy placeKey key. A set shot.locationKey wins (assignLocationKeys / assignSceneGroups).
 */
export const locationKeyOf = (s: Pick<Shot, 'placeKey' | 'sceneId'> & { location?: string; locationKey?: string }): string =>
  s.locationKey || ((s.location || '').trim() ? normalizeLocation(s.location) : '') || (s.placeKey && s.placeKey !== 'unknown' ? s.placeKey : '') || s.sceneId || s.placeKey || ''

/**
 * Set locationKey on every shot: normalized location text with the pack's character names as owner prefixes.
 * A split child that the split moved to another placeKey (cross-cut window) gets the dominant text key of that placeKey.
 */
export function assignLocationKeys(exp: VideoPipelineExport): VideoPipelineExport {
  const namer = locationNamer(exp.characters)
  const own = (s: Shot) => ((s.location || '').trim() ? normalizeLocation(s.location, namer) : '') || (s.placeKey && s.placeKey !== 'unknown' ? s.placeKey : '') || s.sceneId || s.placeKey || ''
  const count = <K>(m: Map<K, Map<string, number>>, k: K, v: string) => {
    const x = m.get(k) || new Map<string, number>()
    x.set(v, (x.get(v) || 0) + 1)
    m.set(k, x)
  }
  const byPlace = new Map<string, Map<string, number>>()
  const byKey = new Map<string, Map<string, number>>()
  for (const s of exp.shots) if (!s.splitFrom && s.placeKey) {
    count(byPlace, s.placeKey, own(s))
    count(byKey, own(s), s.placeKey)
  }
  const top = (m?: Map<string, number>) => (m ? [...m].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined)
  const shots = exp.shots.map((s) => {
    let k = own(s)
    if (s.splitFrom && s.placeKey && top(byKey.get(k)) !== undefined && top(byKey.get(k)) !== s.placeKey) k = top(byPlace.get(s.placeKey)) || s.placeKey
    return { ...s, locationKey: k }
  })
  return { ...exp, shots }
}

/** placeKeys shared by different location texts (coarse place classification; report only) */
export function placeKeyConflicts(shots: Shot[]): { placeKey: string; locations: string[] }[] {
  const by = new Map<string, Set<string>>()
  for (const s of shots) if (s.placeKey && s.placeKey !== 'unknown' && s.location) by.set(s.placeKey, (by.get(s.placeKey) || new Set()).add(s.location.trim()))
  return [...by].filter(([, l]) => l.size > 1).map(([placeKey, l]) => ({ placeKey, locations: [...l] }))
}
const hasLine = (s: Shot) => Boolean(s.dialogueLines?.length || (s.dialogue || '').trim())
const speakers = (s: Shot) => new Set((s.dialogueLines?.length ? s.dialogueLines.map((l) => l.speaker) : [s.speaker]).filter(Boolean) as string[])

/** places linked by a split segment (children of one splitFrom at different places), per time band */
function linkedPlaces(shots: Shot[]): Set<string> {
  const by = new Map<string, Set<string>>()
  for (const s of shots) if (s.splitFrom) by.set(`${s.episode}\u0000${s.splitFrom}`, (by.get(`${s.episode}\u0000${s.splitFrom}`) || new Set()).add(locationKeyOf(s)))
  const pairs = new Set<string>()
  for (const set of by.values()) for (const a of set) for (const b of set) if (a !== b) pairs.add(`${a}\u0000${b}`)
  return pairs
}

/** Set locationKey + sceneGroup on every shot (output order). */
export function assignSceneGroups(exp0: VideoPipelineExport): VideoPipelineExport {
  const exp = assignLocationKeys(exp0)
  const links = linkedPlaces(exp.shots)
  let k = 0
  let prev: Shot | null = null
  let places = new Set<string>()
  const shots = exp.shots.map((s0) => {
    const s = { ...s0 }
    const loc = s.locationKey
    const same = prev && prev.episode === s.episode && (prev.timeBand || '') === (s.timeBand || '') && (places.has(loc) || [...places].some((p) => links.has(`${p}\u0000${loc}`)))
    if (!same) {
      k = prev && prev.episode === s.episode ? k + 1 : 1
      places = new Set()
    }
    places.add(loc)
    s.sceneGroup = `ep${s.episode}_g${k}`
    prev = s
    return s
  })
  return { ...exp, shots }
}

export interface RegroupMove {
  id: string
  splitFrom: string
  from: number
  to: number
  reason: string
}

/** Move silent split children toward the side of their sibling block that touches their own location. */
export function regroupSplitChildren(exp: VideoPipelineExport, opts: { pairMinSec?: number } = {}): { exp: VideoPipelineExport; moves: RegroupMove[] } {
  const shots = [...assignLocationKeys(exp).shots]
  const moves: RegroupMove[] = []
  let i = 0
  while (i < shots.length) {
    const sf = shots[i].splitFrom
    if (!sf) {
      i++
      continue
    }
    let j = i
    while (j + 1 < shots.length && shots[j + 1].splitFrom === sf && shots[j + 1].episode === shots[i].episode) j++
    // block [i..j]; neighbours outside the block
    const before = i > 0 && shots[i - 1].episode === shots[i].episode && (shots[i - 1].timeBand || '') === (shots[i].timeBand || '') ? shots[i - 1] : null
    const after = j + 1 < shots.length && shots[j + 1].episode === shots[i].episode && (shots[j + 1].timeBand || '') === (shots[i].timeBand || '') ? shots[j + 1] : null
    const block = shots.slice(i, j + 1)
    const original = block.map((s) => s.id)
    const switches = (arr: Shot[]) => {
      const seq = [before, ...arr, after].filter(Boolean) as Shot[]
      let n = 0
      for (let q = 1; q < seq.length; q++) if (locationKeyOf(seq[q]) !== locationKeyOf(seq[q - 1])) n++
      return n
    }
    // try every move of one silent child to another slot in the block; keep improving greedily
    // rhythm (a) guard: a move may not create a new pair of consecutive shots both < pairMinSec
    const pairMin = opts.pairMinSec ?? 4.5
    const shortPairs = (arr: Shot[]) => {
      const seq = [before, ...arr, after].filter(Boolean) as Shot[]
      let n = 0
      for (let q = 1; q < seq.length; q++) if (seq[q].durationSec < pairMin && seq[q - 1].durationSec < pairMin) n++
      return n
    }
    const pairs0 = shortPairs(block)
    let cur = block
    for (;;) {
      let best: { arr: Shot[]; n: number } | null = null
      const base = switches(cur)
      for (let a = 0; a < cur.length; a++) {
        if (hasLine(cur[a])) continue
        for (let b = 0; b < cur.length; b++) {
          if (b === a) continue
          const arr = [...cur]
          const [x] = arr.splice(a, 1)
          arr.splice(b, 0, x)
          // lines keep their order: the subsequence of line-carrying children is unchanged by construction
          const n = switches(arr)
          if (n < base && shortPairs(arr) <= pairs0 && (!best || n < best.n)) best = { arr, n }
        }
      }
      if (!best) break
      cur = best.arr
    }
    cur.forEach((s, q) => {
      const from = original.indexOf(s.id)
      if (from !== q && !hasLine(s)) moves.push({ id: s.id, splitFrom: sf, from: i + from, to: i + q, reason: `无台词插入镜移到同地点一侧（${locationKeyOf(s)}），减少乒乓切换` })
    })
    shots.splice(i, block.length, ...cur)
    i = j + 1
  }
  return { exp: moves.length ? { ...exp, shots } : exp, moves }
}

export interface GroupStats {
  group: string
  episode: number
  shots: number
  shotIds: string[]
  locations: string[]
  switches: number
  allowed: number
  longestRun: number
  longestAlternation: number
  splitInternal: number
  splitBoundary: number
  source: number
  turnDriven: number
  exceeded: boolean
  reasons: string[]
}
export interface EpisodeLocationStats {
  episode: number
  shots: number
  cuts: number
  locationChanges: number
  inGroupChanges: number
  longestRun: number
  groups: number
  sequence: string
}

function runs(seq: Shot[]) {
  let longestRun = seq.length ? 1 : 0
  let run = 1
  let alt = seq.length ? 1 : 0
  let a = 1
  for (let q = 1; q < seq.length; q++) {
    const ch = locationKeyOf(seq[q]) !== locationKeyOf(seq[q - 1])
    run = ch ? 1 : run + 1
    longestRun = Math.max(longestRun, run)
    // alternation: every step switches and q-2 is back at the same place
    a = ch && (q < 2 || locationKeyOf(seq[q]) === locationKeyOf(seq[q - 2]) || a === 1) ? a + 1 : 1
    alt = Math.max(alt, a)
  }
  return { longestRun, longestAlternation: alt }
}

export function locationStats(exp: VideoPipelineExport, budget: CrosscutBudget = DEFAULT_CROSSCUT_BUDGET): { episodes: EpisodeLocationStats[]; groups: GroupStats[] } {
  const shots = exp.shots.map((s) => (s.sceneGroup ? s : { ...s, locationKey: locationKeyOf(s) }))
  const eps = [...new Set(shots.map((s) => s.episode))].sort((a, b) => a - b)
  const letters = new Map<string, string>()
  const letter = (k: string) => {
    if (!letters.has(k)) letters.set(k, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[letters.size % 26])
    return letters.get(k)!
  }
  const episodes: EpisodeLocationStats[] = []
  const groups: GroupStats[] = []
  for (const ep of eps) {
    const e = shots.filter((s) => s.episode === ep)
    let ch = 0
    let inGroup = 0
    for (let q = 1; q < e.length; q++) {
      if (locationKeyOf(e[q]) !== locationKeyOf(e[q - 1])) {
        ch++
        if (e[q].sceneGroup && e[q].sceneGroup === e[q - 1].sceneGroup) inGroup++
      }
    }
    const gs = [...new Set(e.map((s) => s.sceneGroup).filter(Boolean))] as string[]
    episodes.push({ episode: ep, shots: e.length, cuts: Math.max(0, e.length - 1), locationChanges: ch, inGroupChanges: inGroup, longestRun: runs(e).longestRun, groups: gs.length, sequence: e.map((s) => letter(locationKeyOf(s))).join('') })
    for (const g of gs) {
      const seq = e.filter((s) => s.sceneGroup === g)
      const st: GroupStats = {
        group: g, episode: ep, shots: seq.length, shotIds: seq.map((s) => s.id), locations: [...new Set(seq.map(locationKeyOf))],
        switches: 0, allowed: Math.ceil((seq.length * budget.maxSwitchesPer) / budget.perShots), ...runs(seq),
        splitInternal: 0, splitBoundary: 0, source: 0, turnDriven: 0, exceeded: false, reasons: [],
      }
      for (let q = 1; q < seq.length; q++) {
        const [x, y] = [seq[q - 1], seq[q]]
        if (locationKeyOf(x) === locationKeyOf(y)) continue
        st.switches++
        if (x.splitFrom && x.splitFrom === y.splitFrom) st.splitInternal++
        else if (x.splitFrom || y.splitFrom) st.splitBoundary++
        else st.source++
        const sx = speakers(x)
        if (hasLine(x) && hasLine(y) && [...speakers(y)].some((p) => !sx.has(p))) st.turnDriven++
      }
      if (st.switches > st.allowed) st.reasons.push(`切换 ${st.switches} > 预算 ${st.allowed}（每 ${budget.perShots} 镜 ${budget.maxSwitchesPer} 次）`)
      if (st.longestAlternation > budget.maxAlternation) st.reasons.push(`连续交替 ${st.longestAlternation} 镜 > ${budget.maxAlternation}`)
      st.exceeded = st.reasons.length > 0
      groups.push(st)
    }
  }
  return { episodes, groups }
}

/** gate=hold: every shot of an over-budget group gets a hold reason (runner defers); other gates leave shots alone. Run after applyRenderHold. */
export function applyCrosscutGate(exp: VideoPipelineExport, groups: GroupStats[], budget: CrosscutBudget): VideoPipelineExport {
  if (budget.gate !== 'hold') return exp
  const bad = new Map(groups.filter((g) => g.exceeded).map((g) => [g.group, g.reasons.join('；')]))
  if (!bad.size) return exp
  return {
    ...exp,
    shots: exp.shots.map((s) => {
      const r = s.sceneGroup ? bad.get(s.sceneGroup) : undefined
      if (!r) return s
      const note = `${CROSSCUT_BUDGET_NOTE}${s.sceneGroup} ${r}`
      return { ...s, hold: { reason: [...(s.hold?.reason || []), note] } }
    }),
  }
}

export interface CarryBreak { id: string; field: 'carryFromPrev' | 'carryFromShotId'; from: string; reason: string }

/**
 * Carries never cross a location change or a time-band change (round 16): carryFromPrev → false and a carryFromShotId
 * whose source is at another locationKey / timeBand → null (start from the pack ref + the group's sceneKeyframe).
 * Every shot gets sceneKeyframe `<sceneGroup>@<locationKey>`; establishing = true on the first shot of each
 * (sceneGroup, locationKey) and on every shot whose carry was broken.
 */
export function breakCarries(exp: VideoPipelineExport): { exp: VideoPipelineExport; breaks: CarryBreak[] } {
  const breaks: CarryBreak[] = []
  const byId = new Map(exp.shots.map((s) => [s.id, s] as const))
  const seen = new Set<string>()
  const same = (a: Shot, b: Shot) => a.episode === b.episode && locationKeyOf(a) === locationKeyOf(b) && (a.timeBand || '') === (b.timeBand || '')
  const why = (a: Shot, b: Shot) => (locationKeyOf(a) !== locationKeyOf(b) ? `地点 ${locationKeyOf(a)} → ${locationKeyOf(b)}` : `时段 ${a.timeBand} → ${b.timeBand}`)
  const shots = exp.shots.map((s0, i) => {
    const s: Shot = { ...s0 }
    const prev = exp.shots[i - 1]
    let broke = false
    if (s.carryFromPrev && prev && prev.episode === s.episode && !same(prev, s)) {
      breaks.push({ id: s.id, field: 'carryFromPrev', from: prev.id, reason: why(prev, s) })
      s.carryFromPrev = false
      broke = true
    }
    if (typeof s.carryFromShotId === 'string') {
      const src = byId.get(s.carryFromShotId)
      if (src && !same(src, s)) {
        breaks.push({ id: s.id, field: 'carryFromShotId', from: src.id, reason: why(src, s) })
        s.carryFromShotId = null
        broke = true
      }
    }
    const kf = `${s.sceneGroup || `ep${s.episode}`}@${locationKeyOf(s)}`
    s.sceneKeyframe = kf
    s.establishing = broke || !seen.has(kf)
    seen.add(kf)
    return s
  })
  return { exp: { ...exp, shots }, breaks }
}
